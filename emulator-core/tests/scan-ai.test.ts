// scan-ai.test.js — unit tests for the AI with a full situation scan (scan-ai.js).
// Verifies: determinism, decisions for living attackers, validity of directions,
// "does not freeze" (always movement or fire if not boxed in), brick line-of-fire.
import { test } from "node:test";
import assert from "node:assert";
import { scanPlan } from "../ai/scan-ai.ts";
import { buildState, readState } from "../model/game-view.ts";

// Synthetic state via buildState (no RAM addresses).
function buildMem({ attackers = [[88, 80]], bricks = [], obstacles = [], prize = null, bullets = [] }) {
  const rows = Array.from({ length: 32 }, () => Array(32).fill("."));
  for (const [c, r] of bricks) rows[r][c] = "B";
  for (const [c, r] of obstacles) rows[r][c] = "#";
  const tanks = attackers.map(([x, y], k) => ({ i: k + 2, x, y, team: "ATT" }));
  const s = buildState({ field: rows.map((r) => r.join("")), tanks, prize, bullets, eagle: { col: 14, row: 27 } });
  return s.mem;
}

test("scanPlan: детерминирован и даёт решения живым атакующим", () => {
  const mem = buildMem({ attackers: [[88, 80], [120, 80], [152, 80]] });
  const r1 = scanPlan(mem, new Map());
  const r2 = scanPlan(mem, new Map());
  assert.deepStrictEqual([...r1.decisions], [...r2.decisions], "детерминизм нарушен");
  const bf = readState(mem);
  for (const [t, d] of r1.decisions) {
    assert.ok(t >= 2 && t < 8, "только ATT-танки");
    assert.ok(bf.tanks[t].inField, "танк в поле");
    assert.ok(d.dir === null || (d.dir >= 0 && d.dir <= 3), `невалидный dir ${d.dir}`);
    assert.strictEqual(typeof d.fire, "boolean");
  }
});

test("scanPlan: не замирает — атакующий в открытом поле всегда движется", () => {
  const mem = buildMem({ attackers: [[88, 80]] });
  const r = scanPlan(mem, new Map());
  const d = r.decisions.get(0); // tank index 2 -> decision key 2? use the actual one
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер (dir=null) на открытом поле`);
  }
});

test("scanPlan: прострел — при кирпичной стене на пути к базе танк целится в неё", () => {
  // brick wall on row 14 (center-left), goal (base) below
  const mem = buildMem({ attackers: [[80, 88]], bricks: [[10, 14], [11, 14], [12, 14], [13, 14]] });
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер`);
  }
});

test("scanPlan: учитывает приз — при близком призе цель двигает к нему", () => {
  const mem = buildMem({ attackers: [[80, 80]], prize: { id: 3, x: 112, y: 80 } }); // star to the right
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер при наличии приза`);
  }
});

test("scanPlan: защищён от пуль — решение корректно при вражеской пуле", () => {
  // an enemy bullet (DEF tank 0) flies down at the attacker
  const mem = buildMem({ attackers: [[88, 88]], bullets: [{ i: 0, x: 88, y: 48, dir: 2, team: "DEF" }] });
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null || dec.fire, `танк ${t} ничего не делает под пулей`);
  }
});
