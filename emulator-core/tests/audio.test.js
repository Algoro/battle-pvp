// audio.test.js — звук из APU jsnes без правок ядра: эмиссия сэмплов, гейт на время
// переигровки, независимость от детерминизма (getFrameHash).
// Запуск: node --test tests/audio.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function makeEmu(onSample) {
  const emu = new PvPNes({ patchSet: "pvp", sampleRate: 48000, onAudioSample: onSample });
  emu.loadROM(ROM);
  return emu;
}

test("аудио: APU эмитит ненулевые сэмплы при sampleRate=48000", () => {
  let n = 0, nonzero = 0, peak = 0;
  const emu = makeEmu((l, r) => {
    n++;
    if (l !== 0 || r !== 0) nonzero++;
    peak = Math.max(peak, Math.abs(l));
  });
  for (let f = 0; f < 120; f++) emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }]);
  assert.ok(n > 1000, `мало сэмплов: ${n}`);
  assert.ok(nonzero > 0, "все сэмплы нулевые");
  assert.ok(peak > 0.01, `пик слишком мал: ${peak}`);
});

test("аудио: гейт глушит сэмплы во время переигровки", () => {
  let n = 0;
  const emu = makeEmu(() => { n++; });
  for (let f = 0; f < 60; f++) emu.stepFrame([{ port: 0, buttons: 0x40 }]);
  assert.ok(n > 0, "нет сэмплов до гейта");

  emu.setAudioSuppressed(true);
  const n1 = n;
  for (let f = 0; f < 10; f++) emu.stepFrame([{ port: 0, buttons: 0x80 }]);
  assert.strictEqual(n, n1, "сэмплы эмитятся при включённом гейте");

  emu.setAudioSuppressed(false);
  emu.stepFrame([{ port: 0, buttons: 0x10 }]);
  assert.ok(n > n1, "звук не вернулся после снятия гейта");
});

test("аудио: включение звука не меняет детерминизм (getFrameHash)", () => {
  const inputs = (f) => [{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0 }, { port: 2, buttons: (f * 7) & 0x0f }];
  const off = new PvPNes({ patchSet: "pvp", sampleRate: 0, onAudioSample: null });
  off.loadROM(ROM);
  const on = makeEmu(() => {});
  for (let f = 0; f < 300; f++) { off.stepFrame(inputs(f)); on.stepFrame(inputs(f)); }
  assert.strictEqual(on.getFrameHash(), off.getFrameHash());
});

test("аудио: раздельные группы music/sfx маршрутизируются", () => {
  const got = { music: 0, sfx: 0 };
  const emu = new PvPNes({
    patchSet: "pvp", sampleRate: 48000,
    onAudioSampleGroup: (g) => { got[g] = (got[g] || 0) + 1; },
  });
  emu.loadROM(ROM);
  for (let f = 0; f < 120; f++) emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? 0x08 : 0x40 }]);
  assert.ok(got.music > 1000, `нет сэмплов music: ${got.music}`);
  assert.ok(got.sfx > 1000, `нет сэмплов sfx: ${got.sfx}`);
});

test("аудио: гейт глушит обе группы", () => {
  const got = { music: 0, sfx: 0 };
  const emu = new PvPNes({ patchSet: "pvp", sampleRate: 48000, onAudioSampleGroup: (g) => { got[g]++; } });
  emu.loadROM(ROM);
  for (let f = 0; f < 30; f++) emu.stepFrame([{ port: 0, buttons: 0x10 }]);
  emu.setAudioSuppressed(true);
  const m = got.music, s = got.sfx;
  for (let f = 0; f < 10; f++) emu.stepFrame([{ port: 0, buttons: 0x80 }]);
  assert.strictEqual(got.music, m, "music эмитится при гейте");
  assert.strictEqual(got.sfx, s, "sfx эмитится при гейте");
});
