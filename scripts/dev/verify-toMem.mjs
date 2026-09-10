// verify-toMem.mjs — КОНТРАКТНЫЙ ТЕСТ слоя решений на уровне РЕШЕНИЙ ИИ.
//
// Цель: ИИ защитника в симуляторе (ai-eval) читает `sim.toMem()`, в эмуляторе
// (emu-eval) — реальный `emu.cpu.mem`. Если toMem не даёт того же «мира», что RAM,
// решения расходятся → результаты (убийства/HQ) разные.
//
// Тест: lockstep-прогон. На каждом кадре запускаем ИИ ДВАЖДЫ:
//   1) на `sim.toMem()`   → решения, которые принял бы ИИ симулятора;
//   2) на `emu.cpu.mem`   → решения, которые принял ИИ эмулятора (defButtons).
// Сравниваем. ЛЮБОЕ расхождение решений — FAIL (это и есть причина ai-eval != emu-eval).
//
// Такой контракт надёжнее байтового: он игнорирует «шум», который ИИ не использует
// (напр. точное значение счётчика взрыва пули 0x33 vs 0x32 — ИИ смотрит только на
// старший ниббл статуса 0x40=летит), и ловит ровно те различия, что меняют решения.
//
// Запуск: node scripts/verify-toMem.mjs [stage] [frames] [attAI] [defAI]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";
import { runBrain } from "../emulator-core/ai/brain-runner.js";
import { AI_READ_RANGES } from "../emulator-core/sim/ram-addr.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const DEF_AI = process.argv[5] ?? "plan";
const NET_DIR = 0x01db, NET_FIRE = 0x01e1;

