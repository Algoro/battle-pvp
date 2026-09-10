// fine-grid.test.js — проверка мелкой сетки проходимости (исправленный патч).
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.js";
import { buildFineGrid, canOccupy, tankFinePos, cellFinePos, fineAStar, finePathDirection,
  TANK_FINE, FINE, FINE_SIZE } from "../model/fine-grid.js";

function field32(fill = ".".repeat(32)) {
  return Array.from({ length: 32 }, () => fill);
}

test("buildFineGrid — кирпичные квадранты (bit0=TL,1=TR,2=BL,3=BR) мапятся в fine-клетки", () => {
  // тайл 0x03 = TL+TR (верхняя половина) — занята верхняя строка fine-клеток
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x03; // тайл (0,0): верхняя половина
  const g = buildFineGrid(s.field);
  // тайл (0,0) -> fine fx 0..1, fy 0..1. Верхняя строка (fy=0): blocked(0); нижняя (fy=1): open(1)
  assert.strictEqual(g[0 * FINE_SIZE + 0], 0, "TL (fr0,fc0) должен быть блок");
  assert.strictEqual(g[0 * FINE_SIZE + 1], 0, "TR (fr0,fc1) должен быть блок");
  assert.strictEqual(g[1 * FINE_SIZE + 0], 1, "BL (fr1,fc0) должен быть открыт");
  assert.strictEqual(g[1 * FINE_SIZE + 1], 1, "BR (fr1,fc1) должен быть открыт");
});

test("buildFineGrid — 0x0a = правый столбец (TR+BR) блокирован", () => {
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x0a; // биты 1,3 = TR,BR
  const g = buildFineGrid(s.field);
  assert.strictEqual(g[0 * FINE_SIZE + 1], 0, "TR (fc1) блок");
  assert.strictEqual(g[1 * FINE_SIZE + 1], 0, "BR (fc1) блок");
  assert.strictEqual(g[0 * FINE_SIZE + 0], 1, "TL открыт");
  assert.strictEqual(g[1 * FINE_SIZE + 0], 1, "BL открыт");
});

test("buildFineGrid — сталь/вода полностью блокируют, пусто/дерево/лёд открыты", () => {
  const s = buildState({ field: field32() });
  s.mem[0x400 + 0 * 32 + 0] = 0x11; // сталь
  s.mem[0x400 + 0 * 32 + 1] = 0x12; // вода
  s.mem[0x400 + 0 * 32 + 2] = 0x22; // дерево
  s.mem[0x400 + 0 * 32 + 3] = 0x21; // лёд
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
  // сталь в тайле (0,0) блокирует любую позицию, хитбокс которой её задевает
  s.mem[0x400 + 0 * 32 + 0] = 0x10;
  const g2 = buildFineGrid(s.field);
  assert.ok(!canOccupy(g2, 0, 0, FINE_SIZE), "хитбокс над сталью — не помещается");
  assert.ok(canOccupy(g2, 4, 4, FINE_SIZE), "вдали от стали — помещается");
});

test("tankFinePos/cellFinePos — соответствие пиксельного центра и центра тайла", () => {
  // центр танка в центре тайла (1,1)=(12,12): верх-лево хитбокса = 12-8=4 -> fine (1,1)
  assert.deepStrictEqual(tankFinePos(12, 12), { x: 1, y: 1 });
  assert.deepStrictEqual(cellFinePos(1, 1), { x: 1, y: 1 });
});

test("КЛЮЧЕВОЙ: 16px-танк НЕ проходит сквозь 8px-стык (исправление патча)", () => {
  // Стена во всю ширину на row 5, с 8px (один тайл) проёмом в (16,5).
  // По патчу (хитбокс 8×8) такой проём проходим; по реальному хитбоксу 16×16 — нет.
  const field = field32();
  for (let c = 0; c < 32; c++) field[5] = field[5].slice(0, c) + "B" + field[5].slice(c + 1); // row5 = кирпич
  field[5] = field[5].slice(0, 16) + "." + field[5].slice(17); // 8px проём в (16,5)
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const start = { x: 32, y: 20 }; // ниже стены
  const goal = { x: 32, y: 4 };   // выше стены
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  assert.strictEqual(path, null, "16×16 танк не может пройти через 8px-стык в стене");
});

test("КЛЮЧЕВОЙ: 16px-танк проходит сквозь 16px-проём", () => {
  const field = field32();
  for (let c = 0; c < 32; c++) field[5] = field[5].slice(0, c) + "B" + field[5].slice(c + 1);
  field[5] = field[5].slice(0, 16) + ".." + field[5].slice(18); // 16px проём (16,5)+(17,5)
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
  // короткая стальная стена на (10..12, 10..12)
  for (let r = 10; r <= 12; r++) for (let c = 10; c <= 12; c++) {
    field[r] = field[r].slice(0, c) + "#" + field[r].slice(c + 1);
  }
  const s = buildState({ field });
  const g = buildFineGrid(s.field);
  const start = { x: 8, y: 20 };   // слева снизу
  const goal = { x: 40, y: 20 };   // справа
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  assert.ok(path, "путь в обход стены существует");
  for (const p of path) assert.ok(canOccupy(g, p.x, p.y, FINE_SIZE), "каждая позиция пути допустима");
});

test("relaxStart — танк на границе (хитбокс не влезает) релаксируется к ближайшей валидной позиции", () => {
  const s = buildState({ field: field32() });
  const g = buildFineGrid(s.field);
  // неверный старт на краю поля (вне границ)
  const start = { x: FINE_SIZE - 2, y: FINE_SIZE - 2 }; // хитбокс вылезает за поле
  const goal = { x: 4, y: 4 };
  const path = fineAStar(g, start, goal, {}, FINE_SIZE, s.field);
  // relaxStart должен найти валидную позицию и построить путь к цели
  assert.ok(path, "релаксация старта позволяет найти путь");
});

test("ПАТЧ ДИАГОНАЛЬ: путь строго ортогонален (нет диагональных «срезов» угла)", () => {
  // Лабиринт из открытых single-клеток, где диагональный срез дал бы короткий путь,
  // но ортогональный граф запрещает его.
  const field = field32();
  // вертикальный «коридор» шириной 1 fine-клетку невозможен для 4×4 танка, поэтому
  // строим широкий открытый район и проверяем: каждый шаг пути — только по одной оси.
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
