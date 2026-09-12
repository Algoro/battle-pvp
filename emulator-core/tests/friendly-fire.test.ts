// friendly-fire.test.ts — фичи friendly-fire-def / friendly-fire-att.
//   def: ROM ставит стан 0xC8 при попадании своего — рантайм превращает в смерть.
//   att: рантайм добавляет коллизию враг-пуля→враг-танк (броня, приз).
// Запуск: node --test tests/friendly-fire.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function boot(features: string[]) {
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
  return emu;
}

// Пустая клетка поля (не стена), с координатами центра.
function emptyCell(emu: any): { x: number; y: number } {
  for (let i = 0; i < 32 * 32; i++) {
    if (emu.cpu.mem[RAM.FIELD + i] === 0) {
      const col = i % 32, row = (i / 32) | 0;
      return { x: col * 8 + 4, y: row * 8 + 4 };
    }
  }
  throw new Error("нет пустой клетки");
}

function parkTanks(emu: any, tanks: number[]) {
  for (const t of tanks) {
    emu.cpu.mem[RAM.TANK_FLAG + t] = 0;
    emu.cpu.mem[RAM.BULLET_STATUS + t] = 0;
  }
}

// DEF-пуля (слот 0) точно в танк 1.
function aimP0AtP1(emu: any) {
  const c = emptyCell(emu);
  for (const t of [0, 2, 3, 4, 5, 6, 7]) {
    emu.cpu.mem[RAM.TANK_FLAG + t] = 0;
    emu.cpu.mem[RAM.BULLET_STATUS + t] = 0;
  }
  emu.cpu.mem[RAM.TANK_X] = (c.x + 32) & 0xff; // владелец подальше
  emu.cpu.mem[RAM.TANK_Y] = c.y;
  emu.cpu.mem[RAM.TANK_FLAG] = 0x90;
  emu.cpu.mem[RAM.TANK_X + 1] = c.x;
  emu.cpu.mem[RAM.TANK_Y + 1] = c.y;
  emu.cpu.mem[RAM.TANK_FLAG + 1] = 0x90;
  emu.cpu.mem[RAM.TANK_TYPE + 1] = 0;
  emu.cpu.mem[RAM.HELMET + 1] = 0;
  emu.cpu.mem[RAM.STUN + 1] = 0;
  emu.cpu.mem[RAM.BULLET_STATUS] = 0x40;
  emu.cpu.mem[RAM.BULLET_X] = c.x;
  emu.cpu.mem[RAM.BULLET_Y] = c.y;
}

// Вражеская пуля (слот 2) точно в танк 3.
function aimEnemy2AtEnemy3(emu: any, type3 = 0x80) {
  const c = emptyCell(emu);
  parkTanks(emu, [0, 1, 4, 5, 6, 7]);
  emu.cpu.mem[RAM.TANK_X + 2] = c.x;
  emu.cpu.mem[RAM.TANK_Y + 2] = c.y;
  emu.cpu.mem[RAM.TANK_FLAG + 2] = 0x90;
  emu.cpu.mem[RAM.TANK_TYPE + 2] = 0x80;
  emu.cpu.mem[RAM.TANK_X + 3] = c.x;
  emu.cpu.mem[RAM.TANK_Y + 3] = c.y;
  emu.cpu.mem[RAM.TANK_FLAG + 3] = 0x90;
  emu.cpu.mem[RAM.TANK_TYPE + 3] = type3;
  emu.cpu.mem[RAM.BULLET_STATUS + 2] = 0x40;
  emu.cpu.mem[RAM.BULLET_X + 2] = c.x;
  emu.cpu.mem[RAM.BULLET_Y + 2] = c.y;
}

test("ff-def: попадание защитника в защитника убивает (фича включена)", () => {
  const emu = boot(["friendly-fire-def"]);
  aimP0AtP1(emu);
  emu.stepFrame([]);
  emu.stepFrame([]);
  assert.strictEqual(emu.cpu.mem[RAM.TANK_FLAG + 1], 0x73, "союзник не убит friendly fire");
});

test("ff-def: без фичи союзник остаётся жив (стан)", () => {
  const emu = boot([]);
  aimP0AtP1(emu);
  emu.stepFrame([]);
  assert.notStrictEqual(emu.cpu.mem[RAM.TANK_FLAG + 1], 0x73, "без фичи не должно убивать");
});

test("ff-att: попадание врага во врага убивает (фича включена)", () => {
  const emu = boot(["friendly-fire-att"]);
  aimEnemy2AtEnemy3(emu, 0x80);
  emu.stepFrame([]);
  assert.strictEqual(emu.cpu.mem[RAM.TANK_FLAG + 3], 0x73, "враг не убит friendly fire");
  assert.strictEqual(emu.cpu.mem[RAM.BULLET_STATUS + 2], 0x33, "пуля не погашена");
});

test("ff-att: без фичи враг не получает урон", () => {
  const emu = boot([]);
  aimEnemy2AtEnemy3(emu, 0x80);
  emu.stepFrame([]);
  assert.notStrictEqual(emu.cpu.mem[RAM.TANK_FLAG + 3], 0x73, "без фичи урона быть не должно");
});

test("ff-att: броня поглощает попадание союзника", () => {
  const emu = boot(["friendly-fire-att"]);
  aimEnemy2AtEnemy3(emu, 0xa1); // armor&3 = 1
  emu.stepFrame([]);
  assert.notStrictEqual(emu.cpu.mem[RAM.TANK_FLAG + 3], 0x73, "танк должен выжить");
  assert.strictEqual(emu.cpu.mem[RAM.TANK_TYPE + 3], 0xa0, "броня должна уменьшиться");
});

test("ff-att: убийство носителя приза заставляет приз выпасть", () => {
  const emu = boot(["friendly-fire-att"]);
  emu.cpu.mem[RAM.PRIZE_X] = 0; // приз не активен
  aimEnemy2AtEnemy3(emu, 0x84); // carrier, armor&3 = 0 -> смерть
  emu.stepFrame([]);
  assert.strictEqual(emu.cpu.mem[RAM.TANK_FLAG + 3], 0x73, "носитель не убит");
  assert.notStrictEqual(emu.cpu.mem[RAM.PRIZE_X], 0, "приз не выпал");
});
