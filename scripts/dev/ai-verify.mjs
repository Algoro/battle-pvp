// ai-verify.mjs — покадровая сверка ИИ (att+def) на эмуляторе и симуляторе.
// Эмулятор (источник решений): attAI пишет NET_DIR/NET_FIRE, defAI двигает DEF-танки.
// Харнесс захватывает решения после кадра и кормит в симулятор через sim.attControl/
// defControl (сим сам считает и врагов, и игроков). Сверяем все танки, поле и RNG.
//
// Запуск: node scripts/ai-verify.mjs [stage] [frames] [attAI] [defAI]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "1500", 10);
const ATT_AI = process.argv[4] ?? "plan";
const DEF_AI = process.argv[5] ?? "plan";
const NET_DIR = 0x01db, NET_FIRE = 0x01e1;

function movementRange(flag) { const h = flag & 0xf0; return h >= 0x80 && h <= 0xd0; }

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
// Пре-ролл: прокрутить эмулятор, чтобы DEF-танки полностью зареспавнились (иначе
// форсированный переход оставляет их в mid-респавне — артефакт setup, не сима).
const PREROLL = 90;
for (let f = 0; f < PREROLL; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
const tanks = []; for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0, helmet: m[0x89 + t] });
const bullets = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({ field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100], lives: [m[0x51], m[0x52]] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 } });

let prevB = m[0x0b];
let div = null, matched = 0, endFrame = -1, firstRng = null;
// Перехват _setDefController: фиксируем кнопки DEF-ИИ (решение на этот кадр).
const defButtons = { 0: 0, 1: 0 };
const origSetDef = emu._setDefController.bind(emu);
emu._setDefController = (port, hold) => { if (port < 2) defButtons[port] = hold; return origSetDef(port, hold); };
for (let fr = 0; fr < MAX; fr++) {
  // слот DEF-пули в эмуляторе на начало кадра (эмулятор решает огонь в начале кадра)
  sim.defSlotBusy = [(m[0xcc] & 0xf0) !== 0, (m[0xcd] & 0xf0) !== 0];
  // позиции p1/p2 (DEF-танки) на НАЧАЛО кадра: ATT-танки (индексы 7..2) обрабатываются в
  // эмуляторе раньше DEF-танков (1,0), поэтому follow-цель (sub_DE72/E420) читает PRE-кадровую
  // позицию игрока. Синхронизация пост-кадровой позиции давала дрейф follow-направления (план f2754).
  const p1x = m[0x90], p1y = m[0x98], p2x = m[0x91], p2y = m[0x99];
  const p1al = m[0xa0] !== 0, p2al = m[0xa1] !== 0;
  // жизни DEF-танков на НАЧАЛО кадра: PvP-слой (pvp.js) сбрасывает жизни на 3 при 0,
  // ROM респавнит танк сразу при lives>0 (sub_DE07). Пост-кадровый m[0x51/52] уже
  // декрементирован смертью этого кадра — симулятор тогда считает lives==0 и ждёт
  // 30-кадровый ритм _defLifecycle (расхождение респавна lookahead f5023).
  const lv0 = m[0x51], lv1 = m[0x52];
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  // решения DEF из перехваченных кнопок ИИ
  const defDec = {};
  for (let t = 0; t < 2; t++) {
    const hold = defButtons[t];
    let dir = null;
    if (hold & BTN.Up) dir = 0; else if (hold & BTN.Left) dir = 1; else if (hold & BTN.Down) dir = 2; else if (hold & BTN.Right) dir = 3;
    defDec[t] = { dir, fire: (hold & BTN.A) !== 0 };
  }
  sim.defControl = defDec;
  // решения att из NET_DIR/NET_FIRE
  const attDec = {};
  for (let t = 2; t < 8; t++) {
    const dir = m[NET_DIR + (t - 2)], fire = m[NET_FIRE + (t - 2)];
    attDec[t] = { dir: dir === 0xff ? null : dir, fire: fire === 1 };
  }
  sim.attControl = attDec;
  sim.defFrame = emu._frame; // монотонный счётчик PvP-слоя (ритм респавна DEF, pvp.js)
  sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  sim.p1 = { x: p1x, y: p1y, alive: p1al };
  sim.p2 = { x: p2x, y: p2y, alive: p2al };
  sim.c.lives = [lv0, lv1];
  sim.step();
  // танки 0..7
  for (let t = 0; t < 8 && !div; t++) {
    const s = sim.tanks.find((x) => x.index === t); if (!s) continue;
    if (m[0xa0 + t] !== s.flag || (m[0xa0 + t] !== 0 && (m[0x90 + t] !== s.x || m[0x98 + t] !== s.y))) {
      div = { frame: fr, kind: "tank", detail: `танк${t}(${s.team}): эмул.flag=0x${m[0xa0 + t].toString(16)} сим.flag=0x${s.flag.toString(16)} эмул=(${m[0x90 + t]},${m[0x98 + t]}) сим=(${s.x},${s.y})` };
    }
  }
  // поле
  if (!div) for (let i = 0; i < 1024; i++) {
    if ((sim.field[i] & 0x7f) !== (m[0x400 + i] & 0x7f)) {
      div = { frame: fr, kind: "field", detail: `тайл (${Math.floor(i / 32)},${i % 32}) эмул=0x${m[0x400 + i].toString(16)} сим=0x${sim.field[i].toString(16)}` };
      const eb = []; for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40 || (s & 0xf0) === 0x30) eb.push(`${t}:(${m[0xb8 + t]},${m[0xc2 + t]})s0x${s.toString(16)}`); }
      const sb = []; for (let t = 0; t < 8; t++) { const b = sim.bullets[t]; if (b.alive) sb.push(`${t}:(${b.x},${b.y})${b.explode ? "x" + b.explode : ""}`); }
      console.log(`  пули эмул=[${eb.join(" ")}] сим=[${sb.join(" ")}]`);
      break;
    }
  }
  if (firstRng === null && sim.rngState !== m[0x0f]) firstRng = fr;
  if (div) break;
  matched++;
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) { endFrame = fr; break; }
}
if (endFrame < 0 && !div) endFrame = MAX - 1;
console.log(`Стадия ${TARGET} att=${ATT_AI} def=${DEF_AI}: совпало ${matched} из ${(div ? matched + 1 : endFrame + 1)}`);
if (div) console.log(`РАСХОЖДЕНИЕ ${div.kind}@${div.frame}: ${div.detail}`);
else console.log("100% покадрово (все танки+поле)");
console.log(`RNG: ${firstRng === null ? "синхронен" : "первый рассинхрон f" + firstRng}`);
