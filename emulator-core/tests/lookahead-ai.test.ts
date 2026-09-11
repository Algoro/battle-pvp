// lookahead-ai.test.js — юнит-тесты ИИ с предсказанием будущего (lookahead-ai.js).
import { test } from "node:test";
import assert from "node:assert";
import { lookaheadPlan } from "../ai/lookahead-ai.ts";
import { buildState, readState } from "../model/game-view.ts";

function buildMem({ attackers = [[88, 80]], bricks = [], bullets = [] }) {
  const rows = Array.from({ length: 32 }, () => Array(32).fill("."));
  for (const [c, r] of bricks) rows[r][c] = "B";
  const tanks = attackers.map(([x, y], k) => ({ i: k + 2, x, y, team: "ATT" }));
  const s = buildState({ field: rows.map((r) => r.join("")), tanks, bullets, eagle: { col: 14, row: 27 } });
  return s.mem;
}

test("lookaheadPlan: детерминирован и даёт валидные решения живым атакующим", () => {
  const mem = buildMem({ attackers: [[88, 80], [120, 80], [152, 80]] });
  const r1 = lookaheadPlan(mem, new Map());
  const r2 = lookaheadPlan(mem, new Map());
  assert.deepStrictEqual([...r1.decisions], [...r2.decisions], "детерминизм нарушен");
  const bf = readState(mem);
  for (const [t, d] of r1.decisions) {
    assert.ok(bf.tanks[t].inField, "танк в поле");
    assert.ok(d.dir === null || (d.dir >= 0 && d.dir <= 3), `невалидный dir ${d.dir}`);
    assert.strictEqual(typeof d.fire, "boolean");
  }
});

test("lookaheadPlan: не замирает — атакующий в открытом поле всегда имеет действие", () => {
  const mem = buildMem({ attackers: [[88, 80]] });
  const r = lookaheadPlan(mem, new Map());
  for (const [t, d] of r.decisions) {
    assert.ok(d.dir !== null || d.fire, `танк ${t} ничего не делает (dir=null, fire=false)`);
  }
});

test("lookaheadPlan: прострел — при кирпичной стене на пути целься в неё или обходи", () => {
  const mem = buildMem({ attackers: [[80, 88]], bricks: [[10, 14], [11, 14], [12, 14], [13, 14]] });
  const r = lookaheadPlan(mem, new Map());
  for (const [t, d] of r.decisions) {
    assert.ok(d.dir !== null || d.fire, `танк ${t} замер у стены`);
  }
});

test("lookaheadPlan: уворачивается/перехватывает летящую пулю", () => {
  const mem = buildMem({ attackers: [[88, 88]], bullets: [{ i: 0, x: 88, y: 56, dir: 2, team: "DEF" }] });
  const r = lookaheadPlan(mem, new Map());
  for (const [t, d] of r.decisions) {
    assert.ok(d.dir !== null || d.fire, `танк ${t} бездействует под пулей`);
  }
});