const emu = new PvPNes({ attAI: ATT_AI, defAI: DEF_AI, defMode: "active", aiEvery: 1, noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
// --- модульная переменная для прайминга состояния ИИ (инициализируется ниже) ---
let PRIMED_DEF_STATE = null;

// Пре-ролл: прокрутить эмулятор, чтобы DEF-танки полностью зареспавнились. Параллельно
// праймим состояние ИИ защитника сима: эмуляторный planDefense за эти кадры накопил
// модульный defState (историю _ev/prevDir). Прогоняем симовский planDefense по тем же
// pre-step RAM, чтобы он стартовал с эквивалентным состоянием (иначе решения расходятся
// с f0 из-за «холодного» состояния, а не из-за toMem).
{
  let st = new Map();
  for (let f = 0; f < 90; f++) {
    const r = runBrain(m, st, DEF_AI, "def", emu._frame); // симовский ИИ на pre-step RAM
    st = r.state;
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  }
  PRIMED_DEF_STATE = st;
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

// Состояние ИИ защитника в симуляторе (для scan/lookahead с памятью между кадрами).
let simDefState = PRIMED_DEF_STATE ?? new Map();
let mismatchFrames = 0, checkedFrames = 0;
const firstMismatch = { frame: -1, details: "" };

// Переводит решения ИИ в битмаску кнопок (для сравнения с defButtons эмулятора).
// runBrain для защитника возвращает decisions как Map<idx, битмаска кнопок>.
function toButtons(decisions, tankIdx) {
  return decisions.get(tankIdx) ?? 0;
}

// Дамп различий sim.toMem() vs pre-frame RAM эмулятора по read-set (для отладки).
function dumpReadSetDiff(simMem, emuPre, frame) {
  console.log(`  --- toMem vs pre-frame RAM по read-set на f${frame} ---`);
  for (const r of emuPre.ranges) {
    const { base, bytes } = r;
    const diffs = [];
    for (let off = 0; off < bytes.length; off++) {
      const addr = base + off;
      const sv = simMem[addr], ev = bytes[off];
      if (sv !== ev) diffs.push(`0x${addr.toString(16)} сим=0x${sv.toString(16)} эмул=0x${ev.toString(16)}`);
    }
    if (diffs.length) {
      const desc = AI_READ_RANGES.find((x) => x.base === base)?.desc ?? "?";
      console.log(`  ${desc} (${diffs.length} байт): ${diffs.slice(0, 10).join(", ")}`);
    }
  }
}

for (let fr = 0; fr < MAX; fr++) {
  const p1x = m[0x90], p1y = m[0x98], p2x = m[0x91], p2y = m[0x99];
  const p1al = m[0xa0] !== 0, p2al = m[0xa1] !== 0;
  const lv0 = m[0x51], lv1 = m[0x52];

  // ДО шага: решения ИИ симулятора на его toMem (в том же кадре, что читает эмулятор).
  const simMem = sim.toMem();
  const emuFrame = emu._frame; // фактический NES-кадр (planDefense использует его для респавна)
  // Снимок pre-frame RAM эмулятора (до emu.stepFrame) — для корректного дампа расхождений.
  const emuPre = { mem: m, ranges: AI_READ_RANGES.map((r) => ({ base: r.base, bytes: Array.from(m.subarray(r.base, r.base + r.len)) })) };
  const simBrain = runBrain(simMem, simDefState, DEF_AI, "def", emuFrame);
  simDefState = simBrain.state;
  // ДИАГНОСТИКА: прогон planDefense сима на RAM эмулятора (тот же вход, что у эмулятора),
  // чтобы отделить «toMem ≠ RAM» от «состояние/логика ИИ разошлись».
  const simOnEmu = runBrain(m, simDefState, DEF_AI, "def", emuFrame);

  // Решения эмулятора (его ИИ уже отработал на cpu.mem во время stepFrame прошлого кадра
  // / этого — см. захват defButtons ниже). Для чистоты сравним в тот же момент: НО
  // defButtons захватываются во время emu.stepFrame этого кадра, а toMem — до шага.
  // Поэтому: сначала читаем toMem сима, затем шагаем эмулятор и ловим его решения,
  // затем шагаем сим с этими решениями — и сравниваем решения в СЛЕДУЮЩЕМ кадре.

  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  // emuDecisions — решения, которые эмулятор применил в этом кадре (на своём pre-frame RAM).
  const emuDecisions = { 0: defButtons[0], 1: defButtons[1] };

  // Сравниваем решения сима (принятые на toMem ПРОШЛОГО кадра) с решениями эмулятора
  // (принятыми на cpu.mem этого кадра) — оба соответствуют одному и тому же моменту боя.
  // Для надёжности: сравниваем решения, принятые для одного и того же состояния. Здесь
  // we compare simBrain (toMem до шага) с defButtons (эмулятор применил на этом шаге).
  checkedFrames++;
  const simButtons = { 0: toButtons(simBrain.decisions, 0), 1: toButtons(simBrain.decisions, 1) };
  const simOnEmuButtons = { 0: toButtons(simOnEmu.decisions, 0), 1: toButtons(simOnEmu.decisions, 1) };
  if (simButtons[0] !== emuDecisions[0] || simButtons[1] !== emuDecisions[1]) {
    mismatchFrames++;
    if (firstMismatch.frame < 0) {
      firstMismatch.frame = fr;
      firstMismatch.details = `tank0: сим=0x${simButtons[0].toString(16)} эмул=0x${emuDecisions[0].toString(16)}, tank1: сим=0x${simButtons[1].toString(16)} эмул=0x${emuDecisions[1].toString(16)}`;
      dumpReadSetDiff(simMem, emuPre, fr);
      const onEmuMatch = simOnEmuButtons[0] === emuDecisions[0] && simOnEmuButtons[1] === emuDecisions[1];
      console.log(`  [диагностика] planDefense сима на RAM эмулятора: ${onEmuMatch ? "СОВПАДАЕТ с эмулятором (проблема = toMem)" : "РАСХОДИТСЯ (проблема = состояние/логика ИИ)"}`);
      console.log(`    sim-on-emu: tank0=0x${simOnEmuButtons[0].toString(16)} tank1=0x${simOnEmuButtons[1].toString(16)} | эмулятор: tank0=0x${emuDecisions[0].toString(16)} tank1=0x${emuDecisions[1].toString(16)}`);
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

console.log(`Контракт решений ИИ (стадия ${TARGET}, att=${ATT_AI}, def=${DEF_AI}, до ${MAX} кадров)\n`);
console.log(`Проверено кадров: ${checkedFrames}`);
if (mismatchFrames === 0) {
  console.log("ПРОЙДЕНО: ИИ симулятора (на toMem) принимает те же решения, что ИИ эмулятора (на RAM).");
} else {
  console.log(`РАСХОЖДЕНИЙ решений: ${mismatchFrames} из ${checkedFrames}`);
  console.log(`Первое расхождение: f${firstMismatch.frame} — ${firstMismatch.details}`);
}
