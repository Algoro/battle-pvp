// defender-ai.test.js — activity of the defending AI (planDefense) in many
// game situations: the defender tank at different positions relative to the anchor and with
// obstacles on different sides. The goal is to find cases where the defender "freezes"
// (gives neither a direction nor fire), although it has somewhere to move.
//
// Logic (tactical-ai.js decideDefender): if there is no threat and no line of fire,
// the defender goes to the "anchor" (the base flank). bfsDirection to the anchor returns null
// when the tank is ALREADY at the anchor or there is no path — then dir=null and buttons=0 (freeze).
//
// Run: node --test tests/defender-ai.test.js
import { test } from "node:test";
import assert from "node:assert";
import { planDefense, readPrizes } from "../ai/tactical-ai.ts";
import { buildState, readState } from "../model/game-view.ts";

// --- declarative state builder (game-view buildState) ---
// Tanks: def/attackers — pairs [x,y]; bricks/obstacles — [[col,row]]; prize — {id,x,y}.
function buildMem({ def = [[88, 80], [152, 80]], attackers = [], bricks = [], obstacles = [], prize = null }) {
  const field = Array.from({ length: 32 }, () => Array(32).fill(".").join(""));
  const rows = field.map((s) => s.split(""));
  for (const [c, r] of bricks) rows[r][c] = "B";      // brick
  for (const [c, r] of obstacles) rows[r][c] = "#";   // wall
  const tanks = [];
  for (let t = 0; t < def.length; t++) tanks.push({ i: t, x: def[t][0], y: def[t][1], team: "DEF" });
  for (let t = 0; t < attackers.length; t++) tanks.push({ i: t + 2, x: attackers[t][0], y: attackers[t][1], team: "ATT" });
  const state = buildState({ field: rows.map((r) => r.join("")), tanks, prize, eagle: { col: 14, row: 27 } });
  return state.mem;
}

const DIR_BITS = [0x10, 0x40, 0x20, 0x80]; // U, L, D, R
const FIRE = 0x01;

// Directions hardcoded in the port buttons.
function dirsOf(buttons) {
  return DIR_BITS.filter((b) => buttons & b);
}

// Defender buttons t (0/1) by the current mem.
function defButtons(mem, t) {
  return planDefense(mem, 100).buttons.get(t);
}

// The defender is active if it gives a direction or fire.
function isActive(mem, t) {
  return defButtons(mem, t) !== 0;
}

// Is the tank fully boxed in its cell (all 4 neighbors impassable) — a legitimate "freeze".
function isBoxed(mem, t) {
  const c = Math.floor(mem[0x90 + t] / 8), r = Math.floor(mem[0x98 + t] / 8);
  const pass = (cc, rr) => cc >= 0 && rr >= 0 && cc < 32 && rr < 32 && mem[0x400 + rr * 32 + cc] === 0x00;
  return !pass(c + 1, r) && !pass(c - 1, r) && !pass(c, r + 1) && !pass(c, r - 1);
}

// Tank 0 anchor = (eagle.col-2, eagle.row-2) = (12,25) = (96,200).
const ANCHOR_0 = [96, 200];

test("защитник двигается к якорю в открытом поле (без угрозы)", () => {
  const mem = buildMem({ def: [[40, 40], [152, 80]] });
  const b = defButtons(mem, 0);
  assert.notStrictEqual(b, 0, `защитник должен двигаться, но кнопки=0x${b.toString(16)}`);
  assert.ok(dirsOf(b).length > 0, "должно быть направление движения");
});

test("защитник не замирает на якоре (патрулирует), если не заперт", () => {
  const mem = buildMem({ def: [ANCHOR_0, [152, 80]] });
  const b = defButtons(mem, 0);
  assert.notStrictEqual(b, 0,
    `защитник ЗАМЕР на якоре (кнопки=0x0): нет ни направления, ни огня. Причина: bfsDirection к якорю==null`);
});

