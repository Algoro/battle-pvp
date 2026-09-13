// input.test.js — tests of pure input logic (keyboard -> con_btn).
// Keys are specified by KeyboardEvent.code (KeyZ, KeyW, ArrowUp, etc.).
// Run: node --test tests/input.test.js
import { test } from "node:test";
import assert from "node:assert";
import { BTN, keyToMask, maskFromCodes } from "../src/engine/input.ts";

test("keyToMask сопоставляет коды клавиш битам con_btn", () => {
  assert.strictEqual(keyToMask("ArrowUp"), BTN.Up);
  assert.strictEqual(keyToMask("KeyW"), BTN.Up);
  assert.strictEqual(keyToMask("ArrowLeft"), BTN.Left);
  assert.strictEqual(keyToMask("KeyA"), BTN.Left);
  assert.strictEqual(keyToMask("KeyZ"), BTN.A); // fire
  assert.strictEqual(keyToMask("KeyJ"), BTN.A);
  assert.strictEqual(keyToMask("Enter"), BTN.Start);
  assert.strictEqual(keyToMask("ShiftLeft"), BTN.Select);
  assert.strictEqual(keyToMask("KeyQ"), 0); // not assigned
});

test("maskFromCodes агрегирует одновременные нажатия", () => {
  assert.strictEqual(maskFromCodes(["ArrowUp", "KeyZ"]), BTN.Up | BTN.A);
  assert.strictEqual(maskFromCodes(["ArrowLeft", "ArrowRight"]), BTN.Left | BTN.Right);
  assert.strictEqual(maskFromCodes(["KeyW", "KeyD"]), BTN.Up | BTN.Right);
  assert.strictEqual(maskFromCodes([]), 0);
});
