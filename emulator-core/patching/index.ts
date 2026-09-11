// index.js — публичный API модуля in-memory патчинга ROM.
// Относительный путь: ./emulator-core/patching/index.js
export { RomImage, fnv1a32, toHex32 } from "./rom-image.ts";
export { Linker } from "./linker.ts";
export { applyPatchSet } from "./apply.ts";
export { PatchError, PatchErrorCode } from "./errors.ts";
export {
  hex,
  toBytes,
  jmp,
  jsr,
  fill,
  composeSets,
  validateSet,
} from "./descriptor.ts";
export {
  registerPatchSet,
  resolvePatchSet,
  listPatchSets,
  baseNrom,
  pvp,
} from "./registry.ts";
