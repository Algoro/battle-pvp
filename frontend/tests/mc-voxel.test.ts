// mc-voxel.test.ts — блоки, настройки/пресеты и мешер (отсечение граней, AO).
import { test } from "node:test";
import assert from "node:assert";
import { blockForTile, solidAt } from "../src/render/drivers/mc-voxel/world/blocks.ts";
import { meshCells, type MeshContext, type MeshCell } from "../src/render/drivers/mc-voxel/world/mesher.ts";
import {
  normalizeMcOptions,
  optionsFromPreset,
  MC_DEFAULTS,
} from "../src/render/drivers/mc-voxel/options.ts";
import type { RenderBounds } from "../src/render/types.ts";

const BOUNDS: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };

test("mc-voxel: tile -> блок", () => {
  assert.strictEqual(blockForTile(0), null);
  assert.strictEqual(blockForTile(0x0f)?.pass, "opaque");
  assert.strictEqual(blockForTile(0x0f)?.h, 1);
  const dmg = blockForTile(0x05);
  assert.ok(dmg && dmg.h < 1 && dmg.top === "brickCracked");
  assert.strictEqual(blockForTile(0x10)?.top, "steel");
  assert.strictEqual(blockForTile(0x12)?.pass, "water");
  assert.strictEqual(blockForTile(0x21)?.top, "ice");
  assert.strictEqual(blockForTile(0x22)?.pass, "cutout");
  assert.strictEqual(blockForTile(0x20)?.top, "path");
  assert.strictEqual(blockForTile(0xc8), null, "орёл — отдельной моделью");
});

test("mc-voxel: solidAt учитывает высоту и флаг solid", () => {
  const brick = blockForTile(0x0f)!;
  const path = blockForTile(0x20)!;
  assert.strictEqual(solidAt(brick, 0.5), true);
  assert.strictEqual(solidAt(brick, 1.5), false);
  assert.strictEqual(solidAt(path, 0.05), false, "дорога не непроходима");
  assert.strictEqual(solidAt(null, 0.5), false);
});

test("mc-voxel: нормализация настроек и пресеты", () => {
  const d = normalizeMcOptions(null);
  assert.deepStrictEqual(d, MC_DEFAULTS);
  assert.strictEqual(normalizeMcOptions({ fog: 9 }).fog, 1);
  assert.strictEqual(normalizeMcOptions({ time: "nope" }).time, "day");
  assert.strictEqual(normalizeMcOptions({ textureSize: 32 }).textureSize, 32);
  const perf = optionsFromPreset("performance");
  assert.strictEqual(perf.ao, "off");
  assert.strictEqual(perf.shadows, "off");
  assert.strictEqual(perf.particles, 0);
  assert.strictEqual(perf.preset, "performance");
});

function ctx(defs: Record<string, "brick">, ao: "off" | "simple" | "smooth"): MeshContext {
  return {
    bounds: BOUNDS,
    defAt: (c, r) => (defs[`${c},${r}`] ? blockForTile(0x0f) : null),
    uvOf: () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }),
    ao,
    outline: false,
  };
}

function cell(c: number, r: number): MeshCell {
  return { col: c, row: r, def: blockForTile(0x0f)! };
}

test("mc-voxel: мешер отсекает общие грани", () => {
  const single = meshCells([cell(2, 2)], ctx({ "2,2": "brick" }, "smooth"));
  // top + 4 боковых (низ у земли пропущен) = 5 граней
  assert.strictEqual(single.opaque.index.length / 6, 5);

  const pair = meshCells([cell(2, 2), cell(3, 2)], ctx({ "2,2": "brick", "3,2": "brick" }, "smooth"));
  // 2 top + 3+3 боковых (общая грань скрыта) = 8
  assert.strictEqual(pair.opaque.index.length / 6, 8);
});

test("mc-voxel: AO затеняет углы у соседнего блока", () => {
  const alone = meshCells([cell(2, 2)], ctx({ "2,2": "brick" }, "smooth"));
  const near = meshCells([cell(2, 2), cell(3, 2)], ctx({ "2,2": "brick", "3,2": "brick" }, "smooth"));
  const maxAlone = Math.max(...alone.opaque.color);
  const maxNear = Math.max(...near.opaque.color);
  const minNear = Math.min(...near.opaque.color);
  assert.strictEqual(maxAlone, 1);
  assert.ok(minNear < maxNear, "при соседе часть вершин затеняется");

  // AO выключен -> верхние грани без затенения (ровно 1.0), несмотря на соседа.
  const flat = meshCells([cell(2, 2), cell(3, 2)], ctx({ "2,2": "brick", "3,2": "brick" }, "off"));
  const flatTop: number[] = [];
  for (let v = 0; v < flat.opaque.color.length / 3; v++) {
    if (flat.opaque.normal[v * 3 + 1] > 0.5) flatTop.push(flat.opaque.color[v * 3]);
  }
  assert.strictEqual(flatTop.length, 8);
  assert.ok(flatTop.every((c) => c === 1));
});

test("mc-voxel: контур добавляет только открытые верхние рёбра", () => {
  const c = ctx({ "2,2": "brick", "3,2": "brick" }, "off");
  c.outline = true;
  const m = meshCells([cell(2, 2), cell(3, 2)], c);
  // открытых сторон: у пары суммарно 6 рёбер
  assert.strictEqual(m.outline.length / 6, 6);
});
