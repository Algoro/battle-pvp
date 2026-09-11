// cycle.test.js — юнит-тесты абстрагированного цикла (CycleSim).
import { test } from "node:test";
import assert from "node:assert";
import { CycleSim, FRAME_SCRIPT } from "../sim/cycle.ts";
import { GameSim } from "../sim/engine.ts";
import { canLead } from "../sim/sim-model.ts";
import { DX, DY } from "../model/game-view.ts";

function makeSim(over = {}) {
  const field = new Uint8Array(32 * 32);
  field[27 * 32 + 15] = 0xc8; // орёл
  const tanks = over.tanks ?? [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: true },
    { index: 2, x: 120, y: 24, dir: 2, team: "ATT", type: 0x80, alive: true },
  ];
  const bullets = over.bullets ?? [];
  const counters = { timer: 999, count: 1, limit: 4, interval: 8, posIndex: 0, lives: 3, clock: 0, helmet: 0 };
  const prize = over.prize ?? null;
  const sim = new CycleSim({ field, tanks, bullets, counters, prize }, () => 1);
  return sim;
}

test("CycleSim: FRAME_SCRIPT — порядок процедур кадра (как sub_C2E6)", () => {
  assert.deepStrictEqual(FRAME_SCRIPT, [
    "ice_movement", "tank_movement", "bullets_status", "hq", "enemy_spawn",
    "bullets_movement", "bullet_vs_bullet", "bullet_vs_tank", "bonus", "enemy_death", "player_death", "stage",
  ]);
});

test("CycleSim: граната (приз id=4) уничтожает всех врагов на экране", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: true },
    { index: 2, x: 120, y: 24, dir: 2, team: "ATT", type: 0x80, alive: true },
    { index: 3, x: 216, y: 24, dir: 2, team: "ATT", type: 0x80, alive: true },
  ]});
  sim.applyPrize(4); // граната
  const dead = sim.state.tanks.filter((t) => t.team === "ATT" && t.alive);
  assert.strictEqual(dead.length, 0, "граната должна уничтожить всех врагов");
});

test("CycleSim: танк-в-танк — нельзя встать на другого живого танка", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 96, dir: 3, team: "DEF", type: 0, alive: true },
    { index: 2, x: 100, y: 96, dir: 2, team: "ATT", type: 0x80, alive: true },
  ]});
  const t0 = sim.state.tanks[0];
  // t0 движется вправо, но впереди враг — не должен встать на него
  const blocked = sim._tankBlocked(sim.state, { x: 96, y: 96 }, t0);
  assert.strictEqual(blocked, true, "танк должен быть заблокирован другим танком");
  const free = sim._tankBlocked(sim.state, { x: 60, y: 96 }, t0);
  assert.strictEqual(free, false, "пустая клетка не блокирует");
});

test("CycleSim: победа — все враги уничтожены и некого спавнить", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: true },
  ]});
  sim.state.counters.count = 0;
  const ev = sim.step();
  assert.ok(ev.some((e) => e.op === "stage_clear"), "должна быть победа (stage_clear)");
});

test("CycleSim: танк-в-танк коллизия в движении — танк не проходит сквозь другого", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 96, dir: 3, team: "DEF", type: 0, alive: true },
    { index: 2, x: 80, y: 96, dir: 2, team: "ATT", type: 0x80, alive: true },
  ]});
  sim.frame = 0; // двигаемся
  const t0 = sim.state.tanks[0];
  sim.proc_tank_movement(sim.state);
  // t0 не должен пройти сквозь врага (расстояние < 13 блокирует)
  assert.ok(Math.abs(t0.x - sim.state.tanks[1].x) < 13 || Math.abs(t0.x - 64) < 8,
    "танк не должен пройти сквозь другого танка");
});

test("CycleSim: тип врага по стадии (sub_E3CB) — стадия 1 спавнит basic(0x80) первым", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: true },
  ]});
  sim.state.counters.timer = 0; sim.state.counters.count = 5; sim.state.counters.stage = 1; sim.state.counters.typeOffset = 0;
  sim.proc_enemy_spawn(sim.state);
  const spawned = sim.state.tanks.find((t) => t.team === "ATT" && t.alive && t.index !== 2);
  // счётчик: враг спавнится в слот 4 (limit 4), т.к. слот 2 занят? нет, слот 2 пуст
  const enemy = sim.state.tanks.find((t) => t.team === "ATT" && t.alive);
  assert.strictEqual(enemy.type & 0xf0, 0x80, "первый враг стадии 1 — basic (0x80)");
});

