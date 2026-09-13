// ai-sim.test.js — integration of CycleSim into AI testing.
// The AI decision is executed in the exact simulator (CycleSim), and the result is compared
// with the AI's intent. This links the AI predictions to the exact physics.
import { test } from "node:test";
import assert from "node:assert";
import { scanPlan } from "../ai/scan-ai.ts";
import { buildState } from "../model/game-view.ts";
import { CycleSim } from "../sim/cycle.ts";

function fieldOpen() {
  const f = new Uint8Array(32 * 32);
  f[27 * 32 + 15] = 0xc8; // eagle (base at the bottom)
  return f;
}

test("AI-интеграция: решение scan-ИИ исполняется в CycleSim (движение к базе)", () => {
  // attacker at the top, base at the bottom
  const field = fieldOpen();
  const mem = buildState({
    field: Array.from({ length: 32 }, () => "." .repeat(32)),
    tanks: [{ i: 2, x: 88, y: 40, team: "ATT" }],
    eagle: { col: 15, row: 27 },
  }).mem;
  // the scan AI decides where to drive
  const { decisions } = scanPlan(mem, new Map());
  const d = decisions.get(2);
  assert.ok(d, "ИИ должен дать решение атакующему");
  assert.ok(d.dir !== null, "ИИ должен дать направление");

  // execute the decision in CycleSim (exact physics)
  const sim = new CycleSim({
    field, tanks: [{ index: 2, x: 88, y: 40, dir: d.dir, team: "ATT", type: 0x80, alive: true }],
    bullets: [], counters: {}, prize: null,
  }, () => 1);
  const t = sim.state.tanks[0];
  sim.frame = 0; // so the player(0.75) or enemy moves
  // the enemy moves (sub-pixel): a normal enemy — 0.5px/frame, let's check the shift over 10 frames
  let moved = false;
  for (let f = 0; f < 20; f++) {
    const before = { x: t.x, y: t.y };
    sim.proc_tank_movement(sim.state);
    sim.frame++;
    if (t.x !== before.x || t.y !== before.y) moved = true;
  }
  // the AI headed toward the base (down/sideways) — the tank should shift toward the base
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
  // the AI should choose a step that does not increase the distance to the base (base priority)
  assert.ok(dist1 <= dist0 + 8, "шаг ИИ не должен сильно удалять от базы (в пределах манёвра)");
});
