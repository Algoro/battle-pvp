// input.test.js — тесты чистой логики ввода (клавиатура -> con_btn).
// Клавиши задаются кодами KeyboardEvent.code (KeyZ, KeyW, ArrowUp и т.д.).
// Запуск: node --test tests/input.test.js
import { test } from "node:test";
import assert from "node:assert";
import { BTN, keyToMask, maskFromCodes } from "../src/engine/input.ts";

test("keyToMask сопоставляет коды клавиш битам con_btn", () => {
  assert.strictEqual(keyToMask("ArrowUp"), BTN.Up);
  assert.strictEqual(keyToMask("KeyW"), BTN.Up);
  assert.strictEqual(keyToMask("ArrowLeft"), BTN.Left);
  assert.strictEqual(keyToMask("KeyA"), BTN.Left);
  assert.strictEqual(keyToMask("KeyZ"), BTN.A); // огонь
  assert.strictEqual(keyToMask("KeyJ"), BTN.A);
  assert.strictEqual(keyToMask("Enter"), BTN.Start);
  assert.strictEqual(keyToMask("ShiftLeft"), BTN.Select);
  assert.strictEqual(keyToMask("KeyQ"), 0); // не назначено
});

test("maskFromCodes агрегирует одновременные нажатия", () => {
  assert.strictEqual(maskFromCodes(["ArrowUp", "KeyZ"]), BTN.Up | BTN.A);
  assert.strictEqual(maskFromCodes(["ArrowLeft", "ArrowRight"]), BTN.Left | BTN.Right);
  assert.strictEqual(maskFromCodes(["KeyW", "KeyD"]), BTN.Up | BTN.Right);
  assert.strictEqual(maskFromCodes([]), 0);
});
