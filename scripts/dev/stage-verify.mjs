// stage-verify.mjs — верификация BattleSim vs эмулятор на заданном уровне.
// Переход на уровень: форсируем enemies_left=0 (sub_C728 завершает стадию, игра
// переходит к следующей), затем синкаем BattleSim на старте целевой стадии.
//
// Запуск: node scripts/stage-verify.mjs [stage]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "2", 10);

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;

// прогоняем до целевой стадии (форсируя конец текущей, если стадия < target)
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  // форсим enemies_left=0 КАЖДЫЙ кадр (иначе стадия перезапишет на 20 при инициализации)
  for (let f = 0; f < 20000; f++) {
    m[0x80] = 0;
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    if (m[0x85] >= TARGET) break;
  }
  if (m[0x85] > TARGET) { console.error(`перескочили на стадию 0x${m[0x85].toString(16)}`); process.exit(1); }
  if (m[0x85] < TARGET) { console.error(`не удалось перейти на стадию ${TARGET} (stage=0x${m[0x85].toString(16)})`); process.exit(1); }
  // ждём старта боя целевой стадии: уровень инициализирован (enemies_left=20)
  for (let f = 0; f < 5000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    if (m[0x85] !== TARGET) break;
    if (m[0x80] === 20 && m[0x82] !== 0) break;
  }
}

const syncFrame = 0;
const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0 });
const bullets = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});
console.log(`Стадия ${m[0x85]}: синк на кадре (после перехода) — field с ${(function(){let i=0;for(let k=0;k<1024;k++)if((m[0x400+k]&0x7f)===0x21)i++;return i;})()} льда (0x21), enemies_left=0x${m[0x80].toString(16)}`);

let prevB = m[0x0b];
const cats = {};
function add(op, fr) { if (!cats[op]) cats[op] = { n: 0, first: fr }; cats[op].n++; }
const fieldDiffs = new Map();
let enemyFrames = 0, fieldFrames = 0, startRng = sim.rngState;
const MAX = 6000;
let endFrame = -1;
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
  let okE = true, okF = true;
  for (let t = 2; t < 8; t++) { const s = sim.tanks.find((x) => x.index === t); if (!s) continue;
    if (m[0xa0 + t] !== s.flag || (m[0xa0 + t] !== 0 && (m[0x90 + t] !== s.x || m[0x98 + t] !== s.y))) { okE = false; add(m[0xa0 + t] !== s.flag ? "enemy_flag" : "enemy_pos", fr); } }
  if (okE) enemyFrames++;
  for (let i = 0; i < 1024; i++) { if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) { okF = false; const k = Math.floor(i / 32) + "," + (i % 32); if (!fieldDiffs.has(k)) fieldDiffs.set(k, { emu: m[0x400 + i], sim: sim.field[i], n: 0 }); const d = fieldDiffs.get(k); d.n++; d.emu = m[0x400 + i]; d.sim = sim.field[i]; } }
  if (okF) fieldFrames++;
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) { endFrame = fr; break; }
}
if (endFrame < 0) endFrame = MAX - 1;
console.log(`Стадия ${TARGET}: пройдено ${endFrame + 1} кадров (конец: stage=${m[0x85]}, game_over=0x${m[0x68].toString(16)})`);
console.log(`Враги 100%: ${enemyFrames} кадров из ${endFrame + 1}`);
console.log(`Поле совпадало: ${fieldFrames} из ${endFrame + 1}`);
console.log("\n=== РАСХОЖДЕНИЯ ВРАГОВ ===");
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}: ${v.n} раз, первый f${v.first}`);
console.log("\n=== РАСХОЖДЕНИЯ ПОЛЯ (топ 20) ===");
const arr = [...fieldDiffs.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [k, d] of arr.slice(0, 20)) console.log(`  (${k}): эмул=0x${d.emu.toString(16)} сим=0x${d.sim.toString(16)} (${d.n} кадров)`);
console.log(`\nВсего тайлов-расхождений: ${fieldDiffs.size}`);
console.log(`RNG: эмул=0x${m[0x0f].toString(16)} сим=0x${sim.rngState.toString(16)} (старт сим=0x${startRng.toString(16)})`);
