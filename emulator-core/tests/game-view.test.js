// game-view.test.js — проверка единого слоя АПИ (A/B/C/D).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../pvp.js";
import { buildState, readState, wrap } from "../model/game-view.js";
import {
  tileType, tileCost, tileCostAt, isWater, isTree, isIce, isSteel, isRoad,
  bulletSpeed, bulletProperty, playerLevel, playerLives, hitsLeft, onIceTile,
} from "../model/game-view.js";
import { runBrain } from "../ai/brain-runner.js";
import { readPrizes } from "../ai/tactical-ai.js";

const ROM = new URL("../../rom/disasm/_battle_city.nes", import.meta.url).pathname;

test("A: readState — чистая модель боя и хелперы", () => {
  const field = Array.from({ length: 32 }, () => ".".repeat(32));
  field[2] = field[2].slice(0, 2) + "B" + field[2].slice(3); // кирпич на (2,2)
  field[26] = field[26].slice(0, 2) + "E" + field[26].slice(3); // орёл на (2,26)
  const s = buildState({
    field,
    tanks: [{ i: 2, x: 16, y: 8, team: "ATT" }],
    prize: { id: 4, x: 24, y: 8 },
  });
  assert.ok(s.tanks[2].inField);
  assert.strictEqual(s.tanks[2].cell.col, 2);
  assert.strictEqual(s.prizes[0].value, 100); // граната — максимальная ценность
  assert.strictEqual(s.passable(1, 1), true);
  assert.strictEqual(s.brick(2, 2), true);
  assert.strictEqual(s.eagle.col, 2);
});

test("B: buildState — декларативный построитель без адресов", () => {
  const s = buildState({
    field: ["........", "....B...", "........"],
    tanks: [{ i: 0, x: 32, y: 8 }],
  });
  assert.strictEqual(readPrizes(s.mem).length, 0);
  assert.strictEqual(s.brick(4, 1), true);
});

test("D: runBrain — единая точка запуска всех движков", () => {
  const s = buildState({
    field: ["................", "................", "................", "................", "................"],
    tanks: [{ i: 0, x: 88, y: 120, team: "DEF" }],
  });
  const p = runBrain(s, new Map(), "plan", "def", 100);
  assert.ok(p.decisions instanceof Map);
  assert.ok(p.decisions.has(0) || p.decisions.size === 2, "planDefense даёт кнопки");
  const sc = runBrain(s, new Map(), "scan", "def", 100);
  assert.ok(sc.decisions instanceof Map);
  const la = runBrain(s, new Map(), "lookahead", "def", 100);
  assert.ok(la.decisions instanceof Map);
});

test("C: wrap — живой адаптер поверх эмулятора", () => {
  const emu = new PvPNes({ attAI: "asm", noRender: true });
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[0x80] === 20) break;
  }
  const v = wrap(emu);
  assert.ok(Array.isArray(v.tanks), "wrap.tanks");
  assert.ok(v.eagle, "wrap.eagle");
  v.spawnPrize(4, v.tanks[0]?.x ?? 88, v.tanks[0]?.y ?? 216);
  assert.strictEqual(v.state.prizes.length, 1, "spawnPrize активирует приз");
});

// --- стратегический слой: классификация тайлов и стоимости ---
test("tileType/tileCost — классификация тайлов из буфера коллизий", () => {
  assert.strictEqual(tileType(0x00), "empty");
  assert.strictEqual(tileType(0x0f), "brick");
  assert.strictEqual(tileType(0x10), "steel");
  assert.strictEqual(tileType(0x11), "steel");
  assert.strictEqual(tileType(0x12), "water");
  assert.strictEqual(tileType(0x21), "ice");
  assert.strictEqual(tileType(0x22), "tree");
  assert.strictEqual(tileType(0x20), "road");
  assert.strictEqual(tileCost(0x00), 1);
  assert.strictEqual(tileCost(0x20), 1);
  assert.strictEqual(tileCost(0x0f), 3);
  assert.strictEqual(tileCost(0x10), Infinity);
  assert.strictEqual(tileCost(0x12), Infinity);
  assert.strictEqual(tileCost(0x22), 1.2);
  assert.strictEqual(tileCost(0x21), 1.5);
});

