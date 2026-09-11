// golden-replay.test.js — СЕРТИФИКАЦИЯ детерминизма ядра.
//
// Фиксирует поведение ROM+патч+ядро независимо от ИИ (attAI/defAI выключены):
//  1) golden-хэш сценария (любое изменение ядра/патча — осознанное);
//  2) save/load не меняет эволюцию (сериализация состояния корректна);
//  3) периодический save/load эквивалентен непрерывному прогону;
//  4) стартовые опции (стадия/звёзды) детерминированы.
// Запуск: node --test tests/golden-replay.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

// Golden-хэш ядра: ROM (original) + патч "pvp" + детерминированный сценарий, ИИ ВЫКЛ.
// Меняйте только осознанно (изменение ядра/патча/степпинга).
const GOLDEN_HASH = "34e8ff73";

function makeEmu() {
  const emu = new PvPNes({ patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 });
  emu.loadROM(ROM);
  return emu;
}

function preload(emu) {
  let started = false;
  for (let f = 1; f <= 1500 && !started; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
    if (emu.readMem(0x80) !== 0xff) started = true;
  }
  return started;
}

function rng(seed = 0x12345678) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >> 24) & 0xff;
}

function inputs(next) {
  return [{ port: 0, buttons: next() & 0x0f }, { port: 2, buttons: next() & 0x0f }];
}

test("golden: детерминированный сценарий ядра даёт ожидаемый хэш", () => {
  const emu = makeEmu();
  emu.setStartStage(1);
  emu.setStartStars(0);
  assert.ok(preload(emu), "партия не началась");
  const next = rng();
  for (let f = 0; f < 120; f++) emu.stepFrame(inputs(next));
  assert.strictEqual(emu.getFrameHash(), GOLDEN_HASH);
});

test("golden: два независимых инстанса сходятся покадрово", () => {
  const a = makeEmu(), b = makeEmu();
  a.setStartStage(1); b.setStartStage(1);
  assert.ok(preload(a) && preload(b));
  const n1 = rng(), n2 = rng();
  for (let f = 0; f < 180; f++) {
    a.stepFrame(inputs(n1));
    b.stepFrame(inputs(n2));
    assert.strictEqual(a.getFrameHash(), b.getFrameHash(), `кадр ${f}`);
  }
});

test("golden: save/load не меняет эволюцию состояния", () => {
  const a = makeEmu();
  a.setStartStage(1);
  assert.ok(preload(a));
  const next = rng();
  for (let f = 0; f < 60; f++) a.stepFrame(inputs(next));
  const snapshot = a.saveState();

  const n1 = rng(0xabcdef01);
  for (let f = 0; f < 60; f++) a.stepFrame(inputs(n1));
  const hashA = a.getFrameHash();

  a.loadState(snapshot);
  const n2 = rng(0xabcdef01);
  for (let f = 0; f < 60; f++) a.stepFrame(inputs(n2));
  const hashB = a.getFrameHash();

  assert.strictEqual(hashA, hashB, "после loadState эволюция отличается");
});

test("golden: периодический save/load эквивалентен непрерывному прогону", () => {
  const base = makeEmu(); base.setStartStage(1);
  const chk = makeEmu(); chk.setStartStage(1);
  assert.ok(preload(base) && preload(chk));
  const n1 = rng(0x0badf00d), n2 = rng(0x0badf00d);
  for (let f = 0; f < 200; f++) {
    base.stepFrame(inputs(n1));
    chk.stepFrame(inputs(n2));
    if (f % 25 === 0) {
      // round-trip состояния посреди прогона не должен менять эволюцию
      const snap = chk.saveState();
      chk.loadState(snap);
    }
    assert.strictEqual(chk.getFrameHash(), base.getFrameHash(), `кадр ${f}`);
  }
});

test("golden: стартовые стадия/звёзды детерминированы и влияют на состояние", () => {
  const run = (stage, stars) => {
    const emu = makeEmu();
    emu.setStartStage(stage);
    emu.setStartStars(stars);
    assert.ok(preload(emu));
    const next = rng(0xfeed);
    for (let f = 0; f < 60; f++) emu.stepFrame(inputs(next));
    return emu.getFrameHash();
  };
  assert.strictEqual(run(7, 3), run(7, 3), "одинаковые опции — разный хэш");
  assert.notStrictEqual(run(7, 3), run(7, 0), "звёзды не влияют на состояние");
  assert.notStrictEqual(run(7, 0), run(2, 0), "стадия не влияет на состояние");
});
