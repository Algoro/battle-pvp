// pistol.test.js — приз «пистолет»: выпадение/подбор, 4-я звезда, супер-выстрел (луч).
// Правила получения — ROM-патч `pistol`; эффект луча — JS-ядро PvPNes (детерминированно).
// Запуск: node --test tests/pistol.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

// Быстрый старт: автозапуск и ожидание живого DEF-танка 0.
function boot() {
  const emu = new PvPNes({ patchSet: "pvp", features: ["pistol"], attAI: "off", defAI: "off" });
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

const idle = (emu, n = 1) => { for (let i = 0; i < n; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); };

test("пistol: приз id 6 выпадает (таблица tbl_E8FA_bonus изменена)", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: ["pistol"] });
  emu.loadROM(ROM);
  // tbl_E8FA_bonus[6] в CPU-адресе 0xE900 (банк $C000)
  assert.strictEqual(emu.cpu.mem[0xe900], 0x06, "шестая запись таблицы должна быть пистолетом");
});

test("пistol: подбор приза 6 выдаёт оружие и боезапас N=3", () => {
  const emu = boot();
  const x = emu.readMem(RAM.TANK_X);
  const y = emu.readMem(RAM.TANK_Y);
  emu.spawnBonus(6, x, y);
  idle(emu, 20);
  assert.strictEqual(emu.readMem(RAM.PISTOL), 1, "флаг владения не выставлен");
  assert.strictEqual(emu.readMem(RAM.PISTOL_AMMO), 3, "боезапас не выставлен");
});

test("пistol: 1–3-я звезды апгрейдят, 4-я выдаёт оружие", () => {
  const emu = boot();
  emu.cpu.mem[RAM.TANK_UPGRADE] = 0x40; // 2 звезды
  emu.spawnBonus(3, emu.readMem(RAM.TANK_X), emu.readMem(RAM.TANK_Y));
  idle(emu, 20);
  assert.strictEqual(emu.readMem(RAM.TANK_UPGRADE), 0x60, "3-я звезда должна дать максимум");
  assert.notStrictEqual(emu.readMem(RAM.PISTOL), 1, "3-я звезда не должна выдавать оружие");

  emu.spawnBonus(3, emu.readMem(RAM.TANK_X), emu.readMem(RAM.TANK_Y));
  idle(emu, 20);
  assert.strictEqual(emu.readMem(RAM.PISTOL), 1, "4-я звезда должна выдать оружие");
  assert.strictEqual(emu.readMem(RAM.PISTOL_AMMO), 3);
});

test("пistol: луч уничтожает кирпич, танк-противника и сталь в линии", () => {
  const emu = boot();
  const tx = emu.readMem(RAM.TANK_X);
  const ty = emu.readMem(RAM.TANK_Y);
  const col = tx >> 3;
  const row = (ty >> 3) - 1;
  emu.spawnBonus(6, tx, ty);
  idle(emu, 20);

  // кирпич в 1-й клетке, сталь во 2-й, враг в 3-й
  emu.cpu.mem[RAM.FIELD + row * 32 + col] = 0x01; // brick
  emu.cpu.mem[RAM.FIELD + (row - 1) * 32 + col] = 0x10; // steel
  const ec = col, er = row - 2;
  emu.cpu.mem[RAM.TANK_X + 2] = ec * 8;
  emu.cpu.mem[RAM.TANK_Y + 2] = er * 8;
  emu.cpu.mem[RAM.TANK_FLAG + 2] = 0x90;
  emu.cpu.mem[RAM.TANK_TYPE + 2] = 0x80;

  emu.stepFrame([{ port: 0, buttons: BTN.A }]);
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + row * 32 + col], 0, "кирпич не уничтожен");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (row - 1) * 32 + col], 0, "сталь не уничтожена");
  assert.strictEqual(emu.readMem(RAM.TANK_FLAG + 2), 0x73, "враг не уничтожен");
});

