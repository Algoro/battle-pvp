// rom-contract.test.js — единый контракт адресов RAM/ROM: контрольные байты ROM и
// согласованность модели ИИ (game-view) с контрактом.
// Запуск: node --test tests/rom-contract.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ROMClass from "../src/rom.js";
import { RAM, ROM, AI_READ_RANGES } from "../rom-contract.ts";
import { assertRomContract } from "../startup.ts";
import { readState } from "../model/game-view.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ORIG = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

test("rom-contract: контрольные байты ROM совпадают", () => {
  const rom = new ROMClass(null);
  rom.load(ORIG);
  assert.strictEqual(assertRomContract(rom), true);
});

test("rom-contract: адреса из AI_READ_RANGES лежат в RAM и согласованы", () => {
  for (const r of AI_READ_RANGES) {
    assert.ok(r.base >= 0 && r.base + r.len <= 0x800, `диапазон вне RAM: ${r.desc}`);
  }
  assert.strictEqual(RAM.FIELD, 0x0400);
  assert.strictEqual(ROM.STAGE_STRIDE, 91);
  // ключевые адреса не должны «уехать»
  assert.strictEqual(RAM.NET_DIR, 0x01db);
  assert.strictEqual(RAM.TANK_UPGRADE, 0x0101);
  assert.strictEqual(RAM.STAGE, 0x85);
});

test("rom-contract: game-view читает те же адреса, что и контракт", () => {
  const mem = new Uint8Array(0x800);
  mem[RAM.ENEMIES_LEFT] = 5;
  mem[RAM.SPAWN_TIMER] = 7;
  mem[RAM.FORTIFIED] = 1;
  mem[RAM.CLOCK_TIMER] = 9;
  mem[RAM.TANK_FLAG] = 0xa1; // танк 0: движение влево (dir=1)
  mem[RAM.TANK_X] = 0x58;
  mem[RAM.TANK_Y] = 0xd8;
  mem[RAM.TANK_TYPE] = 0x80;
  mem[RAM.HELMET] = 3;
  mem[RAM.BULLET_STATUS + 2] = 0x43; // пуля танка 2 летит вправо
  mem[RAM.BULLET_X + 2] = 0x40;
  mem[RAM.BULLET_Y + 2] = 0x40;
  mem[RAM.PRIZE_ID] = 5;
  mem[RAM.PRIZE_X] = 0x30;
  mem[RAM.PRIZE_Y] = 0x30;

  const st = readState(mem);
  assert.strictEqual(st.enemiesLeft, 5);
  assert.strictEqual(st.spawnTimer, 7);
  assert.strictEqual(st.fortified, true);
  assert.strictEqual(st.clockTimer, 9);
  assert.strictEqual(st.tanks[0].dir, 1);
  assert.strictEqual(st.tanks[0].x, 0x58);
  assert.strictEqual(st.tanks[0].y, 0xd8);
  assert.strictEqual(st.tanks[0].helmet, true);
  assert.strictEqual(st.bullets.length, 1);
  assert.strictEqual(st.bullets[0].owner, 2);
  assert.strictEqual(st.prizes.length, 1);
});
