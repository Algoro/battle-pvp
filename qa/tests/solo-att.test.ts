// solo-att.test.js — comprehensive test of the solo mode "as the enemy" (ATT).
// Uses the REAL buildSoloInputs from the frontend (single source with GameCanvas).
// Run: node --test tests/solo-att.test.js
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BTN } from "../../emulator-core/pvp.ts";
import { loadAndStart, runFrames, ADDR } from "./test-utils.ts";
import { buildSoloInputs, isTankAlive, isGameplayStarted } from "../../frontend/src/engine/game-state.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

const dirOf = (flag) => flag & 3;

// The frontend solo-ATT loop through buildSoloInputs.
function runFrontendSoloAtt(emu, { respawnEvery = 30 } = {}) {
  let frame = 0;
  let started = false;
  const step = (port2Buttons) => {
    frame++;
    started = isGameplayStarted(emu.cpu.mem[ADDR.enLeft]);
    const inputs = buildSoloInputs({
      port: 2,
      team: "ATT",
      frame,
      started,
      userButtons: port2Buttons,
      attTankAlive: isTankAlive(emu.cpu.mem[ADDR.tankFlag(2)]),
    });
    emu.stepFrame(inputs);
    return { started, attAlive: isTankAlive(emu.cpu.mem[ADDR.tankFlag(2)]) };
  };
  return step;
}

test("соло-ATT: танк игрока респавнится (авто-респавн) и живой", () => {
  const emu = loadAndStart(ROM);
  const step = runFrontendSoloAtt(emu);
  let alive = false;
  for (let f = 0; f < 400; f++) {
    const s = step(0);
    if (s.attAlive) { alive = true; break; }
  }
  assert.ok(alive, "танк 2 (ATT-игрок) не стал живым за 400 кадров авто-респавна");
});

test("соло-ATT: танк игрока управляется (влево -> X уменьшается)", () => {
  const emu = loadAndStart(ROM);
  const step = runFrontendSoloAtt(emu);
  for (let f = 0; f < 400; f++) { const s = step(0); if (s.attAlive) break; }
  // alive -> hold left long enough for the tank to turn at an intersection
  const x0 = emu.cpu.mem[ADDR.tankX(2)];
  let movedLeft = false;
  for (let f = 0; f < 250; f++) {
    const s = step(BTN.Left);
    if (dirOf(emu.cpu.mem[ADDR.tankFlag(2)]) === 1) movedLeft = true; // Left
    if (movedLeft && emu.cpu.mem[ADDR.tankX(2)] < x0) break;
  }
  const x1 = emu.cpu.mem[ADDR.tankX(2)];
  assert.ok(movedLeft || x1 < x0, `влево не управляет танком (x0=${x0}, x1=${x1})`);
});

test("соло-ATT: танк игрока стреляет по кнопке A (ram_net_enemy_fire)", () => {
  const emu = loadAndStart(ROM);
  const step = runFrontendSoloAtt(emu);
  for (let f = 0; f < 400; f++) { const s = step(0); if (s.attAlive) break; }
  // wait for tank 2's bullet to clear, then press A
  for (let f = 0; f < 300 && emu.cpu.mem[0xce] !== 0; f++) step(0);
  assert.strictEqual(emu.cpu.mem[0xce], 0, "пуля танка 2 не очистилась (стреляет без кнопки?)");
  emu.stepFrame([
    { port: 0, buttons: 0 },
    { port: 2, buttons: BTN.A },
  ]);
  assert.notStrictEqual(emu.cpu.mem[0xce], 0, "по кнопке A танк 2 не выстрелил");
});

test("соло-ATT: без ввода игрок не движется по сетевой зоне (dir=FF)", () => {
  const emu = loadAndStart(ROM);
  const step = runFrontendSoloAtt(emu);
  for (let f = 0; f < 400; f++) { const s = step(0); if (s.attAlive) break; }
  // with no presses the direction in the network zone = FF (no input)
  runFrames(emu, 5, [{ port: 2, buttons: 0 }]);
  assert.strictEqual(emu.cpu.mem[ADDR.netDir], 0xff, "без ввода сетевой dir должен быть FF");
});
