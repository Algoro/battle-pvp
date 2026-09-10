// demo-sim.ts — симулятор GameSim как игровой движок (без NES-эмулятора).
// Драйвер: спавн врагов, их движение к базе, стрельба защитников, пули.
// @ts-nocheck
import { GameSim } from "../../emulator-core/sim/engine.js";
import { canLead } from "../../emulator-core/sim/sim-model.js";

const canvas = document.getElementById("screen");
const ctx = canvas.getContext("2d");
canvas.width = 256; canvas.height = 240;
const hud = document.getElementById("hud");

// поле: проходимое, база внизу, пара кирпичей
const field = new Uint8Array(32 * 32);
field[27 * 32 + 15] = 0xc8; field[28 * 32 + 15] = 0xc8;
field[13 * 32 + 8] = 0x0f; field[13 * 32 + 9] = 0x0f;
field[13 * 32 + 22] = 0x0f; field[13 * 32 + 23] = 0x0f;

const tanks = [
  { index: 0, x: 88, y: 216, dir: 0, team: "DEF", type: 0, alive: true, flag: 0xa0 },
  { index: 1, x: 152, y: 216, dir: 0, team: "DEF", type: 0, alive: true, flag: 0xa0 },
];
const sim = new GameSim({ field, tanks, bullets: [] }, () => 0);
const spawnState = { timer: 0, count: 14, limit: 4, interval: 4, posIndex: 0, stage: 1, typeOffset: 0 };
const navState = { frmCntHi: 0, interval: 4, p1x: 88, p1y: 216, p2x: 152, p2y: 216, p1Alive: true, p2Alive: false };

let shot = 0;
function stepFrame() {
  sim.frame = sim.frame + 1;
  if (sim.frame % 40 === 0) {
    for (const t of sim.tanks) if (t.team === "DEF" && t.alive) { sim.bullets.push({ tank: t.index, team: "DEF", x: t.x, y: t.y - 8, dir: 0, alive: true }); shot++; }
  }
  for (const b of sim.bullets) if (b.alive && b.team === "DEF") sim._moveBullet(sim, b);
  for (const b of sim.bullets) if (b.alive && b.team === "ATT") sim._moveBullet(sim, b);
  sim.spawnEnemy(spawnState);
  for (const t of sim.tanks) if (t.team === "ATT" && t.alive) sim.stepEnemy(t, navState);
}

function render() {
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 256, 240);
  for (let i = 0; i < field.length; i++) {
    const v = field[i]; if (v === 0) continue;
    const x = (i % 32) * 8, y = ((i / 32) | 0) * 8;
    ctx.fillStyle = v === 0x0f ? "#c66" : v >= 0xc8 ? "#6a6" : v === 0x11 ? "#999" : "#666";
    ctx.fillRect(x, y, 8, 8);
  }
  for (const t of sim.tanks) {
    if (!t.alive || t.x > 254) continue;
    ctx.fillStyle = t.team === "DEF" ? "#4f4" : "#f44";
    ctx.fillRect(t.x - 6, t.y - 6, 13, 13);
  }
  for (const b of sim.bullets) if (b.alive) { ctx.fillStyle = "#ff4"; ctx.fillRect(b.x - 2, b.y - 2, 4, 4); }
}

let acc = 0, last = performance.now();
function tick(now) {
  const dt = now - last; last = now; acc += dt;
  while (acc >= 1000 / 60) { stepFrame(); acc -= 1000 / 60; }
  render();
  const alive = sim.tanks.filter((t) => t.team === "ATT" && t.alive).length;
  const baseOk = field[27 * 32 + 15] === 0xc8;
  hud.textContent =
    `Кадр: ${sim.frame}\n` +
    `Врагов на поле: ${alive} / спавнено: ${14 - spawnState.count}\n` +
    `Выстрелов защитников: ${shot}\n` +
    `База: ${baseOk ? "цела" : "РАЗРУШЕНА"}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
