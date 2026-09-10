// test-utils.js — общие утилиты headless-эмуляции для QA-тестов.
// Навигация: титул -> выбор стадии -> игровой экран (en_left=20); ожидание врага.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../../emulator-core/pvp.js";

// RAM-адреса (см. reports/agent-reversing.md, bank_ram.inc)
export const ADDR = {
  enLeft: 0x80,
  stage: 0x85,
  pause: 0x6d,
  gameOver: 0x68,
  tankFlag: (t) => 0xa0 + t, // танк t
  tankX: (t) => 0x90 + t,
  tankY: (t) => 0x98 + t,
  netDir: 0x01db, // ram_net_enemy_dir
};

// Загружает патченый ROM и начинает игру (титул -> игра, en_left=20).
export function loadAndStart(romPath, maxStart = 12) {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(romPath));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < maxStart; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[ADDR.enLeft] === 20) return emu;
  }
  throw new Error("не удалось начать игру (en_left != 20)");
}

// Ждёт появления вражеского танка 2 в «живом/движущемся» состоянии И в поле
// (Y>48, т.е. минуя верхние спавн-ворота, где танк игнорирует направление).
// Флаги: 0x90-0xD0 активные; 0xE0/F0 респавн-мигание; 0x70/0x80 взрыв.
export function waitTank2InField(emu, maxFrames = 2500) {
  for (let f = 0; f < maxFrames; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    const hi = emu.cpu.mem[ADDR.tankFlag(2)] & 0xf0;
    if (hi >= 0x90 && hi <= 0xd0 && emu.cpu.mem[ADDR.tankY(2)] > 48) return true;
  }
  return false;
}

// Прогон кадров с заданными входами всех 8 портов (остальные 0).
export function runFrames(emu, frames, inputs = []) {
  const all = [];
  for (let p = 0; p < 8; p++) all.push({ port: p, buttons: 0 });
  for (const inp of inputs) all[inp.port] = inp;
  for (let f = 0; f < frames; f++) emu.stepFrame(all);
}
