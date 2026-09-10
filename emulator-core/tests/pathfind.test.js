// pathfind.test.js — проверка стратегического слоя навигации (взвешенный A*).
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.js";
import { aStar, pathDirection, pathCost, isReachable, bfsDirection, costField } from "../model/pathfind.js";

function emptyField() {
  const f = new Uint8Array(1024);
  return f;
}

function setTile(field, col, row, v) {
  field[row * 32 + col] = v;
}

test("aStar — прямой путь на открытом поле", () => {
  const f = emptyField();
  const path = aStar(f, { col: 0, row: 0 }, { col: 5, row: 0 }, {});
  assert.ok(path);
  assert.strictEqual(path.length, 5);
  assert.strictEqual(path[0].col, 1);
  assert.strictEqual(path[path.length - 1].col, 5);
  assert.strictEqual(pathDirection(f, { col: 0, row: 0 }, { col: 5, row: 0 }, {}), 3); // right
});

test("aStar — обход стальной стены (сталь непроходима)", () => {
  const f = emptyField();
  for (let r = 0; r < 3; r++) setTile(f, 3, r, 0x10); // короткая стальная стена на col 3, rows 0..2
  const path = aStar(f, { col: 0, row: 0 }, { col: 6, row: 0 }, {});
  assert.ok(path, "путь существует в обход стены");
  // путь не проходит через сталь (в застенном диапазоне rows 0..2, col 3)
  for (const c of path) {
    if (c.row <= 2) assert.notStrictEqual(c.col, 3, "не заходит в сталь в зоне стены");
  }
  assert.ok(path.length > 6, "обход длиннее прямого пути");
});

test("aStar — allowBreak: кирпич проходим, вода нет", () => {
  const f = emptyField();
  setTile(f, 3, 0, 0x0f); // кирпич на (3,0)
  setTile(f, 3, 3, 0x12); // вода на (3,3)
  // без allowBreak цель за кирпичом (5,0): обходим кирпич (3,0) по row 1
  const path = aStar(f, { col: 0, row: 0 }, { col: 5, row: 0 }, { allowBreak: false });
  assert.ok(path);
  for (const c of path) assert.ok(!(c.col === 3 && c.row === 0), "не в кирпич без allowBreak");
  // с allowBreak можно пройти сквозь кирпич
  const direct = aStar(f, { col: 0, row: 0 }, { col: 5, row: 0 }, { allowBreak: true });
  assert.ok(direct);
  assert.ok(direct.some((c) => c.col === 3), "allowBreak проходит сквозь кирпич");
  // вода непроходима в любом случае (сплошной барьер на col 3)
  for (let r = 0; r < 32; r++) setTile(f, 3, r, 0x12);
  const waterPath = aStar(f, { col: 2, row: 2 }, { col: 4, row: 2 }, { allowBreak: true });
  assert.strictEqual(waterPath, null, "вода непроходима");
});

test("pathCost — учитывает стоимость тайлов (кирпич дороже)", () => {
  const f = emptyField();
  // прямая через кирпич (cost 3) vs обход (4 шага по пустоте cost 4)
  setTile(f, 3, 0, 0x0f);
  const viaBrick = pathCost(f, { col: 0, row: 0 }, { col: 5, row: 0 }, { allowBreak: true });
  assert.ok(viaBrick >= 7, "прямо через кирпич (1+3+1+1+1=7)");
  const around = pathCost(f, { col: 0, row: 0 }, { col: 5, row: 0 }, { allowBreak: false });
  assert.ok(around > 5, "обход длиннее прямого пути");
});

test("pathCost — недостижимая цель = Infinity", () => {
  const f = emptyField();
  for (let r = 0; r < 32; r++) setTile(f, 3, r, 0x10); // бесконечная стальная стена на col 3
  // цель и старт по разные стороны стены → недостижимо
  const cost = pathCost(f, { col: 2, row: 0 }, { col: 10, row: 0 }, {});
  assert.strictEqual(cost, Infinity);
  assert.strictEqual(isReachable(f, { col: 2, row: 0 }, { col: 10, row: 0 }, {}), false);
});

test("aStar — avoid: избегание зоны (например, под пулями)", () => {
  const f = emptyField();
  const avoid = new Set([1 * 32 + 1, 1 * 32 + 2]); // клетки (1,1),(2,1)
  const path = aStar(f, { col: 0, row: 0 }, { col: 3, row: 0 }, { avoid });
  assert.ok(path);
  for (const c of path) assert.ok(!avoid.has(c.row * 32 + c.col), "не заходит в avoid-зону");
});

test("aStar — maxCost обрезает длинные пути", () => {
  const f = emptyField();
  // от (0,0) до (20,0) — 20 шагов, maxCost 5 → недостижимо
  const p = aStar(f, { col: 0, row: 0 }, { col: 20, row: 0 }, { maxCost: 5 });
  assert.strictEqual(p, null);
});

test("pathDirection — работает на buildState-поле", () => {
  const s = buildState({
    field: [
      "........",
      "........",
      "..#.....",
      "........",
    ],
  });
  const d = pathDirection(s.field, { col: 0, row: 0 }, { col: 3, row: 3 }, {});
  assert.ok(d !== null);
});

// --- общие примитивы, перенесённые из атакующих ИИ (behavior-preserving) ---
test("bfsDirection — первый шаг по BFS; null при недостижимости", () => {
  const f = new Uint8Array(1024);
  assert.strictEqual(bfsDirection(f, { col: 0, row: 0 }, { col: 5, row: 0 }), 3); // right
  assert.strictEqual(bfsDirection(f, { col: 5, row: 5 }, { col: 5, row: 5 }), null); // уже там
  // стена во всю ширину на row 1 разделяет → недостижимо
  for (let c = 0; c < 32; c++) f[1 * 32 + c] = 0x10;
  assert.strictEqual(bfsDirection(f, { col: 0, row: 0 }, { col: 0, row: 5 }), null);
});

test("costField — BFS-поле стоимости (движение 1, кирпич = прочность)", () => {
  const f = new Uint8Array(1024);
  const cost = costField(f, { col: 5, row: 5 });
  assert.strictEqual(cost[5 * 32 + 5], 0, "цель = 0");
  assert.strictEqual(cost[5 * 32 + 6], 1, "соседняя = 1");
  assert.strictEqual(cost[5 * 32 + 8], 3, "через 3 клетки = 3");
  // кирпич на пути → стоимость = прочность (0x0f = 2)
  const f2 = new Uint8Array(1024);
  f2[5 * 32 + 6] = 0x0f;
  const cost2 = costField(f2, { col: 5, row: 5 });
  assert.strictEqual(cost2[5 * 32 + 6], 2, "кирпич 0x0f стоит 2");
});
