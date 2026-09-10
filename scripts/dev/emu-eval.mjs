// emu-eval.mjs — оценка ИИ защитника (DEF) на ЭМУЛЯТОРЕ (настоящая игра).
// Запуск: node scripts/emu-eval.mjs [stage] [frames] [attAI] [defAI] [defMode]
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const TARGET = parseInt(process.argv[2] ?? "1", 10);
const MAX = parseInt(process.argv[3] ?? "6000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const DEF_AI = process.argv[5] ?? "plan";
const DEF_MODE = process.argv[6] ?? "active";

const emu = new PvPNes({ attAI: ATT_AI, defAI: DEF_AI, defMode: DEF_MODE, aiEvery: 1, noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < TARGET && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= TARGET) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== TARGET) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
let kills = 0, hq = true, outcome = "timeout", frames = 0, prevLeft = m[0x80];
const startLeft = m[0x80];
for (let fr = 0; fr < MAX; fr++) {
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  frames++;
  // убийства: enemiesLeft уменьшился
  const left = m[0x80];
  if (left < prevLeft) kills += prevLeft - left;
  prevLeft = left;
  // HQ
  if (m[0x400 + 26 * 32 + 14] >= 0xcc || m[0x400 + 27 * 32 + 15] >= 0xcc) hq = false;
  if (!hq) { outcome = "game_over"; break; }
  // stage clear: врагов не осталось и спавн пуст
  if (left === 0 && m[0x7f] === 0 && m[0x82] === 0) { outcome = "stage_clear"; break; }
  if (m[0x85] !== TARGET || m[0x68] !== 0x80) { outcome = "end"; break; }
}
console.log(`${ATT_AI}/${DEF_AI}(${DEF_MODE}) | ${outcome.padEnd(10)} | кадры ${String(frames).padEnd(5)} | убийств ${String(kills).padEnd(4)} | HQ ${hq ? "цел" : "разр."} | врагов осталось ${m[0x80]} | спавнено ${startLeft - m[0x80] + kills}`);
