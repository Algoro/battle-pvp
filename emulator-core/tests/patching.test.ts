// patching.test.js — in-memory патчинг ROM: воспроизведение собранного ROM, база,
// идемпотентность, ошибки линкера и детерминизм.
// Запуск: node --test tests/patching.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ROM from "../src/rom.js";
import PvPNes from "../pvp.ts";
import { applyPatchSet } from "../patching/apply.ts";
import { PatchError } from "../patching/errors.ts";
import { RomImage, fnv1a32, toHex32 } from "../patching/rom-image.ts";
import { composeSets, hex, jmp, jsrT, selfJmpT } from "../patching/descriptor.ts";
import { baseNrom } from "../patching/patches/base-nrom.ts";
import { pvp } from "../patching/patches/pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const ORIG = readFileSync(join(root, "rom", "original", "_battle_city.nes"));
const PATCHED = readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));

function prgOf(data) {
  const rom = new ROM(null);
  rom.load(data);
  return rom;
}

function prgFingerprintOf(data) {
  const rom = prgOf(data);
  return new RomImage(rom).fingerprint();
}

test("patching: набор 'pvp' на оригинале побайтово воспроизводит собранный ROM", () => {
  const rom = prgOf(ORIG);
  const report = applyPatchSet(rom, "pvp");
  assert.strictEqual(report.fingerprint, prgFingerprintOf(PATCHED), "отпечаток PRG не совпал");
  assert.strictEqual(report.fingerprint, "94cb0636");
  assert.deepStrictEqual(report.features, []); // база без опциональных фич
  // побайтовое сравнение PRG
  for (let b = 0; b < rom.romCount; b++) {
    for (let i = 0; i < 16384; i++) {
      assert.strictEqual(rom.rom[b][i], PATCHED[16 + b * 16384 + i], `PRG diff @bank${b}+0x${i.toString(16)}`);
    }
  }
});

test("patching: опциональные фичи меняют набор и fingerprint; неизвестная фича отвергается", () => {
  const repCore = applyPatchSet(prgOf(ORIG), "pvp");
  const repPistol = applyPatchSet(prgOf(ORIG), { base: "pvp", features: ["pistol"] });
  assert.deepStrictEqual(repPistol.features, ["pistol"]);
  assert.notStrictEqual(repPistol.fingerprint, repCore.fingerprint, "fingerprint должен зависеть от фич");
  // канонизация: порядок/дубли не влияют
  const repAgain = applyPatchSet(prgOf(ORIG), { base: "pvp", features: ["pistol", "pistol"] });
  assert.strictEqual(repAgain.fingerprint, repPistol.fingerprint);
  // неизвестная фича
  assert.throws(
    () => applyPatchSet(prgOf(ORIG), { base: "pvp", features: ["nope"] }),
    (e) => e instanceof PatchError && e.code === "PATCH_BAD_SET",
  );
});

test("patching: неверная база отвергается (BASE_MISMATCH)", () => {
  const rom = prgOf(ORIG);
  rom.rom[0][0x145d] ^= 0xff; // портим байт в PRG -> отпечаток не совпадёт
  assert.throws(() => applyPatchSet(rom, "pvp"), (e) => e instanceof PatchError && e.code === "PATCH_BASE_MISMATCH");
});

test("patching: повторное применение к тому же образу отвергается", () => {
  const rom = prgOf(ORIG);
  applyPatchSet(rom, "pvp");
  assert.throws(() => applyPatchSet(rom, "pvp"), (e) => e instanceof PatchError);
});

test("patching: EXPECT_FAILED без base-отпечатка (неверные исходные байты хука)", () => {
  const bare = composeSets({ id: "t", symbols: {}, free: [{ start: 0xef75, end: 0xefff }] }, pvp);
  const rom = prgOf(ORIG);
  rom.rom[0][0x145d] ^= 0xff; // портим байт в зоне expect хука prng
  assert.throws(() => applyPatchSet(rom, bare), (e) => e instanceof PatchError && e.code === "PATCH_EXPECT_FAILED");
});

