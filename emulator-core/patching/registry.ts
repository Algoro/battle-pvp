// registry.js — named patch sets and a registry of OPTIONAL features.
//
// Model:
//   * Base sets (`pvp`, `base`) — the mandatory compatible foundation (network/ROM).
//   * Features (`pistol`, ...) — optional game patches on top of the base. Enabled by a list:
//       applyPatchSet(rom, { base: "pvp", features: ["pistol"] })
//     Feature order/duplicates are canonicalized, so the fingerprint is unambiguous.
//   * The base fingerprint (without features) is a netcode-compatibility concern; the host chooses
//     the feature set and broadcasts it in `match.start`; all clients build the same image.
//
// Relative path: ./emulator-core/patching/registry.js
import { composeSets } from "./descriptor.ts";
import { PatchError, PatchErrorCode } from "./errors.ts";
import { RUNTIME_METHODS, type FeatureRuntime } from "./runtime.ts";
import { baseNrom } from "./patches/base-nrom.ts";
import { pvp } from "./patches/pvp.ts";
import { pistol } from "./patches/pistol.ts";
import { enemyPrizes } from "./patches/enemy-prizes.ts";
import { friendlyFireDef } from "./patches/friendly-fire-def.ts";
import { friendlyFireAtt } from "./patches/friendly-fire-att.ts";
import { playerNames } from "./patches/player-names.ts";
import { pacman } from "./patches/pacman.ts";
import { towerDefence } from "./patches/tower-defence.ts";
import { wrapBorders } from "./patches/wrap-borders.ts";
import { pistolRuntime } from "../features/pistol.ts";
import { enemyPrizesRuntime } from "../features/enemy-prizes.ts";
import { friendlyFireDefRuntime } from "../features/friendly-fire-def.ts";
import { friendlyFireAttRuntime } from "../features/friendly-fire-att.ts";
import { playerNamesRuntime } from "../features/player-names.ts";
import { pacmanDotsRuntime } from "../features/pacman-dots.ts";
import { towerDefenceRuntime } from "../features/tower-defence.ts";
import { wrapBordersRuntime } from "../features/wrap-borders.ts";
import { FEATURE_MANIFEST } from "../../shared/features.ts";

const SETS = new Map<any, any>();
const FEATURES = new Map<any, any>();

/** Register (or replace) a named set. */
export function registerPatchSet(name: string, set: any): void {
  SETS.set(name, set);
}

/** Register an optional feature: { id, patch, runtime? }. Metadata (title/description)
 *  comes from shared/features.ts — here only the id → patch/runtime wiring. */
export function registerFeature(feature: any): void {
  if (!feature || !feature.id || !feature.patch) {
    throw new PatchError(PatchErrorCode.BAD_SET, "фича должна иметь id и patch");
  }
  if (feature.runtime) validateRuntime(feature.runtime, feature.id);
  FEATURES.set(feature.id, { id: feature.id, patch: feature.patch, runtime: feature.runtime });
}

/** Validate the shape of a feature's JS runtime (known methods only). */
function validateRuntime(runtime: any, id: string): void {
  if (typeof runtime !== "object") {
    throw new PatchError(PatchErrorCode.BAD_SET, `runtime фичи ${id} должен быть объектом`);
  }
  for (const k of Object.keys(runtime)) {
    if (!(RUNTIME_METHODS as readonly string[]).includes(k)) {
      throw new PatchError(PatchErrorCode.BAD_SET, `runtime фичи ${id}: неизвестный метод ${k}`);
    }
    if (typeof runtime[k] !== "function") {
      throw new PatchError(PatchErrorCode.BAD_SET, `runtime фичи ${id}: ${k} не функция`);
    }
  }
}

/** Runtimes of active features in deterministic (canonical) order. */
export function resolveFeatureRuntimes(features: any): { id: string; runtime: FeatureRuntime }[] {
  const ids = canonicalFeatures(features);
  const out: { id: string; runtime: FeatureRuntime }[] = [];
  for (const id of ids) {
    const f = FEATURES.get(id);
    if (f && f.runtime) out.push({ id, runtime: f.runtime });
  }
  return out;
}

