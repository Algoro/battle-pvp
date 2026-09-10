// trace-defbul.mjs — покадровый трейс сима и эмулятора вокруг расхождения f3344
// (js/plan, стадия 1): DEF-пуля vs ATT-танк. Выводит танки+пули+поле по кадрам.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = 1, ATT_AI = "plan", DEF_AI = "plan";
const NET_DIR = 0x01db, NET_FIRE = 0x01e1;
const FROM = parseInt(process.argv[2] ?? "3320", 10);
const TO = parseInt(process.argv[3] ?? "3350", 10);

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
for (let f = 0; f < 90; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
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

const fmtB = (tag, arr) => {
  const bs = (arr || []).filter((b) => b.alive || b.explode).map((b) => `${b.slot}${b.dir}${b.team[0]}@(${b.x},${b.y})${b.explode ? "x" + b.explode : ""}${b.fresh ? "f" : ""}`);
  return bs.length ? ` ${tag}=[${bs.join(" ")}]` : "";
};
const fmtT = (tag, arr) => {
  const ts = arr.filter((t) => t.alive).map((t) => `t${t.index}0x${t.flag.toString(16)}@(${t.x},${t.y})`);
  return ` ${tag}=[${ts.join(" ")}]`;
};

for (let fr = 0; fr <= TO; fr++) {
  const p1x = m[0x90], p1y = m[0x98], p2x = m[0x91], p2y = m[0x99];
  const p1al = m[0xa0] !== 0, p2al = m[0xa1] !== 0;
  const lv0 = m[0x51], lv1 = m[0x52];
  const simPre = sim.snapshot();
  const simBulPre = simPre.bullets.filter((b) => b.alive).map((b) => `${b.slot}${b.dir}@(${b.x},${b.y})${b.explode ? "x" + b.explode : ""}${b.fresh ? "f" : ""}p${b.property}`).join(" ") || "-";
  const emuBulPre = [];
  for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; const live = (s & 0xf0) === 0x40 || (s & 0xf0) === 0x30; if (live) emuBulPre.push(`${t}${s & 3}@(${m[0xb8 + t]},${m[0xc2 + t]})s0x${s.toString(16)}`); }

  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const defDec = {};
  for (let t = 0; t < 2; t++) { const hold = defButtons[t]; let dir = null;
    if (hold & BTN.Up) dir = 0; else if (hold & BTN.Left) dir = 1; else if (hold & BTN.Down) dir = 2; else if (hold & BTN.Right) dir = 3;
    defDec[t] = { dir, fire: (hold & BTN.A) !== 0 }; }
  sim.defControl = defDec;
  const attDec = {};
  for (let t = 2; t < 8; t++) { const dir = m[NET_DIR + (t - 2)], fire = m[NET_FIRE + (t - 2)];
    attDec[t] = { dir: dir === 0xff ? null : dir, fire: fire === 1 }; }
  sim.attControl = attDec;
  sim.defFrame = emu._frame; sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  sim.p1 = { x: p1x, y: p1y, alive: p1al }; sim.p2 = { x: p2x, y: p2y, alive: p2al };
  sim.c.lives = [lv0, lv1];
  if (fr >= FROM) console.log(`f${fr} PRE simBul=[${simBulPre}] emuBul=[${emuBulPre.join(" ")}]`);
  sim.step();
  const simPost = sim.snapshot();
  if (fr >= FROM) {
    const emuT = []; for (let t = 0; t < 8; t++) if (m[0xa0 + t] !== 0) emuT.push(`t${t}0x${m[0xa0 + t].toString(16)}@(${m[0x90 + t]},${m[0x98 + t]})`);
    const simT = simPost.tanks.filter((t) => t.alive).map((t) => `t${t.index}0x${t.flag.toString(16)}@(${t.x},${t.y})`);
    console.log(`     simT=[${simT.join(" ")}]  emuT=[${emuT.join(" ")}]  RNG sim=${sim.rngState} emu=0x${m[0x0f].toString(16)}`);
  }
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) break;
}