test("patching: свободная зона защищена (NO_SPACE / OVERLAP)", () => {
  const bad = composeSets(baseNrom, {
    id: "bad",
    version: 1,
    routines: [{ symbol: "r", at: 0x8000, bytes: hex("EA") }],
    writes: [],
  });
  assert.throws(() => applyPatchSet(prgOf(ORIG), bad), (e) => e instanceof PatchError && e.code === "PATCH_NO_SPACE");

  const overlap = composeSets(baseNrom, {
    id: "overlap",
    version: 1,
    routines: [
      { symbol: "a", at: 0xef90, bytes: hex("EA EA EA EA") },
      { symbol: "b", at: 0xef92, bytes: hex("EA EA") },
    ],
    writes: [],
  });
  assert.throws(() => applyPatchSet(prgOf(ORIG), overlap), (e) => e instanceof PatchError && e.code === "PATCH_OVERLAP");
});

test("patching: неизвестный символ (UNKNOWN_SYMBOL)", () => {
  const bad = composeSets(baseNrom, {
    id: "bad-sym",
    version: 1,
    free: [{ start: 0xef75, end: 0xefff }],
    routines: [],
    writes: [{ id: "w", at: 0xdb48, len: 3, expect: hex("A5 82 F0"), bytes: jmp("no_such_symbol", 3) }],
  });
  assert.throws(() => applyPatchSet(prgOf(ORIG), bad), (e) => e instanceof PatchError && e.code === "PATCH_UNKNOWN_SYMBOL");
});

test("patching: детерминизм — оригинал+патч == собранный ROM (одинаковые хэши кадров)", () => {
  const a = new PvPNes({ attAI: "asm", patchSet: "pvp" });
  const b = new PvPNes({ attAI: "asm" });
  a.loadROM(ORIG);
  b.loadROM(PATCHED);
  let s = 0x1234;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0));
  for (let f = 0; f < 120; f++) {
    const inputs = [
      { port: 0, buttons: (rnd() >> 24) & 0xff },
      { port: 2, buttons: (rnd() >> 24) & 0xff },
    ];
    a.stepFrame(inputs);
    b.stepFrame(inputs);
    assert.strictEqual(a.getFrameHash(), b.getFrameHash(), `кадр ${f}`);
  }
});

test("rom-image: отпечаток оригинала стабилен", () => {
  assert.strictEqual(prgFingerprintOf(ORIG), "b8a818c1");
  assert.strictEqual(toHex32(fnv1a32(new Uint8Array([1, 2, 3]))), toHex32(fnv1a32(new Uint8Array([1, 2, 3]))));
});

test("relocation: токены резолвят внешние и собственные адреса", () => {
  const reloc = composeSets(baseNrom, {
    id: "reloc",
    version: 1,
    routines: [
      {
        symbol: "r",
        bytes: [0xa2, 0x07, 0xe0, 0x02, selfJmpT(0), jsrT("sub_E363_tank_spawn_handler")],
      },
    ],
    writes: [],
  });
  const rom = prgOf(ORIG);
  const rep = applyPatchSet(rom, reloc);
  const at = rep.routines.find((r) => r.symbol === "r").at;
  const img = new RomImage(rom);
  // selfJmp -> адрес рутины (не зашитый EFxx)
  assert.strictEqual(img.read(at + 4), 0x4c);
  assert.strictEqual(img.read(at + 5), at & 0xff);
  assert.strictEqual(img.read(at + 6), (at >> 8) & 0xff);
  // jsr на внешний символ -> $E363
  assert.strictEqual(img.read(at + 7), 0x20);
  assert.strictEqual(img.read(at + 8), 0x63);
  assert.strictEqual(img.read(at + 9), 0xe3);
});
