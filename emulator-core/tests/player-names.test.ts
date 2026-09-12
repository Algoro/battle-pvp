// player-names.test.ts — фича player-names: имя над танком через BG-overlay nametable.
// Проверяем: отрисовку глифов, центровку, восстановление при движении, отсутствие
// влияния на cpu.mem/хэш, исключение overlay из saveState, регистрацию и отсутствие
// эффекта без имён.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";
import { listFeatures } from "../patching/registry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function boot(features: string[] = ["player-names"], names: Record<number, string> = {}) {
  const emu = new PvPNes({ patchSet: "pvp", features, names, attAI: "off", defAI: "off" });
  emu.loadROM(ROM);
  for (let f = 1; f <= 1500; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? BTN.Start : 0 }]);
    if (emu.readMem(RAM.ENEMIES_LEFT) !== 0xff) break;
  }
  for (let f = 0; f < 400; f++) {
    const flag = emu.readMem(RAM.TANK_FLAG);
    if ((flag & 0x80) && flag < 0xe0) break;
    emu.stepFrame([{ port: 0, buttons: 0 }]);
  }
  emu.stepFrame([]); // применить overlay
  return emu;
}

function overlayCells(emu: any) {
  return (emu._runtimes.find((r: any) => r.id === "player-names")?.ctx.state.overlay || []) as any[];
}

test("player-names: фича зарегистрирована", () => {
  assert.ok(listFeatures().some((f) => f.id === "player-names"));
});

test("player-names: глифы рисуются над живым танком (центровка)", () => {
  const emu = boot(["player-names"], { 0: "AB" });
  const x = emu.readMem(RAM.TANK_X);
  const y = emu.readMem(RAM.TANK_Y);
  const row = (y >> 3) - 1;
  const start = (x >> 3) - 0; // len=2 -> (len-1)>>1 = 0
  const nt = emu.ppu.nameTable[0];
  assert.strictEqual(nt.tile[row * 32 + start], "A".charCodeAt(0), "нет глифа A");
  assert.strictEqual(nt.tile[row * 32 + start + 1], "B".charCodeAt(0), "нет глифа B");
  assert.ok(overlayCells(emu).length >= 2, "overlay не заполнен");
});

test("player-names: без имён ничего не рисуется", () => {
  const emu = boot(["player-names"], {});
  assert.strictEqual(overlayCells(emu).length, 0, "overlay не должен появляться");
});

test("player-names: без фичи ничего не рисуется", () => {
  const emu = boot([], { 0: "AB" });
  const x = emu.readMem(RAM.TANK_X);
  const y = emu.readMem(RAM.TANK_Y);
  const nt = emu.ppu.nameTable[0];
  assert.notStrictEqual(nt.tile[((y >> 3) - 1) * 32 + (x >> 3)], "A".charCodeAt(0));
});

test("player-names: при движении старая строка восстанавливается", () => {
  const names = { 0: "AB" };
  const on = boot(["player-names"], names);
  const off = boot([], names);
  const y0 = on.readMem(RAM.TANK_Y);
  const x0 = on.readMem(RAM.TANK_X);
  const offRow = (y0 >> 3) - 1;
  const offCol = x0 >> 3;
  const baseTile = off.ppu.nameTable[0].tile[offRow * 32 + offCol];
  // смещаем танк на 4 тайла (32px) и прокручиваем кадр
  on.cpu.mem[RAM.TANK_X] = (x0 + 32) & 0xff;
  on.stepFrame([]);
  assert.strictEqual(
    on.ppu.nameTable[0].tile[offRow * 32 + offCol],
    baseTile,
    "старая клетка не восстановлена",
  );
});

test("player-names: overlay не меняет cpu.mem/хэш кадра", () => {
  const a = boot(["player-names"], { 0: "NAME" });
  const b = boot([], {});
  for (let i = 0; i < 60; i++) {
    a.stepFrame([]);
    b.stepFrame([]);
    assert.strictEqual(a.getFrameHash(), b.getFrameHash(), `хэш разошёлся на кадре ${i}`);
  }
});

test("player-names: overlay исключается из saveState", () => {
  const on = boot(["player-names"], { 0: "AB" });
  const x = on.readMem(RAM.TANK_X);
  const y = on.readMem(RAM.TANK_Y);
  const off = (y >> 3) - 1;
  const col = x >> 3;
  const saved = on.saveState();
  // снапшот снят без overlay -> загрузка в чистое ядро не должна содержать глиф
  const clean = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off" });
  clean.loadROM(ROM);
  clean.loadState(saved);
  assert.notStrictEqual(
    clean.ppu.nameTable[0].tile[off * 32 + col],
    "A".charCodeAt(0),
    "overlay попал в saveState",
  );
});
