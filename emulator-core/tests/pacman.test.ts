// pacman.test.ts — режим «Pac-Man»: ROM-лабиринт (стадия 1 + замуровка базы),
// точки, сбор DEF-танками, счётчик, победа, бомбы.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";
import ROMClass from "../src/rom.js";
import { applyPatchSet } from "../patching/apply.ts";
import { DOT_TILE, dotCells, BOMBS, isWallBlock } from "../features/pacman-maze.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function boot(features: string[] = ["pacman"]) {
  const emu = new PvPNes({ patchSet: "pvp", features, attAI: "off", defAI: "off" });
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
  emu.stepFrame([]);
  return emu;
}

test("pacman: ROM-патч меняет fingerprint фичи, база не тронута", () => {
  const romBase = new ROMClass(null);
  romBase.load(ROM);
  const base = applyPatchSet(romBase, "pvp");
  assert.strictEqual(base.fingerprint, "94cb0636");
  const rom = new ROMClass(null);
  rom.load(ROM);
  const rep = applyPatchSet(rom, { base: "pvp", features: ["pacman"] });
  assert.deepStrictEqual(rep.features, ["pacman"]);
  assert.notStrictEqual(rep.fingerprint, base.fingerprint);
});

test("pacman: лабиринт из бетона, база замурована, точки расставлены", () => {
  const emu = boot();
  // стена лабиринта: берём любой блок-стену и проверяем FIELD
  let wr = -1, wc = -1;
  for (let r = 0; r < 13 && wr < 0; r++) for (let c = 0; c < 13; c++) if (isWallBlock(r, c)) { wr = r; wc = c; break; }
  const woff = (2 + 2 * wr) * 32 + (2 + 2 * wc);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + woff], 0x10, "нет бетонной стены лабиринта");
  // база замурована: field row25 col13 (кирпич -> бетон)
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (25 * 32 + 13)], 0x10, "база не замурована");
  // точки: счётчик и хотя бы одна точка в nametable
  const left = emu.readMem(RAM.DOTS_LEFT) | (emu.readMem(RAM.DOTS_LEFT + 1) << 8);
  assert.ok(left > 0, "точки не расставлены");
  assert.strictEqual(emu.readMem(RAM.PACMAN_WIN), 0, "win не должен быть выставлен сразу");
  const off = dotCells()[0];
  assert.strictEqual(emu.ppu.nameTable[0].tile[off], DOT_TILE, "нет глифа точки");
});

test("pacman: все точки достижимы (связный лабиринт)", () => {
  const reach = new Set<number>([0 * 13 + 0]);
  const q: number[] = [0 * 13 + 0];
  while (q.length) {
    const k = q.pop()!;
    const r = (k / 13) | 0,
      c = k % 13;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
      const nr = r + dr,
        nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= 13 || nc >= 13) continue;
      if (isWallBlock(nr, nc)) continue;
      const nk = nr * 13 + nc;
      if (!reach.has(nk)) {
        reach.add(nk);
        q.push(nk);
      }
    }
  }
  for (const off of dotCells()) {
    const r = ((off / 32) | 0), c = off % 32;
    const br = (r - 2) / 2, bc = (c - 2) / 2;
    assert.ok(reach.has(br * 13 + bc), `точка (${br},${bc}) недостижима`);
  }
});

test("pacman: бомбы стоят в углах и на проходимых клетках", () => {
  for (const b of BOMBS) {
    const off = b.off;
    const r = (off / 32) | 0,
      c = off % 32;
    const br = (r - 2) / 2,
      bc = (c - 2) / 2;
    assert.ok(!isWallBlock(br, bc), `бомба (${br},${bc}) в стене`);
    assert.ok((br === 0 || br === 12) && (bc === 0 || bc === 12), `бомба (${br},${bc}) не в углу`);
  }
});

