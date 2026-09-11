// registry.js — именованные наборы патчей (композиция base + модулей).
//
// Относительный путь: ./emulator-core/patching/registry.js
import { composeSets } from "./descriptor.js";
import { PatchError, PatchErrorCode } from "./errors.js";
import { baseNrom } from "./patches/base-nrom.js";
import { pvp } from "./patches/pvp.js";
import { pistol } from "./patches/pistol.js";

const SETS = new Map();

/** Зарегистрировать (или заменить) именованный набор. */
export function registerPatchSet(name, set) {
  SETS.set(name, set);
}

export function resolvePatchSet(nameOrSet) {
  if (typeof nameOrSet !== "string") return nameOrSet;
  if (!SETS.has(nameOrSet)) {
    throw new PatchError(PatchErrorCode.BAD_SET, `неизвестный набор патчей: ${nameOrSet}`);
  }
  return SETS.get(nameOrSet);
}

export function listPatchSets() {
  return [...SETS.keys()];
}

// Встроенные наборы.
registerPatchSet("pvp", composeSets(baseNrom, pvp, pistol));
registerPatchSet("base", composeSets(baseNrom));

export { baseNrom, pvp, pistol };
