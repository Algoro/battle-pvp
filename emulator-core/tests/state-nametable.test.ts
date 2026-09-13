// state-nametable.test.js — regression: binary saveState/loadState must restore the
// PPU RENDER cache (nameTable[].tile/attrib), not just vramMem/$0400. Otherwise after
// rollback destroyed bricks "hang" on screen (an online bug).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes"));

function started(rom) {
  const g = new PvPNes({ attAI: "lookahead", defAI: "plan" });
  g.loadROM(rom);
  let s = false;
  for (let f = 1; f <= 1200 && !s; f++) {
    g.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 8 : 0 }]);
    if (g.cpu.mem[0x80] !== 0xff) s = true;
  }
  return g;
}

test("saveState/loadState восстанавливает nameTable (рендер PPU)", () => {
  const a = started(ROM);
  const snap = a.saveState();
  const before = a.ppu.nameTable.map((nt) => Array.from(nt.tile));

  // "Corrupt" the render cache (as simulation frames do), then roll back.
  const g2 = started(ROM);
  g2.loadState(snap);
  for (let i = 0; i < 64; i++) g2.stepFrame([{ port: 0, buttons: 0 }]);
  g2.loadState(snap);

  const after = g2.ppu.nameTable.map((nt) => Array.from(nt.tile));
  assert.deepStrictEqual(after, before, "nameTable после loadState не совпадает с исходным");
});

test("snapshot общего состояния: nameTable и vramMem согласованы между клиентами", () => {
  const a = started(ROM);
  const b = started(ROM);
  b.loadState(a.saveState());
  for (const nt of [0, 1, 2, 3]) {
    assert.deepStrictEqual(Array.from(b.ppu.nameTable[nt].tile), Array.from(a.ppu.nameTable[nt].tile), `nameTable[${nt}]`);
    assert.deepStrictEqual(Array.from(b.ppu.nameTable[nt].attrib), Array.from(a.ppu.nameTable[nt].attrib), `attrib[${nt}]`);
  }
  assert.deepStrictEqual(Array.from(b.ppu.vramMem), Array.from(a.ppu.vramMem), "vramMem");
});

test("saveState/loadState побайтово сохраняет Uint16Array (PPU vramMirrorTable)", () => {
  const a = started(ROM);
  const before = Uint16Array.from(a.ppu.vramMirrorTable);
  const snap = a.saveState();
  // corrupt and restore
  a.ppu.vramMirrorTable[0x225d] = 0xffff;
  a.ppu.vramMirrorTable[0x2000] = 0x1234;
  a.loadState(snap);
  assert.deepStrictEqual(Uint16Array.from(a.ppu.vramMirrorTable), before, "vramMirrorTable повреждён (поэлементный set вместо побайтового)");
});
