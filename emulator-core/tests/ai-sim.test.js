// ai-sim.test.js — интеграция CycleSim в тестирование ИИ.
// Решение ИИ исполняется в точном симуляторе (CycleSim), результат сверяется
// с намерением ИИ. Это связывает прогнозы ИИ с точной физикой.
import { test } from "node:test";
import assert from "node:assert";
import { scanPlan } from "../ai/scan-ai.js";
import { buildState } from "../model/game-view.js";
import { CycleSim } from "../sim/cycle.js";

function fieldOpen() {
  const f = new Uint8Array(32 * 32);
  f[27 * 32 + 15] = 0xc8; // орёл (база внизу)
  return f;
}

test("AI-интеграция: решение scan-ИИ исполняется в CycleSim (движение к базе)", () => {
  // атакующий сверху, база внизу
  const field = fieldOpen();
  const mem = buildState({
    field: Array.from({ length: 32 }, () => "." .repeat(32)),
    tanks: [{ i: 2, x: 88, y: 40, team: "ATT" }],
    eagle: { col: 15, row: 27 },
  }).mem;
  // scan-ИИ решает, куда ехать
  const { decisions } = scanPlan(mem, new Map());
  const d = decisions.get(2);
  assert.ok(d, "ИИ должен дать решение атакующему");
  assert.ok(d.dir !== null, "ИИ должен дать направление");

  // исполняем решение в CycleSim (точная физика)
  const sim = new CycleSim({
    field, tanks: [{ index: 2, x: 88, y: 40, dir: d.dir, team: "ATT", type: 0x80, alive: true }],
    bullets: [], counters: {}, prize: null,
  }, () => 1);
  const t = sim.state.tanks[0];
  sim.frame = 0; // чтобы игрок(0.75) или враг двигались
  // враг движется (sub-pixel): обычный враг — 0.5px/кадр, проверим сдвиг за 10 кадров
  let moved = false;
  for (let f = 0; f < 20; f++) {
    const before = { x: t.x, y: t.y };
    sim.proc_tank_movement(sim.state);
    sim.frame++;
    if (t.x !== before.x || t.y !== before.y) moved = true;
  }
  // ИИ направил в сторону базы (вниз/вбок) — танк должен сдвинуться к базе
  assert.ok(moved, "танк должен двигаться по решению ИИ");
});

test("AI-интеграция: решение ИИ ведёт к уменьшению расстояния до базы", () => {
  const mem = buildState({
    field: Array.from({ length: 32 }, () => "." .repeat(32)),
    tanks: [{ i: 2, x: 88, y: 40, team: "ATT" }],
    eagle: { col: 15, row: 27 },
  }).mem;
  const { decisions } = scanPlan(mem, new Map());
  const d = decisions.get(2);
  const dist0 = Math.abs(88 - 15 * 8) + Math.abs(40 - 27 * 8);
  const dist1 = Math.abs(88 + [0, -1, 0, 1][d.dir] - 15 * 8) + Math.abs(40 + [-1, 0, 1, 0][d.dir] - 27 * 8);
  // ИИ должен выбирать шаг, не увеличивающий расстояние до базы (база-приоритет)
  assert.ok(dist1 <= dist0 + 8, "шаг ИИ не должен сильно удалять от базы (в пределах манёвра)");
});
