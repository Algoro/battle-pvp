// tank-driver.test.js — tests for the JS tank control layer (movement/collisions/AI).
// Model: field 32x32 cells of 8px, tank 13x13px, RAM (x,y) — tank center.
// Movement checks the front edge (canLead); the body box — canPlace.
// Run: node --test.
import { test } from "node:test";
import assert from "node:assert";
import {
  stepTank,
  tickTank,
  canPlace,
  canLead,
  aiDirection,
  runtimePassable,
  FIELD,
  TILE,
  TANK,
  HALF,
} from "../io/tank-driver.ts";

// empty field 32x32
const empty = new Uint8Array(FIELD * FIELD); // all 0x00 -> passable

// field with a vertical wall in column 16 (x=128..135)
const walled = empty.slice();
for (let r = 0; r < FIELD; r++) walled[r * FIELD + 16] = 0x11; // wall

// field with a vertical "water" wall (0x0f) — per ASM it blocks the tank
const waterWalled = empty.slice();
for (let r = 0; r < FIELD; r++) waterWalled[r * FIELD + 16] = 0x0f; // water/wall

test("runtimePassable: зеркалит ASM — проходимы 0x00 и 0x20..0x7F, всё прочее блокирует", () => {
  assert.strictEqual(runtimePassable(0x00), true);
  assert.strictEqual(runtimePassable(0x20), true); // road (lower bound of passable)
  assert.strictEqual(runtimePassable(0x7f), true); // road (upper bound of passable)
  assert.strictEqual(runtimePassable(0x0f), false); // water — the tank does NOT pass (ASM blocks)
  assert.strictEqual(runtimePassable(0x15), false); // water (variant) — blocks
  assert.strictEqual(runtimePassable(0x11), false); // wall
  assert.strictEqual(runtimePassable(0x16), false); // steel
  assert.strictEqual(runtimePassable(0x01), false); // lower bound of blocking
  assert.strictEqual(runtimePassable(0x1f), false); // upper bound of blocking
  assert.strictEqual(runtimePassable(0x80), false); // bit7 set -> blocks
  assert.strictEqual(runtimePassable(0xff), false); // bit7 set -> blocks
});

test("runtimePassable согласован с правилом ASM для всех 256 значений", () => {
  for (let v = 0; v < 256; v++) {
    const expected = v === 0x00 || (v >= 0x20 && v < 0x80);
    assert.strictEqual(runtimePassable(v), expected, `tile ${v.toString(16)}`);
  }
});

test("stepTank движется в 4 направлениях на пустом поле (0=Up,1=Left,2=Down,3=Right)", () => {
  const pos = { x: 16 * TILE, y: 16 * TILE }; // (128,128)
  assert.deepStrictEqual(stepTank(pos, 0, empty, runtimePassable), { x: pos.x, y: pos.y - 1 });
  assert.deepStrictEqual(stepTank(pos, 1, empty, runtimePassable), { x: pos.x - 1, y: pos.y });
  assert.deepStrictEqual(stepTank(pos, 2, empty, runtimePassable), { x: pos.x, y: pos.y + 1 });
  assert.deepStrictEqual(stepTank(pos, 3, empty, runtimePassable), { x: pos.x + 1, y: pos.y });
});

test("коллизия: стена блокирует переднюю кромку, край поля тоже", () => {
  // wall in column 16 (x=128..135). Tank body [x-6, x+6]; front edge x+6.
  const y = 16 * TILE;
  const atWall = { x: 121, y }; // body [115,127] — right at the wall (x=128)
  assert.strictEqual(canPlace(atWall.x, atWall.y, walled, runtimePassable), true);
  // cannot move right: the target center x=122 gives a front edge on the wall
  assert.strictEqual(canLead(atWall.x, atWall.y, 3, walled, runtimePassable), false);
  // step right: the front edge will touch column 16 -> blocked
  assert.strictEqual(stepTank(atWall, 3, walled, runtimePassable), null);
  // a bit to the left — the front edge (x+8) has not yet reached the wall, so we can step right
  assert.deepStrictEqual(stepTank({ x: 119, y }, 3, walled, runtimePassable), { x: 120, y });
  // up/down inside column 15 — ok (not right at the wall)
  assert.notStrictEqual(stepTank({ x: 112, y }, 0, walled, runtimePassable), null);
  assert.notStrictEqual(stepTank({ x: 112, y }, 2, walled, runtimePassable), null);
  // right at the wall (x=121) up/down is not allowed: the ASM box ±8 sticks into column 16
  assert.strictEqual(stepTank(atWall, 0, walled, runtimePassable), null);
  // field edge: at the left edge, left is not allowed
  assert.strictEqual(stepTank({ x: 0, y }, 1, empty, runtimePassable), null);
});

test("коллизия: водная стена 0x0f блокирует переднюю кромку (танк не проходит сквозь)", () => {
  const y = 16 * TILE;
  const atWater = { x: 121, y };
  assert.strictEqual(canPlace(atWater.x, atWater.y, waterWalled, runtimePassable), true);
  assert.strictEqual(stepTank(atWater, 3, waterWalled, runtimePassable), null);
  assert.deepStrictEqual(stepTank({ x: 119, y }, 3, waterWalled, runtimePassable), { x: 120, y });
});

test("canPlace: центрированный корпус не встаёт на стену и в пределах поля", () => {
  assert.strictEqual(canPlace(0, 0, empty, runtimePassable), false); // body sticks out of the field
  assert.strictEqual(canPlace(8, 8, empty, runtimePassable), true);
  assert.strictEqual(canPlace(128, 8, walled, runtimePassable), false); // on the wall (column 16)
  assert.strictEqual(canPlace(FIELD * TILE - HALF - 1, 8, empty, runtimePassable), true); // x=249
  assert.strictEqual(canPlace(FIELD * TILE - HALF, 8, empty, runtimePassable), false); // x=250
});

test("aiDirection: идёт к цели", () => {
  const from = { x: 16 * TILE, y: 16 * TILE };
  const targetDown = { x: 16 * TILE, y: 24 * TILE };
  assert.strictEqual(aiDirection(from, targetDown, empty, runtimePassable), 2); // down
  const targetUp = { x: 16 * TILE, y: 8 * TILE };
  assert.strictEqual(aiDirection(from, targetUp, empty, runtimePassable), 0); // up
});

test("tickTank: двигается по направлению или остаётся при блокировке", () => {
  const pos = { x: 16 * TILE, y: 16 * TILE };
  assert.deepStrictEqual(tickTank(pos, 2, empty, runtimePassable), { x: pos.x, y: pos.y + 1 });
  const atRight = { x: FIELD * TILE - HALF - 1, y: 16 * TILE }; // x=249, body [243,255]
  assert.deepStrictEqual(tickTank(atRight, 3, empty, runtimePassable), atRight);
});