test("pistol: луч шириной 3 тайла уничтожает кирпичи слева и справа", () => {
  const emu = boot();
  const tx = emu.readMem(RAM.TANK_X);
  const ty = emu.readMem(RAM.TANK_Y);
  const col = tx >> 3;
  const row = (ty >> 3) - 1;
  emu.spawnBonus(6, tx, ty);
  idle(emu, 20);
  emu.cpu.mem[RAM.FIELD + row * 32 + col - 1] = 0x01;
  emu.cpu.mem[RAM.FIELD + row * 32 + col] = 0x01;
  emu.cpu.mem[RAM.FIELD + row * 32 + col + 1] = 0x01;
  emu.stepFrame([{ port: 0, buttons: BTN.A }]);
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + row * 32 + col - 1], 0, "левый край луча");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + row * 32 + col], 0, "центр луча");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + row * 32 + col + 1], 0, "правый край луча");
});

test("пistol: луч сносит воду, лёд и кусты, но не дорогу", () => {
  const emu = boot();
  const tx = emu.readMem(RAM.TANK_X);
  const ty = emu.readMem(RAM.TANK_Y);
  const col = tx >> 3;
  const row = (ty >> 3) - 1;
  emu.spawnBonus(6, tx, ty);
  idle(emu, 20);
  emu.cpu.mem[RAM.FIELD + row * 32 + col] = 0x12; // вода
  emu.cpu.mem[RAM.FIELD + (row - 1) * 32 + col] = 0x21; // лёд
  emu.cpu.mem[RAM.FIELD + (row - 2) * 32 + col] = 0x22; // кусты
  emu.cpu.mem[RAM.FIELD + (row - 3) * 32 + col] = 0x20; // дорога
  emu.stepFrame([{ port: 0, buttons: BTN.A }]);
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + row * 32 + col], 0, "вода не снесена");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (row - 1) * 32 + col], 0, "лёд не снесён");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (row - 2) * 32 + col], 0, "кусты не снесены");
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + (row - 3) * 32 + col], 0x20, "дорога не должна сноситься");
});

test("пistol: попадание луча в штаб разрушает базу и запускает поражение", () => {
  const emu = boot();
  emu.spawnBonus(6, emu.readMem(RAM.TANK_X), emu.readMem(RAM.TANK_Y));
  idle(emu, 20);
  // поставить танк слева от базы и направить вправо (dir=3)
  emu.cpu.mem[RAM.TANK_X] = 11 * 8;
  emu.cpu.mem[RAM.TANK_Y] = 27 * 8;
  emu.cpu.mem[RAM.TANK_FLAG] = 0x03;
  emu.stepFrame([{ port: 0, buttons: BTN.A }]);
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  assert.strictEqual(emu.cpu.mem[RAM.FIELD + 26 * 32 + 14], 0xcc, "разрушенный орёл не отрисован");
  assert.ok(emu.readMem(RAM.GAME_OVER) > 0 && emu.readMem(RAM.GAME_OVER) <= 0x27, "поражение не запущено");
});

test("пistol: боезапас расходуется, оружие снимается после N выстрелов", () => {
  const emu = boot();
  emu.spawnBonus(6, emu.readMem(RAM.TANK_X), emu.readMem(RAM.TANK_Y));
  idle(emu, 20);
  for (let k = 0; k < 3; k++) {
    emu.stepFrame([{ port: 0, buttons: BTN.A }]);
    emu.stepFrame([{ port: 0, buttons: 0 }]);
  }
  assert.strictEqual(emu.readMem(RAM.PISTOL), 0, "оружие должно закончиться");
  assert.strictEqual(emu.readMem(RAM.PISTOL_AMMO), 0);
});

test("пistol: save/load вокруг выстрела эквивалентен непрерывному прогону", () => {
  const emu = boot();
  emu.spawnBonus(6, emu.readMem(RAM.TANK_X), emu.readMem(RAM.TANK_Y));
  idle(emu, 20);
  assert.strictEqual(emu.readMem(RAM.PISTOL), 1, "нужен пистолет для сценария");
  const start = emu.saveState();

  const inputsAt = (i) => [{ port: 0, buttons: i === 0 ? BTN.A : (i % 7 === 0 ? BTN.Up : 0) }];
  const N = 40;

  const a = new PvPNes({ patchSet: "pvp", features: ["pistol"] });
  a.loadROM(ROM);
  a.loadState(start);
  const hashesA = [];
  let snapMid = null;
  for (let i = 0; i < N; i++) {
    a.stepFrame(inputsAt(i));
    hashesA.push(a.getFrameHash());
    if (i === 10) snapMid = a.saveState();
  }

  const b = new PvPNes({ patchSet: "pvp", features: ["pistol"] });
  b.loadROM(ROM);
  b.loadState(start);
  const hashesB = [];
  for (let i = 0; i < N; i++) {
    if (i === 11) b.loadState(snapMid); // откат к кадру 10 и продолжение
    b.stepFrame(inputsAt(i));
    hashesB.push(b.getFrameHash());
  }
  assert.deepStrictEqual(hashesB.slice(11), hashesA.slice(11), "save/load разошёлся с непрерывным прогоном");
});

