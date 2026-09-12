// coords.test.ts — перевод RAM-пикселей в мировые юниты: непрерывность и центрирование.
// RAM (x,y) танка — ЦЕНТР танка (emulator-core/io/tank-driver.ts), поэтому округление
// до 8 px и лишнее смещение недопустимы (иначе рывки и наезд на препятствия).
import { test } from "node:test";
import assert from "node:assert";
import { PLAY_BOUNDS } from "../src/render/scene-state.ts";
import { tankCenter, pointFromPixel, spriteCenter, cellCenter, fieldCenter, followYaw } from "../src/render/coords.ts";

test("coords: центр танка — непрерывный, без округления до клетки", () => {
  const a = tankCenter(PLAY_BOUNDS, 88, 216);
  assert.deepStrictEqual(a, { x: 9, z: 25 });
  const b = tankCenter(PLAY_BOUNDS, 89, 216);
  assert.strictEqual(b.x, 9.125, "сдвиг на 1 px = 1/8 юнита, а не целая клетка");
});

test("coords: спавны DEF симметричны относительно центра поля", () => {
  const p0 = tankCenter(PLAY_BOUNDS, 88, 216);
  const p1 = tankCenter(PLAY_BOUNDS, 152, 216);
  const mid = { x: (p0.x + p1.x) / 2, z: (p0.z + p1.z) / 2 };
  const c = fieldCenter(PLAY_BOUNDS);
  assert.strictEqual(mid.x, c.x);
  assert.strictEqual(mid.z, p0.z);
});

test("coords: центр клетки и точки объектов согласованы", () => {
  assert.deepStrictEqual(cellCenter(PLAY_BOUNDS, 11, 3), { x: 9.5, z: 1.5 });
  assert.deepStrictEqual(pointFromPixel(PLAY_BOUNDS, 88, 216), tankCenter(PLAY_BOUNDS, 88, 216));
});

test("coords: центр спрайта приза/пули (RAM хранит top-left)", () => {
  // Приз 16×16: центр = pos/8 - col0 + 1.
  assert.deepStrictEqual(spriteCenter(PLAY_BOUNDS, 96, 96, 16), { x: 11, z: 11 });
  // Пуля 8×8: центр = pos/8 - col0 + 0.5.
  assert.deepStrictEqual(spriteCenter(PLAY_BOUNDS, 88, 216, 8), { x: 9.5, z: 25.5 });
});

test("coords: followYaw — камера за танком", () => {
  assert.ok(Math.abs(followYaw(0)) < 1e-9); // вверх -> камера снизу
  assert.strictEqual(followYaw(1), Math.PI / 2); // влево -> камера справа
  assert.ok(Math.abs(Math.abs(followYaw(2)) - Math.PI) < 1e-9); // вниз -> камера сверху (±π)
  assert.strictEqual(followYaw(3), -Math.PI / 2); // вправо -> камера слева
});
