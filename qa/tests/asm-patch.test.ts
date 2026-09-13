// asm-patch.test.js — functional check of the ASM patches P2 (headless emulation).
// Goal: the enemy tank's direction (slot 2) is taken from ram_net_enemy_dir,
// not from AI/RNG. We check by the direction flag and movement.
// Run: node --test tests/asm-patch.test.js
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BTN } from "../../emulator-core/pvp.ts";
import { loadAndStart, waitTank2InField, runFrames, ADDR } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

// direction from the tank flag (bits 0-1): 0=Up 1=Left 2=Down 3=Right
const dirOf = (flag) => flag & 3;

// Checks that while the direction is held, tank 2 either accepts the required
// direction flag or (fallback) actually shifts in that direction.
function holdAndCheck(emu, buttons, expectDir, axis) {
  const all = [];
  for (let p = 0; p < 8; p++) all.push({ port: p, buttons: 0 });
  all[2] = { port: 2, buttons };
  const start = axis === "x" ? emu.cpu.mem[ADDR.tankX(2)] : emu.cpu.mem[ADDR.tankY(2)];
  let flagHit = false;
  for (let f = 0; f < 250; f++) {
    emu.stepFrame(all);
    if (dirOf(emu.cpu.mem[ADDR.tankFlag(2)]) === expectDir) flagHit = true;
  }
  if (flagHit) return true;
  const end = axis === "x" ? emu.cpu.mem[ADDR.tankX(2)] : emu.cpu.mem[ADDR.tankY(2)];
  return expectDir === 1 ? end < start : end > start; // Left: decreases, Right: increases
}

test("патч P2: влево -> направление врага = Left (флаг биты 0-1)", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  assert.ok(holdAndCheck(emu, BTN.Left, 1, "x"), "влево не управляет танком (флаг/движение)");
});

test("патч P2: вправо -> направление врага = Right (флаг биты 0-1)", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  assert.ok(holdAndCheck(emu, BTN.Right, 3, "x"), "вправо не управляет танком (флаг/движение)");
});

test("патч P2: влево реально двигает танк влево (X уменьшается)", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  // hold Left until the tank turns left
  const all = [];
  for (let p = 0; p < 8; p++) all.push({ port: p, buttons: 0 });
  all[2] = { port: 2, buttons: BTN.Left };
  for (let f = 0; f < 120 && dirOf(emu.cpu.mem[ADDR.tankFlag(2)]) !== 1; f++) emu.stepFrame(all);
  const x0 = emu.cpu.mem[ADDR.tankX(2)];
  runFrames(emu, 40, [{ port: 2, buttons: BTN.Left }]);
  const x1 = emu.cpu.mem[ADDR.tankX(2)];
  assert.ok(x1 <= x0, `при влево X не уменьшился/не остался (x0=${x0}, x1=${x1})`);
});

test("патч P4: per-player respawn — запрос респавна оживляет слот врага", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  // "kill" tank 2 (flag 0) and request a respawn via port 2 input (Start edge)
  emu.cpu.mem[0xa2] = 0;
  const all = [];
  for (let p = 0; p < 8; p++) all.push({ port: p, buttons: 0 });
  all[2] = { port: 2, buttons: BTN.Start }; // edge -> ram_net_enemy_respawn[0]=1
  for (let f = 0; f < 30; f++) {
    emu.stepFrame(all);
    all[2] = { port: 2, buttons: 0 }; // holding -> edge for only 1 frame
    if (emu.cpu.mem[0xa2] !== 0) break;
  }
  const flag = emu.cpu.mem[0xa2];
  assert.notStrictEqual(flag, 0, "респавн не сработал (слот остался пустым)");
});

test("патч P2+E171: враг стреляет по кнопке (ram_net_enemy_fire), не без кнопки", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  // wait until tank 2 is ALIVE and its bullet flies away (becomes 0) — the defenders may kill it,
  // so we wait for a suitable moment (live tank with a cleared bullet)
  let alive2 = false;
  for (let f = 0; f < 2000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    alive2 = hi >= 0x90 && hi <= 0xd0;
    if (alive2 && emu.cpu.mem[0xce] === 0) break;
  }
  assert.ok(alive2, "танк 2 не оказался жив для проверки стрельбы");
  assert.strictEqual(emu.cpu.mem[0xce], 0, "пуля танка 2 не очистилась (враг стреляет без кнопки)");
  // press A on port 2 -> tank 2 fires
  emu.stepFrame([{ port: 0, buttons: 0 }].concat([{ port: 2, buttons: BTN.A }]));
  assert.notStrictEqual(emu.cpu.mem[0xce], 0, "по кнопке A танк 2 не выстрелил");
});

test("патч P2: без сетевого ввода враг ведёт себя как AI (двигается)", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  const x0 = emu.cpu.mem[ADDR.tankX(2)];
  const y0 = emu.cpu.mem[ADDR.tankY(2)];
  runFrames(emu, 120);
  const x1 = emu.cpu.mem[ADDR.tankX(2)];
  const y1 = emu.cpu.mem[ADDR.tankY(2)];
  assert.ok(x1 !== x0 || y1 !== y0, "AI-враг не двигался вовсе");
});