test("CycleSim: вода блокирует танк (не проходима)", () => {
  const field = new Uint8Array(32 * 32);
  field[6 * 32 + 8] = 0x15; // вода прямо перед передней кромкой танка (dir вниз)
  const tanks = [{ index: 0, x: 64, y: 40, dir: 2, team: "DEF", type: 0, alive: true }];
  const sim = new CycleSim({ field, tanks, bullets: [], counters: {}, prize: null }, () => 1);
  const t0 = tanks[0];
  const n = canLead(t0.x, t0.y, 2, field) ? { x: t0.x + DX[2], y: t0.y + DY[2] } : null;
  assert.strictEqual(n, null, "вода блокирует движение танка");
});

test("CycleSim: 2-я пуля — powered-танк может иметь 2 пули, обычный — 1", () => {
  const sim = makeSim();
  const t0 = sim.state.tanks[0]; // игрок, не powered
  sim.state.bullets.push({ tank: 0, team: "DEF", x: 64, y: 100, dir: 0, alive: true });
  assert.strictEqual(sim.canFire(t0), false, "обычный танк не стреляет со 2-й пулей");
  t0.powered = true;
  assert.strictEqual(sim.canFire(t0), true, "powered-танк может выпустить 2-ю пулю");
});

test("CycleSim: приз спавнится из мигающего врага при его гибели", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: true },
    { index: 2, x: 120, y: 24, dir: 2, team: "ATT", type: 0x84, alive: true }, // мигающий
  ]});
  sim.state.prize = null;
  sim._maybeSpawnPrize(sim.state, 2);
  assert.ok(sim.state.prize, "приз должен заспавниться из мигающего врага");
  assert.ok(sim.state.prize.id >= 0 && sim.state.prize.id <= 5, "валидный id приза");
});

test("CycleSim: жизни игрока уменьшаются при смерти, респавн пока есть жизни", () => {
  const sim = makeSim({ tanks: [
    { index: 0, x: 64, y: 136, dir: 0, team: "DEF", type: 0, alive: false },
  ]});
  sim.state.counters.lives = 3;
  sim.proc_player_death(sim.state);
  assert.strictEqual(sim.state.counters.lives, 2, "-1 жизнь");
  assert.ok(sim.state.tanks[0].alive, "респавн при оставшихся жизнях");
});

test("CycleSim: лёд — проходим (не блокирует)", () => {
  const field = new Uint8Array(32 * 32);
  field[6 * 32 + 8] = 0x2a; // лёд перед кромкой
  const tanks = [{ index: 0, x: 64, y: 40, dir: 2, team: "DEF", type: 0, alive: true }];
  const sim = new CycleSim({ field, tanks, bullets: [], counters: {}, prize: null }, () => 1);
  const n = canLead(tanks[0].x, tanks[0].y, 2, field) ? true : false;
  assert.strictEqual(n, true, "лёд проходим");
});

test("GameSim: флаговая машина — враг из респавна переходит в движение и двигается", () => {
  const field = new Uint8Array(32 * 32);
  const sim = new GameSim({ field, tanks: [{ index: 2, x: 120, y: 40, dir: 2, team: "ATT", type: 0x80, alive: true, flag: 0xf0 }], bullets: [] }, () => 1);
  const t = sim.tanks[0];
  const state = { frmCntLo: 0, frmCntHi: 0, interval: 8, p1x: 88, p1y: 216, p2x: 152, p2y: 216, p1Alive: true, p2Alive: false };
  // Респавн (0xF0->0xE0->0xA2) идёт с супер-пиксельным гейтом (idx^frmCntLo)&1,
  // как в ASM sub_DBF1; затем враг начинает двигаться.
  let moved = false;
  for (let f = 0; f < 120; f++) {
    sim.frame = f;
    state.frmCntLo = f & 0xff;
    const before = { x: t.x, y: t.y };
    sim.stepEnemy(t, state);
    if (t.x !== before.x || t.y !== before.y) moved = true;
  }
  assert.ok(moved, "враг после респавна должен начать двигаться");
});