/** Feature list (metadata for UI/validation) from the single manifest. */
export function listFeatures() {
  return FEATURE_MANIFEST.map((f) => ({ id: f.id, title: f.title, description: f.description }));
}

/** Cross-check the manifest and the patch registry (one without the other is a config error). */
export function assertFeaturesConsistent(): void {
  const registered = new Set(FEATURES.keys());
  const manifest = new Set(FEATURE_MANIFEST.map((f) => f.id));
  for (const id of manifest) {
    if (!registered.has(id)) throw new PatchError(PatchErrorCode.BAD_SET, `фича «${id}» в манифесте, но патч не зарегистрирован`);
  }
  for (const id of registered) {
    if (!manifest.has(id)) throw new PatchError(PatchErrorCode.BAD_SET, `патч «${id}» зарегистрирован, но отсутствует в манифесте`);
  }
}

/** Canonical feature id list: strings, unique, sorted. */
export function canonicalFeatures(features: any): string[] {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  const ids = arr.map((x) => String(x)).filter(Boolean);
  return [...new Set(ids)].sort();
}

/**
 * Resolve a patch set: name | descriptor | spec { base, features }.
 */
export function resolvePatchSet(nameOrSpec: any): any {
  if (typeof nameOrSpec === "string") {
    if (!SETS.has(nameOrSpec)) {
      throw new PatchError(PatchErrorCode.BAD_SET, `неизвестный набор патчей: ${nameOrSpec}`);
    }
    return SETS.get(nameOrSpec);
  }
  // A feature spec differs from a ready descriptor: for a descriptor `base` is the
  // base-verify object {mapper,prgBanks,fingerprint}, while the spec is given by `features` or
  // a string base name.
  const isSpec =
    nameOrSpec &&
    typeof nameOrSpec === "object" &&
    (nameOrSpec.features !== undefined || typeof nameOrSpec.base === "string");
  if (isSpec) {
    const base = typeof nameOrSpec.base === "string" ? SETS.get(nameOrSpec.base) : nameOrSpec.base;
    if (!base) {
      throw new PatchError(PatchErrorCode.BAD_SET, `неизвестная база патчей: ${nameOrSpec.base}`);
    }
    const ids = canonicalFeatures(nameOrSpec.features);
    const patches = ids.map((id) => {
      const f = FEATURES.get(id);
      if (!f) throw new PatchError(PatchErrorCode.BAD_SET, `неизвестная фича: ${id}`);
      return f.patch;
    });
    const set = composeSets(base, ...patches);
    set.id = `${base.id}${ids.length ? "+" + ids.join("+") : ""}`;
    set.features = ids;
    return set;
  }
  return nameOrSpec; // ready descriptor
}

export function listPatchSets() {
  return [...SETS.keys()];
}

// --- Built-in sets and features ---------------------------------------------
// The `pvp` base = ROM contract + the network PvP patch (without game features).
registerPatchSet("pvp", composeSets(baseNrom, pvp));
registerPatchSet("base", composeSets(baseNrom));

// Optional game features (metadata — in shared/features.ts).
registerFeature({
  id: "pistol",
  patch: pistol,
  runtime: pistolRuntime,
});

registerFeature({
  id: "enemy-prizes",
  patch: enemyPrizes,
  runtime: enemyPrizesRuntime,
});

registerFeature({
  id: "friendly-fire-def",
  patch: friendlyFireDef,
  runtime: friendlyFireDefRuntime,
});

registerFeature({
  id: "friendly-fire-att",
  patch: friendlyFireAtt,
  runtime: friendlyFireAttRuntime,
});

registerFeature({
  id: "player-names",
  patch: playerNames,
  runtime: playerNamesRuntime,
});

registerFeature({
  id: "pacman",
  patch: pacman,
  runtime: pacmanDotsRuntime,
});

registerFeature({
  id: "wrap-borders",
  patch: wrapBorders,
  runtime: wrapBordersRuntime,
});

registerFeature({
  id: "tower-defence",
  patch: towerDefence,
  runtime: towerDefenceRuntime,
});

// The manifest and the registry must match (added a feature — register the patch, and vice versa).
assertFeaturesConsistent();

export { baseNrom, pvp, pistol, enemyPrizes, friendlyFireDef, friendlyFireAtt, playerNames, pacman, wrapBorders, towerDefence };
