// meine-tank-decor.test.ts — ground decor must never grow on water, ice, trees, roads,
// brick, steel or the eagle base.
import { test } from "node:test";
import assert from "node:assert";
import { decorAllowed, decorReadyToBuild } from "../src/render/drivers/meine-tank/world/decor.ts";
import { TILE } from "@core/domain.ts";

test("meine-tank decor: растёт только на голой земле", () => {
  assert.strictEqual(decorAllowed(TILE.EMPTY), true, "трава/песок/грунт — можно");
});

test("meine-tank decor: не растёт на воде, льду, деревьях и дороге", () => {
  assert.strictEqual(decorAllowed(TILE.WATER), false, "вода");
  assert.strictEqual(decorAllowed(TILE.ICE), false, "лёд");
  assert.strictEqual(decorAllowed(TILE.TREE), false, "деревья");
  assert.strictEqual(decorAllowed(0x20), false, "дорога");
  assert.strictEqual(decorAllowed(0x2a), false, "дорога-вариант");
});

test("meine-tank decor: не сеется, пока поле пустое (стадия ещё не загрузилась)", () => {
  assert.strictEqual(decorReadyToBuild(false, false, 10), false, "пустое поле — ждём");
  assert.strictEqual(decorReadyToBuild(true, false, 10), false, "поле меняется — ждём");
  assert.strictEqual(decorReadyToBuild(true, true, 3), true, "поле загрузилось и стабильно");
  assert.strictEqual(decorReadyToBuild(false, false, 121), true, "пустая стадия — по таймауту");
});

test("meine-tank decor: не растёт на кирпиче, стали и орле", () => {
  assert.strictEqual(decorAllowed(0x0f), false, "кирпич");
  assert.strictEqual(decorAllowed(0x14), false, "кирпич-вариант");
  assert.strictEqual(decorAllowed(TILE.STEEL), false, "сталь");
  assert.strictEqual(decorAllowed(TILE.STEEL_ALT), false, "сталь-вариант");
  assert.strictEqual(decorAllowed(0xc8), false, "орёл");
});