test("защитник активен с препятствиями по всем 4 сторонам от якоря", () => {
  const c = 12, r = 25; // tank 0 anchor
  const layouts = [
    { name: "кирпичи сверху", bricks: [[c, r - 1]] },
    { name: "кирпичи снизу", bricks: [[c, r + 1]] },
    { name: "кирпичи слева", bricks: [[c - 1, r]] },
    { name: "кирпичи справа", bricks: [[c + 1, r]] },
    { name: "сталь сверху+слева", obstacles: [[c, r - 1], [c - 1, r]] },
    { name: "сталь справа+снизу", obstacles: [[c + 1, r], [c, r + 1]] },
  ];
  for (const { name, bricks, obstacles } of layouts) {
    const mem = buildMem({ def: [ANCHOR_0, [152, 80]], bricks, obstacles });
    if (isBoxed(mem, 0)) continue; // fully boxed — legitimate
    const b = defButtons(mem, 0);
    assert.notStrictEqual(b, 0, `[${name}] защитник ЗАМЕР (кнопки=0x${b.toString(16)}), хотя не заперт`);
  }
});

test("защитник активен при разных стартовых позициях вокруг якоря", () => {
  const cases = [
    [96, 40],   // far above
    [96, 120],  // in between
    [96, 190],  // almost at the anchor
    [60, 200],  // left
    [140, 200], // right
  ];
  for (const pos of cases) {
    const mem = buildMem({ def: [pos, [152, 80]] });
    if (isBoxed(mem, 0)) continue;
    const b = defButtons(mem, 0);
    assert.notStrictEqual(b, 0, `позиция (${pos}) -> защитник ЗАМЕР (кнопки=0x${b.toString(16)})`);
  }
});

test("защитник отстреливает атакующего с линией огня и не замирает", () => {
  // attacker in view to the right of the defender
  const mem = buildMem({ def: [[88, 100], [152, 80]], attackers: [[152, 100]] });
  const b = defButtons(mem, 0);
  assert.ok(b & FIRE, `защитник должен стрелять по линии (кнопки=0x${b.toString(16)})`);
});

test("защитник НЕ стреляет сквозь напарника (friendly fire guard)", () => {
  // T0 on the left, T1 (partner) in the center on the same row, attacker on the right behind T1.
  // The line T0->attacker passes through T1 — T0 must not fire.
  const mem = buildMem({ def: [[40, 120], [120, 120]], attackers: [[240, 120]] });
  const b0 = defButtons(mem, 0);
  assert.ok(!(b0 & FIRE), `T0 не должен стрелять сквозь напарника T1 (кнопки=0x${b0.toString(16)})`);
});

test("защитник НЕ замирает и не дрожит на якоре (активен и плавно движется)", () => {
  // We run 60 "frames" of planDefense on a static field at the anchor; the defender
  // must give a direction (not stand still), and the direction must not flap every frame.
  const mem = buildMem({ def: [[96, 200], [152, 80]] }); // T0 at the anchor
  const seen = new Set();
  let fireFrames = 0, moveFrames = 0;
  for (let f = 0; f < 60; f++) {
    const b = defButtons(mem, 0);
    if (b & FIRE) fireFrames++;
    if (dirsOf(b).length > 0) { moveFrames++; seen.add(b); }
  }
  // the defender at the anchor must be active (moving/patrolling) almost always
  assert.ok(moveFrames >= 30, `защитник почти не двигается на якоре (moveFrames=${moveFrames})`);
  // and the direction must not jump frantically: at most 3 different button masks
  assert.ok(seen.size <= 3, `защитник «дрожит»: ${seen.size} разных направлений за 60 кадров`);
});

test("readPrizes: приз считывается из RAM (id и позиция)", () => {
  const mem = buildMem({ def: [[88, 80], [152, 80]], prize: { id: 3, x: 96, y: 120 } }); // star (level)
  const bf = readState(mem);
  assert.strictEqual(bf.prizes.length, 1, "должен быть один приз");
  assert.strictEqual(bf.prizes[0].id, 3);
  assert.deepStrictEqual(bf.prizes[0].cell, { col: 12, row: 15 });
  // without a prize (id=0xFF) — empty
  const mem2 = buildMem({ def: [[88, 80], [152, 80]] });
  assert.strictEqual(readPrizes(mem2).length, 0);
});

test("защитник идёт собирать близкий приз (активен и использует бонусы)", () => {
  // prize (star) in cell (12,15)=(96,120); the defender is nearby
  const mem = buildMem({ def: [[40, 120], [152, 80]], prize: { id: 3, x: 96, y: 120 } });
  const b = defButtons(mem, 0);
  assert.notStrictEqual(b, 0, `защитник должен идти к призу, а не стоять (кнопки=0x${b.toString(16)})`);
  assert.ok(dirsOf(b).length > 0, "должно быть направление к призу");
});
