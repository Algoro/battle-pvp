// battle-verify.mjs — покадровая сверка BattleSim с эмулятором на патченом ROM
// (детерминированный PRNG, вариант B). Обе стороны используют один PRNG и один
// начальный seed, поэтому должны совпадать при верном порядке потребления RNG.
//
// Запуск: node scripts/battle-verify.mjs [frames]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const FRAMES = parseInt(process.argv[2] ?? "1500", 10);

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) {
  emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
  for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  if (emu.cpu.mem[0x80] === 20) break;
}

const m = emu.cpu.mem;
function flagOf(t) { return m[0xa0 + t]; }
function aliveE(t) { const h = flagOf(t) & 0xf0; return h >= 0x90 && h <= 0xd0; }

// Симулятор из состояния эмулятора
const tanks = [];
for (let t = 0; t < 8; t++) {
  tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: flagOf(t) & 3, flag: flagOf(t), type: m[0xa8 + t], alive: flagOf(t) !== 0 });
}
const bullets = [];
for (let t = 0; t < 8; t++) {
  const s = m[0xcc + t];
  if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true });
}
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024),
  tanks, bullets,
  counters: {
    spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f],
    spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80],
    limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x0100],
  },
  rngState: m[0x0f],
  frame: m[0x0b] + m[0x0a] * 256,
  typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 },
  p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});

let prevB = 0;
// Синхронизация кадрового счётчика (пост-кадр, для RNG/гейта). DEF-танки и игроки
// (0,1) берутся из ПРЕ-кадрового состояния (как эмулятор в sub_E181: маркеры ставятся
// по состоянию на начало кадра). Эволюционирующие счётчики спавна симулятор ведёт сам.
function sync(def) {
  sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; // сброс счётчика
  else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  sim.p1 = { x: def.x0, y: def.y0, alive: def.f0 !== 0 };
  sim.p2 = { x: def.x1, y: def.y1, alive: def.f1 !== 0 };
  for (const t of [0, 1]) {
    const st = sim.tanks.find((x) => x.index === t);
    if (st) { st.flag = def[`f${t}`]; st.x = def[`x${t}`]; st.y = def[`y${t}`]; st.type = m[0xa8 + t]; st.alive = def[`f${t}`] !== 0; }
  }
}

let total = 0, ematch = 0, fmatch = 0;
const mis = [];
for (let f = 0; f < FRAMES; f++) {
  const def = { x0: m[0x90], y0: m[0x98], f0: m[0xa0], x1: m[0x91], y1: m[0x99], f1: m[0xa1] }; // пре-кадр
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  sync(def);
  sim.step();

  total++;
  // --- враги: флаг + позиция (главная метрика) ---
  let okE = true;
  for (let t = 2; t < 8; t++) {
    const eflag = flagOf(t);
    const st = sim.tanks.find((x) => x.index === t);
    if (!st) continue;
    if (eflag !== st.flag) {
      okE = false;
      if (mis.length < 6) mis.push(`f${f} враг${t}: флаг эмул=0x${eflag.toString(16)} сим=0x${(st.flag ?? 0).toString(16)}`);
    } else if (eflag !== 0 && (m[0x90 + t] !== st.x || m[0x98 + t] !== st.y)) {
      okE = false;
      if (mis.length < 6) mis.push(`f${f} враг${t}: поз эмул=(${m[0x90 + t]},${m[0x98 + t]}) сим=(${st.x},${st.y})`);
    }
  }
  if (okE) ematch++;

  // --- поле: байты, но с маской бита маркера (bit7 транзитивен) ---
  let okF = true;
  for (let i = 0; i < 1024; i++) {
    if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) { okF = false; break; }
  }
  if (okF) fmatch++;
}
const epct = (100 * ematch / total).toFixed(1);
const fpct = (100 * fmatch / total).toFixed(1);
console.log(`BattleSim vs эмулятор (${FRAMES} кадров, вариант B):`);
console.log(`  ВРАГИ (флаг+поз):  ${ematch}/${total} = ${epct}%`);
console.log(`  ПОЛЕ (bit7 маск):  ${fmatch}/${total} = ${fpct}%`);
console.log(`  rngState: эмул=0x${emu.cpu.mem[0x0f].toString(16)} сим=0x${sim.rngState.toString(16)}`);
if (mis.length) console.log("примеры:\n  " + mis.join("\n  "));
