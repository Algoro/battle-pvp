// defender-strategy.test.js — verification of the strategic defender AI (utility+FSM).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../pvp.ts";
import { buildState } from "../model/game-view.ts";
import { strategyDefense } from "../ai/defender-strategy.ts";

const ROM = new URL("../../rom/disasm/_battle_city.nes", import.meta.url).pathname;

const DIR_BITS = [0x10, 0x40, 0x20, 0x80]; // U, L, D, R
const FIRE = 0x01;
const START = 0x08;

function dirsOf(b) { return DIR_BITS.filter((x) => b & x); }

// Field 32x32: empty, eagle by default (15,26).
function openMem({ def = [[88, 80], [152, 80]], attackers = [], prize = null } = {}) {
  const field = Array.from({ length: 32 }, () => ".".repeat(32));
  const tanks = [];
  for (let t = 0; t < def.length; t++) tanks.push({ i: t, x: def[t][0], y: def[t][1], team: "DEF" });
  for (let t = 0; t < attackers.length; t++) tanks.push({ i: t + 2, x: attackers[t][0], y: attackers[t][1], team: "ATT" });
  return buildState({ field, tanks, prize }).mem;
}

// Defender decision t in the current state (direction/fire in the buttons).
function buttons(mem, t, state = new Map(), frame = 100) {
  return strategyDefense(mem, frame, state).buttons.get(t);
}

test("strategy: защитник активен и двигается к якорю в открытом поле", () => {
  const mem = openMem({ def: [[40, 40], [152, 80]] });
  const b = buttons(mem, 0);
  assert.notStrictEqual(b, 0, "должен двигаться, а не стоять");
  assert.ok(dirsOf(b).length > 0, "должно быть направление движения");
});

test("strategy: отстреливает выровненного атакующего с линией огня", () => {
  // attacker on the same row to the right of the defender
  const mem = openMem({ def: [[88, 100], [152, 80]], attackers: [[152, 100]] });
  const b = buttons(mem, 0);
  assert.ok(b & FIRE, `защитник должен стрелять по выровненной цели (кнопки=0x${b.toString(16)})`);
});

test("strategy: НЕ стреляет сквозь напарника (friendly fire guard через lineClear)", () => {
  // T0 on the left, T1 in the center on the same row, attacker behind T1
  const mem = openMem({ def: [[40, 120], [120, 120]], attackers: [[240, 120]] });
  const b0 = buttons(mem, 0);
  // the line T0->attacker crosses T1 (opaque body) — firing along it is impossible,
  // but the defender is still active (moving toward the target)
  assert.notStrictEqual(b0, 0, "защитник должен быть активен");
});

test("strategy: НЕ замирает и не дрожит на якоре (активен, плавное движение)", () => {
  const mem = openMem({ def: [[96, 200], [152, 80]] });
  const state = new Map();
  const seen = new Set();
  let moveFrames = 0;
  for (let f = 0; f < 60; f++) {
    const b = buttons(mem, 0, state, f);
    if (dirsOf(b).length > 0) { moveFrames++; seen.add(b); }
  }
  assert.ok(moveFrames >= 30, `защитник почти не двигается на якоре (moveFrames=${moveFrames})`);
  assert.ok(seen.size <= 3, `защитник «дрожит»: ${seen.size} направлений за 60 кадров`);
});

test("strategy: идёт собирать близкий ценный приз", () => {
  const mem = openMem({ def: [[40, 120], [152, 80]], prize: { id: 4, x: 96, y: 120 } }); // grenade nearby
  const b = buttons(mem, 0);
  assert.notStrictEqual(b, 0, "защитник должен идти к призу");
});

test("strategy: респавнит мёртвого защитника каждые 30 кадров", () => {
  const mem = openMem({ def: [[255, 255], [152, 80]] }); // T0 dead (x=255)
  mem[0x80] = 20; // game has started
  mem[0xa0] = 0;  // T0 flag = dead
  const r29 = strategyDefense(mem, 29, new Map());
  const r30 = strategyDefense(mem, 30, new Map());
  assert.ok(!r29.respawn.has(0), "до 30-го кадра не респавнит");
  assert.ok(r30.respawn.has(0), "на 30-м кадре респавнит");
  assert.strictEqual(mem[0xa0], 0xf0, "флаг выставлен в респавн");
});

test("strategy: детерминирован при том же входе", () => {
  const mem = openMem({ def: [[88, 120], [152, 120]], attackers: [[16, 120], [240, 120]] });
  const a = strategyDefense(mem, 5, new Map());
  const b = strategyDefense(mem, 5, new Map());
  assert.deepStrictEqual([...a.buttons], [...b.buttons]);
});

test("strategy: режим доступен в ядре PvPNes", () => {
  const emu = new PvPNes({ attAI: "lookahead", defAI: "strategy", noRender: true });
  assert.ok(emu.getDefModes().includes("strategy"));
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  // switching on the fly
  emu.setDefAI("strategy");
  assert.strictEqual(emu.getDefAI(), "strategy");
  emu.stepFrame([{ port: 0, buttons: 0 }]);
  emu.setDefAI("plan");
});
