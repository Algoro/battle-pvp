// diag-def.mjs — ГЛУБОКАЯ диагностика расхождения DEF-ИИ (planDefense) между
// симулятором и эмулятором в слое решений.
//
// Что делает:
//  1) греет модульный defState эмулятора за полный setup (defMode active) —
//     как в emu-eval;
//  2) ведёт сим в lockstep (кормит его решениями эмулятора), чтобы его toMem
//     совпадал с RAM эмулятора;
//  3) сидирует состояние planDefense сима (клоны _ev из defState эмулятора);
//  4) на каждом кадре запускает planDefense сима на toMem и сравнивает его
//     решения с решениями эмулятора (defButtons);
//  5) при первом расхождении выводит: выравнивание frame, отличие решений,
//     отличие семантических входов (GameState), отличие состояний (_ev),
//     производные поля (cell/inField/vel) и активную ветку decideDefender.
//
// Запуск: node scripts/diag-def.mjs [stage] [frames] [attAI]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";
import { runBrain } from "../emulator-core/ai/brain-runner.js";
import { defState } from "../emulator-core/ai/tactical-ai.js";
import { readState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const NET_DIR = 0x01db, NET_FIRE = 0x01e1;

const emu = new PvPNes({ attAI: ATT_AI, defAI: "plan", defMode: "active", aiEvery: 1, noRender: true });
emu.loadROM(readFileSync(ROM));
// Полный setup: титул + Start + переход на стадию + пре-ролл (греет module defState).
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
for (let f = 0; f < 90; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);

// Состояние DEF-ИИ эмулятора после setup (прогрето).
const evEmu = defState.get("_ev");
console.log(`defState._ev после setup: ${evEmu ? `pos=${evEmu.pos.size} vel=${evEmu.vel.size}` : "пуст"}`);
console.log(`defState всего ключей после setup: ${defState.size} — ${[...defState.keys()].map((k) => typeof k === "object" ? `[объект:${k.index}]` : String(k)).join(", ")}`);

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

// Сид состояния planDefense сима из defState эмулятора (полный: _ev + per-tank 0,1).
function seedDefState() {
  const st = new Map();
  for (const [k, v] of defState) {
    if (k === "_ev") st.set("_ev", { pos: new Map(v.pos), vel: new Map(v.vel) });
    else if (v && typeof v === "object") st.set(k, { ...v });
    else st.set(k, v);
  }
  return st;
}
let simDefState = seedDefState();

let mismatches = 0, checked = 0;
let first = null;
let firstReadSetDiff = -1;

// Проверка: расходятся ли read-set байты simMem vs emuPreMem (возвращает список адресов).
function readSetDiffers(a, b) {
  const R = {
    scalars: [0x80, 0x82, 0x45, 0x100], tanks: [0x90, 0x98, 0xa0, 0xa8],
    def: [0x89, 0x6f], bullets: [0xcc, 0xb8, 0xc2], prize: [0x88, 0x86, 0x87],
  };
  const out = [];
  for (const base of R.scalars) if (a[base] !== b[base]) out.push(`0x${base.toString(16)}`);
  for (let t = 0; t < 8; t++) for (const base of R.tanks) if (a[base + t] !== b[base + t]) out.push(`0x${(base + t).toString(16)}`);
  for (let t = 0; t < 2; t++) for (const base of R.def) if (a[base + t] !== b[base + t]) out.push(`0x${(base + t).toString(16)}`);
  for (let t = 0; t < 8; t++) for (const base of R.bullets) if (a[base + t] !== b[base + t]) out.push(`0x${(base + t).toString(16)}`);
  for (const base of R.prize) if (a[base] !== b[base]) out.push(`0x${base.toString(16)}`);
  for (let i = 0; i < 1024; i++) if (a[0x400 + i] !== b[0x400 + i]) out.push(`0x${(0x400 + i).toString(16)}`);
  return out;
}

for (let fr = 0; fr < MAX; fr++) {
  const p1x = m[0x90], p1y = m[0x98], p2x = m[0x91], p2y = m[0x99];
  const p1al = m[0xa0] !== 0, p2al = m[0xa1] !== 0;
  const lv0 = m[0x51], lv1 = m[0x52];
  const emuFrame = emu._frame; // кадр, который видит planDefense эмулятора в этом шаге
  const emuPreMem = m.slice(); // снимок pre-frame RAM (до emu.stepFrame) — для сравнения GameState
  // PRE-DECISION per-tank состояние: модуль defState (эмулятор) и simDefState (сим), ДО их ИИ.
  const preEmuSt = { 0: defState.get(0) && { ...defState.get(0) }, 1: defState.get(1) && { ...defState.get(1) } };
  const preSimSt = { 0: simDefState.get(0) && { ...simDefState.get(0) }, 1: simDefState.get(1) && { ...simDefState.get(1) } };
  const simMem = sim.toMem();
  const simBrain = runBrain(simMem, simDefState, "plan", "def", emuFrame);
  simDefState = simBrain.state;
  // Отслеживаем ПЕРВОЕ семантическое расхождение read-set (до шага) — если оно есть
  // до первого расхождения решений, значит состояние ИИ разошлось из-за входа.
  if (firstReadSetDiff < 0) {
    const d = readSetDiffers(simMem, emuPreMem);
    if (d.length) firstReadSetDiff = fr;
  }

  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const emuDec = { 0: defButtons[0], 1: defButtons[1] };
  const simDec = { 0: toBtn(simBrain.decisions, 0), 1: toBtn(simBrain.decisions, 1) };

  checked++;
  if (simDec[0] !== emuDec[0] || simDec[1] !== emuDec[1]) {
    mismatches++;
    if (!first) {
      first = { fr, simDec, emuDec, emuFrame, simFrame: sim.frame, simMem: simMem.slice(), emuPreMem, preEmuSt, preSimSt };
    }
  }

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

function toBtn(dec, idx) { return dec.get(idx) ?? 0; }

console.log(`\nПроверено кадров: ${checked}, расхождений решений: ${mismatches}`);
console.log(`Первое семантическое расхождение read-set: f${firstReadSetDiff}`);
if (first) {
  console.log(`Первое расхождение: f${first.fr}`);
  console.log(`  решения — tank0: сим=0x${first.simDec[0].toString(16)} эмул=0x${first.emuDec[0].toString(16)}, tank1: сим=0x${first.simDec[1].toString(16)} эмул=0x${first.emuDec[1].toString(16)}`);
  console.log(`  frame: emu._frame=${first.emuFrame} sim.frame(переданный в runBrain)=${first.emuFrame} (оба = emuFrame)`);
  // Семантический вход: GameState из toMem сима и из PRE-frame RAM эмулятора.
  const gsSim = readState(first.simMem), gsEmu = readState(first.emuPreMem);
  const tk = (g) => g.tanks.map((t) => `t${t.index}=0x${t.flag.toString(16)}@(${t.x},${t.y})c(${t.cell.col},${t.cell.row})in${t.inField?1:0}hel${t.helmet?1:0}`).join(" | ");
  console.log(`  GameState tanks сим: ${tk(gsSim)}`);
  console.log(`  GameState tanks эмул: ${tk(gsEmu)}`);
  const bl = (g) => g.bullets.map((b) => `b${b.owner}${b.dir}@(${b.x},${b.y})`).join(" ");
  console.log(`  GameState bullets сим: [${bl(gsSim)}]`);
  console.log(`  GameState bullets эмул: [${bl(gsEmu)}]`);
  console.log(`  GameState enemiesLeft сим=${gsSim.enemiesLeft} эмул=${gsEmu.enemiesLeft} spawnTimer сим=${gsSim.spawnTimer} эмул=${gsEmu.spawnTimer}`);
  // Состояния ИИ (_ev) сима vs эмулятора (pos и vel).
  const evS = simDefState.get("_ev"), evE = defState.get("_ev");
  const dumpEv = (ev) => ev ? `pos=[${[...ev.pos.entries()].map(([k,v]) => `${k}(${v.col},${v.row})`).join(" ")}] vel=[${[...ev.vel.entries()].map(([k,v]) => `${k}(${v.col},${v.row})`).join(" ")}]` : "-";
  console.log(`  _ev сима: ${dumpEv(evS)}`);
  console.log(`  _ev эмул: ${dumpEv(evE)}`);
  // Per-tank состояние (prevDir/held/fire) — сима vs эмулятора.
  for (const idx of [0, 1]) {
    console.log(`  tank${idx} state — сим: ${JSON.stringify(simDefState.get(idx))} | эмул: ${JSON.stringify(defState.get(idx))}`);
  }
  // PRE-DECISION per-tank состояние (до того, как ИИ обновил его в этом кадре).
  console.log(`  PRE-DECISION tank state — сим: ${JSON.stringify(first.preSimSt)} | эмул: ${JSON.stringify(first.preEmuSt)}`);
  // Решающий тест: одно и то же состояние (pre-decision) на обоих входах.
  const freshState = new Map();
  freshState.set("_ev", { pos: new Map(), vel: new Map() });
  freshState.set(0, { held: 13, prevDir: 3, fire: false });
  freshState.set(1, { held: 0, prevDir: 0, fire: false });
  const ra = runBrain(first.simMem, freshState, "plan", "def", first.emuFrame);
  const rb = runBrain(first.emuPreMem, freshState, "plan", "def", first.emuFrame);
  console.log(`  [вход-тест] с ОДИНАКОВЫМ состоянием: simMem tank0=0x${toBtn(ra.decisions,0).toString(16)} | emuPreMem tank0=0x${toBtn(rb.decisions,0).toString(16)} — ${toBtn(ra.decisions,0)===toBtn(rb.decisions,0) ? "вход не влияет" : "ВХОД ВЛИЯЕТ (raw-байт читается напрямую)"}`);
  // Бисекция: какой raw-байт (из расходящихся) меняет решение с 0x10 на 0x40.
  const diffs = [];
  for (const addr of [0x8a, ...Array.from({length:8},(_,i)=>0xb8+i), ...Array.from({length:8},(_,i)=>0xc2+i), 0x86, 0x87]) {
    if (first.simMem[addr] !== first.emuPreMem[addr]) diffs.push(addr);
  }
  const mkState = () => { const st = new Map(); st.set("_ev", { pos: new Map(), vel: new Map() }); st.set(0, { held: 13, prevDir: 3, fire: false }); st.set(1, { held: 0, prevDir: 0, fire: false }); return st; };
  for (const addr of diffs) {
    const mem = first.emuPreMem.slice();
    mem[addr] = first.simMem[addr]; // подменить один байт на симовский
    const r = runBrain(mem, mkState(), "plan", "def", first.emuFrame);
    if (toBtn(r.decisions,0) === 0x40) console.log(`  >> байт 0x${addr.toString(16)} (сим=0x${first.simMem[addr].toString(16)} эмул=0x${first.emuPreMem[addr].toString(16)}) МЕНЯЕТ решение на Left`);
  }
  // Все шумовые байты разом.
  const allMem = first.emuPreMem.slice();
  for (const addr of diffs) allMem[addr] = first.simMem[addr];
  const rall = runBrain(allMem, mkState(), "plan", "def", first.emuFrame);
  console.log(`  все шумовые байты разом -> tank0=0x${toBtn(rall.decisions,0).toString(16)} ${toBtn(rall.decisions,0) === 0x40 ? "(да, комбинация)" : "(нет)"}`);
  // Бисекция половинок списка расходящихся байтов.
  function comboFlip(mem, bytes) {
    const c = mem.slice();
    for (const a of bytes) c[a] = first.simMem[a];
    return c;
  }
  const second = [0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0x86, 0x87];
  const subs = [second.slice(0, 5), second.slice(5)];
  for (const sub of subs) {
    const r = runBrain(comboFlip(first.emuPreMem, sub), mkState(), "plan", "def", first.emuFrame);
    console.log(`  под-набор [${sub.map(a=>"0x"+a.toString(16)).join(",")}] -> ${toBtn(r.decisions,0) === 0x40 ? "Left (влияет)" : toBtn(r.decisions,0).toString(16)}`);
  }
  // Поодиночке вторую половину.
  for (const a of second) {
    const r = runBrain(comboFlip(first.emuPreMem, [a]), mkState(), "plan", "def", first.emuFrame);
    console.log(`  один 0x${a.toString(16)} (сим=0x${first.simMem[a].toString(16)} эмул=0x${first.emuPreMem[a].toString(16)}) -> ${toBtn(r.decisions,0) === 0x40 ? "Left" : toBtn(r.decisions,0).toString(16)}`);
  }
  // Комбинации из [0xc8, 0xc9, 0x86, 0x87].
  const core = [0xc8, 0xc9, 0x86, 0x87];
  const combos = [];
  for (let i = 0; i < core.length; i++) for (let j = i + 1; j < core.length; j++) combos.push([core[i], core[j]]);
  combos.push(core);
  for (const cb of combos) {
    const r = runBrain(comboFlip(first.emuPreMem, cb), mkState(), "plan", "def", first.emuFrame);
    console.log(`  комбо [${cb.map(a=>"0x"+a.toString(16)).join(",")}] (сим: ${cb.map(a=>`${a.toString(16)}=${first.simMem[a]}`).join(" ")} эмул: ${cb.map(a=>`${a.toString(16)}=${first.emuPreMem[a]}`).join(" ")}) -> ${toBtn(r.decisions,0) === 0x40 ? "Left (влияет)" : toBtn(r.decisions,0).toString(16)}`);
  }
  // RAW-дифф прямых чтений planDefense: 0x80, 0xcc+t, поле (для проверки, что вход не идентичен).
  const rawDiffs = [];
  for (let a = 0; a < 0x20; a++) if (first.simMem[a] !== first.emuPreMem[a]) rawDiffs.push(`0x${a.toString(16)} сим=0x${first.simMem[a].toString(16)} эмул=0x${first.emuPreMem[a].toString(16)}`);
  for (let t = 0; t < 8; t++) if (first.simMem[0xcc + t] !== first.emuPreMem[0xcc + t]) rawDiffs.push(`0x${(0xcc + t).toString(16)} сим=0x${first.simMem[0xcc + t].toString(16)} эмул=0x${first.emuPreMem[0xcc + t].toString(16)}`);
  console.log(`  RAW-дифф (0x00-0x20 и 0xcc-0xd3): ${rawDiffs.length ? rawDiffs.join(", ") : "нет"}`);
  // Детерминизм planDefense: повторный запуск на том же входе+состоянии.
  const checkState = seedDefState();
  const r1 = runBrain(first.simMem, checkState, "plan", "def", first.emuFrame);
  const r2 = runBrain(first.simMem, seedDefState(), "plan", "def", first.emuFrame);
  console.log(`  детерминизм (2 прогона на том же toMem): tank0 ${toBtn(r1.decisions,0).toString(16)} vs ${toBtn(r2.decisions,0).toString(16)} — ${toBtn(r1.decisions,0)===toBtn(r2.decisions,0) ? "одинаково" : "РАЗНО"}`);
  // Прямая проверка: planDefense на pre-frame RAM эмулятора с МОДУЛЬНЫМ defState.
  const onEmuMem = runBrain(first.emuPreMem, defState, "plan", "def", first.emuFrame);
  console.log(`  planDefense(emuPreMem, module defState): tank0=0x${toBtn(onEmuMem.decisions,0).toString(16)} (defButtons=0x${first.emuDec[0].toString(16)})`);
  // Read-set дифф именно на f5105 (все адреса).
  const rs = readSetDiffers(first.simMem, first.emuPreMem);
  console.log(`  read-set дифф на f${first.fr}: ${rs.length ? rs.join(", ") : "нет"}`);
  // Изоляция вход vs состояние: оба входа с ОДНИМ состоянием (module defState).
  const a = runBrain(first.simMem, defState, "plan", "def", first.emuFrame);
  const b = runBrain(first.emuPreMem, defState, "plan", "def", first.emuFrame);
  console.log(`  изоляция: planDefense(simMem, module) tank0=0x${toBtn(a.decisions,0).toString(16)} | planDefense(emuPreMem, module) tank0=0x${toBtn(b.decisions,0).toString(16)} — ${toBtn(a.decisions,0)===toBtn(b.decisions,0) ? "вход НЕ влияет (дело в состоянии)" : "вход ВЛИЯЕТ"}`);
} else {
  console.log("СОВПАДЕНИЕ: planDefense сима (на toMem) принимает те же решения, что эмулятор.");
}
