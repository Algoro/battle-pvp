// def-kill-verify.mjs — ДИАГНОСТИКА Фазы 5 (не гарантирует 100%).
// Эмулятор: DEF-танки (0,1) управляются planDefense (defMode active) и стреляют по врагам.
// Симулятор: DEF-танки и DEF-пули синкаются с эмулятора (позиции DEF-пуль — конец кадра,
// коллизия обрабатывается как sub_E604), враги (2-7) считаются BattleSim.
//
// ОГРАНИЧЕНИЕ: симулятор предсказывает ВРАГОВ, а не DEF. Решение DEF-танка о выстреле (когда
// именно стрелять) задаёт ИИ (planDefense) и не предсказывается симулятором. Поэтому выстрел,
// который убивает врага В ТОМ ЖЕ кадре (fire-frame kill), симулятор не успевает обработать
// (пуля уже в состоянии взрыва 0x33 при синке). Это даёт рассинхрон убийств, поле и RNG.
// Юнит-логика смерти врага (броня, бонус при ударе, взрыв 0x73, enemiesLeft, приз) покрыта
// unit-тестами (tests/battle.test.js) и здесь не может быть доведена до 100%.
//
// Запуск: node scripts/def-kill-verify.mjs [stage] [frames]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "4000", 10);

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "active", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0, helmet: t < 2 && m[0x89 + t] > 0 });
const bullets = []; for (let t = 0; t < 10; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true, property: m[0xd6 + t] ?? 0, synced: t < 2 }); }
const sim = new BattleSim({ field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 } });

let prevB = m[0x0b];
const fieldDiffs = new Map();
const cats = {};
function add(op, fr) { if (!cats[op]) cats[op] = { n: 0, first: fr }; cats[op].n++; }
let enemyFrames = 0, fieldFrames = 0, rngDiverged = false, firstRngDiv = -1;
let emuDeaths = 0, simDeaths = 0, simPrizeSpawns = 0;
let prevEmuDeaths = 0;
let endFrame = -1;

for (let fr = 0; fr < MAX; fr++) {
  // синк DEF-танков на НАЧАЛО кадра, DEF-пуль — на КОНЕЦ кадра эмулятора (позиция после
  // движения sub_E604): симулятор обрабатывает только коллизию DEF-пуль, как эмулятор.
  const def = { x0: m[0x90], y0: m[0x98], f0: m[0xa0], t0: m[0xa8], h0: m[0x89], x1: m[0x91], y1: m[0x99], f1: m[0xa1], t1: m[0xa9], h1: m[0x8a] };
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  // синк DEF-танков
  sim.p1 = { x: def.x0, y: def.y0, alive: def.f0 !== 0 };
  sim.p2 = { x: def.x1, y: def.y1, alive: def.f1 !== 0 };
  for (const i of [0, 1]) {
    const st = sim.tanks.find((x) => x.index === i);
    if (st) { st.flag = def[`f${i}`]; st.x = def[`x${i}`]; st.y = def[`y${i}`]; st.type = def[`t${i}`]; st.alive = def[`f${i}`] !== 0; st.helmet = def[`h${i}`] > 0; }
  }
  // синк DEF-пуль на конец кадра
  for (const slot of [0, 1]) {
    const s = m[0xcc + slot];
    const sb = sim.bullets[slot]; sb.synced = true; sb.team = "DEF"; sb.owner = slot; sb.slot = slot; sb.property = m[0xd6 + slot] ?? 0;
    if ((s & 0xf0) === 0x40) { sb.alive = true; sb.explode = 0; sb.x = m[0xb8 + slot]; sb.y = m[0xc2 + slot]; sb.dir = s & 3; }
    else if ((s & 0xf0) === 0x30) { sb.alive = true; sb.explode = 9; sb.x = m[0xb8 + slot]; sb.y = m[0xc2 + slot]; sb.dir = s & 3; }
    else { sb.alive = false; sb.explode = 0; }
  }
  // синк приза из эмулятора
  const emuHasPrize = m[0x88] !== 0xff && m[0x86] !== 0;
  if (emuHasPrize) sim.prize = { id: m[0x88], x: m[0x86], y: m[0x87] };
  sim.step();
  // статистика убийств и спавнов приза
  const nowEmuDeaths = 20 - m[0x80];
  if (nowEmuDeaths > prevEmuDeaths) emuDeaths += nowEmuDeaths - prevEmuDeaths;
  prevEmuDeaths = nowEmuDeaths;
  if (sim.events.some((e) => e.op === "enemy_dead")) simDeaths++;
  if (sim.events.some((e) => e.op === "bonus_spawn")) simPrizeSpawns++;
  // RNG
  if (sim.rngState !== m[0x0f] && firstRngDiv < 0) firstRngDiv = fr;
  if (sim.rngState !== m[0x0f]) rngDiverged = true;
  // сверка
  let okE = true, okF = true;
  for (let t = 2; t < 8; t++) { const s = sim.tanks.find((x) => x.index === t); if (!s) continue;
    if (m[0xa0 + t] !== s.flag || (m[0xa0 + t] !== 0 && (m[0x90 + t] !== s.x || m[0x98 + t] !== s.y))) { okE = false; add(m[0xa0 + t] !== s.flag ? "enemy_flag" : "enemy_pos", fr); } }
  if (okE) enemyFrames++;
  for (let i = 0; i < 1024; i++) if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) { okF = false; const k = Math.floor(i / 32) + "," + (i % 32); if (!fieldDiffs.has(k)) fieldDiffs.set(k, { emu: m[0x400 + i], sim: sim.field[i], n: 0 }); const d = fieldDiffs.get(k); d.n++; d.emu = m[0x400 + i]; d.sim = sim.field[i]; }
  if (okF) fieldFrames++;
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) { endFrame = fr; break; }
}
if (endFrame < 0) endFrame = MAX - 1;
console.log(`Стадия ${TARGET} (DEF active): пройдено ${endFrame + 1} кадров`);
console.log(`Убийства врагов: эмул=${emuDeaths} сим=${simDeaths}; спавнов приза: эмул~${emuDeaths >= simDeaths ? simPrizeSpawns : "?"} сим=${simPrizeSpawns}`);
console.log(`Враги 100%: ${enemyFrames} из ${endFrame + 1}`);
console.log(`Поле 100%: ${fieldFrames} из ${endFrame + 1}`);
console.log(`RNG синхронен: ${!rngDiverged}${firstRngDiv >= 0 ? " (первый рассинхрон f" + firstRngDiv + ")" : ""}`);
console.log("=== РАСХОЖДЕНИЯ ВРАГОВ ===");
for (const [k, v] of Object.entries(cats).sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k}: ${v.n} раз, первый f${v.first}`);
console.log("=== РАСХОЖДЕНИЯ ПОЛЯ (топ 15) ===");
const arr = [...fieldDiffs.entries()].sort((a, b) => b[1].n - a[1].n);
for (const [k, d] of arr.slice(0, 15)) console.log(`  (${k}): эмул=0x${d.emu.toString(16)} сим=0x${d.sim.toString(16)} (${d.n} кадров)`);
console.log(`Всего тайлов-расхождений: ${fieldDiffs.size}`);
