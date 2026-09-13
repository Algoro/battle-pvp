// fine-grid.test.js — verification of the fine passability grid (fixed patch).
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.ts";
import { buildFineGrid, canOccupy, tankFinePos, cellFinePos, fineAStar, finePathDirection,
  TANK_FINE, FINE, FINE_SIZE } from "../model/fine-grid.ts";

function field32(fill = ".".repeat(32)) {
  return Array.from({ length: 32 }, () => fill);
}

test("buildFineGrid — кирпичные квадранты (bit0=TL,1=TR,2=BL,3=BR) мапятся в fine-клетки", () => {
  // tile 0x03 = TL+TR (top half) — the top row of fine cells is occupied
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x03; // tile (0,0): top half
  const g = buildFineGrid(s.field);
  // tile (0,0) -> fine fx 0..1, fy 0..1. Top row (fy=0): blocked(0); bottom (fy=1): open(1)
  assert.strictEqual(g[0 * FINE_SIZE + 0], 0, "TL (fr0,fc0) должен быть блок");
  assert.strictEqual(g[0 * FINE_SIZE + 1], 0, "TR (fr0,fc1) должен быть блок");
  assert.strictEqual(g[1 * FINE_SIZE + 0], 1, "BL (fr1,fc0) должен быть открыт");
  assert.strictEqual(g[1 * FINE_SIZE + 1], 1, "BR (fr1,fc1) должен быть открыт");
});

test("buildFineGrid — 0x0a = правый столбец (TR+BR) блокирован", () => {
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x0a; // bits 1,3 = TR,BR
  const g = buildFineGrid(s.field);
  assert.strictEqual(g[0 * FINE_SIZE + 1], 0, "TR (fc1) блок");
  assert.strictEqual(g[1 * FINE_SIZE + 1], 0, "BR (fc1) блок");
  assert.strictEqual(g[0 * FINE_SIZE + 0], 1, "TL открыт");
  assert.strictEqual(g[1 * FINE_SIZE + 0], 1, "BL открыт");
});

test("buildFineGrid — сталь/вода полностью блокируют, пусто/дерево/лёд открыты", () => {
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x11; // steel
  s.mem[0x400 + 0 * 32 + 1] = 0x12; // water
  s.mem[0x400 + 0 * 32 + 2] = 0x22; // tree
  s.mem[0x400 + 0 * 32 + 3] = 0x21; // ice
  const g = buildFineGrid(s.field);
  // steel c=0 -> fx 0,1; water c=1 -> fx 2,3; tree c=2 -> fx 4,5; ice c=3 -> fx 6,7
  for (let y = 0; y < 2; y++) {
    assert.strictEqual(g[y * FINE_SIZE + 0], 0, "сталь блок");
    assert.strictEqual(g[y * FINE_SIZE + 1], 0, "сталь блок");
    assert.strictEqual(g[y * FINE_SIZE + 2], 0, "вода блок");
    assert.strictEqual(g[y * FINE_SIZE + 3], 0, "вода блок");
    assert.strictEqual(g[y * FINE_SIZE + 4], 1, "дерево открыто");
    assert.strictEqual(g[y * FINE_SIZE + 5], 1, "дерево открыто");
    assert.strictEqual(g[y * FINE_SIZE + 6], 1, "лёд открыт");
    assert.strictEqual(g[y * FINE_SIZE + 7], 1, "лёд открыт");
  }
});

test("canOccupy — хитбокс танка 16×16 (4×4 fine-клетки) на открытом поле и у препятствия", () => {
  const s = buildState({ field: field32() });
  const g = buildFineGrid(s.field);
  assert.ok(canOccupy(g, 0, 0, FINE_SIZE), "открытое поле — помещается");
  // steel in tile (0,0) blocks any position whose hitbox touches it
  s.mem[0x400 + 0 * 32 + 0] = 0x10;
  const g2 = buildFineGrid(s.field);
  assert.ok(!canOccupy(g2, 0, 0, FINE_SIZE), "хитбокс над сталью — не помещается");
  assert.ok(canOccupy(g2, 4, 4, FINE_SIZE), "вдали от стали — помещается");
});

