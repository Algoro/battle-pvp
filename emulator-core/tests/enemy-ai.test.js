// enemy-ai.test.js — точный порт вражеского ИИ (sub_DBF1 -> sub_DC3D -> tbl_E498,
// sub_DE72 выбор цели, sub_DDA2 навигация). Фиксирует поведение ASM, выявленное
// по bank_FF.asm: исправления относительно старой упрощённой модели.
import { test } from "node:test";
import assert from "node:assert";
import { GameSim } from "../sim/engine.js";

function makeSim(tankOver, rng = () => 1) {
  const field = new Uint8Array(32 * 32);
  const tanks = [{ index: 2, x: 120, y: 40, dir: 2, team: "ATT", type: 0x80, alive: true, flag: 0xa2, ...tankOver }];
  const sim = new GameSim({ field, tanks, bullets: [] }, rng);
  return { sim, tank: sim.tanks[0], state: {
    frmCntLo: 0, frmCntHi: 0, interval: 8, clock: 0,
    p1x: 88, p1y: 216, p2x: 152, p2y: 216, p1Alive: true, p2Alive: false,
  } };
}

test("_pickFollowFlag: HQ при interval>>2 < frmCntHi (исправление инверсии)", () => {
  const { sim, tank, state } = makeSim();
  // interval=8 -> half=2, quarter=1. frmCntHi=3 -> 2 < 3 -> follow HQ (0xB0)
  state.frmCntHi = 3;
  assert.strictEqual(sim._pickFollowFlag(tank, state), 0xb0, "должен следовать к HQ");
});

test("_pickFollowFlag: keep current, когда quarter >= frmCntHi (не random)", () => {
  const { sim, tank, state } = makeSim();
  // interval=8 -> half=2, quarter=1. frmCntHi=0 -> half(2)>=0, quarter(1)>=0 -> null
  state.frmCntHi = 0;
  assert.strictEqual(sim._pickFollowFlag(tank, state), null, "должен сохранить направление");
});

test("_pickFollowFlag: p1/p2 — чётный индекс следует за p1, нечётный за p2", () => {
  const { sim, tank, state } = makeSim();
  // interval=8 -> half=2, quarter=1. frmCntHi=2 -> half(2)>=2, quarter(1)<2 -> p1/p2
  state.frmCntHi = 2;
  state.p1Alive = true; state.p2Alive = true;
  assert.strictEqual(sim._pickFollowFlag(tank, state), 0xd0, "чётный(2) -> p1 (0xD0)");
  const odd = makeSim({ index: 3 }).tank;
  assert.strictEqual(sim._pickFollowFlag(odd, state), 0xc0, "нечётный(3) + p2 жив -> p2 (0xC0)");
  state.p2Alive = false;
  assert.strictEqual(sim._pickFollowFlag(odd, state), 0xd0, "нечётный(3) + p2 мёртв -> p1 (0xD0)");
});

test("_pickFollowFlag: p1 мёртв -> follow p2 (0xC0)", () => {
  const { sim, tank, state } = makeSim();
  state.frmCntHi = 2;
  state.p1Alive = false; state.p2Alive = true;
  assert.strictEqual(sim._pickFollowFlag(tank, state), 0xc0, "p1 мёртв -> p2");
});

test("_navigate: враг всегда использует базовую таблицу (без случайной +9)", () => {
  const { sim, tank } = makeSim();
  // цель ниже-правее: sy=+1, sx=+1 -> idx=3*2+2=8 -> dir=2 (down)
  const nav = sim._navigate(tank, tank.x + 100, tank.y + 100);
  assert.strictEqual(nav.dir, 2, "направление вниз (idx 8 -> A2)");
  // цель выше-левее: sy=-1,sx=-1 -> idx=0 -> dir=0 (up)
  const nav2 = sim._navigate(tank, tank.x - 100, tank.y - 100);
  assert.strictEqual(nav2.dir, 0, "направление вверх (idx 0 -> A0)");
  // цель строго правее (sy=0,sx=+1): idx=3*1+2=5 -> dir=3 (right)
  const nav3 = sim._navigate(tank, tank.x + 100, tank.y);
  assert.strictEqual(nav3.dir, 3, "направление вправо (idx 5 -> A3)");
});

test("stepEnemy: респавн 0xF0 -> 0xE0 -> 0xA2 (движение вниз)", () => {
  const { sim, tank, state } = makeSim({ flag: 0xf0 });
  // гейт: type=0x80, (2^frmCntLo)&1 — подбираем frmCntLo, чтобы проходил
  state.frmCntLo = 0; // (2^0)&1 = 0 — не проходит; используем frmCntLo, где проходит
  // Респавн идёт только на кадрах, где гейт открыт. Прогоняем с frmCntLo=1,3,5...
  let flag;
  for (let f = 1; f < 80 && flag !== 0xa2; f++) {
    state.frmCntLo = f;
    sim.stepEnemy(tank, state);
    flag = tank.flag;
  }
  assert.strictEqual(tank.flag, 0xa2, "после респавна враг активен (вниз)");
  assert.strictEqual(tank.alive, true);
});

