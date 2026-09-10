// full-match-verify.mjs — ПОЛНАЯ покадровая сверка вражеского ИИ: эмулятор
// (нативный ASM AI + RNG-инжекция) vs GameSim. Сравнивает позиции/флаги врагов
// при ЕСТЕСТВЕННОМ спавне, с одинаковым RNG.
//
// Методика:
//   - Эмулятор: attAI="asm" (нативный AI врагов), defMode="none" (DEF не стреляют,
//     не мешают), RNG-инжекция = константа.
//   - Симулятор: GameSim с тем же полем, те же RNG-значения.
//   - Спавн врагов синхронизируется по эмулятору (инициализация слота при переходе
//     флага 0 -> ненулевой), затем флаг-машина/навигация работают в симуляторе САМОСТОЯТЕЛЬНО
//     и сравниваются кадр в кадр.
//   - RNG выбирается так, чтобы ретаргет/повороты происходили (RNG&0x0F==0),
//     но стрельба НЕТ (стрельба при RNG()==0): фикс RNG=16.
//
// Запуск: node scripts/full-match-verify.mjs [frames] [rng]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { GameSim } from "../emulator-core/sim/engine.js";
import { readState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const FRAMES = parseInt(process.argv[2] ?? "2000", 10);
const RNGVAL = parseInt(process.argv[3] ?? "16", 10);

// Слот «присутствует» (спавн/движение/взрыв), если флаг != 0. Респавн (0xF0/0xE0)
// и взрыв (0x10-0x70) — тоже активные слоты, а не «мёртвые».
function emuPresent(m, t) { return m[0xa0 + t] !== 0; }
function emuAlive(m, t) { const h = m[0xa0 + t] & 0xf0; return h >= 0x90 && h <= 0xd0; }

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
emu.setRngInjection(RNGVAL);
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) {
  emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
  for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  if (emu.cpu.mem[0x80] === 20) break;
}

const mem0 = emu.cpu.mem;
const field = mem0.slice(0x400, 0x400 + 1024);
const initTanks = [];
for (let t = 0; t < 8; t++) {
  const flag = mem0[0xa0 + t];
  initTanks.push({ index: t, x: mem0[0x90 + t], y: mem0[0x98 + t], dir: flag & 3, team: t < 2 ? "DEF" : "ATT", type: mem0[0xa8 + t], alive: flag !== 0, flag });
}
const sim = new GameSim({ field: field.slice(), tanks: initTanks, bullets: [] }, () => RNGVAL);

const state = {
  frmCntLo: mem0[0x0b], frmCntHi: mem0[0x0a], interval: mem0[0x84] || 8, clock: mem0[0x0100],
  p1x: mem0[0x90], p1y: mem0[0x98], p1Alive: emuAlive(mem0, 0),
  p2x: mem0[0x91], p2y: mem0[0x99], p2Alive: emuAlive(mem0, 1),
};

let total = 0, match = 0;
const mis = [];
for (let f = 0; f < FRAMES; f++) {
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const m = emu.cpu.mem;
  state.frmCntLo = m[0x0b]; state.frmCntHi = m[0x0a];
  state.interval = m[0x84] || state.interval; state.clock = m[0x0100];
  state.p1x = m[0x90]; state.p1y = m[0x98]; state.p1Alive = emuAlive(m, 0);
  state.p2x = m[0x91]; state.p2y = m[0x99]; state.p2Alive = emuAlive(m, 1);

  // Синхронизация спавнов: инициализировать слот при переходе флага 0 -> ненулевой
  for (let t = 2; t < 8; t++) {
    const eflag = m[0xa0 + t];
    let st = sim.tanks.find((x) => x.index === t);
    if (eflag !== 0 && (!st || (st.flag === 0))) {
      if (!st) { st = { index: t, team: "ATT", type: m[0xa8 + t], x: m[0x90 + t], y: m[0x98 + t] }; sim.tanks.push(st); }
      st.flag = eflag; st.type = m[0xa8 + t]; st.x = m[0x90 + t]; st.y = m[0x98 + t]; st.alive = true;
    } else if (st && eflag === 0) {
      st.flag = 0; st.alive = false;
    }
  }

  // Шаг врагов в симуляторе
  for (const t of sim.tanks) if (t.team === "ATT") sim.stepEnemy(t, state);

  // Сравнение по всем вражеским слотам: слот «присутствует», если флаг != 0
  total++;
  let ok = true;
  for (let t = 2; t < 8; t++) {
    const eflag = m[0xa0 + t]; const epresent = emuPresent(m, t);
    const st = sim.tanks.find((x) => x.index === t);
    if (!st) continue;
    const spresent = (st.flag ?? 0) !== 0;
    if (epresent !== spresent) {
      ok = false;
      if (mis.length < 8) mis.push(`f${f} враг${t}: слот эмул=${epresent} сим=${spresent} (флаг эмул=0x${eflag.toString(16)} сим=0x${(st.flag ?? 0).toString(16)})`);
      continue;
    }
    if (!epresent) continue;
    const ex = m[0x90 + t], ey = m[0x98 + t];
    if (ex !== st.x || ey !== st.y) {
      ok = false;
      if (mis.length < 8) mis.push(`f${f} враг${t}: поз эмул=(${ex},${ey}) сим=(${st.x},${st.y}) флаг эмул=0x${eflag.toString(16)} сим=0x${(st.flag ?? 0).toString(16)}`);
    } else if (eflag !== (st.flag ?? 0)) {
      ok = false;
      if (mis.length < 8) mis.push(`f${f} враг${t}: флаг эмул=0x${eflag.toString(16)} сим=0x${(st.flag ?? 0).toString(16)}`);
    }
  }
  if (ok) match++;
}
const pct = (100 * match / total).toFixed(1);
console.log(`Полный матч (RNG=${RNGVAL}, ${FRAMES} кадров): позиции+флаги совпали ${match}/${total} = ${pct}%`);
if (mis.length) console.log("примеры расхождений:\n  " + mis.join("\n  "));