test("tankFinePos/cellFinePos — соответствие пиксельного центра и центра тайла", () => {
  // tank center at the center of tile (1,1)=(12,12): hitbox top-left = 12-8=4 -> fine (1,1)
  assert.deepStrictEqual(tankFinePos(12, 12), { x: 1, y: 1 });
  assert.deepStrictEqual(cellFinePos(1, 1), { x: 1, y: 1 });
});

test("КЛЮЧЕВОЙ: 16px-танк НЕ проходит сквозь 8px-стык (исправление патча)", () => {
  // A full-width wall on row 5, with an 8px (one tile) gap at (16,5).
  // By the patch (8×8 hitbox) such a gap is passable; by the real 16×16 hitbox — not.
  const field = field32();
  for (let c = 0; c < 32; c++) field[5] = field[5].slice(0, c) + "B" + field[5].slice(c + 1); // row5 = brick
  field[5] = field[5].slice(0, 16) + "." + field[5].slice(17); // 8px gap at (16,5)
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const start = { x: 32, y: 20 }; // below the wall
  const goal = { x: 32, y: 4 };   // above the wall
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  assert.strictEqual(path, null, "16×16 танк не может пройти через 8px-стык в стене");
});

test("КЛЮЧЕВОЙ: 16px-танк проходит сквозь 16px-проём", () => {
  const field = field32();
  for (let c = 0; c < 32; c++) field[5] = field[5].slice(0, c) + "B" + field[5].slice(c + 1);
  field[5] = field[5].slice(0, 16) + ".." + field[5].slice(18); // 16px gap (16,5)+(17,5)
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const start = { x: 32, y: 20 };
  const goal = { x: 32, y: 4 };
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  assert.ok(path, "16×16 танк проходит через 16px-проём");
  const dir = finePathDirection(g, start, goal, {}, FINE_SIZE, s.field);
  assert.strictEqual(dir, 0, "первый шаг вверх");
});

test("fineAStar — обходит сплошную стальную стену (в обход по открытому краю)", () => {
  const field = field32();
  // short steel wall at (10..12, 10..12)
  for (let r = 10; r <= 12; r++) for (let c = 10; c <= 12; c++) {
    field[r] = field[r].slice(0, c) + "#" + field[r].slice(c + 1);
  }
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const start = { x: 8, y: 20 };   // left bottom
  const goal = { x: 40, y: 20 };   // right
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  assert.ok(path, "путь в обход стены существует");
  for (const p of path) assert.ok(canOccupy(g, p.x, p.y, FINE_SIZE), "каждая позиция пути допустима");
});

test("relaxStart — танк на границе (хитбокс не влезает) релаксируется к ближайшей валидной позиции", () => {
  const s = buildState({ field: field32() });
  const g = buildFineGrid(s.field);
  // invalid start on the field edge (out of bounds)
  const start = { x: FINE_SIZE - 2, y: FINE_SIZE - 2 }; // hitbox sticks out of the field
  const goal = { x: 4, y: 4 };
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  // relaxStart must find a valid position and build a path to the goal
  assert.ok(path, "релаксация старта позволяет найти путь");
});

test("ПАТЧ ДИАГОНАЛЬ: путь строго ортогонален (нет диагональных «срезов» угла)", () => {
  // A maze of open single cells where a diagonal cut would give a short path,
  // but the orthogonal graph forbids it.
  const field = field32();
  // a vertical "corridor" one fine cell wide is impossible for a 4×4 tank, so
  // we build a wide open area and check: every step of the path is along only one axis.
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const path = fineAStar(g, { x: 4, y: 4 }, { x: 20, y: 18 }, {}, FINE_SIZE, s.field);
  assert.ok(path, "путь существует");
  let px = 4, py = 4;
  for (const p of path) {
    const dx = Math.abs(p.x - px), dy = Math.abs(p.y - py);
    assert.strictEqual(dx + dy, 1, `диагональный шаг: (${px},${py})->(${p.x},${p.y})`);
    px = p.x; py = p.y;
  }
});
