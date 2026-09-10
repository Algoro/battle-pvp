// enemy-verify.mjs — сверка вражеского ИИ: эмулятор (RNG-инжекция) vs CycleSim.
// Загружаем реальную стадию из эмулятора, симулируем в CycleSim, сравниваем
// позиции/флаги врагов покадрово.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { GameSim } from "../emulator-core/sim/engine.js";
import { readState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const RNGSEQ = Array(200000).fill(1); // фикс RNG=1 для детерминизма

// запуск эмулятора на стадии stage с инжектированным RNG
const emu = new PvPNes({ attAI: "asm", defAI: "plan", noRender: true });
emu.loadROM(readFileSync(ROM));
emu.setRngInjection(RNGSEQ);
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }

// реальная стадия: снимаем поле из эмулятора
const field = emu.cpu.mem.slice(0x400, 0x400 + 1024);
const initTanks = readState(emu.cpu.mem).tanks.map((t) => ({ index: t.index, x: t.x, y: t.y, dir: t.flag & 3, team: t.team, type: t.type, alive: t.alive }));

// GameSim из того же состояния
const sim = new GameSim({
  field: field.slice(), tanks: initTanks.map((t) => ({ ...t })),
  bullets: [],
}, () => 1);
sim.frame = emu.cpu.mem[0x0b];
function emuAlive(emu, t) { const h = emu.cpu.mem[0xa0 + t] & 0xf0; return h >= 0x90 && h <= 0xd0; }

const state = { frmCntHi: 0, interval: 8, p1x: 88, p1y: 216, p2x: 152, p2y: 216, p1Alive: true, p2Alive: false };
let match = 0, total = 0, mis = [], spawnSeq = [];
for (let f = 0; f < 600; f++) {
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  // эмулятор: позиции/флаги врагов
  const epos = [];
  for (let t = 2; t < 8; t++) if (emuAlive(emu, t)) epos.push(`${t}:${emu.cpu.mem[0x90 + t]},${emu.cpu.mem[0x98 + t]}`);
  // sim: двигаем врагов (навигация к базе), синхронизируем кадр
  sim.frame = emu.cpu.mem[0x0b];
  state.frmCntHi = emu.cpu.mem[0x0a];
  for (const t of sim.tanks) if (t.team === "ATT" && t.alive) sim.stepEnemy(t, state);
  // сравнение по живым врагам
  total++;
  let ok = epos.length > 0;
  for (const t of sim.tanks) if (t.team === "ATT" && t.alive) {
    const et = emu.cpu.mem[0x90 + t.index];
    const ey = emu.cpu.mem[0x98 + t.index];
    if (!emuAlive(emu, t.index) || Math.abs(et - t.x) > 3 || Math.abs(ey - t.y) > 3) { ok = false; if (mis.length < 3) mis.push(`f${f}: враг${t.index} эмул=(${et},${ey}) сим=(${t.x},${t.y})`); }
  }
  if (ok) match++;
}
console.log(`Вражеский ИИ (реальная стадия, RNG=1): совпало ${match}/${total} = ${(100 * match / total).toFixed(1)}%`);
if (mis.length) console.log("примеры расхождений:", mis.join(" | "));
