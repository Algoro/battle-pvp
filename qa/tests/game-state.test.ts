// game-state.test.js — contract tests of the pure JS game logic (game-state.ts).
// 1) unit: buildSoloInputs / determineWinner / isTankAlive / isGameplayStarted.
// 2) headless integration: the frontend solo loop drives the emulator THROUGH the real
//    buildSoloInputs (single source with GameCanvas) and checks the behavior.
// Run: node --test tests/game-state.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../../emulator-core/pvp.ts";
import {
  buildSoloInputs,
  determineWinner,
  isTankAlive,
  isGameplayStarted,
  BTN_START,
} from "../../frontend/src/engine/game-state.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

// ---- unit ----
test("buildSoloInputs: DEF — автостарт Start на порту 0 и ввод игрока", () => {
  const r = buildSoloInputs({ port: 0, team: "DEF", frame: 30, started: false, userButtons: BTN.Up, attTankAlive: true });
  assert.deepStrictEqual(r, [{ port: 0, buttons: BTN.Up | BTN_START }]);
  // after start — Start is not added
  const r2 = buildSoloInputs({ port: 0, team: "DEF", frame: 30, started: true, userButtons: BTN.Up, attTankAlive: true });
  assert.deepStrictEqual(r2, [{ port: 0, buttons: BTN.Up }]);
});

test("buildSoloInputs: ATT — ввод игрока на порту 2 + авто-респавн, порт 0 на автостарте", () => {
  // before the battle starts: port 0 Start, port 2 — player input (no respawn, since !started)
  const r1 = buildSoloInputs({ port: 2, team: "ATT", frame: 30, started: false, userButtons: BTN.Left, attTankAlive: false });
  assert.deepStrictEqual(r1, [{ port: 0, buttons: BTN_START }, { port: 2, buttons: BTN.Left }]);
  // battle started, tank not alive -> auto-respawn (Start on port 2)
  const r2 = buildSoloInputs({ port: 2, team: "ATT", frame: 30, started: true, userButtons: 0, attTankAlive: false });
  assert.deepStrictEqual(r2, [{ port: 0, buttons: 0 }, { port: 2, buttons: BTN_START }]);
  // tank alive -> only player input
  const r3 = buildSoloInputs({ port: 2, team: "ATT", frame: 30, started: true, userButtons: BTN.Up, attTankAlive: true });
  assert.deepStrictEqual(r3, [{ port: 0, buttons: 0 }, { port: 2, buttons: BTN.Up }]);
});

test("determineWinner: корректная атрибуция", () => {
  assert.strictEqual(determineWinner(1, 0, 20), "ATT"); // HQ destroyed
  assert.strictEqual(determineWinner(1, 0x80, 0), "DEF"); // all ATT tanks destroyed
  assert.strictEqual(determineWinner(1, 0x80, 20), null); // battle in progress
  assert.strictEqual(determineWinner(0xff, 0, 20), null); // not in game (title)
});

test("isTankAlive / isGameplayStarted", () => {
  assert.strictEqual(isTankAlive(0xa2), true); // basic enemy, alive
  assert.strictEqual(isTankAlive(0xd1), true); // follow_p1, alive
  assert.strictEqual(isTankAlive(0xf0), false); // respawn-blinking
  assert.strictEqual(isTankAlive(0x70), false); // explosion
  assert.strictEqual(isTankAlive(0), false);
  assert.strictEqual(isGameplayStarted(0xff), false);
  assert.strictEqual(isGameplayStarted(20), true);
});

// ---- headless integration through the real buildSoloInputs ----
function makeDriver() {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  // In the real game (App.tsx) the player tank is marked human — otherwise it
  // is controlled by the AI enemy (port 2) and can be hit by other enemies.
  emu.setHumanTank(2);
  let frame = 0;
  let started = false;
  const step = (userButtons = 0) => {
    frame++;
    started = isGameplayStarted(emu.cpu.mem[0x80]);
    const inputs = buildSoloInputs({
      port: 2, team: "ATT", frame, started,
      userButtons,
      attTankAlive: isTankAlive(emu.cpu.mem[0xa2]),
    });
    emu.stepFrame(inputs);
  };
  return { emu, step };
}

test("интеграция: реальный buildSoloInputs доводит до боя и даёт управление", () => {
  const { emu, step } = makeDriver();
  // auto-start until the battle
  let battle = false;
  for (let f = 0; f < 600; f++) { step(); if (isGameplayStarted(emu.cpu.mem[0x80])) { battle = true; break; } }
  assert.ok(battle, "бой не начался через buildSoloInputs");

  // auto-respawn until a live tank
  for (let f = 0; f < 400 && !isTankAlive(emu.cpu.mem[0xa2]); f++) step();
  assert.ok(isTankAlive(emu.cpu.mem[0xa2]), "танк игрока не стал живым (авто-респавн)");

  // control left: the contract is that the tank direction follows the input.
  // (X movement may be blocked by a wall depending on the spawn.)
  let turnedLeft = false;
  for (let f = 0; f < 250; f++) {
    step(BTN.Left);
    if ((emu.cpu.mem[0xa2] & 3) === 1) { turnedLeft = true; break; }
  }
  assert.ok(turnedLeft, "влево не меняет направление танка (buildSoloInputs)");
});

test("интеграция: удержание Left задаёт направление влево (управление реагирует)", () => {
  const { emu, step } = makeDriver();
  for (let f = 0; f < 600; f++) { step(); if (isGameplayStarted(emu.cpu.mem[0x80])) break; }
  for (let f = 0; f < 400 && !isTankAlive(emu.cpu.mem[0xa2]); f++) step();
  let turned = false;
  for (let f = 0; f < 150; f++) {
    step(BTN.Left);
    if ((emu.cpu.mem[0xa2] & 3) === 1) { turned = true; break; } // Left direction
  }
  assert.ok(turned, "удержание Left не задало направление влево (управление не реагирует)");
});

test("интеграция: огонь по кнопке A (через buildSoloInputs)", () => {
  const { emu, step } = makeDriver();
  for (let f = 0; f < 600; f++) { step(); if (isGameplayStarted(emu.cpu.mem[0x80])) break; }
  for (let f = 0; f < 400 && !isTankAlive(emu.cpu.mem[0xa2]); f++) step();
  for (let f = 0; f < 300 && emu.cpu.mem[0xce] !== 0; f++) step(); // wait for the bullet to clear
  step(BTN.A); // fire
  assert.notStrictEqual(emu.cpu.mem[0xce], 0, "по A танк не выстрелил");
});
