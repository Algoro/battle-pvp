// diag-att.mjs — ДИАГНОСТИКА контракта решений АТАКУЮЩЕГО (plan) между симулятором
// и эмулятором в standalone-режиме (ai-eval vs emu-eval).
//
// Фон: физика сима точна (ai-verify 100% при тех же решениях), контракт ЗАЩИТНИКА
// чист (diag-def 0/6000). Но исход standalone (4 vs 9 убийств) зависит и от АТАКУЮЩЕГО:
// в ai-eval атакующий план читает sim.toMem() и принимает решения сам, в emu-eval —
// реальную RAM. Если решения расходятся — вся standalone-битва разъезжается.
//
// Тест: lockstep. На каждом кадре:
//   1) запускаем sim-овский plan на sim.toMem()  → решения атакующего сима;
//   2) читаем решения атакующего эмулятора из NET_DIR/NET_FIRE (что план записал в кадр);
//   3) сравниваем. Расхождение — FAIL.
// Состояние атакующего плана сима праймится теми же кадрами, что эмуляторный
// _tacticalState (иначе «холодное» состояние расходится с прогретого).
//
// Запуск: node scripts/diag-att.mjs [stage] [frames] [attAI]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";
import { runBrain } from "../emulator-core/ai/brain-runner.js";
import { readState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const NET_DIR = 0x01db, NET_FIRE = 0x01e1;

const emu = new PvPNes({ attAI: ATT_AI, defAI: "plan", defMode: "active", aiEvery: 1, noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
const PREROLL = 90;
for (let f = 0; f < PREROLL; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);

// Прайминг состояния атакующего плана сима: прогоняем plan на pre-step RAM эмулятора
// за те же setup+preroll кадры, что накапливал эмуляторный _tacticalState (история
// скоростей). Копия по значению — эмуляторный _tacticalState остаётся нетронутым.
let simAttState = new Map();
{
  // для прайминга нужен тот же поток кадров: уже прошли setup+preroll выше, но мы
  // НЕ накапливали state. Перезапуск заново невозможен (эмулятор одноразовый).
  // Поэтому праймим "на лету": снимаем _tacticalState эмулятора (он накопил историю
  // за всё время) и клонируем её в simAttState.
  simAttState = new Map();
  for (const [k, v] of emu._tacticalState) simAttState.set(k, v && typeof v === "object" ? { ...v } : v);
  console.log(`_tacticalState эмулятора после setup/preroll: ${emu._tacticalState.size} ключей`);
}

const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0, helmet: m[0x89 + t] });
const bullets = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100], lives: [m[0x51], m[0x52]] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});

let prevB = m[0x0b];
const defButtons = { 0: 0, 1: 0 };
const origSetDef = emu._setDefController.bind(emu);
emu._setDefController = (port, hold) => { if (port < 2) defButtons[port] = hold; return origSetDef(port, hold); };

let mismatches = 0, checked = 0;
let first = null;

for (let fr = 0; fr < MAX; fr++) {
  const p1x = m[0x90], p1y = m[0x98], p2x = m[0x91], p2y = m[0x99];
  const p1al = m[0xa0] !== 0, p2al = m[0xa1] !== 0;
  const lv0 = m[0x51], lv1 = m[0x52];
  const emuFrame = emu._frame;
  const emuPreMem = m.slice();

  // решения атакующего сима на его toMem (то же, что делает ai-eval)
  const simMem = sim.toMem();
  const simAtt = runBrain(simMem, simAttState, ATT_AI, "att", emuFrame);
  simAttState = simAtt.state;

  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);

  // решения атакующего эмулятора: NET_DIR/NET_FIRE, записанные планом в этот кадр
  const emuAtt = {};
  for (let t = 2; t < 8; t++) {
    const dir = m[NET_DIR + (t - 2)], fire = m[NET_FIRE + (t - 2)];
    emuAtt[t] = { dir: dir === 0xff ? null : dir, fire: fire === 1 };
  }

  checked++;
  let mismatch = null;
  for (let t = 2; t < 8; t++) {
    const sd = simAtt.decisions.get(t) ?? { dir: null, fire: false };
    const ed = emuAtt[t];
    if ((sd.dir ?? null) !== ed.dir || (!!sd.fire) !== ed.fire) {
      mismatch = { t, sd, ed };
      break;
    }
  }
  if (mismatch) {
    mismatches++;
    if (!first) first = { fr, ...mismatch, simMem: simMem.slice(), emuPreMem, simState: simAttState };
  }

  // кормим сим решениями эмулятора (lockstep), чтобы toMem оставался синхронным
  const defDec = {};
  for (let t = 0; t < 2; t++) { const hold = defButtons[t]; let dir = null;
    if (hold & BTN.Up) dir = 0; else if (hold & BTN.Left) dir = 1; else if (hold & BTN.Down) dir = 2; else if (hold & BTN.Right) dir = 3;
    defDec[t] = { dir, fire: (hold & BTN.A) !== 0 }; }
  sim.defControl = defDec;
  const attDec = {};
  for (let t = 2; t < 8; t++) { const dir = m[NET_DIR + (t - 2)], fire = m[NET_FIRE + (t - 2)];
    attDec[t] = { dir: dir === 0xff ? null : dir, fire: fire === 1 }; }
  sim.attControl = attDec;
  sim.defFrame = emu._frame;
  sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  sim.p1 = { x: p1x, y: p1y, alive: p1al };
  sim.p2 = { x: p2x, y: p2y, alive: p2al };
  sim.c.lives = [lv0, lv1];
  sim.step();
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) break;
}

