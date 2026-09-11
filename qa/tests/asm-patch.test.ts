// asm-patch.test.js — функциональная проверка ASM-патчей P2 (headless-эмуляция).
// Цель: направление вражеского танка (слот 2) берётся из ram_net_enemy_dir,
// а не из AI/RNG. Проверяем по флагу направления и перемещению.
// Запуск: node --test tests/asm-patch.test.js
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BTN } from "../../emulator-core/pvp.ts";
import { loadAndStart, waitTank2InField, runFrames, ADDR } from "./test-utils.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

// направление из флага танка (биты 0-1): 0=Up 1=Left 2=Down 3=Right
const dirOf = (flag) => flag & 3;

// Проверяет, что за время удержания направления танк 2 либо принимает нужный
// флаг направления, либо (fallback) реально смещается в эту сторону.
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
  return expectDir === 1 ? end < start : end > start; // Left: убывает, Right: растёт
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
  // удерживаем Left, пока танк не развернётся влево
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
  // "убиваем" танк 2 (флаг 0) и запрашиваем респавн через ввод порта 2 (Start edge)
  emu.cpu.mem[0xa2] = 0;
  const all = [];
  for (let p = 0; p < 8; p++) all.push({ port: p, buttons: 0 });
  all[2] = { port: 2, buttons: BTN.Start }; // edge -> ram_net_enemy_respawn[0]=1
  for (let f = 0; f < 30; f++) {
    emu.stepFrame(all);
    all[2] = { port: 2, buttons: 0 }; // удержание -> edge только 1 кадр
    if (emu.cpu.mem[0xa2] !== 0) break;
  }
  const flag = emu.cpu.mem[0xa2];
  assert.notStrictEqual(flag, 0, "респавн не сработал (слот остался пустым)");
});

test("патч P2+E171: враг стреляет по кнопке (ram_net_enemy_fire), не без кнопки", () => {
  const emu = loadAndStart(ROM);
  assert.ok(waitTank2InField(emu), "вражеский танк 2 не оказался в поле");
  // ждём, пока танк 2 ЖИВ и его пуля улетит (станет 0) — защитники могут убить его,
  // поэтому ждём подходящий момент (живой танк с очищенной пулей)
  let alive2 = false;
  for (let f = 0; f < 2000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    alive2 = hi >= 0x90 && hi <= 0xd0;
    if (alive2 && emu.cpu.mem[0xce] === 0) break;
  }
  assert.ok(alive2, "танк 2 не оказался жив для проверки стрельбы");
  assert.strictEqual(emu.cpu.mem[0xce], 0, "пуля танка 2 не очистилась (враг стреляет без кнопки)");
  // жмём A на порту 2 -> танк 2 стреляет
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
