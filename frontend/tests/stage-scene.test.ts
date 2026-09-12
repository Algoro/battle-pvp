// stage-scene.test.ts — предпросмотр уровня: ROM-блоки стадии → поле коллизий.
import { test } from "node:test";
import assert from "node:assert";
import { stageScene } from "../src/render/stage-scene.ts";
import { PLAY_BOUNDS } from "../src/render/scene-state.ts";

function fakeEmu(blocks: Record<number, number>, tileOf: (id: number, k: number) => number) {
  const b = new Uint8Array(169);
  const t = new Uint8Array(169 * 4);
  for (const [i, id] of Object.entries(blocks)) {
    const idx = Number(i);
    b[idx] = id;
    for (let k = 0; k < 4; k++) t[idx * 4 + k] = tileOf(id, k);
  }
  return { getStage: () => ({ blocks: b, tiles: t }) };
}

const c = PLAY_BOUNDS.col0;
const r = PLAY_BOUNDS.row0;
const at = (s: ReturnType<typeof stageScene>, fc: number, fr: number) => s.field[(r + fr) * 32 + (c + fc)];

test("stage-scene: полный кирпич, сталь, вода, пусто", () => {
  const emu = fakeEmu({ 0: 0x4, 1: 0xa, 2: 0xd }, () => 0x10);
  const s = stageScene(emu, 901);
  // кирпич (id4) — 2×2 клетки в начале
  assert.strictEqual(at(s, 0, 0), 0x0f);
  assert.strictEqual(at(s, 1, 1), 0x0f);
  // вода (id a) в колонке блока 1 → клетки 2..3
  assert.strictEqual(at(s, 2, 0), 0x12);
  assert.strictEqual(at(s, 3, 1), 0x12);
  // пусто (id d) в блоке 2 → клетки 4..5
  assert.strictEqual(at(s, 4, 0), 0);
  assert.strictEqual(s.tanks.length, 0);
});

test("stage-scene: частичный кирпич — заполнены только тайлы квадрантов", () => {
  // id 3 = верхняя половина (TL,TR), нижние тайлы пустые
  const emu = fakeEmu({ 0: 0x3 }, (_id, k) => (k < 2 ? 0x0f : 0));
  const s = stageScene(emu, 902);
  assert.strictEqual(at(s, 0, 0), 0x0f);
  assert.strictEqual(at(s, 1, 0), 0x0f);
  assert.strictEqual(at(s, 0, 1), 0);
  assert.strictEqual(at(s, 1, 1), 0);
});

test("stage-scene: место под орла свободно, штаб в центре низа", () => {
  const emu = fakeEmu({ 0: 0x4 }, () => 0x10);
  const s = stageScene(emu, 903);
  assert.strictEqual(at(s, 12, 24), 0);
  assert.deepStrictEqual(s.eagle, { col: c + 12, row: r + 24, fortified: false, destroyed: false });
});
