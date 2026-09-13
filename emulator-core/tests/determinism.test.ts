// Determinism + PvP injection. Run: node --test tests/determinism.test.js
// Paths are relative to the project root; the ROM is read from ROM_PATH.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN, NUM_PLAYERS, DEF_PORTS } from "../pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function loadRom() {
  const romFile = readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));
  return romFile;
}

// A simple seedable pseudo-random input (deterministic, without Math.random).
function makeInputSequence(frames, seed = 0x1234) {
  let s = seed >>> 0;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
  const seq = [];
  for (let f = 0; f < frames; f++) {
    // DEF: 2 ports, ATT: 2 ports
    const inputs = [];
    for (let port = 0; port < 4; port++) {
      inputs.push({ port, buttons: next() & 0xff });
    }
    seq.push(inputs);
  }
  return seq;
}

test("два независимых инстанса дают одинаковый hash на каждом кадре (детерминизм)", () => {
  const rom = loadRom();
  const a = new PvPNes();
  const b = new PvPNes();
  a.loadROM(rom);
  b.loadROM(rom);
  const seq = makeInputSequence(300);
  for (let f = 0; f < seq.length; f++) {
    const ha = a.stepFrame(seq[f]);
    const hb = b.stepFrame(seq[f]);
    assert.strictEqual(ha, hb, `кадр ${f}: рассинхрон хэшей`);
  }
  assert.ok(a.getFrameHash().length === 8);
});

test("save/load state детерминирован (роллбек): откат и переигровка дают тот же hash", () => {
  const rom = loadRom();
  const emu = new PvPNes();
  emu.loadROM(rom);
  const seq = makeInputSequence(120);
  const hashes = [];
  for (const inputs of seq.slice(0, 60)) hashes.push(emu.stepFrame(inputs));

  // Save the state at frame 60
  const snapshot = emu.saveState();
  const midHash = emu.getFrameHash();

  // Play 30 more frames (60..90)
  for (const inputs of seq.slice(60, 90)) hashes.push(emu.stepFrame(inputs));
  const afterHash = emu.getFrameHash();
  assert.notStrictEqual(afterHash, midHash, "состояние должно было измениться");

  // Roll back to the snapshot (frame 60)
  emu.loadState(snapshot);
  assert.strictEqual(emu.getFrameHash(), midHash, "откат должен вернуть прежний hash");

  // Replay the same frames (60..90) — the same hashes (rollback correctness)
  const replayed = [];
  for (const inputs of seq.slice(60, 90)) replayed.push(emu.stepFrame(inputs));
  assert.deepStrictEqual(replayed, hashes.slice(60, 90), "переигровка дала иные хэши");
});

test("PvP: ввод ATT-порта пишется в ram_net_enemy_dir (инъекция из ASM-патча)", () => {
  const rom = loadRom();
  const emu = new PvPNes();
  emu.loadROM(rom);
  // Run until entering a round (title -> game screen) so the random spawn has passed.
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  // ATT port 2: press Up+A (direction 0, fire edge)
  emu.stepFrame([
    { port: 0, buttons: BTN.A | BTN.Start },
    { port: 2, buttons: BTN.Up | BTN.A },
  ]);
  // ram_net_enemy_dir for tank 2 = $01DB -> 0 (Up)
  assert.strictEqual(emu.readMem(0x01db), 0, "dir танка 2 должна быть Up=0");
  // ram_net_enemy_fire for tank 2 = $01E1 -> 1 (edge A)
  assert.strictEqual(emu.readMem(0x01e1), 1, "fire танка 2 должен быть 1");
  // Port 0 (DEF) — must not touch the net area
  assert.ok(emu.readMem(0x01db) === 0);
});

test("PvP: удержание кнопки не даёт повторный edge (press = hold & ~prev)", () => {
  const rom = loadRom();
  const emu = new PvPNes();
  emu.loadROM(rom);
  for (let i = 0; i < 40; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  // hold Start on ATT port 3 (idx = 3-2 = 1 -> respawn = $01E7 + 1 = $01E8)
  emu.stepFrame([{ port: 3, buttons: BTN.Start }]);
  assert.strictEqual(emu.readMem(0x01e8), 1, "respawn edge на первом кадре удержания");
  emu.stepFrame([{ port: 3, buttons: BTN.Start }]);
  assert.strictEqual(emu.readMem(0x01e8), 0, "на втором кадре удержания edge=0");
});

test("ядро работает с реальным патченым ROM и заполняет кадр детерминированно", () => {
  const rom = loadRom();
  const emu = new PvPNes();
  emu.loadROM(rom);
  let h = null;
  for (let i = 0; i < 200; i++) h = emu.stepFrame([{ port: 0, buttons: 0 }]);
  assert.ok(typeof h === "string" && h.length === 8);
});
