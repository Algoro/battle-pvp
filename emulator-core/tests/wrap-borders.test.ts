// wrap-borders.test.ts — фича «открытые края»: ROM убирает рамку, рантайм делает тор.
// Запуск: node --test tests/wrap-borders.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";
import ROMClass from "../src/rom.js";
import { applyPatchSet } from "../patching/apply.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

const LOW = 0x18;
const HIGH = 0xd8;
const PERIOD = HIGH - LOW;

function boot(features: string[] = ["wrap-borders"], zeroField = true) {
  const emu = new PvPNes({ patchSet: "pvp", features, attAI: "off", defAI: "off" });
  emu.loadROM(ROM);
  for (let f = 1; f <= 3000; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? BTN.Start : 0 }]);
    if (emu.readMem(RAM.GAME_OVER) === 0x80) break;
  }
  emu.cpu.mem[RAM.PAUSE] = 0;
  for (let f = 0; f < 300; f++) {
    const flag = emu.readMem(RAM.TANK_FLAG);
    if ((flag & 0x80) && flag < 0xe0) break;
    emu.stepFrame([{ port: 0, buttons: 0 }]);
  }
  if (zeroField) emu.cpu.mem.fill(0, RAM.FIELD, RAM.FIELD + 1024); // чистое поле для проверки переноса
  return emu;
}
const idle = (emu: PvPNes, n = 1) => {
  for (let i = 0; i < n; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
};

test("wrap-borders: ROM-патч убирает рамку, fingerprint меняется", () => {
  const romBase = new ROMClass(null);
  romBase.load(ROM);
  const base = applyPatchSet(romBase, "pvp");
  const rom = new ROMClass(null);
  rom.load(ROM);
  const rep = applyPatchSet(rom, { base: "pvp", features: ["wrap-borders"] });
  assert.notStrictEqual(rep.fingerprint, base.fingerprint);
  const w = rep.applied.find((a: any) => a.type === "write" && a.id === "stage-fill-empty");
  assert.ok(w && w.at === 0xd7ce);

  const emu = boot(["wrap-borders"]);
  assert.strictEqual(emu.readMem(RAM.FIELD), 0, "рамка поля должна быть пустой");
  assert.strictEqual(emu.ppu.nameTable[0].tile[0], 0, "рамка nametable должна быть пустой");
  const plain = boot([], false);
  assert.strictEqual(plain.readMem(RAM.FIELD), 0x11, "без фичи рамка на месте");
});

test("wrap-borders: танк переносится через шов по X и Y", () => {
  const emu = boot();
  const m = emu.cpu.mem;
  m[RAM.TANK_FLAG] = 0x80; // стоящий DEF0
  m[RAM.TANK_X] = LOW;
  m[RAM.TANK_Y] = 0x80;
  idle(emu, 1); // запомнить позицию как предыдущую
  m[RAM.TANK_X] = LOW - 8; // шаг наружу влево
  idle(emu, 1);
  assert.strictEqual(m[RAM.TANK_X], LOW - 8 + PERIOD, "перенос из левого шва в правый");

  m[RAM.TANK_X] = HIGH + 8; // шаг наружу вправо
  idle(emu, 1);
  assert.strictEqual(m[RAM.TANK_X], HIGH + 8 - PERIOD, "перенос из правого шва в левый");

  m[RAM.TANK_X] = LOW;
  m[RAM.TANK_Y] = LOW;
  idle(emu, 1);
  m[RAM.TANK_X] = LOW - 8;
  m[RAM.TANK_Y] = LOW - 8;
  idle(emu, 1);
  assert.strictEqual(m[RAM.TANK_X], LOW - 8 + PERIOD, "X-перенос при выходе по диагонали");
  assert.strictEqual(m[RAM.TANK_Y], LOW - 8 + PERIOD, "Y-перенос при выходе по диагонали");
});

test("wrap-borders: занятая противоположная сторона — танк упирается в шов", () => {
  const emu = boot();
  const m = emu.cpu.mem;
  const cy = 0x80;
  m[RAM.TANK_FLAG] = 0x80;
  m[RAM.TANK_X] = LOW;
  m[RAM.TANK_Y] = cy;
  idle(emu, 1);
  // назначаем сталь на противоположном (правом) краю
  const c0 = (LOW - 8 + PERIOD - 8) >> 3;
  const r0 = (cy - 8) >> 3;
  for (let r = r0; r <= r0 + 1; r++) for (let c = c0; c <= c0 + 1; c++) m[RAM.FIELD + r * 32 + c] = 0x10;
  m[RAM.TANK_X] = LOW - 8;
  idle(emu, 1);
  assert.strictEqual(m[RAM.TANK_X], LOW, "танк должен остаться у шва, а не пройти сквозь стену");
});

test("wrap-borders: пуля переносится, а в стену — гаснет", () => {
  const emu = boot();
  const m = emu.cpu.mem;
  m[RAM.BULLET_STATUS] = 0x41; // летит влево
  m[RAM.BULLET_X] = LOW;
  m[RAM.BULLET_Y] = 0x80;
  idle(emu, 1);
  m[RAM.BULLET_X] = LOW - 8;
  idle(emu, 1);
  assert.ok(m[RAM.BULLET_X] > 0xb0, "пуля должна уйти на правую половину поля");

  const emu2 = boot();
  const m2 = emu2.cpu.mem;
  const cy = 0x80;
  m2[RAM.BULLET_STATUS] = 0x41;
  m2[RAM.BULLET_X] = LOW;
  m2[RAM.BULLET_Y] = cy;
  idle(emu2, 1);
  const c0 = (LOW - 8 + PERIOD - 8) >> 3;
  const r0 = (cy - 8) >> 3;
  for (let r = r0; r <= r0 + 1; r++) for (let c = c0; c <= c0 + 1; c++) m2[RAM.FIELD + r * 32 + c] = 0x10;
  m2[RAM.BULLET_X] = LOW - 8;
  idle(emu2, 1);
  assert.strictEqual(m2[RAM.BULLET_STATUS], 0x33, "пуля должна погаснуть о стену на другой стороне");
});

test("wrap-borders: детерминизм (одинаковый hash у двух инстансов)", () => {
  const a = boot();
  const b = boot();
  for (const emu of [a, b]) {
    emu.cpu.mem[RAM.TANK_FLAG] = 0x80;
    emu.cpu.mem[RAM.TANK_X] = LOW;
    emu.cpu.mem[RAM.TANK_Y] = 0x80;
  }
  for (let i = 0; i < 40; i++) {
    a.stepFrame([{ port: 0, buttons: i % 7 === 0 ? 0x40 : 0 }]);
    b.stepFrame([{ port: 0, buttons: i % 7 === 0 ? 0x40 : 0 }]);
  }
  assert.strictEqual(a.getFrameHash(), b.getFrameHash());
});
