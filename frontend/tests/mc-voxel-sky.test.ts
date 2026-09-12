// mc-voxel-sky.test.ts — палитра дня/ночи: «день» должен быть голубым, а не бежевым.
import { test } from "node:test";
import assert from "node:assert";
import { dayStateForFraction } from "../src/render/drivers/mc-voxel/sky/sky.ts";

function rgb(n: number): [number, number, number] {
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

test("mc-voxel sky: полдень — голубое небо и туман", () => {
  const day = dayStateForFraction(0.5);
  const fog = rgb(day.fogColor);
  const top = rgb(day.skyTop);
  assert.ok(fog[2] > fog[0] + 20, `туман должен быть голубым, получено ${fog}`);
  assert.ok(top[2] > top[0] + 40, `небо должно быть голубым, получено ${top}`);
  assert.ok(day.starOpacity < 0.05, "днём звёзд нет");
});

test("mc-voxel sky: восход — тёплый горизонт", () => {
  const dawn = dayStateForFraction(0.25);
  const horizon = rgb(dawn.skyHorizon);
  assert.ok(horizon[0] > horizon[2], `горизонт восхода тёплый, получено ${horizon}`);
});

test("mc-voxel sky: ночь — тёмное небо и звёзды", () => {
  const night = dayStateForFraction(0.0);
  const top = rgb(night.skyTop);
  assert.ok(top[0] + top[1] + top[2] < 120, "ночью небо тёмное");
  assert.strictEqual(night.starOpacity, 1);
});