test("pistol: на разрушенных клетках рисуется анимация взрыва (OAM)", () => {
  const emu = boot();
  const tx = emu.readMem(RAM.TANK_X);
  const ty = emu.readMem(RAM.TANK_Y);
  const col = tx >> 3;
  const row = (ty >> 3) - 1;
  emu.spawnBonus(6, tx, ty);
  idle(emu, 20);
  emu.cpu.mem[RAM.FIELD + row * 32 + col] = 0x01; // кирпич
  emu.cpu.mem[RAM.FIELD + (row - 1) * 32 + col] = 0x10; // сталь
  emu.stepFrame([{ port: 0, buttons: BTN.A }]);

  const sm = emu.ppu.spriteMem;
  const FX_TILES = [0xf1, 0xf3, 0xf5, 0xf7, 0xf9, 0xfb];
  let drawn = 0;
  for (let i = 0; i < 64; i++) {
    if (sm[i * 4] < 0xf0 && FX_TILES.includes(sm[i * 4 + 1])) drawn++;
  }
  assert.ok(drawn >= 2, `нет спрайтов взрыва на разрушенных клетках (найдено ${drawn})`);
  // анимация продолжается в следующих кадрах
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  let drawn2 = 0;
  for (let i = 0; i < 64; i++) {
    if (sm[i * 4] < 0xf0 && FX_TILES.includes(sm[i * 4 + 1])) drawn2++;
  }
  assert.ok(drawn2 >= 2, "анимация взрывов не продолжалась");
});

test("pistol: стартовая опция setStartPistol выдаёт оружие и максимум звёзд", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: ["pistol"], attAI: "off", defAI: "off" });
  emu.setStartPistol(true);
  emu.loadROM(ROM);
  for (let f = 1; f <= 1500; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? BTN.Start : 0 }]);
    if (emu.readMem(RAM.ENEMIES_LEFT) !== 0xff) break;
  }
  assert.strictEqual(emu.readMem(RAM.PISTOL), 1, "стартовый пистолет не выдан");
  assert.strictEqual(emu.readMem(RAM.PISTOL_AMMO), 3);
  assert.strictEqual(emu.readMem(RAM.TANK_UPGRADE), 0x60, "стартовый апгрейд не максимум");
});

test("pistol: без опции старта оружия нет", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: ["pistol"], attAI: "off", defAI: "off" });
  emu.setStartPistol(false);
  emu.loadROM(ROM);
  for (let f = 1; f <= 1500; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? BTN.Start : 0 }]);
    if (emu.readMem(RAM.ENEMIES_LEFT) !== 0xff) break;
  }
  assert.notStrictEqual(emu.readMem(RAM.PISTOL), 1, "оружие выдано без опции");
});

test("пistol: смерть игрока сбрасывает оружие (ROM-хук)", () => {
  const emu = boot();
  emu.cpu.mem[RAM.PISTOL] = 1;
  emu.cpu.mem[RAM.PISTOL_AMMO] = 3;
  emu.cpu.mem[RAM.TANK_UPGRADE] = 0x40;
  // вражеская пуля ровно на танке 0
  emu.cpu.mem[RAM.BULLET_STATUS + 2] = 0x40;
  emu.cpu.mem[RAM.BULLET_X + 2] = emu.readMem(RAM.TANK_X);
  emu.cpu.mem[RAM.BULLET_Y + 2] = emu.readMem(RAM.TANK_Y);
  emu.cpu.mem[RAM.HELMET] = 0;
  for (let f = 0; f < 6; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.readMem(RAM.TANK_FLAG) === 0) break;
  }
  assert.strictEqual(emu.readMem(RAM.PISTOL), 0, "оружие не сбросилось при смерти");
  assert.strictEqual(emu.readMem(RAM.PISTOL_AMMO), 0);
  assert.strictEqual(emu.readMem(RAM.TANK_UPGRADE), 0);
});
