// ai-scenarios.mjs — исследование «когда ASM-ИИ лучше JS-ИИ» на разных раскладках
// препятствий. Поле инжектится в запущенную игру; DEF защищается одинаково
// (planDefense JS) в обоих режимах, чтобы изолировать переменную «мозг атакующих».
//
// Запуск: node scripts/ai-scenarios.mjs
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";

const __dirname = new URL(".", import.meta.url).pathname;
const ROM = `${__dirname}../rom/disasm/_battle_city.nes`;
const BUDGET = 6000;

function alive(emu, t) { const hi = emu.cpu.mem[0xa0 + t] & 0xf0; return hi >= 0x90 && hi <= 0xd0; }
function eagleAlive(emu) {
  const f = emu.cpu.mem.subarray(0x400, 0x400 + 1024);
  for (let i = 0; i < 1024; i++) { const v = f[i]; if (v >= 0xc8 && v <= 0xcb) return true; }
  return false;
}

function makeField(layout) {
  const f = new Uint8Array(1024).fill(0x00);
  for (let r = 27; r <= 28; r++) for (let c = 14; c <= 17; c++) f[r * 32 + c] = 0xc8;
  for (const { type, c, r } of (layout?.tiles || [])) f[r * 32 + c] = type;
  return f;
}

function run(attAI, layout) {
  const emu = new PvPNes({ attAI });
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[0x80] === 20) break;
  }
  for (let f = 0; f < 3000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    if (alive(emu, 2) && emu.cpu.mem[0x9a] > 48) break;
  }
  emu.cpu.mem.set(makeField(layout), 0x400);
  // инжект приза (если задан): id в $88, позиция в $86/$87
  if (layout.prize) { emu.cpu.mem[0x88] = layout.prize.id; emu.cpu.mem[0x86] = layout.prize.x; emu.cpu.mem[0x87] = layout.prize.y; }
  const wasDefAlive = [false, false], wasAttAlive = new Array(6).fill(false);
  let defKills = 0, attDeaths = 0, eagle = -1, stages = 0, lastStage = emu.cpu.mem[0x80];
  let prizeCollected = false, prizeStartId = layout.prize ? layout.prize.id : 0xff;
  for (let frm = 0; frm < BUDGET; frm++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: 0 }]);
    for (let d = 0; d < 2; d++) { const a = alive(emu, d); if (wasDefAlive[d] && !a) defKills++; wasDefAlive[d] = a; }
    for (let i = 0; i < 6; i++) { const t = i + 2, a = alive(emu, t); if (wasAttAlive[i] && !a) attDeaths++; wasAttAlive[i] = a; }
    if (eagle < 0 && !eagleAlive(emu)) eagle = frm;
    if (!prizeCollected && layout.prize && emu.cpu.mem[0x88] === 0xff) prizeCollected = true;
    const s = emu.cpu.mem[0x80]; if (s !== lastStage && s !== 0xff) stages++; lastStage = s;
  }
  let da = 0, aa = 0; for (let d = 0; d < 2; d++) if (alive(emu, d)) da++; for (let i = 0; i < 6; i++) if (alive(emu, i + 2)) aa++;
  return { attAI, defKills, attDeaths, kd: attDeaths ? (defKills / attDeaths).toFixed(3) : "inf", eagle, stages, attAlive: aa, defAlive: da, prize: layout.prize ? (prizeCollected ? "collected" : "left") : "none" };
}

const LAYOUTS = {
  open: { name: "открытое поле", tiles: [] },
  cols: { name: "вертикальные стены", tiles: Array.from({ length: 6 }, (_, r) => [{ type: 0x11, c: 8, r: 12 + r }, { type: 0x11, c: 23, r: 12 + r }]).flat() },
  rows: { name: "горизонтальные стены", tiles: Array.from({ length: 6 }, (_, c) => [{ type: 0x11, c: 10 + c, r: 16 }, { type: 0x11, c: 10 + c, r: 22 }]).flat() },
  brickWall: { name: "кирпичная стена", tiles: Array.from({ length: 10 }, (_, c) => ({ type: 0x0f, c: 14 + c, r: 14 })) },
  maze: { name: "лабиринт/кирпичи", tiles: Array.from({ length: 200 }, () => ({ type: 0x0f, c: 1 + Math.floor(Math.random() * 30), r: 2 + Math.floor(Math.random() * 26) })) },
  prize: { name: "приз в центре", tiles: [], prize: { id: 3, x: 128, y: 112 } }, // звезда (уровень)
  prizeNearBase: { name: "приз у базы", tiles: [], prize: { id: 5, x: 104, y: 200 } }, // жизнь
  fortifiedEagle: { name: "укреплённый орёл", tiles: [
    ...Array.from({ length: 6 }, (_, c) => ({ type: 0x11, c: 12 + c, r: 26 })),
    ...Array.from({ length: 6 }, (_, c) => ({ type: 0x11, c: 12 + c, r: 29 })),
  ].flat() },
};

for (const key of Object.keys(LAYOUTS)) {
  console.log(`\n=== ${LAYOUTS[key].name} ===`);
  for (const mode of ["asm", "js"]) console.log(JSON.stringify(run(mode, LAYOUTS[key])));
}
