// divergence-report.mjs — прогнать все уровни (1..35) через BattleSim до ПЕРВОГО расхождения
// с эмулятором и собрать отчёт: кадр расхождения, враги/поле, детали.
//
// Запуск: node scripts/divergence-report.mjs [maxFrames]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const MAX = parseInt(process.argv[2] ?? "6000", 10);
const FIRST = parseInt(process.argv[3] ?? "1", 10);
const LAST = parseInt(process.argv[4] ?? "35", 10);

function setupStage(TARGET) {
  const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
  const m = emu.cpu.mem;
  let guard = 0;
  while (m[0x85] < TARGET && guard++ < 60) {
    for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
    for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
  }
  const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0 });
  const bullets = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
  const sim = new BattleSim({ field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
    counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100] },
    rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
    p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 } });
  return { emu, m, sim };
}

// Статус завершения стадии (для отчёта): 0x27 = завершена, 0x80 = игра идёт (лимит кадров).
const rows = [];
for (let TARGET = FIRST; TARGET <= LAST; TARGET++) {
  const { emu, m, sim } = setupStage(TARGET);
  let prevB = m[0x0b];
  let div = null; // {frame, kind, detail}
  let matched = 0;
  let endFrame = -1, endGameOver = null, endStage = null;
  let firstRng = null;
  for (let fr = 0; fr < MAX; fr++) {
    const def = { x0: m[0x90], y0: m[0x98], f0: m[0xa0], x1: m[0x91], y1: m[0x99], f1: m[0xa1] };
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    sim.frame = m[0x0b] + m[0x0a] * 256;
    if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
    prevB = m[0x0b];
    sim.p1 = { x: def.x0, y: def.y0, alive: def.f0 !== 0 };
    sim.p2 = { x: def.x1, y: def.y1, alive: def.f1 !== 0 };
    for (const t of [0, 1]) { const st = sim.tanks.find((x) => x.index === t); if (st) { st.flag = def[`f${t}`]; st.x = def[`x${t}`]; st.y = def[`y${t}`]; st.type = m[0xa8 + t]; st.alive = def[`f${t}`] !== 0; } }
    sim.step();
    // враги
    for (let t = 2; t < 8 && !div; t++) {
      const s = sim.tanks.find((x) => x.index === t); if (!s) continue;
      if (m[0xa0 + t] !== s.flag || (m[0xa0 + t] !== 0 && (m[0x90 + t] !== s.x || m[0x98 + t] !== s.y))) {
        div = { frame: fr, kind: "enemy", detail: `танк${t}: эмул.flag=0x${m[0xa0 + t].toString(16)} сим.flag=0x${s.flag.toString(16)}` +
          ` эмул=(${m[0x90 + t]},${m[0x98 + t]}) сим=(${s.x},${s.y}) type=0x${(s.type ?? 0).toString(16)}` };
      }
    }
    // поле
    if (!div) {
      for (let i = 0; i < 1024; i++) {
        if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) {
          div = { frame: fr, kind: "field", detail: `тайл (${Math.floor(i / 32)},${i % 32}): эмул=0x${m[0x400 + i].toString(16)} сим=0x${sim.field[i].toString(16)}` };
          break;
        }
      }
    }
    // RNG (не блокирующий — только фиксируем первый рассинхрон)
    if (firstRng === null && sim.rngState !== m[0x0f]) firstRng = fr;
    if (div) break;
    matched++;
    if (m[0x85] !== TARGET || m[0x68] !== 0x80) { endFrame = fr; endGameOver = m[0x68]; endStage = m[0x85]; break; }
  }
  if (endFrame < 0 && !div) { endFrame = MAX - 1; endGameOver = m[0x68]; endStage = m[0x85]; }
  rows.push({ stage: TARGET, div, matched: div ? matched : endFrame + 1, total: div ? matched + 1 : endFrame + 1, endGameOver, endStage, firstRng });
}

// Отчёт
console.log("ОТЧЁТ: прогнано уровней через симулятор до первого расхождения\n");
console.log("стадия | кадров до расхожд | расхождение           | первый рассинхрон RNG");
console.log("-------+-------------------+----------------------+-----------------------");
for (const r of rows) {
  const divStr = r.div ? `${r.kind}@${r.div.frame}` : "нет (100%)";
  const rngStr = r.firstRng === null ? "нет" : `f${r.firstRng}`;
  console.log(`  ${String(r.stage).padStart(4)} |   ${String(r.matched).padStart(12)} | ${divStr.padEnd(19)} | ${rngStr}`);
}
console.log("\n=== ДЕТАЛИ РАСХОЖДЕНИЙ ===");
let n = 0;
for (const r of rows) {
  if (r.div) {
    n++;
    console.log(`\nУровень ${r.stage} — расхождение ${r.div.kind} на кадре ${r.div.frame}:`);
    console.log(`  ${r.div.detail}`);
  }
}
console.log(`\nУровней с расхождением: ${n} из ${rows.length}`);
