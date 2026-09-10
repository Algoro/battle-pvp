// strategy-eval-worker.mjs — воркер (worker_threads) для прогона одного (конфиг, уровень).
// Получает workerData { cfg, level, max, attAI, defMode }. Ставит конфиг ИИ, гоняет эмулятор,
// возвращает { variant, level, kills, hq, outcome, frames, enemiesLeft }.
import { parentPort, workerData } from "node:worker_threads";
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { setStrategyConfig } from "../emulator-core/ai/defender-strategy.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;

function run(variant, level, max, attAI, defMode) {
  setStrategyConfig(variant.cfg ?? {});
  const emu = new PvPNes({ attAI, defAI: "strategy", defMode, aiEvery: 1, noRender: true });
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
  const m = emu.cpu.mem;
  let guard = 0;
  while (m[0x85] < level && guard++ < 60) {
    for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= level) break; }
    for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== level) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
  }
  let kills = 0, hq = true, outcome = "timeout", frames = 0, prevLeft = m[0x80];
  for (let fr = 0; fr < max; fr++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    frames++;
    const left = m[0x80];
    if (left < prevLeft) kills += prevLeft - left;
    prevLeft = left;
    if (m[0x400 + 26 * 32 + 14] >= 0xcc || m[0x400 + 27 * 32 + 15] >= 0xcc) hq = false;
    if (!hq) { outcome = "game_over"; break; }
    if (left === 0 && m[0x7f] === 0 && m[0x82] === 0) { outcome = "stage_clear"; break; }
    if (m[0x85] !== level || m[0x68] !== 0x80) { outcome = "end"; break; }
  }
  return { variant: variant.name, level, kills, hq, outcome, frames, enemiesLeft: m[0x80] };
}

const r = run(workerData.variant, workerData.level, workerData.max, workerData.attAI, workerData.defMode);
parentPort.postMessage(r);