test("pacman: хитбокс точки — целый блок (сбор со смещением) + звук", () => {
  const emu = boot();
  const off = dotCells().find((o) => emu.ppu.nameTable[0].tile[o] === DOT_TILE)!;
  const before = emu.readMem(RAM.DOTS_LEFT) | (emu.readMem(RAM.DOTS_LEFT + 1) << 8);
  emu.cpu.mem[RAM.SFX_SHOT] = 0;
  emu.cpu.mem[RAM.SFX_BULLET_HIT_TANK] = 0;
  // танк смещён на соседнюю половину блока — всё равно должен собрать
  emu.cpu.mem[RAM.TANK_X] = ((off % 32) + 1) * 8;
  emu.cpu.mem[RAM.TANK_Y] = ((off / 32) | 0) * 8;
  emu.cpu.mem[RAM.TANK_FLAG] = 0x90;
  emu.stepFrame([]);
  const after = emu.readMem(RAM.DOTS_LEFT) | (emu.readMem(RAM.DOTS_LEFT + 1) << 8);
  assert.ok(after < before, "точка не собрана при смещении в пределах блока");
  assert.ok(
    emu.readMem(RAM.SFX_SHOT) === 1 || emu.readMem(RAM.SFX_BULLET_HIT_TANK) === 1,
    "нет звука сбора точки",
  );
});

test("pacman: без фичи база остаётся кирпичной", () => {
  const emu = boot([]);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (25 * 32 + 13)], 0x0f, "база должна быть кирпичной без фичи");
});

test("pacman: DEF-танк собирает точку, счётчик уменьшается", () => {
  const emu = boot();
  const off = dotCells().find((o) => emu.ppu.nameTable[0].tile[o] === DOT_TILE)!;
  const before = emu.readMem(RAM.DOTS_LEFT) | (emu.readMem(RAM.DOTS_LEFT + 1) << 8);
  emu.cpu.mem[RAM.TANK_X] = (off % 32) * 8;
  emu.cpu.mem[RAM.TANK_Y] = ((off / 32) | 0) * 8;
  emu.cpu.mem[RAM.TANK_FLAG] = 0x90;
  emu.stepFrame([]);
  const after = emu.readMem(RAM.DOTS_LEFT) | (emu.readMem(RAM.DOTS_LEFT + 1) << 8);
  assert.ok(after < before, "точка не собрана");
  assert.strictEqual(emu.ppu.nameTable[0].tile[off], 0, "точка не убрана с экрана");
});

test("pacman: зачистка всех точек даёт победу DEF", () => {
  const emu = boot();
  for (const off of dotCells()) emu.ppu.nameTable[0].tile[off] = 0;
  emu.loadState(emu.saveState()); // снапшот уже без точек -> onLoadState пересоберёт множество
  emu.stepFrame([]);
  assert.strictEqual(emu.readMem(RAM.PACMAN_WIN), 1, "победа DEF не выставлена");
});

function bombOn(emu: any): boolean {
  const off = BOMBS[0].off;
  const nt = emu.ppu.nameTable[0];
  return nt.tile[off] !== 0 && nt.tile[off + 1] !== 0 && nt.tile[off + 32] !== 0 && nt.tile[off + 33] !== 0;
}

test("pacman: бомбы рисуются BG 2×2 (иконка приза) и мигают", () => {
  const emu = boot();
  let sawOn = false,
    sawOff = false;
  for (let i = 0; i < 24; i++) {
    emu.stepFrame([]);
    if (bombOn(emu)) sawOn = true;
    else sawOff = true;
  }
  assert.ok(sawOn, "бомбы не рисуются");
  assert.ok(sawOff, "бомбы не мигают");
});

test("pacman: бомба — стационарный приз, подбор выдаёт ROM-приз", () => {
  const emu = boot();
  const bomb = BOMBS[0];
  emu.cpu.mem[RAM.PRIZE_X] = 0;
  emu.cpu.mem[RAM.TANK_X] = (bomb.off % 32) * 8;
  emu.cpu.mem[RAM.TANK_Y] = ((bomb.off / 32) | 0) * 8;
  emu.cpu.mem[RAM.TANK_FLAG] = 0x90;
  emu.stepFrame([]);
  assert.strictEqual(emu.readMem(RAM.PRIZE_ID), bomb.id, "приз не выдан");
});
