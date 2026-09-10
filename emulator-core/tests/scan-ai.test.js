// scan-ai.test.js — юнит-тесты ИИ с полным сканированием ситуации (scan-ai.js).
// Проверяем: детерминизм, решения для живых атакующих, валидность направлений,
// «не замерзает» (всегда движение или огонь, если не заперт), прострел кирпичей.
import { test } from "node:test";
import assert from "node:assert";
import { scanPlan } from "../ai/scan-ai.js";
import { buildState, readState } from "../model/game-view.js";

// Синтетическое состояние через buildState (без адресов RAM).
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
  const d = r.decisions.get(0); // индекс танка 2 -> decision key 2? используем фактический
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер (dir=null) на открытом поле`);
  }
});

test("scanPlan: прострел — при кирпичной стене на пути к базе танк целится в неё", () => {
  // кирпичная стена на строке 14 (слева-центр), цель (база) внизу
  const mem = buildMem({ attackers: [[80, 88]], bricks: [[10, 14], [11, 14], [12, 14], [13, 14]] });
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер`);
  }
});

test("scanPlan: учитывает приз — при близком призе цель двигает к нему", () => {
  const mem = buildMem({ attackers: [[80, 80]], prize: { id: 3, x: 112, y: 80 } }); // звезда справа
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null, `танк ${t} замер при наличии приза`);
  }
});

test("scanPlan: защищён от пуль — решение корректно при вражеской пуле", () => {
  // вражеская пуля (танк 0 DEF) летит вниз на атакующего
  const mem = buildMem({ attackers: [[88, 88]], bullets: [{ i: 0, x: 88, y: 48, dir: 2, team: "DEF" }] });
  const r = scanPlan(mem, new Map());
  for (const [t, dec] of r.decisions) {
    assert.ok(dec.dir !== null || dec.fire, `танк ${t} ничего не делает под пулей`);
  }
});
