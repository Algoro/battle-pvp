// stage.test.js — данные стадий из ROM и выбор стартовой стадии.
// Запуск: node --test tests/stage.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.js";
import { readStageBlocks, normalizeStage, readBlockTiles, STAGE_COUNT, STAGE_BLOCKS } from "../io/stage-data.js";
import ROMClass from "../src/rom.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function loadedRom() {
  const rom = new ROMClass(null);
  rom.load(ROM);
  return rom;
}

test("stage-data: 35 стадий по 169 блоков, стадии различаются", () => {
  const rom = loadedRom();
  const s1 = readStageBlocks(rom, 1);
  const s2 = readStageBlocks(rom, 2);
  assert.strictEqual(STAGE_COUNT, 35);
  assert.strictEqual(s1.length, STAGE_BLOCKS);
  // stage_01 начинается с байта 0xDD -> два пустых блока (0xD)
  assert.strictEqual(s1[0], 0x0d);
  assert.strictEqual(s1[1], 0x0d);
  assert.notDeepStrictEqual(Array.from(s1), Array.from(s2));
});

test("stage-data: нормализация номера стадии (зацикливание)", () => {
  assert.strictEqual(normalizeStage(0), 1);
  assert.strictEqual(normalizeStage(1), 1);
  assert.strictEqual(normalizeStage(35), 35);
  assert.strictEqual(normalizeStage(36), 1);
  assert.strictEqual(normalizeStage(37), 2);
});

test("PvPNes: стартовая стадия внедряется детерминированно", () => {
  const run = (stage) => {
    const emu = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 });
    emu.loadROM(ROM);
    emu.setStartStage(stage);
    let started = false;
    for (let f = 1; f <= 1200 && !started; f++) {
      emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
      if (emu.readMem(0x80) !== 0xff) started = true;
    }
    for (let f = 0; f < 30; f++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    return { stage: emu.readMem(0x85), hash: emu.getFrameHash() };
  };
  const one = run(1);
  const five = run(5);
  assert.strictEqual(one.stage, 1);
  assert.strictEqual(five.stage, 5);
  assert.notStrictEqual(one.hash, five.hash, "разные стадии должны давать разное состояние");
});

test("stage-data: раскладка блоков совпадает с реальным полем (PPU nametable)", () => {
  const emu = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 });
  emu.loadROM(ROM);
  emu.setStartStage(1);
  let started = false;
  for (let f = 1; f <= 1200 && !started; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
    if (emu.readMem(0x80) !== 0xff) started = true;
  }
  for (let f = 0; f < 5; f++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  const nt = emu.ppu.nameTable[0];
  const st = emu.getStage(1);
  let match = 0;
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const tl = readBlockTiles(emu.rom, st.blocks[row * 13 + col])[0] & 0xff;
      if ((nt.getTileIndex(2 + col * 2, 2 + row * 2) & 0xff) === tl) match++;
    }
  }
  // допускаем пару отличий в зоне орла/базы
  assert.ok(match >= 160, `совпадение с полем слишком низкое: ${match}/169`);
});

test("PvPNes: выбранная стадия реально отрисована (поле, а не только ram_stage)", () => {
  const emu = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 });
  emu.loadROM(ROM);
  emu.setStartStage(5);
  let started = false;
  for (let f = 1; f <= 1500 && !started; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
    if (emu.readMem(0x80) !== 0xff) started = true;
  }
  for (let f = 0; f < 5; f++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  const nt = emu.ppu.nameTable[0];
  const st5 = emu.getStage(5);
  let match = 0;
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const tl = readBlockTiles(emu.rom, st5.blocks[row * 13 + col])[0] & 0xff;
      if ((nt.getTileIndex(2 + col * 2, 2 + row * 2) & 0xff) === tl) match++;
    }
  }
  assert.ok(match >= 160, `нарисованное поле не соответствует стадии 5: ${match}/169`);
});

test("PvPNes: стартовые звёзды DEF применяются при спавне (ram_tank_type)", () => {
  const run = (stars) => {
    const emu = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 });
    emu.loadROM(ROM);
    emu.setStartStage(1);
    emu.setStartStars(stars);
    emu.setHumanDefTank(0);
    let started = false;
    for (let f = 1; f <= 1500 && !started; f++) {
      emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
      if (emu.readMem(0x80) !== 0xff) started = true;
    }
    let typeAt = null;
    for (let f = 0; f < 300 && typeAt === null; f++) {
      emu.stepFrame([{ port: 0, buttons: 0 }]);
      const hi = emu.readMem(0xa0) & 0xf0;
      if (hi >= 0x80 && hi <= 0xd0) typeAt = emu.readMem(0xa8);
    }
    return { up1: emu.readMem(0x101), type1: typeAt ?? -1, hash: emu.getFrameHash() };
  };
  const zero = run(0);
  const three = run(3);
  assert.strictEqual(zero.up1, 0);
  assert.strictEqual(three.up1, 0x60);
  assert.strictEqual(three.type1 & 0x60, 0x60, "ram_tank_type не получил апгрейд");
  assert.strictEqual(zero.type1 & 0x60, 0, "без звёзд апгрейда быть не должно");
});
