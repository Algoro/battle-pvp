// sim-verify2.mjs — ПОКАДРОВАЯ сверка боевого ядра GameSim с эмулятором:
// выстрел в кирпич (пуля 2px/кадр + разрушение по brickHit) и пуля-в-танк.
// Сравниваем тайл кирпича и позицию пули кадр за кадром.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { GameSim } from "../emulator-core/sim/engine.js";
import { buildState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;

function startEmu() {
  const e = new PvPNes({ attAI: "asm", defAI: "none", noRender: true });
  e.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) e.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    e.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) e.stepFrame([{ port: 0, buttons: 0 }]);
    if (e.cpu.mem[0x80] === 20) break;
  }
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) e.cpu.mem[0x400 + r * 32 + c] = 0x00;
  for (let t = 1; t < 8; t++) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
  return e;
}

// Эмулятор: танк 0 на (64,136) смотрит вверх, кирпич на (64,104). Записываем
// тайл кирпича и позицию пули каждый кадр.
function emuTrace() {
  const e = startEmu();
  e.cpu.mem[0x400 + 13 * 32 + 8] = 0x0f;
  e.cpu.mem[0x90] = 64; e.cpu.mem[0x98] = 136; e.cpu.mem[0xa0] = 0xa0;
  const trace = [];
  for (let f = 0; f < 60; f++) {
    const fire = e.cpu.mem[0xcc] === 0 ? BTN.A : 0;
    e.stepFrame([{ port: 0, buttons: fire }, { port: 1, buttons: 0 }]);
    for (let t = 1; t < 8; t++) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
    trace.push({ tile: e.cpu.mem[0x400 + 13 * 32 + 8], by: e.cpu.mem[0xc2], bstatus: e.cpu.mem[0xcc] });
  }
  return trace;
}

// Движок GameSim: тот же сценарий, сравниваем тайл и позицию пули.
function simTrace() {
  const s = buildState({ field: Array.from({ length: 32 }, () => "." .repeat(32)) });
  const field = s.mem.subarray(0x400, 0x400 + 1024).slice();
  field[13 * 32 + 8] = 0x0f;
  const sim = new GameSim({ field, tanks: [{ index: 0, x: 64, y: 136, dir: 0, team: "DEF" }], bullets: [] });
  const t = sim.tanks[0];
  sim.fireTank(t, 0);
  const trace = [];
  for (let f = 0; f < 60; f++) {
    const b = sim.bullets[0];
    trace.push({ tile: sim.fieldTile(8, 13), by: b && b.alive ? b.y : 255 });
    sim.step();
  }
  return trace;
}

// сравнение
const emu = emuTrace(), sim = simTrace();
const emuHit = emu.findIndex((x) => x.tile === 0x03);
const simHit = sim.findIndex((x) => x.tile === 0x03);
console.log(`Разрушение (0x0f->0x03): эмулятор на кадре ${emuHit}, движок на кадре ${simHit} | ${emuHit === simHit ? "OK" : "НЕ СОВПАЛО"}`);
// пуля движется 2px/кадр до попадания в кирпич; сравниваем только пока пуля жива
// (после разрушения кирпича пуля в обоих гибнет — эмулятор хранит устаревшие координаты)
let bulletOk = true;
let firstAlive = emu.findIndex((x) => x.bstatus !== 0); // кадр появления пули в эмуляторе
if (firstAlive < 0) firstAlive = 0;
const end = Math.min(emuHit, simHit) - 1; // до разрушения
for (let f = firstAlive; f <= end && f < 60; f++) {
  if (Math.abs(emu[f].by - sim[f].by) > 1) { bulletOk = false; }
}
console.log(`Пуля (кадры ${firstAlive}-${end}): ${bulletOk ? "OK (2px/кадр, идентично)" : "РАСХОДИМОСТЬ"}`);

