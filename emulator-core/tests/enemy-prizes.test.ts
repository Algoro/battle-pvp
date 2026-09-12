// enemy-prizes.test.ts — фича `enemy-prizes`: враги (танки 2..7) поглощают призы.
// Патч хукает sub_E972 ($E972); рутина проверяет танки 2..7 на близость к призу и
// «съедает» его (без player-индексированных эффектов). Запуск: node --test tests/enemy-prizes.test.ts
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { applyPatchSet } from "../patching/apply.ts";
import { RomImage } from "../patching/rom-image.ts";
import { listFeatures } from "../patching/registry.ts";
import ROMClass from "../src/rom.js";
import { RAM } from "../rom-contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const ROM = readFileSync(join(ROOT, "rom", "original", "_battle_city.nes"));

// Быстрый старт и ожидание живого DEF-танка 0.
function boot(features = ["enemy-prizes"]) {
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

const idle = (emu, n = 1) => {
  for (let i = 0; i < n; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
};

// Поставить "живого" врага (слот 2) точно на приз.
function enemyOnBonus(emu, id = 3, x = 100, y = 100) {
  emu.cpu.mem[RAM.TANK_X + 2] = x;
  emu.cpu.mem[RAM.TANK_Y + 2] = y;
  emu.cpu.mem[RAM.TANK_FLAG + 2] = 0x90; // жив, не взрыв/респавн
  emu.cpu.mem[RAM.TANK_TYPE + 2] = 0x80;
  emu.spawnBonus(id, x, y);
}

test("enemy-prizes: фича зарегистрирована и меняет fingerprint", () => {
  assert.ok(listFeatures().some((f) => f.id === "enemy-prizes"), "фича не в реестре");
  const romBase = new ROMClass(null);
  romBase.load(ROM);
  const base = applyPatchSet(romBase, "pvp");
  assert.strictEqual(base.fingerprint, "94cb0636");
  const rom = new ROMClass(null);
  rom.load(ROM);
  const rep = applyPatchSet(rom, { base: "pvp", features: ["enemy-prizes"] });
  assert.deepStrictEqual(rep.features, ["enemy-prizes"]);
  assert.notStrictEqual(rep.fingerprint, base.fingerprint, "фича должна менять fingerprint");
  // хук переписан на JMP, рутина размещена в свободной зоне
  const img = new RomImage(rom);
  assert.strictEqual(img.read(0xe972), 0x4c, "хук sub_E972 не переписан");
  assert.ok(rep.routines.some((r) => r.symbol === "sub_enemy_pick_up_bonus"));
});

test("enemy-prizes: комбинация с pistol собирается без перекрытий", () => {
  const rom = new ROMClass(null);
  rom.load(ROM);
  const rep = applyPatchSet(rom, { base: "pvp", features: ["pistol", "enemy-prizes"] });
  assert.deepStrictEqual(rep.features, ["enemy-prizes", "pistol"]);
  const syms = rep.routines.map((r) => r.symbol);
  assert.ok(syms.includes("sub_enemy_pick_up_bonus"));
  assert.ok(syms.includes("sub_grant_super_weapon"));
});

test("enemy-prizes: враг наезжает на приз и поглощает его", () => {
  const emu = boot();
  enemyOnBonus(emu, 3, 100, 100);
  // ждём несколько кадров: ROM вызовет sub_E972 и поглотит приз
  let consumed = false;
  for (let f = 0; f < 4 && !consumed; f++) {
    idle(emu, 1);
    if (emu.cpu.mem[RAM.BONUS_TIMER] > 0 || emu.cpu.mem[RAM.PRIZE_X] === 0) consumed = true;
  }
  assert.ok(consumed, "враг не поглотил приз");
  // игрок очков/эффектов не получил: пистолет не выдан, апгрейд не изменился
  assert.notStrictEqual(emu.readMem(RAM.PISTOL), 1, "враг не должен выдавать игроку оружие");
});

test("enemy-prizes: без фичи враг приз НЕ берёт", () => {
  const emu = boot([]);
  enemyOnBonus(emu, 3, 100, 100);
  let consumed = false;
  for (let f = 0; f < 4 && !consumed; f++) {
    idle(emu, 1);
    if (emu.cpu.mem[RAM.BONUS_TIMER] > 0 || emu.cpu.mem[RAM.PRIZE_X] === 0) consumed = true;
  }
  assert.ok(!consumed, "без фичи враг не должен брать приз");
});

test("enemy-prizes: подбор приза игроком (танк 0) продолжает работать", () => {
  const emu = boot();
  const x = emu.readMem(RAM.TANK_X);
  const y = emu.readMem(RAM.TANK_Y);
  emu.spawnBonus(6, x, y); // пистолет как заметный player-эффект (фича pistol выключена -> только SFX)
  idle(emu, 10);
  assert.ok(
    emu.cpu.mem[RAM.BONUS_TIMER] > 0 || emu.cpu.mem[RAM.PRIZE_X] === 0,
    "игрок не смог подобрать приз",
  );
});

test("enemy-prizes: врага в зоне нет -> приз остаётся", () => {
  const emu = boot();
  emu.cpu.mem[RAM.TANK_X + 2] = 10;
  emu.cpu.mem[RAM.TANK_Y + 2] = 10;
  emu.cpu.mem[RAM.TANK_FLAG + 2] = 0x90;
  emu.spawnBonus(3, 200, 200);
  idle(emu, 3);
  assert.strictEqual(emu.cpu.mem[RAM.PRIZE_X], 200, "приз не должен исчезнуть");
  assert.strictEqual(emu.cpu.mem[RAM.BONUS_TIMER], 0, "таймер не должен запуститься");
});

// Подобрать приз врагом и дать рантайму обработать событие (postFrame).
function pickByEnemy(emu: any, id: number): void {
  enemyOnBonus(emu, id, 100, 100);
  for (let f = 0; f < 4; f++) {
    idle(emu, 1);
    if (emu.cpu.mem[RAM.ENEMY_PRIZE_IDX] === 0xff && emu.cpu.mem[RAM.BONUS_TIMER] > 0) return;
  }
}

test("enemy-prizes: clock замораживает защитников", () => {
  const emu = boot();
  pickByEnemy(emu, 1);
  assert.ok(emu.cpu.mem[RAM.PRIZE_FREEZE] > 0, "DEF0 не заморожен");
  assert.ok(emu.cpu.mem[RAM.PRIZE_FREEZE + 1] > 0, "DEF1 не заморожен");
});

test("enemy-prizes: shovel снимает защиту базы (кирпич и сталь)", () => {
  const emu = boot();
  const c = 25 * 32 + 13;
  emu.cpu.mem[RAM.FIELD + c] = 0x0f; // кирпич
  emu.cpu.mem[RAM.FIELD + c + 1] = 0x10; // сталь
  pickByEnemy(emu, 2);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + c], 0, "кирпич не снят");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + c + 1], 0, "сталь не снята");
  assert.strictEqual(emu.cpu.mem[RAM.FORTIFIED], 0, "FORTIFIED не сброшен");
});

