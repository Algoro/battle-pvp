// apply.js — применение набора патчей к загруженному ROM (in-memory image patching).
//
// Порядок:
//   1. Проверка базы (mapper/банки/отпечаток PRG).
//   2. Размещение рутин (явный адрес или свободная зона) — Linker.
//   3. Проверка ВСЕХ expect-байтов хуков до единой записи (all-or-nothing).
//   4. Запись рутин и хуков.
//   5. Отчёт { setId, fingerprint, applied, routines }.
//
// Ничего не пишется, если хотя бы одна проверка не прошла → атомарность на уровне набора.
//
// Относительный путь: ./emulator-core/patching/apply.js
import { RomImage } from "./rom-image.js";
import { Linker } from "./linker.js";
import { PatchError, PatchErrorCode } from "./errors.js";
import { toBytes, validateSet, compileTokens } from "./descriptor.js";
import { resolvePatchSet } from "./registry.js";

/**
 * @param {object} loadedRom — загруженный ROM (emulator-core/src/rom.js)
 * @param {object|string} setOrName — дескриптор набора или его имя ("pvp")
 */
export function applyPatchSet(loadedRom, setOrName) {
  const set = typeof setOrName === "string" ? resolvePatchSet(setOrName) : setOrName;
  validateSet(set);

  const image = new RomImage(loadedRom);

  // 1. База
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

  // 2. Размещение рутин
  const linker = new Linker(image, { symbols: set.symbols || {}, free: set.free || [] });
  linker.allocate(set.routines || []);

  // 3. Проверка expect-байтов
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

  const resolve = (name) => linker.resolve(name);

  // 4. Запись (атомарность обеспечена проверками выше)
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
    fingerprint: image.fingerprint(),
    applied,
    routines: linker.used.map((u) => ({ ...u })),
    warnings: [],
  };
}

export default applyPatchSet;
