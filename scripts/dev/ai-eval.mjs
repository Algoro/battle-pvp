// ai-eval.mjs — оценка ИИ на СИМУЛЯТОРЕ (без эмулятора в цикле).
// ИИ (att/def) читает sim.toMem() и возвращает решения; симулятор исполняет кадр.
// Собираем метрики: убийства врагов, HQ цел, враги на поле, исход эпизода.
// Сравниваем комбинации режимов ИИ (js/scan/lookahead для атакующих; plan для защитников).
//
// СЕМАНТИКА холодного старта DEF-ИИ: planDefense хранит персистентное состояние
// (историю скоростей врагов _ev). Эмулятор (emu-eval) греет его за setup/preroll
// (defMode "active"). Симулятор обязан стартовать с ТЕМ ЖЕ состоянием, иначе решения
// расходятся с первых кадров. loadStage использует defMode "active" (совпадает с
// emu-eval) и сидирует состояние DEF-ИИ из прогретого defState эмулятора.
//
// Запуск: node scripts/ai-eval.mjs [stage] [frames] [att1,att2,..] [defModes]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";
import { runBrain } from "../emulator-core/ai/brain-runner.js";
import { defState } from "../emulator-core/ai/tactical-ai.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_MODES = (process.argv[4] ?? "plan,scan,lookahead,js").split(",");
const DEF_MODES = (process.argv[5] ?? "plan").split(",");

// Сидирует персистентное состояние DEF-ИИ сима из прогретого defState эмулятора.
// planDefense хранит:
//   "_ev" — { pos, vel: Map<idx,{col,row}> } — история скоростей врагов;
//   per-tank (ключи 0,1) — { held, prevDir, fire } — сглаживание направления (гистерезис).
// Оба персистят между кадрами (ключи — индексы). Если сим стартует без них
// («холодный»), на первых кадрах решения расходятся (prevDir=null vs прогретый).
// Копируем всё глубоко, чтобы каждый запуск сима стартовал с состоянием эмулятора.
function seedDefState() {
  const st = new Map();
  for (const [k, v] of defState) {
    if (k === "_ev") st.set("_ev", { pos: new Map(v.pos), vel: new Map(v.vel) });
    else if (v && typeof v === "object") st.set(k, { ...v }); // per-tank {held, prevDir, fire}
    else st.set(k, v);
  }
  return st;
}

// Достичь стадии через эмулятор, извлечь начальное состояние симулятора.
function loadStage(TARGET) {
  const emu = new PvPNes({ attAI: "plan", defAI: "plan", defMode: "active", noRender: true });
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
  const m = emu.cpu.mem;
  let guard = 0;
  while (m[0x85] < TARGET && guard++ < 60) {
    for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
    for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
  }
  // Прогрев состояния АТАКУЮЩЕГО ИИ: эмуляторный plan (attAI="plan") накопил _tacticalState
  // (историю скоростей врагов) за setup. Клонируем её, чтобы sim стартовал не «холодным».
  // (Враги во время форс-перехода уже спавнились и двигались — история скоростей есть.)
  const attState = new Map();
  for (const [k, v] of emu._tacticalState) attState.set(k, v && typeof v === "object" ? { ...v } : v);
  const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0 });
  return { state: { field: m.slice(0x400, 0x400 + 1024), tanks, counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100], lives: [3, 3] }, rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]], p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 } }, attState, defFrameBase: emu._frame };
}

