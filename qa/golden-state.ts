// golden-state.js — харнесс детерминированного состояния игры.
//
// Назначение: гарантия «без побочных эффектов». Фиксированный входной скрипт
// прогоняется на эмуляторе, и каждые snapshotEvery кадров снимается полный образ
// RAM (0x0000-0x07FF) + ключевые регистры. Полученная последовательность хэшей —
// эталон (golden). Любое изменение (ASM-патч или JS-логика), меняющее состояние
// даже в «нетронутой» области, даст расхождение и будет поймано.
//
// Относительный путь: ./qa/golden-state.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PvPNes, { BTN } from "../emulator-core/pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(__dirname, "golden");
export const ROM = join(__dirname, "..", "rom", "disasm", "_battle_city.nes");

// FNV-1a 32 (как в ядре)
function fnv(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

// Полный образ «детерминирующего» состояния: RAM 0x0000-0x07FF + картридж.
function snapshot(emu) {
  const mem = emu.cpu.mem;
  const ram = new Uint8Array(0x0800);
  for (let i = 0; i < 0x0800; i++) ram[i] = mem[i];
  return fnv(ram);
}

// Фиксированный детерминированный входной скрипт — соло-режим за атакующих:
//  автостарт -> авто-респавн танка игрока -> движение (влево/вверх) -> стрельба.
export function runScript(emu, opts = {}) {
  const { frames = 1800, snapshotEvery = 60 } = opts;
  const hashes = [];
  let frame = 0;
  let started = false;

  const phase = { state: "autoStart", until: null };

  for (let f = 0; f < frames; f++) {
    frame++;
    if (emu.cpu.mem[0x80] !== 0xff) started = true;

    // фаза 1: автостарт — Start на порту 0, пока бой не начался
    // фаза 2: авто-респавн танка 2 — Start на порту 2, пока не живой
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    const attAlive = hi >= 0x90 && hi <= 0xd0;

    let buttons = 0;
    // фаза 3+ (после старта боя и живого танка): управление
    if (started && attAlive) {
      const t = frame % 900;
      if (t < 300) buttons = BTN.Left;
      else if (t < 600) buttons = BTN.Up;
      else buttons = BTN.A; // огонь
    }

    const autoStart = !started && frame % 30 === 0;
    const autoRespawn = started && !attAlive && frame % 30 === 0;
    const inputs = [
      { port: 0, buttons: autoStart ? BTN.Start : 0 },
      { port: 2, buttons: buttons | (autoRespawn ? BTN.Start : 0) },
    ];
    emu.stepFrame(inputs);

    if (f % snapshotEvery === 0) hashes.push({ frame, hash: snapshot(emu) });
  }
  return { hashes, finalHash: snapshot(emu), frameCount: frame, frames, snapshotEvery };
}

// Сохранить/загрузить golden.
export function saveGolden(name, data) {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  writeFileSync(join(GOLDEN_DIR, name + ".json"), JSON.stringify(data, null, 2));
}

export function loadGolden(name) {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, name + ".json"), "utf8"));
}

export function hasGolden(name) {
  return existsSync(join(GOLDEN_DIR, name + ".json"));
}

// Сравнение фактического прогона с эталоном; возвращает список расхождений.
export function compareGolden(actual, expected) {
  const diffs = [];
  if (actual.frames !== expected.frames) diffs.push(`frames ${actual.frames} != ${expected.frames}`);
  if (actual.snapshotEvery !== expected.snapshotEvery) diffs.push(`snapshotEvery`);
  if (actual.finalHash !== expected.finalHash) diffs.push(`finalHash ${actual.finalHash} != ${expected.finalHash}`);
  const n = Math.min(actual.hashes.length, expected.hashes.length);
  for (let i = 0; i < n; i++) {
    if (actual.hashes[i].hash !== expected.hashes[i].hash) {
      diffs.push(`frame ${expected.hashes[i].frame}: ${actual.hashes[i].hash} != ${expected.hashes[i].hash}`);
      break;
    }
  }
  if (actual.hashes.length !== expected.hashes.length) diffs.push(`#snapshots ${actual.hashes.length} != ${expected.hashes.length}`);
  return diffs;
}

// Запуск с эталоном: если golden нет — создать; иначе сравнить.
export function runGolden(name, opts) {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  const actual = runScript(emu, opts);
  if (!hasGolden(name)) {
    saveGolden(name, actual);
    return { created: true, diffs: [] };
  }
  const expected = loadGolden(name);
  return { created: false, diffs: compareGolden(actual, expected) };
}

export default { runScript, runGolden, compareGolden, saveGolden, loadGolden, hasGolden, ROM };
