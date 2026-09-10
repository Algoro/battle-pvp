// domain.test.js — семантика домена: направления, флаги танков, тайлы, пули, апгрейд.
import { test } from "node:test";
import assert from "node:assert";
import {
  DIR, DIR_VEC, DIR_BTN, dirToBtn, btnToDir,
  isTankAlive, isTankActive, isTankSpawning, tankDir, movingFlag, standingFlag,
  TANK_TYPE, tankHits, tankSpeed, bulletProperty, bulletSpeed,
  TILE, isBrick, isSteel, tankPassable, isRoad, blocksBullet, brickHealth, isEagleTile,
  BULLET, isBulletFlying, bulletDir, flyingBullet,
  UPGRADE, starsToUpgrade, upgradeToStars, BTN,
} from "../domain.js";

test("domain: направления и кнопки", () => {
  assert.deepStrictEqual(DIR, { UP: 0, LEFT: 1, DOWN: 2, RIGHT: 3 });
  assert.deepStrictEqual(DIR_VEC.map((v) => [v.dx, v.dy]), [[0, -1], [-1, 0], [0, 1], [1, 0]]);
  assert.strictEqual(dirToBtn(DIR.LEFT), BTN.Left);
  assert.strictEqual(btnToDir(BTN.Down), DIR.DOWN);
  assert.strictEqual(btnToDir(0), null);
  assert.strictEqual(btnToDir(BTN.Right | BTN.Up), DIR.UP, "первым должен вернуться Up");
});

test("domain: флаги танков", () => {
  assert.strictEqual(isTankAlive(0x90), true);
  assert.strictEqual(isTankAlive(0x80), false);
  assert.strictEqual(isTankActive(0x80), true);
  assert.strictEqual(isTankActive(0x73), false);
  assert.strictEqual(isTankSpawning(0xe0), true);
  assert.strictEqual(movingFlag(1), 0xa1);
  assert.strictEqual(standingFlag(2), 0x8a);
  assert.strictEqual(tankDir(0xa3), 3);
});

test("domain: типы танков и пули", () => {
  assert.strictEqual(tankHits(TANK_TYPE.BASE), 1);
  assert.strictEqual(tankHits(0xe2), 3); // броня (2)+1
  assert.strictEqual(tankHits(0x84), 1); // мигающий
  assert.strictEqual(tankSpeed(0xc0), 1.6);
  assert.strictEqual(tankSpeed(0xe0), 0.8);
  assert.strictEqual(bulletSpeed(0xc0), 4);
  assert.strictEqual(bulletSpeed(0x80), 2);
  assert.strictEqual(bulletProperty(0x60), 3);
});

test("domain: тайлы поля", () => {
  assert.strictEqual(isBrick(0x0f), true);
  assert.strictEqual(isBrick(0x14), true);
  assert.strictEqual(isBrick(0x10), false);
  assert.strictEqual(isSteel(0x10), true);
  assert.strictEqual(tankPassable(0x00), true);
  assert.strictEqual(tankPassable(0x30), true);
  assert.strictEqual(tankPassable(TILE.WATER), false);
  assert.strictEqual(tankPassable(TILE.TREE), true, "деревья проходимы для танков");
  assert.strictEqual(isRoad(0x30), true);
  assert.strictEqual(isRoad(TILE.ICE), false);
  assert.strictEqual(blocksBullet(0x10), true);
  assert.strictEqual(blocksBullet(0x0f), false);
  assert.strictEqual(blocksBullet(0x30), false);
  assert.strictEqual(brickHealth(0x0f), 2);
  assert.strictEqual(brickHealth(0x0c), 1);
  assert.strictEqual(isEagleTile(0xc8), true);
});

test("domain: статус пули", () => {
  assert.strictEqual(isBulletFlying(0x43), true);
  assert.strictEqual(bulletDir(0x43), 3);
  assert.strictEqual(flyingBullet(2), BULLET.FLYING | 2);
  assert.strictEqual(isBulletFlying(BULLET.EXPLODE), false);
  assert.strictEqual(isBulletFlying(BULLET.NONE), false);
});

test("domain: апгрейд (звёзды)", () => {
  assert.strictEqual(starsToUpgrade(0), 0x00);
  assert.strictEqual(starsToUpgrade(1), 0x20);
  assert.strictEqual(starsToUpgrade(3), 0x60);
  assert.strictEqual(starsToUpgrade(9), UPGRADE.MAX);
  assert.strictEqual(starsToUpgrade(-1), 0);
  assert.strictEqual(upgradeToStars(0x60), 3);
  assert.strictEqual(upgradeToStars(0x40), 2);
});
