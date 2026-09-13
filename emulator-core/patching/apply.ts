// apply.js — applying a patch set to a loaded ROM (in-memory image patching).
//
// Order:
//   1. Base check (mapper/banks/PRG fingerprint).
//   2. Placing routines (explicit address or free area) — Linker.
//   3. Checking ALL expect bytes of the hooks before any write (all-or-nothing).
//   4. Writing routines and hooks.
//   5. Report { setId, fingerprint, applied, routines }.
//
// Nothing is written if at least one check fails → atomicity at the set level.
//
// Relative path: ./emulator-core/patching/apply.js
import { RomImage } from "./rom-image.ts";
import { Linker } from "./linker.ts";
import { PatchError, PatchErrorCode } from "./errors.ts";
import { toBytes, validateSet, compileTokens } from "./descriptor.ts";
import { resolvePatchSet } from "./registry.ts";

/**
 * @param {object} loadedRom — the loaded ROM (emulator-core/src/rom.js)
 * @param {object|string} setOrName — the set descriptor or its name ("pvp")
 */
export function applyPatchSet(loadedRom: any, setOrName: any) {
  const set = resolvePatchSet(setOrName);
  validateSet(set);

  const image = new RomImage(loadedRom);

  // 1. Base
  const base = set.base || {};
  if (base.mapper !== undefined && image.mapperType !== base.mapper) {
    throw new PatchError(PatchErrorCode.BASE_MISMATCH, `mapper ${image.mapperType} != ${base.mapper}`);
  }
  if (base.prgBanks !== undefined && image.prgBankCount() !== base.prgBanks) {
    throw new PatchError(PatchErrorCode.BASE_MISMATCH, `PRG-банков ${image.prgBankCount()} != ${base.prgBanks}`);
  }
  if (base.fingerprint && image.fingerprint() !== base.fingerprint) {
    throw new PatchError(PatchErrorCode.BASE_MISMATCH, `отпечаток PRG ${image.fingerprint()} != ${base.fingerprint}`);
  }

  // 2. Routine placement
  const linker = new Linker(image, { symbols: set.symbols || {}, free: set.free || [] });
  linker.allocate(set.routines || []);

  // 3. expect-byte check
  const writes = set.writes || [];
  for (const w of writes) {
    const expect = toBytes(w.expect);
    if (!image.verify(w.at, expect)) {
      throw new PatchError(
        PatchErrorCode.EXPECT_FAILED,
        `${set.id}/${w.id || "?"} @$${w.at.toString(16)}: исходные байты не совпали`,
        { at: w.at, expect: Array.from(expect), actual: Array.from(image.readBytes(w.at, expect.length)) },
      );
    }
  }
  linker.assertWritesDoNotClobber(writes);

  const resolve = (name: any) => linker.resolve(name);

  // 4. Write (atomicity guaranteed by the checks above)
  const applied = [];
  for (const r of set.routines || []) {
    const at = linker.symbols.get(r.symbol);
    const bytes = Array.isArray(r.bytes) ? compileTokens(r.bytes, resolve, at) : toBytes(r.bytes);
    image.writeBytes(at, bytes);
    applied.push({ type: "routine", symbol: r.symbol, at, len: bytes.length });
  }
  for (const w of writes) {
    const bytes = typeof w.bytes === "function" ? w.bytes(resolve) : toBytes(w.bytes);
    if (w.len !== undefined && bytes.length !== w.len) {
      throw new PatchError(PatchErrorCode.BAD_WRITE, `${set.id}/${w.id}: длина ${bytes.length} != ${w.len}`);
    }
    image.writeBytes(w.at, bytes);
    applied.push({ type: "write", id: w.id, at: w.at, len: bytes.length });
  }

  return {
    setId: set.id,
    version: set.version || 1,
    features: set.features || [],
    fingerprint: image.fingerprint(),
    applied,
    routines: linker.used.map((u) => ({ ...u })),
    warnings: [],
  };
}

export default applyPatchSet;