test("stepEnemy: на пересечении с RNG&0x0F==0 ВСЕГДА ретаргет без движения", () => {
  // rng()=16 -> 16&0x0F==0 на каждом вызове
  const { sim, tank, state } = makeSim({ x: 120, y: 24, flag: 0xa2 }, () => 16);
  state.frmCntHi = 3; // half=2 < 3 -> follow HQ
  const before = { x: tank.x, y: tank.y };
  // индекс 2, type 0x80: гейт открыт при (2^frmCntLo)&1. frmCntLo=0 не открыт.
  state.frmCntLo = 1; // (2^1)&1 = 1 -> гейт открыт
  const moved = sim.stepEnemy(tank, state);
  assert.strictEqual(moved, false, "ретаргет в том же кадре без движения");
  assert.deepStrictEqual({ x: tank.x, y: tank.y }, before, "позиция не изменилась");
  assert.strictEqual(tank.flag, 0xb0, "установлен follow-флаг HQ");
});

test("stepEnemy: движение 1px в направлении при свободной кромке", () => {
  const { sim, tank, state } = makeSim({ x: 120, y: 40, flag: 0xa2 });
  // (2^frmCntLo)&1: frmCntLo=1 -> (2^1)=3, &1=1 -> гейт открыт
  state.frmCntLo = 1;
  const before = tank.y;
  const moved = sim.stepEnemy(tank, state);
  assert.strictEqual(moved, true, "должен двигаться");
  assert.strictEqual(tank.y, before + 1, "сдвиг 1px вниз");
  assert.strictEqual(tank.flag, 0xa2, "флаг движения сохраняется");
});

test("stepEnemy: блок без RNG&3==0 -> пауза 0x88|dir", () => {
  // rng()=5: 5&0x0F=5 != 0 (нет ретаргета), 5&3=1 != 0 -> bra_DD1E пауза
  const { sim, tank, state } = makeSim({ x: 120, y: 40, flag: 0xa2 }, () => 5);
  // стена прямо под танком: (120,40) центр, dir=2 -> кромка на y=48+ -> cell(15,6)
  sim.field[6 * 32 + 15] = 0x11;
  state.frmCntLo = 1;
  sim.stepEnemy(tank, state);
  assert.strictEqual(tank.flag, 0x8a, "пауза 0x88|dir(2)=0x8A");
  assert.strictEqual(tank.y, 40, "позиция не изменилась");
});

test("stepEnemy: блок с RNG&3==0 на сетке -> разворот + флаг 0x90|dir", () => {
  // rng()=16: 16&0x0F==0 -> ретаргет(keep, т.к. frmCntHi=0 -> null) затем RTS, без движения.
  // Чтобы проверить блок-разворот, нужен rng где RNG&0x0F!=0 но RNG&3==0: rng()=4
  const { sim, tank, state } = makeSim({ x: 120, y: 40, flag: 0xa2 }, () => 4);
  sim.field[6 * 32 + 15] = 0x11; // стена внизу
  state.frmCntLo = 1;
  sim.stepEnemy(tank, state);
  // rng()=4: 4&0x0F=4!=0 (нет ретаргета), 4&3=0 -> bra_DD30 разворот.
  // dir=2 -> nd=0. На сетке (120&7=0,40&7=0) -> flag=0x90|0 = 0x90.
  assert.strictEqual(tank.dir, 0, "разворот 180° (2->0)");
  assert.strictEqual(tank.flag, 0x90, "флаг поворота 0x90 на сетке");
});

test("_enemyGate: power-враг (type&F0==0xA0) двигается всегда", () => {
  const { sim, tank, state } = makeSim({ type: 0xa0 });
  assert.strictEqual(sim._enemyGate(tank, state), true, "power всегда двигается");
});

test("_enemyGate: обычный враг двигается только при (idx^frmCntLo)&1", () => {
  const { sim, tank, state } = makeSim({ type: 0x80 });
  state.frmCntLo = 0; // (2^0)&1=0
  assert.strictEqual(sim._enemyGate(tank, state), false, "заморожен на чётном кадре");
  state.frmCntLo = 1; // (2^1)&1=1
  assert.strictEqual(sim._enemyGate(tank, state), true, "двигается на нечётном кадре");
});

test("stepEnemy: взрыв (0x10-0x70) -> мёртв после отсчёта", () => {
  const { sim, tank, state } = makeSim({ flag: 0x70, type: 0x80 });
  let dead = false;
  for (let i = 0; i < 200 && !dead; i++) {
    state.frmCntLo = i; // обычный враг: гейт открыт на нечётных
    sim.stepEnemy(tank, state);
    if (!tank.alive) dead = true;
  }
  assert.ok(dead, "враг должен умереть после взрыва");
  assert.strictEqual(tank.flag, 0, "флаг 0 у мёртвого");
});