test("isWater/isTree/isIce/isSteel/isRoad — селекторы тайлов", () => {
  assert.ok(isWater(0x12));
  assert.ok(!isWater(0x21));
  assert.ok(isIce(0x21));
  assert.ok(isTree(0x22));
  assert.ok(isSteel(0x10));
  assert.ok(isSteel(0x11));
  assert.ok(isRoad(0x20));
  assert.ok(!isRoad(0x22));
  assert.strictEqual(onIceTile(Uint8Array.from([0x00, 0x21]), 1, 0), true);
  assert.strictEqual(onIceTile(Uint8Array.from([0x00, 0x21]), 0, 0), false);
});

test("bulletSpeed/bulletProperty — скорость пули по типу стрелка", () => {
  // обычные: 2px; power-пули (property bit1): 4px
  assert.strictEqual(bulletSpeed(0x80), 2);
  assert.strictEqual(bulletSpeed(0xa0), 2);
  assert.strictEqual(bulletSpeed(0xe0), 2);
  assert.strictEqual(bulletSpeed(0xc0), 4);
  assert.strictEqual(bulletSpeed(0x20), 4);
  assert.strictEqual(bulletSpeed(0x40), 4);
  assert.strictEqual(bulletSpeed(0x60), 4);
  assert.strictEqual(bulletProperty(0x60), 3);
  assert.strictEqual(bulletProperty(0xc0), 1);
  assert.strictEqual(bulletProperty(0x80), 0);
});

test("hitsLeft — броня и мигающие враги", () => {
  assert.strictEqual(hitsLeft(0x80), 1);
  assert.strictEqual(hitsLeft(0xa0), 1);
  assert.strictEqual(hitsLeft(0xe0), 1);   // броня без остатка
  assert.strictEqual(hitsLeft(0xe3), 4);   // 3 брони + финальный выстрел
  assert.strictEqual(hitsLeft(0xe4), 1);   // мигающий броневой — один выстрел
  assert.strictEqual(hitsLeft(0x84), 1);   // мигающий обычный
});

test("playerLevel/playerLives — состояние защитников", () => {
  const mem = new Uint8Array(0x10000);
  mem[0x51] = 3; mem[0x52] = 5;          // жизни
  mem[0x0101] = 2; mem[0x0102] = 0;      // апгрейд (звёзды)
  assert.strictEqual(playerLives(mem, 0), 3);
  assert.strictEqual(playerLives(mem, 1), 5);
  assert.strictEqual(playerLevel(mem, 0), 2);
  assert.strictEqual(playerLevel(mem, 1), 0);
});

test("GameState — стратегические поля (defenders, onIce, tileCost)", () => {
  const field = Array.from({ length: 32 }, () => ".".repeat(32));
  field[1] = "IIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII"; // лёд на (0..31, 1)
  field[26] = field[26].slice(0, 2) + "E" + field[26].slice(3);
  const s = buildState({
    field,
    tanks: [
      { i: 0, x: 8, y: 8, team: "DEF", type: 0x60 },  // на льду
      { i: 1, x: 88, y: 216, team: "DEF", type: 0x00 },
      { i: 2, x: 16, y: 0, team: "ATT", type: 0xe3 },
    ],
  });
  // DEF-танк 0 стоит на льду (0,1)
  assert.strictEqual(s.tanks[0].onIce, true);
  assert.strictEqual(s.tanks[1].onIce, false);
  assert.strictEqual(s.ice(0, 1), true);
  assert.strictEqual(s.tileCost(0, 1), 1.5);
  assert.strictEqual(s.tileCost(15, 15), 1);
  // броня врага
  assert.strictEqual(s.tanks[2].hitsLeft, 4);
  assert.strictEqual(s.tanks[2].bulletSpeed, 2);
  // стратегическое состояние защитников
  assert.strictEqual(s.defenders.length, 2);
  assert.strictEqual(s.defenders[0].level, 0);
  assert.strictEqual(s.defenders[0].lives, 0);
});
