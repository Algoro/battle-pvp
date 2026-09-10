// diag-gate.mjs — лог $0B при sub_DC3D (статус каждого танка) в эмуляторе.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const emu = new PvPNes({ attAI: "plan", defAI: "plan", defMode: "active", aiEvery: 1, noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
const m = emu.cpu.mem;
let guard = 0;
while (m[0x85] < 1 && guard++ < 60) {
  for (let f = 0; f < 20000; f++) { m[0x80] = 0; emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] >= 1) break; }
  for (let f = 0; f < 5000; f++) { emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); if (m[0x85] !== 1) break; if (m[0x80] === 20 && m[0x82] !== 0) break; }
}
// Хук sub_DC3D: логируем кадр, X (танк), $0B, флаг при вызове статуса
const calls = [];
emu.setPcHook(0xdc3d, (cpu) => {
  calls.push({ frame: emu._frame, frmLo: cpu.mem[0x0b], tank: cpu.REG_X, flag: cpu.mem[0xa0 + cpu.REG_X] });
});
for (let f = 0; f < 12; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
console.log("Кадр | $0B(вызов) | танк1 статус-вызовы (эмулятор)");
// для каждого кадра: какие статусы танка 1 вызваны и с каким $0B
const byFrame = new Map();
for (const c of calls) { if (!byFrame.has(c.frame)) byFrame.set(c.frame, []); byFrame.get(c.frame).push(c); }
for (let f = 0; f < 12; f++) {
  const list = (byFrame.get(f) ?? []).filter((c) => c.tank === 1);
  const desc = list.map((c) => `0x${c.frmLo.toString(16)}/flag=0x${c.flag.toString(16)}`).join(" ");
  console.log(`f${f}: ${desc || "(нет статуса)"}`);
}
console.log("\nВсе вызовы танка 1 (кадр: $0B → flag):");
for (const c of calls) if (c.tank === 1) console.log(`  f${c.frame}: $0B=0x${c.frmLo.toString(16)} flag=0x${c.flag.toString(16)}`);
