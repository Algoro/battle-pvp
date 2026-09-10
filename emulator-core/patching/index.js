// index.js — публичный API модуля in-memory патчинга ROM.
// Относительный путь: ./emulator-core/patching/index.js
export { RomImage, fnv1a32, toHex32 } from "./rom-image.js";
export { Linker } from "./linker.js";
export { applyPatchSet } from "./apply.js";
export { PatchError, PatchErrorCode } from "./errors.js";
export {
  hex,
  toBytes,
  jmp,
  jsr,
  fill,
  composeSets,
  validateSet,
} from "./descriptor.js";
export {
  registerPatchSet,
  resolvePatchSet,
  listPatchSets,
  baseNrom,
  pvp,
} from "./registry.js";
