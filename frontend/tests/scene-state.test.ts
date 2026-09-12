// scene-state.test.ts — извлечение сцены из RAM: чистота, команды, призы, орёл, детали.
import { test } from "node:test";
import assert from "node:assert";
import { readSceneFromMem, PLAY_BOUNDS } from "../src/render/scene-state.ts";
import { RAM } from "@core/rom-contract.ts";

function baseMem(): Uint8Array {
  const m = new Uint8Array(0x10000);
  m[RAM.ENEMIES_LEFT] = 20; // игра началась
  m[RAM.GAME_OVER] = 0x80; // идёт
  m[RAM.PRIZE_ID] = 0xff; // приза нет
  return m;
}

function putEagle(m: Uint8Array): void {
  m[RAM.FIELD + 26 * 32 + 14] = 0xc8;
  m[RAM.FIELD + 26 * 32 + 15] = 0xca;
  m[RAM.FIELD + 27 * 32 + 14] = 0xc9;
  m[RAM.FIELD + 27 * 32 + 15] = 0xcb;
}

test("scene-state: базовая сцена — команды, направления, состояния, звёзды", () => {
  const m = baseMem();
  putEagle(m);
  m[RAM.TANK_FLAG + 0] = 0xa2; // DEF, движется вниз
  m[RAM.TANK_X + 0] = 88;
  m[RAM.TANK_Y + 0] = 184;
  m[RAM.TANK_UPGRADE + 0] = 0x40; // 2 звезды
  m[RAM.LIVES + 0] = 2;
  m[RAM.TANK_FLAG + 3] = 0x73; // взрыв
  m[RAM.TANK_FLAG + 5] = 0xe0; // респавн
  m[RAM.TANK_TYPE + 5] = 0xa4; // быстрые пули + мигающий
  m[RAM.TANK_FLAG + 1] = 0x88; // стоящий DEF-танк (0x80..0x8F — «на поле»)

  const s = readSceneFromMem(m, 42);
  assert.strictEqual(s.frame, 42);
  assert.deepStrictEqual(s.bounds, PLAY_BOUNDS);

  const t0 = s.tanks[0];
  assert.strictEqual(t0.team, "DEF");
  assert.strictEqual(t0.state, "alive");
  assert.strictEqual(t0.moving, true);
  assert.strictEqual(t0.dir, 2);
  assert.strictEqual(t0.stars, 2);
  assert.strictEqual(t0.lives, 2);

  assert.strictEqual(s.tanks[3].state, "exploding");
  assert.strictEqual(s.tanks[5].state, "spawning");
  assert.strictEqual(s.tanks[5].team, "ATT");
  assert.strictEqual(s.tanks[5].flashing, true);
  assert.strictEqual(s.tanks[5].armored, false);
  // Стоящий human-танк (0x88|dir) обязан быть «живым», а не «мёртвым».
  assert.strictEqual(s.tanks[1].state, "alive");
  assert.strictEqual(s.tanks[1].moving, false);
});

test("scene-state: пули, приз, орёл, заморозка и точки", () => {
  const m = baseMem();
  putEagle(m);
  m[RAM.BULLET_STATUS + 4] = 0x43; // летит вправо
  m[RAM.BULLET_X + 4] = 100;
  m[RAM.BULLET_Y + 4] = 120;
  m[RAM.PRIZE_ID] = 3;
  m[RAM.PRIZE_X] = 60;
  m[RAM.PRIZE_Y] = 60;
  m[RAM.CLOCK_TIMER] = 9;
  m[RAM.DOTS_LEFT] = 5;

  const s = readSceneFromMem(m, 1);
  assert.strictEqual(s.bullets.length, 1);
  assert.strictEqual(s.bullets[0].team, "ATT");
  assert.strictEqual(s.bullets[0].dir, 3);
  assert.deepStrictEqual(s.prize, { id: 3, x: 60, y: 60 });
  assert.strictEqual(s.eagle.destroyed, false);
  assert.strictEqual(s.effects.freezeTimer, 9);
  assert.strictEqual(s.effects.dotsLeft, 5);
});

test("scene-state: чистота — field это копия, mem не мутируется", () => {
  const m = baseMem();
  m[RAM.FIELD + 2 * 32 + 2] = 0x0f;
  const s = readSceneFromMem(m, 0);
  assert.strictEqual(s.field[2 * 32 + 2], 0x0f);
  m[RAM.FIELD + 2 * 32 + 2] = 0x00;
  assert.strictEqual(s.field[2 * 32 + 2], 0x0f, "сцена держит копию поля");
});

test("scene-state: орёл разрушен, если тайлов нет при завершении игры", () => {
  const m = baseMem(); // орла нет
  m[RAM.GAME_OVER] = 0; // штаб уничтожен -> игра окончена
  const s = readSceneFromMem(m, 0);
  assert.strictEqual(s.eagle.destroyed, true);
});

test("scene-state: пустая память даёт безопасную сцену", () => {
  const s = readSceneFromMem(new Uint8Array(8), 0);
  assert.strictEqual(s.tanks.length, 8);
  assert.strictEqual(s.pixels, null);
});