function evaluate(attMode, defMode, base) {
  const sim = new BattleSim(JSON.parse(JSON.stringify(base.state)));
  sim.defFrame = base.defFrameBase ?? 0; // стартовый счётчик PvP (ритм респавна DEF, как _frame эмулятора)
  const attSt = new Map(); for (const [k, v] of base.attState) attSt.set(k, v && typeof v === "object" ? { ...v } : v);
  let defSt = seedDefState(); // DEF-ИИ стартует с прогретым состоянием
  let kills = 0, hq = true, outcome = "running", frames = 0;
  let attState = null;
  for (let fr = 0; fr < MAX; fr++) {
    // продвижение кадра: от этого зависят фаза огня (RNG), таймер каски (frame&0x3f),
    // ритм респавна DEF (defFrame%30). Раньше frame не сдвигался — симулятор шёл неверно.
    // frame инкрементируется как $0A/$0B эмулятора (advanceFrame): $0A не frame>>8,
    // а инкрементится каждые 64 кадра — иначе standalone RNG расходится.
    sim.advanceFrame();
    sim.c.gateFrmLo = sim.frame & 0xff;
    sim.defFrame = sim.defFrame + 1; // отдельный ПРОСТОЙ счётчик (ритм респавна DEF, pvp.js)
    const mem = sim.toMem();
    // решения ИИ: att — {dir, fire}, def — кнопки контроллера (конвертируем)
    const attRes = runBrain(mem, attState, attMode, "att", sim.frame);
    attState = attRes.state;
    sim.attControl = attRes.decisions;
    // planDefense использует frame только для ритма респавна (frame%30) — ему нужен ПРОСТОЙ
    // счётчик (как _frame в эмуляторе), а не $0A/$0B-кодированный sim.frame.
    const defRes = runBrain(mem, defSt, defMode, "def", sim.defFrame);
    defSt = defRes.state; // продолжаем состояние DEF-ИИ между кадрами (как в эмуляторе)
    const defDec = {};
    for (const [port, buttons] of (defRes.decisions ?? new Map())) {
      let dir = null, fire = false;
      if (buttons & 0x01) fire = true;
      if (buttons & 0x10) dir = 0; else if (buttons & 0x40) dir = 1; else if (buttons & 0x20) dir = 2; else if (buttons & 0x80) dir = 3;
      defDec[port] = { dir, fire };
    }
    sim.defControl = defDec;
    // синк p1/p2 из сима
    const p1 = sim.tanks.find((x) => x.index === 0), p2 = sim.tanks.find((x) => x.index === 1);
    sim.p1 = { x: p1?.x ?? 88, y: p1?.y ?? 216, alive: (p1?.alive) ?? true };
    sim.p2 = { x: p2?.x ?? 152, y: p2?.y ?? 216, alive: (p2?.alive) ?? false };
    sim.step();
    frames++;
    if (sim.events.some((e) => e.op === "enemy_dead")) kills++;
    // HQ: орёл 0xc8 на (26,14)/(27,15)
    hq = hq && sim.field[26 * 32 + 14] === 0xc8 && sim.field[27 * 32 + 15] === 0xc8;
    if (sim.c.gameOver) { outcome = "game_over"; break; }
    if ((sim.c.enemiesLeft ?? 0) <= 0 && sim.c.spawnCount === 0) { outcome = "stage_clear"; break; }
    if (fr >= MAX - 1) outcome = "timeout";
  }
  return { kills, hq, outcome, frames, enemiesLeft: sim.c.enemiesLeft ?? 0 };
}

// Прогрев: сравнение через один прогон (результаты детерминированы).
const baseState = loadStage(TARGET);
console.log(`Оценка ИИ на симуляторе (стадия ${TARGET}, до ${MAX} кадров)\n`);
console.log("att/def      | исход       | кадры | убийства врагов | HQ | врагов осталось");
console.log("-------------+-------------+-------+-----------------+----+----------------");
const results = [];
for (const att of ATT_MODES) {
  for (const def of DEF_MODES) {
    const r = evaluate(att, def, baseState);
    results.push({ att, def, ...r });
    console.log(`${(att + "/" + def).padEnd(12)} | ${r.outcome.padEnd(11)} | ${String(r.frames).padEnd(5)} | ${String(r.kills).padEnd(15)} | ${r.hq ? "цел" : "разр."} | ${String(r.enemiesLeft).padEnd(15)}`);
  }
}
const byOutcome = {};
for (const r of results) byOutcome[r.outcome] = (byOutcome[r.outcome] ?? 0) + 1;
console.log("\nИтоги:", JSON.stringify(byOutcome));
