// golden-state.js — deterministic game-state harness.
//
// Purpose: guarantee "no side effects". A fixed input script
// is run on the emulator, and every snapshotEvery frames a full image of
// RAM (0x0000-0x07FF) + key registers is captured. The resulting sequence of hashes is the
// reference (golden). Any change (ASM patch or JS logic) that alters state
// even in an "untouched" region will produce a mismatch and be caught.
//
// Relative path: ./qa/golden-state.js
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import PvPNes, { BTN } from "../emulator-core/pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = join(__dirname, "golden");
export const ROM = join(__dirname, "..", "rom", "disasm", "_battle_city.nes");

// FNV-1a 32 (as in the core)
function fnv(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return ("00000000" + h.toString(16)).slice(-8);
}

// Full image of the "determinizing" state: RAM 0x0000-0x07FF + cartridge.
function snapshot(emu) {
  const mem = emu.cpu.mem;
  const ram = new Uint8Array(0x0800);
  for (let i = 0; i < 0x0800; i++) ram[i] = mem[i];
  return fnv(ram);
}

// Fixed deterministic input script — solo mode as the attackers:
//  auto-start -> auto-respawn of the player tank -> movement (left/up) -> shooting.
export function runScript(emu, opts = {}) {
  const { frames = 1800, snapshotEvery = 60 } = opts;
  const hashes = [];
  let frame = 0;
  let started = false;

  const phase = { state: "autoStart", until: null };

  for (let f = 0; f < frames; f++) {
    frame++;
    if (emu.cpu.mem[0x80] !== 0xff) started = true;

    // phase 1: auto-start — Start on port 0 until the battle begins
    // phase 2: auto-respawn of tank 2 — Start on port 2 while not alive
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    const attAlive = hi >= 0x90 && hi <= 0xd0;

    let buttons = 0;
    // phase 3+ (after the battle starts and the tank is alive): control
    if (started && attAlive) {
      const t = frame % 900;
      if (t < 300) buttons = BTN.Left;
      else if (t < 600) buttons = BTN.Up;
      else buttons = BTN.A; // fire
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

// Save/load golden.
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

// Compare the actual run against the reference; returns a list of mismatches.
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

// Run with the reference: if golden is missing — create it; otherwise compare.
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
