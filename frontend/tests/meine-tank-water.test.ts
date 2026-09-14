// meine-tank-water.test.ts — pond depth: whole blocks whose height grows with the area
// of the connected body of water.
import { test } from "node:test";
import assert from "node:assert";
import { computeWaterDepths, depthForArea, waterBlock } from "../src/render/drivers/meine-tank/world/water.ts";
import { meshCells } from "../src/render/drivers/meine-tank/world/mesher.ts";
import { blockForTile } from "../src/render/drivers/meine-tank/world/blocks.ts";
import type { RenderBounds } from "../src/render/types.ts";

const bounds: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };
const WATER = 0x12;
const GRASS = 0x20;

function idx(col: number, row: number): number {
  return row * 32 + col;
}

function blank(): Uint8Array {
  const f = new Uint8Array(32 * 32);
  for (let r = bounds.row0; r < bounds.row0 + bounds.rows; r++) {
    for (let c = bounds.col0; c < bounds.col0 + bounds.cols; c++) f[idx(c, r)] = GRASS;
  }
  return f;
}

test("meine-tank water: глубина растёт с площадью и зажата в 1..4", () => {
  assert.strictEqual(depthForArea(1), 1);
  assert.strictEqual(depthForArea(4), 2);
  assert.strictEqual(depthForArea(9), 3);
  assert.strictEqual(depthForArea(25), 4);
  for (let a = 1; a <= 100; a++) {
    const d = depthForArea(a);
    assert.ok(d >= 1 && d <= 4, `площадь ${a} -> глубина ${d}`);
  }
  assert.ok(depthForArea(16) >= depthForArea(4), "больше площадь — не мельче");
});

test("meine-tank water: блок воды погружён под арену", () => {
  const def = waterBlock(blockForTile(WATER)!, 3);
  assert.strictEqual(def.y0, -3, "дно на три блока под землёй");
  assert.ok(def.h > 2.5 && def.h < 3, "высота чуть меньше глубины из-за борта");
  const top = def.y0 + def.h;
  assert.ok(top < 0 && top > -0.2, "поверхность чуть ниже арены, а не над ней");
  assert.strictEqual(def.pass, "water");
});

test("meine-tank water: водоём — один блок глубины на все клетки", () => {
  const f = blank();
  // A 3x3 pond (area 9) -> depth 3.
  for (let r = 10; r < 13; r++) for (let c = 10; c < 13; c++) f[idx(c, r)] = WATER;
  const d = computeWaterDepths(f, bounds);
  for (let r = 10; r < 13; r++) for (let c = 10; c < 13; c++) assert.strictEqual(d[idx(c, r)], 3);
  assert.strictEqual(d[idx(9, 10)], 0, "суша остаётся без воды");
});

test("meine-tank water: одиночная клетка — один блок, диагональ не соединяет", () => {
  const f = blank();
  f[idx(5, 5)] = WATER;
  f[idx(6, 6)] = WATER;
  const d = computeWaterDepths(f, bounds);
  assert.strictEqual(d[idx(5, 5)], 1);
  assert.strictEqual(d[idx(6, 6)], 1, "диагональные клетки — разные водоёмы");
});

test("meine-tank water: больший водоём глубже меньшего", () => {
  const f = blank();
  for (let c = 3; c < 7; c++) f[idx(c, 3)] = WATER; // area 4
  for (let r = 10; r < 14; r++) for (let c = 10; c < 14; c++) f[idx(c, r)] = WATER; // area 16
  const d = computeWaterDepths(f, bounds);
  assert.strictEqual(d[idx(3, 3)], 2);
  assert.strictEqual(d[idx(10, 10)], 4);
  assert.ok(d[idx(10, 10)] > d[idx(3, 3)]);
});

test("meine-tank water: вода за границами арены игнорируется", () => {
  const f = blank();
  f[idx(0, 0)] = WATER;
  const d = computeWaterDepths(f, bounds);
  assert.strictEqual(d[idx(0, 0)], 0);
});

test("meine-tank water: у водоёма есть дно-стенки, но нет внутренних граней", () => {
  const uv = { u0: 0, v0: 0, u1: 1, v1: 1 };
  const water = waterBlock(blockForTile(WATER)!, 2);
  const inPond = (c: number, r: number): boolean => (c === 10 || c === 11) && r === 10;
  const makeCtx = (isWater: (c: number, r: number) => boolean) => ({
    bounds,
    defAt: (c: number, r: number) => (isWater(c, r) ? water : null),
    uvOf: () => uv,
    ao: "off" as const,
    outline: false,
  });

  // One cell: top + four walls = 5 quads (bottom is flush, skipped).
  const one = meshCells([{ col: 10, row: 10, def: water }], makeCtx((c, r) => c === 10 && r === 10));
  assert.strictEqual(one.water.position.length / 3, 20);

  // Two cells: 5 + 5 quads minus the two shared internal walls = 8 quads.
  const two = meshCells(
    [
      { col: 10, row: 10, def: water },
      { col: 11, row: 10, def: water },
    ],
    makeCtx(inPond),
  );
  assert.strictEqual(two.water.position.length / 3, 32);
});
