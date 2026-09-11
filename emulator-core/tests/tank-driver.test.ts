// tank-driver.test.js — тесты JS-слоя управления танками (движение/коллизии/ИИ).
// Модель: поле 32x32 ячейки по 8px, танк 13x13px, RAM (x,y) — центр танка.
// Движение проверяет переднюю кромку (canLead); корпус-бокс — canPlace.
// Запуск: node --test.
import { test } from "node:test";
import assert from "node:assert";
import {
  stepTank,
  tickTank,
  canPlace,
  canLead,
  aiDirection,
  runtimePassable,
  FIELD,
  TILE,
  TANK,
  HALF,
} from "../io/tank-driver.ts";

// пустое поле 32x32
const empty = new Uint8Array(FIELD * FIELD); // все 0x00 -> проходимы

// поле с вертикальной стеной в колонке 16 (x=128..135)
const walled = empty.slice();
for (let r = 0; r < FIELD; r++) walled[r * FIELD + 16] = 0x11; // стена

// поле с вертикальной «водной» стеной (0x0f) — по ASM блокирует танк
const waterWalled = empty.slice();
for (let r = 0; r < FIELD; r++) waterWalled[r * FIELD + 16] = 0x0f; // вода/стена

test("runtimePassable: зеркалит ASM — проходимы 0x00 и 0x20..0x7F, всё прочее блокирует", () => {
  assert.strictEqual(runtimePassable(0x00), true);
  assert.strictEqual(runtimePassable(0x20), true); // дорога (нижняя граница проходимых)
  assert.strictEqual(runtimePassable(0x7f), true); // дорога (верхняя граница проходимых)
  assert.strictEqual(runtimePassable(0x0f), false); // вода — танк НЕ проходит (ASM блокирует)
  assert.strictEqual(runtimePassable(0x15), false); // вода (вариант) — блокирует
  assert.strictEqual(runtimePassable(0x11), false); // стена
  assert.strictEqual(runtimePassable(0x16), false); // сталь
  assert.strictEqual(runtimePassable(0x01), false); // нижняя граница блокирующих
  assert.strictEqual(runtimePassable(0x1f), false); // верхняя граница блокирующих
  assert.strictEqual(runtimePassable(0x80), false); // бит7 установлен -> блокирует
  assert.strictEqual(runtimePassable(0xff), false); // бит7 установлен -> блокирует
});

test("runtimePassable согласован с правилом ASM для всех 256 значений", () => {
  for (let v = 0; v < 256; v++) {
    const expected = v === 0x00 || (v >= 0x20 && v < 0x80);
    assert.strictEqual(runtimePassable(v), expected, `tile ${v.toString(16)}`);
  }
});

test("stepTank движется в 4 направлениях на пустом поле (0=Up,1=Left,2=Down,3=Right)", () => {
  const pos = { x: 16 * TILE, y: 16 * TILE }; // (128,128)
  assert.deepStrictEqual(stepTank(pos, 0, empty, runtimePassable), { x: pos.x, y: pos.y - 1 });
  assert.deepStrictEqual(stepTank(pos, 1, empty, runtimePassable), { x: pos.x - 1, y: pos.y });
  assert.deepStrictEqual(stepTank(pos, 2, empty, runtimePassable), { x: pos.x, y: pos.y + 1 });
  assert.deepStrictEqual(stepTank(pos, 3, empty, runtimePassable), { x: pos.x + 1, y: pos.y });
});

test("коллизия: стена блокирует переднюю кромку, край поля тоже", () => {
  // стена в колонке 16 (x=128..135). Тело танка [x-6, x+6]; передняя кромка x+6.
  const y = 16 * TILE;
  const atWall = { x: 121, y }; // тело [115,127] — у самой стены (x=128)
  assert.strictEqual(canPlace(atWall.x, atWall.y, walled, runtimePassable), true);
  // двинуться вправо нельзя: целевой центр x=122 даёт переднюю кромку на стене
  assert.strictEqual(canLead(atWall.x, atWall.y, 3, walled, runtimePassable), false);
  // шаг вправо: передняя кромка заденет колонку 16 -> blocked
  assert.strictEqual(stepTank(atWall, 3, walled, runtimePassable), null);
  // чуть левее — передняя кромка (x+8) ещё не достигла стены, можно шагнуть вправо
  assert.deepStrictEqual(stepTank({ x: 119, y }, 3, walled, runtimePassable), { x: 120, y });
  // вверх/вниз внутри колонки 15 — ок (не впритык к стене)
  assert.notStrictEqual(stepTank({ x: 112, y }, 0, walled, runtimePassable), null);
  assert.notStrictEqual(stepTank({ x: 112, y }, 2, walled, runtimePassable), null);
  // вплотную к стене (x=121) вверх/вниз нельзя: ASM-бокс ±8 вылезает в колонку 16
  assert.strictEqual(stepTank(atWall, 0, walled, runtimePassable), null);
  // край поля: у левого края влево нельзя
  assert.strictEqual(stepTank({ x: 0, y }, 1, empty, runtimePassable), null);
});

test("коллизия: водная стена 0x0f блокирует переднюю кромку (танк не проходит сквозь)", () => {
  const y = 16 * TILE;
  const atWater = { x: 121, y };
  assert.strictEqual(canPlace(atWater.x, atWater.y, waterWalled, runtimePassable), true);
  assert.strictEqual(stepTank(atWater, 3, waterWalled, runtimePassable), null);
  assert.deepStrictEqual(stepTank({ x: 119, y }, 3, waterWalled, runtimePassable), { x: 120, y });
});

test("canPlace: центрированный корпус не встаёт на стену и в пределах поля", () => {
  assert.strictEqual(canPlace(0, 0, empty, runtimePassable), false); // корпус вылезает за поле
  assert.strictEqual(canPlace(8, 8, empty, runtimePassable), true);
  assert.strictEqual(canPlace(128, 8, walled, runtimePassable), false); // на стене (колонка 16)
  assert.strictEqual(canPlace(FIELD * TILE - HALF - 1, 8, empty, runtimePassable), true); // x=249
  assert.strictEqual(canPlace(FIELD * TILE - HALF, 8, empty, runtimePassable), false); // x=250
});

test("aiDirection: идёт к цели", () => {
  const from = { x: 16 * TILE, y: 16 * TILE };
  const targetDown = { x: 16 * TILE, y: 24 * TILE };
  assert.strictEqual(aiDirection(from, targetDown, empty, runtimePassable), 2); // вниз
  const targetUp = { x: 16 * TILE, y: 8 * TILE };
  assert.strictEqual(aiDirection(from, targetUp, empty, runtimePassable), 0); // вверх
});

test("tickTank: двигается по направлению или остаётся при блокировке", () => {
  const pos = { x: 16 * TILE, y: 16 * TILE };
  assert.deepStrictEqual(tickTank(pos, 2, empty, runtimePassable), { x: pos.x, y: pos.y + 1 });
  const atRight = { x: FIELD * TILE - HALF - 1, y: 16 * TILE }; // x=249, тело [243,255]
  assert.deepStrictEqual(tickTank(atRight, 3, empty, runtimePassable), atRight);
});
