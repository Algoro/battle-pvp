// sim-verify3.mjs — автоматическая покадровая сверка событий:
// пассивный наблюдатель (эмулятор) vs GameSim (симулятор) на сценарии «выстрел
// в кирпич». Наблюдатель только читает mem и не влияет на ИИ/игру.
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { EmuObserver } from "../emulator-core/sim/observer.js";
import { GameSim } from "../emulator-core/sim/engine.js";
import { buildState } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;

const emu = new PvPNes({ attAI: "asm", defAI: "none", noRender: true });
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) emu.cpu.mem[0x400 + r * 32 + c] = 0x00;
emu.cpu.mem[0x400 + 13 * 32 + 8] = 0x0f;
for (let t = 1; t < 8; t++) { emu.cpu.mem[0xa0 + t] = 0; emu.cpu.mem[0x90 + t] = 255; emu.cpu.mem[0x98 + t] = 255; }
emu.cpu.mem[0x90] = 64; emu.cpu.mem[0x98] = 136; emu.cpu.mem[0xa0] = 0xa0;
const obs = new EmuObserver(emu);

// симулятор: то же поле и танк
const s = buildState({ field: Array.from({ length: 32 }, () => "." .repeat(32)) });
const field = s.mem.subarray(0x400, 0x400 + 1024).slice();
field[13 * 32 + 8] = 0x0f;
const sim = new GameSim({ field, tanks: [{ index: 0, x: 64, y: 136, dir: 0, team: "DEF" }], bullets: [] });
const st = sim.tanks[0];
sim.fireTank(st, 0);

let emuHit = -1, simHit = -1;
for (let f = 0; f < 30; f++) {
  // эмулятор: стреляем, наблюдатель читает события кадра
  const fire = emu.cpu.mem[0xcc] === 0 ? BTN.A : 0;
  emu.stepFrame([{ port: 0, buttons: fire }, { port: 1, buttons: 0 }]);
  const emuEv = obs.flush();
  if (emuHit < 0 && emuEv.some((e) => e.type === "bulletHitBrick" && e.tileBefore === 0x0f)) emuHit = f;
  // симулятор
  sim.step();
  if (simHit < 0 && sim.fieldTile(8, 13) === 0x03) simHit = f;
}
console.log(`Кадр разрушения кирпича (0x0f->0x03): наблюдатель(эмулятор)=${emuHit}, GameSim=${simHit} | ${emuHit === simHit ? "OK — покадрово идентично" : "НЕ СОВПАЛО"}`);
