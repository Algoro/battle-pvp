// diag-standalone.mjs — покадровое сравнение STANDALONE-прогонов эмулятора и симулятора.
// Эмулятор (эталон): attAI/defAI/defMode как в emu-eval. Симулятор: сам вычисляет решения
// атакующего (runBrain att) и защитника (runBrain def) на sim.toMem(), как в ai-eval.
// Сверяем танки/поле/RNG. Находим ПЕРВЫЙ кадр расхождения standalone-физики/решений.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";
import { runBrain } from "../emulator-core/ai/brain-runner.js";
import { defState } from "../emulator-core/ai/tactical-ai.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const DEF_AI = process.argv[5] ?? "plan";

function seedDefState() {
  const st = new Map();
  for (const [k, v] of defState) {
    if (k === "_ev") st.set("_ev", { pos: new Map(v.pos), vel: new Map(v.vel) });
    else if (v && typeof v === "object") st.set(k, { ...v });
    else st.set(k, v);
  }
  return st;
}

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
const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0, helmet: m[0x89 + t] });
const bullets = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100], lives: [m[0x51], m[0x52]] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});
let attSt = new Map(); for (const [k, v] of emu._tacticalState) attSt.set(k, v && typeof v === "object" ? { ...v } : v);
let defSt = seedDefState();
sim.defFrame = emu._frame; // стартовый счётчик PvP (ритм респавна DEF)

let matched = 0, div = null, firstRng = -1;
for (let fr = 0; fr < MAX; fr++) {
  sim.advanceFrame();
  sim.c.gateFrmLo = sim.frame & 0xff;
  sim.defFrame = sim.defFrame + 1;
  // решения standalone: симулятор сам считает att+def на своём toMem
  const mem = sim.toMem();
  const attRes = runBrain(mem, attSt, ATT_AI, "att", sim.frame);
  attSt = attRes.state;
  const attDec = {};
  for (const [t, d] of attRes.decisions) attDec[t] = d;
  sim.attControl = attDec;
  const defRes = runBrain(mem, defSt, DEF_AI, "def", sim.defFrame);
  defSt = defRes.state;
  const defDec = {};
  for (const [port, b] of defRes.decisions ?? new Map()) {
    let dir = null, fire = false;
    if (b & 0x01) fire = true;
    if (b & 0x10) dir = 0; else if (b & 0x40) dir = 1; else if (b & 0x20) dir = 2; else if (b & 0x80) dir = 3;
    defDec[port] = { dir, fire };
  }
  sim.defControl = defDec;
  sim.defFrame = sim.frame;
  const p1 = sim.tanks.find((x) => x.index === 0), p2 = sim.tanks.find((x) => x.index === 1);
  sim.p1 = { x: p1?.x ?? 88, y: p1?.y ?? 216, alive: p1?.alive ?? true };
  sim.p2 = { x: p2?.x ?? 152, y: p2?.y ?? 216, alive: p2?.alive ?? false };

  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  sim.step();

  for (let t = 0; t < 8 && !div; t++) {
    const s = sim.tanks.find((x) => x.index === t); if (!s) continue;
    if (m[0xa0 + t] !== s.flag || (m[0xa0 + t] !== 0 && (m[0x90 + t] !== s.x || m[0x98 + t] !== s.y))) {
      div = { frame: fr, kind: "tank", detail: `танк${t}: эмул.flag=0x${m[0xa0 + t].toString(16)}@(${m[0x90 + t]},${m[0x98 + t]}) сим.flag=0x${s.flag.toString(16)}@(${s.x},${s.y})` };
    }
  }
  if (!div) for (let i = 0; i < 1024; i++) {
    if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) {
      div = { frame: fr, kind: "field", detail: `тайл(${Math.floor(i / 32)},${i % 32}) эмул=0x${m[0x400 + i].toString(16)} сим=0x${sim.field[i].toString(16)}` };
      break;
    }
  }
  if (firstRng < 0 && sim.rngState !== m[0x0f]) firstRng = fr;
  if (div) break;
  matched++;
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) { div = { frame: fr, kind: "end" }; break; }
}

console.log(`Standalone сравнение (стадия ${TARGET}, att=${ATT_AI}, def=${DEF_AI}, до ${MAX}): совпало ${matched}`);
if (div) console.log(`РАСХОЖДЕНИЕ ${div.kind}@${div.frame}: ${div.detail}`);
else console.log("100% покадрово");
console.log(`первый рассинхрон RNG: f${firstRng < 0 ? "нет" : firstRng} | финальный RNG сим=${sim.rngState} эмул=0x${m[0x0f].toString(16)}`);
