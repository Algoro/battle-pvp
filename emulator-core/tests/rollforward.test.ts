// rollforward.test.js — прогноз на реальном эмуляторе совпадает с фактическим будущим.
// Это основа для отказа от отдельной JS-модели (sim/*) в lookahead-предсказаниях.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";
import { EmulatorPredictor } from "../ai/rollforward.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function mk() {
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
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) >> 24) & 0xff; }

test("rollforward: предсказание эмулятора == реальное будущее", () => {
  const emu = mk(); preload(emu);
  const next = rng(0x42);
  for (let f = 0; f < 40; f++) emu.stepFrame([{ port: 0, buttons: next() & 0x0f }]);

  const state = emu.saveState();
  const predictInputs = rng(0x99);
  const predictor = new EmulatorPredictor(ROM);
  const predicted = predictor.predict(state, 60, () => [{ port: 0, buttons: predictInputs() & 0x0f }]);

  const actualInputs = rng(0x99);
  const actual = [];
  for (let f = 0; f < 60; f++) actual.push(emu.stepFrame([{ port: 0, buttons: actualInputs() & 0x0f }]));

  assert.deepStrictEqual(predicted.hashes, actual, "прогноз разошёлся с фактическим будущим");
  assert.strictEqual(predicted.finalHash, emu.getFrameHash());
});

test("rollforward: предсказание не портит исходное состояние", () => {
  const emu = mk(); preload(emu);
  const next = rng(0x7);
  for (let f = 0; f < 20; f++) emu.stepFrame([{ port: 0, buttons: next() & 0x0f }]);
  const before = emu.getFrameHash();
  const state = emu.saveState();
  const predictor = new EmulatorPredictor(ROM);
  predictor.predict(state, 120, () => [{ port: 0, buttons: 0x10 }]);
  assert.strictEqual(emu.getFrameHash(), before, "исходный инстанс изменился");
});
