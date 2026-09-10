// desync-trace.mjs — детальная диагностика рассинхрона f3875.
// Печатает состояние танка2 (сим vs эмул), все пули и поле вокруг танка2
// на кадре расхождения, а также события симулятора за кадр.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { BattleSim } from "../emulator-core/sim/battle.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const FRAMES = parseInt(process.argv[2] ?? "3880", 10);
const TARGET = parseInt(process.argv[3] ?? "-1", 10);

const emu = new PvPNes({ attAI: "asm", defAI: "plan", defMode: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }

const m = emu.cpu.mem;
const tanks = [];
for (let t = 0; t < 8; t++) tanks.push({ index: t, team: t < 2 ? "DEF" : "ATT", x: m[0x90 + t], y: m[0x98 + t], dir: m[0xa0 + t] & 3, flag: m[0xa0 + t], type: m[0xa8 + t], alive: m[0xa0 + t] !== 0 });
const bullets = [];
for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if ((s & 0xf0) === 0x40) bullets.push({ slot: t, owner: t, team: t < 2 ? "DEF" : "ATT", x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 3, alive: true }); }
const sim = new BattleSim({
  field: m.slice(0x400, 0x400 + 1024), tanks, bullets,
  counters: { spawnTimer: m[0x82], spawnInterval: m[0x84] || 8, spawnCount: m[0x7f], spawnPosIndex: m[0x6a], typeOffset: m[0x8f], stage: m[0x85], enemiesLeft: m[0x80], limit: m[0x6c], frmCntLo: m[0x0b], frmCntHi: m[0x0a], clock: m[0x100] },
  rngState: m[0x0f], frame: m[0x0b] + m[0x0a] * 256, typeCnt: [m[0x8b], m[0x8c], m[0x8d], m[0x8e]],
  p1: { x: m[0x90], y: m[0x98], alive: m[0xa0] !== 0 }, p2: { x: m[0x91], y: m[0x99], alive: m[0xa1] !== 0 },
});
sim._trace = []; sim._rngCtx = "?";

let prevB = m[0x0b];
function dump(f, tag) {
  console.log(`\n===== f${f} ${tag} =====`);
  // танк2
  const s2 = sim.tanks.find((t) => t.index === 2);
  console.log(`танк2: эмул флаг=0x${m[0xa0 + 2].toString(16)} поз=(${m[0x90 + 2]},${m[0x98 + 2]}) | сим флаг=0x${(s2?.flag ?? -1).toString(16)} поз=(${s2?.x},${s2?.y})`);
  // все танки (враги)
  for (let t = 2; t < 8; t++) {
    const st = sim.tanks.find((x) => x.index === t);
    console.log(`  враг${t}: эмул флаг=0x${m[0xa0 + t].toString(16)}@(${m[0x90 + t]},${m[0x98 + t]}) | сим флаг=0x${(st?.flag ?? -1).toString(16)}@(${st?.x},${st?.y})`);
  }
  // пули эмул
  console.log("  пули эмул:");
  for (let t = 0; t < 8; t++) { const s = m[0xcc + t]; if (s) console.log(`    t${t}: status=0x${s.toString(16)} @(${m[0xb8 + t]},${m[0xc2 + t]})`); }
  // пули сим
  console.log("  пули сим:");
  for (const b of sim.bullets) if (b.alive) console.log(`    slot${b.slot}: dir=${b.dir} @(${b.x},${b.y}) owner=${b.owner}`);
  // поле вокруг танка2 (rows 25-29, cols 10-15)
  const cx = Math.floor((s2?.x ?? m[0x90 + 2]) / 8), cy = Math.floor((s2?.y ?? m[0x98 + 2]) / 8);
  for (let r = Math.max(0, cy - 3); r <= Math.min(31, cy + 3); r++) {
    let row = "";
    for (let c = Math.max(0, cx - 3); c <= Math.min(31, cx + 3); c++) {
      const e = m[0x400 + r * 32 + c] & 0x7f, s = sim.field[r * 32 + c] & 0x7f;
      row += `(${c},${r}):${e.toString(16)}${e !== s ? `!${s.toString(16)}` : "  "} `;
    }
    console.log("  " + row);
  }
}

for (let f = 0; f < FRAMES; f++) {
  const def = { x0: m[0x90], y0: m[0x98], f0: m[0xa0], x1: m[0x91], y1: m[0x99], f1: m[0xa1] };
  sim._trace = [];
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  sim.frame = m[0x0b] + m[0x0a] * 256;
  if (m[0x0b] < prevB) sim.c.gateFrmLo = (prevB + 1) & 0xff; else sim.c.gateFrmLo = m[0x0b];
  prevB = m[0x0b];
  sim.p1 = { x: def.x0, y: def.y0, alive: def.f0 !== 0 };
  sim.p2 = { x: def.x1, y: def.y1, alive: def.f1 !== 0 };
  for (const t of [0, 1]) { const st = sim.tanks.find((x) => x.index === t); if (st) { st.flag = def[`f${t}`]; st.x = def[`x${t}`]; st.y = def[`y${t}`]; st.type = m[0xa8 + t]; st.alive = def[`f${t}`] !== 0; } }
  if (f === TARGET) dump(f, "ДО step (пре-кадр)");
  const ev = sim.step();
  if (f === TARGET) {
    dump(f, "ПОСЛЕ step");
    console.log("\nсобытия сим за кадр:", JSON.stringify(ev));
    console.log("rng сим за кадр:", JSON.stringify(sim._trace.map((x) => x.c)));
  }
}