test("enemy-prizes: grenade взрывает защитников", () => {
  const emu = boot();
  // гарантировать живого DEF-танка 0
  emu.cpu.mem[RAM.TANK_FLAG] = 0x90;
  pickByEnemy(emu, 4);
  assert.strictEqual(emu.cpu.mem[RAM.TANK_FLAG], 0x73, "защитник не взорван");
});

test("enemy-prizes: tank даёт подкрепление (ENEMIES_LEFT++)", () => {
  const emu = boot();
  const before = emu.cpu.mem[RAM.ENEMIES_LEFT];
  pickByEnemy(emu, 5);
  assert.strictEqual(emu.cpu.mem[RAM.ENEMIES_LEFT], (before + 1) & 0xff, "нет подкрепления");
});

test("enemy-prizes: star повышает броню врага", () => {
  const emu = boot();
  emu.cpu.mem[RAM.TANK_TYPE + 2] = 0x80;
  pickByEnemy(emu, 3);
  assert.strictEqual(emu.cpu.mem[RAM.TANK_TYPE + 2], 0xa0, "броня врага не повышена");
});

test("enemy-prizes: pistol выдаёт врагу супер-оружие (с фичей pistol)", () => {
  const emu = boot(["pistol", "enemy-prizes"]);
  pickByEnemy(emu, 6);
  assert.strictEqual(emu.cpu.mem[RAM.ENEMY_PISTOL_AMMO], 3, "врагу не выдан супер-боезапас");
});

test("enemy-prizes: без фичи pistol враг не получает супер-оружие", () => {
  const emu = boot();
  pickByEnemy(emu, 6);
  assert.strictEqual(emu.cpu.mem[RAM.ENEMY_PISTOL_AMMO], 0, "супер-оружие выдано без фичи pistol");
});

