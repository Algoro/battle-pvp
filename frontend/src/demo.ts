// demo.ts — живая демонстрация лучшей игры за защитников.
// asm-атакующие (оригинальный ИИ) против plan-защитников (наш ИИ).
// Рендер PPU в canvas 60fps, HUD со статистикой матча.
// @ts-nocheck
import PvPNes from "../../emulator-core/pvp.js";

const ROM_URL = import.meta.env.BASE_URL + "rom/battle_city.nes";
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
canvas.width = 256;
canvas.height = 240;

const alive = (nes: any, t: number) => {
  const h = nes.cpu.mem[0xa0 + t] & 0xf0;
  return h >= 0x90 && h <= 0xd0;
};
const eagleAlive = (nes: any) => {
  const f = nes.cpu.mem.subarray(0x400, 0x400 + 1024);
  for (let i = 0; i < 1024; i++) {
    const v = f[i];
    if (v >= 0xc8 && v <= 0xcb) return true;
  }
  return false;
};

function render(nes: any) {
  const buf = nes.ppu.buffer as Uint32Array;
  const img = ctx.createImageData(256, 240);
  const img32 = new Uint32Array(img.data.buffer);
  for (let i = 0; i < img32.length; i++) img32[i] = 0xff000000 | buf[i];
  ctx.putImageData(img, 0, 0);
}

async function main() {
  const res = await fetch(ROM_URL);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const nes = new PvPNes({ attAI: "asm", defAI: "plan", noRender: false });
  nes.loadROM(bytes);
  // старт игры (Start, пока en_left не инициализирован в 20)
  for (let i = 0; i < 60; i++) nes.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    nes.stepFrame([{ port: 0, buttons: 0x08 }]);
    for (let i = 0; i < 30; i++) nes.stepFrame([{ port: 0, buttons: 0 }]);
    if (nes.cpu.mem[0x80] === 20) break;
  }

  let defDeaths = 0, attDeaths = 0;
  const wd = [false, false], wa = new Array(6).fill(false);
  const startStage = nes.cpu.mem[0x85];

  const hudEl = document.getElementById("hud")!;
  function hud() {
    const over = !eagleAlive(nes);
    const won = nes.cpu.mem[0x85] !== startStage;
    const state = won ? "🏆 ПОБЕДА (уровень пройден)" : over ? "💀 ПОРАЖЕНИЕ (орёл пал)" : "⚔️ идёт бой";
    hudEl.textContent =
      `Состояние: ${state}\n` +
      `Кадр: ${nes._frame}\n` +
      `Врагов осталось: ${nes.cpu.mem[0x80]} / 20\n` +
      `Убито атакующих: ${attDeaths}\n` +
      `Потерь защитников: ${defDeaths}`;
  }

  const tick = () => {
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    for (let d = 0; d < 2; d++) { const a = alive(nes, d); if (wd[d] && !a) defDeaths++; wd[d] = a; }
    for (let i = 0; i < 6; i++) { const t = i + 2, a = alive(nes, t); if (wa[i] && !a) attDeaths++; wa[i] = a; }
    render(nes);
    hud();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main();
