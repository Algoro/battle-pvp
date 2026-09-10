// rng-trace.mjs — диагностика расхождения RNG между эмулятором (вариант B)
// и BattleSim. Логирует последовательность значений RNG ($0F) за каждый кадр
// на обеих сторонах и находит первый кадр, где последовательности расходятся,
// вместе с порядком потребления (контекст вызова в симуляторе).
//
// Запуск: node scripts/rng-trace.mjs [frames]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const FRAMES = parseInt(process.argv[2] ?? "4000", 10);

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) {
  emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
  for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  if (emu.cpu.mem[0x80] === 20) break;
}

// ---- обёртка для лога RNG эмулятора ----
let emuLog = [];
const cpu = emu.cpu;
if (!cpu.__rngTraceWrapped) {
  cpu.__rngTraceWrapped = true;
  const orig = cpu.emulate.bind(cpu);
  cpu.emulate = () => {
    // вход в sub_D44D (TXA/PHA...) — но cpu.emulate исполняет ОДНУ инструкцию,
    // поэтому ловим выход: RTS sub_D44D на 0xd466 (A = новое значение $0F).
    if (cpu.REG_PC === 0xd465) {
      // REG_PC на 1 меньше фактического адреса: RTS sub_D44D на 0xd466 (A = новое $0F)
      const out = cpu.mem[0x0f];
      const hiE = cpu.mem[0x0a], loE = cpu.mem[0x0b];
      orig();
      emuLog.push({ v: out, a: out, hi: hiE, lo: loE });
    } else {
      orig();
    }
  };
}

const m = emu.cpu.mem;
const tanks = [];
for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0 });
const bullets = [];
for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});
sim._trace = [];
sim._rngCtx = "?";

let prevB = m[0x0b];
let matchedFrames = 0;
for (let f = 0; f < FRAMES; f++) {
  const def = { x0: m[0x90], y0: m[0x98], f0: m[0xa0], x1: m[0x91], y1: m[0x99], f1: m[0xa1] };
  emuLog = [];
  sim._trace = [];
  const emuRngBefore = m[0x0f];
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const _postB = m[0x0b], _postA = m[0x0a];
  sim.frame = _postB + _postA * 256;
  if (_postB < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = _postB;
  prevB = _postB;
  sim.p1 = { x: def.x0, y: def.y0, alive: def.f0 !== 0 };
  sim.p2 = { x: def.x1, y: def.y1, alive: def.f1 !== 0 };
  for (const t of [0, 1]) { const st = sim.tanks.find((x) => x.index === t); if (st) { st.flag = def[`f${t}`]; st.x = def[`x${t}`]; st.y = def[`y${t}`]; st.type = m[0xa8 + t]; st.alive = def[`f${t}`] !== 0; } }
  const simRngBefore = sim.rngState;
  sim.step();

  const eVals = emuLog.map((e) => e.v);
  const sVals = sim._trace.map((s) => s.v);
  const sCtx = sim._trace.map((s) => s.c);
  const match = eVals.length === sVals.length && eVals.every((v, i) => v === sVals[i]);
  if (match) { matchedFrames++; continue; }

  // расхождение: состояние до кадра
  console.log(`ДИВЕРГЕНЦИЯ на кадре f${f}: rngState до: сим=0x${simRngBefore.toString(16)} эмул=0x${emuRngBefore.toString(16)}`);
  console.log(`  эмул: ${eVals.length} вызовов RNG, сим: ${sVals.length}`);
  const n = Math.min(eVals.length, sVals.length);
  let k = 0;
  while (k < n && eVals[k] === sVals[k]) k++;
  console.log(`  первый разный индекс: ${k} (совпало ${k})`);
  console.log(`  эмул[${k}]=0x${eVals[k]?.toString(16) ?? "-"}  сим[${k}]=0x${sVals[k]?.toString(16) ?? "-"} ctx="${sCtx[k] ?? "-"}"`);
  console.log(`  эмул  кадр: ${JSON.stringify(eVals.map((v) => "0x" + v.toString(16)))}`);
  console.log(`  эмул  hi/lo: ${JSON.stringify(emuLog.map((e) => `0x${e.hi.toString(16)}/0x${e.lo.toString(16)}`))}`);
  console.log(`  сим   кадр: ${JSON.stringify(sVals.map((v) => "0x" + v.toString(16)))}`);
  console.log(`  сим   ctx : ${JSON.stringify(sCtx)}`);
  // пре-кадр флаги врагов (сим)
  const simflags = sim.tanks.map((t) => `t${t.index}=0x${t.flag.toString(16)}@(${t.x},${t.y})`);
  console.log(`  сим пре-кадр (в начале step): ${simflags.join(" ")}`);
  break;
}
console.log(`\nСовпало кадров подряд: ${matchedFrames}`);