console.log(`\nКонтракт решений АТАКУЮЩЕГО (стадия ${TARGET}, att=${ATT_AI}, до ${MAX} кадров)`);
console.log(`Проверено кадров: ${checked}, расхождений решений: ${mismatches}`);
if (first) {
  console.log(`Первое расхождение: f${first.fr} танк${first.t}: сим=${JSON.stringify(first.sd)} эмул=${JSON.stringify(first.ed)}`);
  const gsSim = readState(first.simMem), gsEmu = readState(first.emuPreMem);
  const tk = (g) => g.tanks.map((t) => `t${t.index}=0x${t.flag.toString(16)}@(${t.x},${t.y})c(${t.cell.col},${t.cell.row})in${t.inField?1:0}`).join(" | ");
  console.log(`  GameState tanks сим: ${tk(gsSim)}`);
  console.log(`  GameState tanks эмул: ${tk(gsEmu)}`);
  const bl = (g) => g.bullets.map((b) => `b${b.owner}${b.dir}@(${b.x},${b.y})`).join(" ");
  console.log(`  GameState bullets сим: [${bl(gsSim)}]`);
  console.log(`  GameState bullets эмул: [${bl(gsEmu)}]`);
  console.log(`  GameState enemiesLeft сим=${gsSim.enemiesLeft} эмул=${gsEmu.enemiesLeft}`);
  // состояние атакующего плана (prevCell/vel) сима vs эмулятора
  const dump = (st) => [...st.entries()].map(([k, v]) => `${k}:${JSON.stringify(v)}`).join(" | ");
  console.log(`  состояние плана — сим: ${dump(simAttState)}`);
  console.log(`  состояние плана — эмул: ${dump(emu._tacticalState)}`);
  // Семантические расхождения входа (raw-дифф по читаемым атакующим адресам)
  const attReads = [0x90, 0x98, 0xa0, 0xa8, 0xcc, 0xb8, 0xc2, 0x86, 0x87, 0x88, 0x80, 0x82];
  const diffs = [];
  for (const base of [0x90, 0x98, 0xa0, 0xa8, 0xcc, 0xb8, 0xc2]) for (let i = 0; i < 8; i++) {
    const a = base + i;
    if (first.simMem[a] !== first.emuPreMem[a]) diffs.push(`0x${a.toString(16)} сим=0x${first.simMem[a].toString(16)} эмул=0x${first.emuPreMem[a].toString(16)}`);
  }
  for (const a of [0x86, 0x87, 0x88, 0x80, 0x82]) if (first.simMem[a] !== first.emuPreMem[a]) diffs.push(`0x${a.toString(16)} сим=0x${first.simMem[a].toString(16)} эмул=0x${first.emuPreMem[a].toString(16)}`);
  for (let i = 0; i < 1024; i++) if (first.simMem[0x400 + i] !== first.emuPreMem[0x400 + i]) { diffs.push(`0x${(0x400 + i).toString(16)} (поле)`); break; }
  console.log(`  raw-дифф читаемых адресов: ${diffs.length ? diffs.join(", ") : "нет"}`);
  // изоляция вход vs состояние: оба входа с ОДНИМ состоянием
  const st1 = new Map(); for (const [k, v] of simAttState) st1.set(k, v && typeof v === "object" ? { ...v } : v);
  const st2 = new Map(); for (const [k, v] of simAttState) st2.set(k, v && typeof v === "object" ? { ...v } : v);
  const a1 = runBrain(first.simMem, st1, ATT_AI, "att", first.fr);
  const a2 = runBrain(first.emuPreMem, st2, ATT_AI, "att", first.fr);
  const same = a1.decisions.get(first.t) && a2.decisions.get(first.t) &&
    a1.decisions.get(first.t).dir === a2.decisions.get(first.t).dir &&
    a1.decisions.get(first.t).fire === a2.decisions.get(first.t).fire;
  console.log(`  изоляция (одно состояние, разные входы): tank${first.t} simMem=${JSON.stringify(a1.decisions.get(first.t))} emuPreMem=${JSON.stringify(a2.decisions.get(first.t))} — ${same ? "вход НЕ влияет (дело в состоянии)" : "вход ВЛИЯЕТ (toMem ≠ RAM)"}`);
} else {
  console.log("СОВПАДЕНИЕ: plan атакующего сима (на toMem) принимает те же решения, что эмулятор.");
}
