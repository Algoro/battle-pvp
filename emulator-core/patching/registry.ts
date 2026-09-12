// registry.js — именованные наборы патчей и реестр ОПЦИОНАЛЬНЫХ фич.
//
// Модель:
//   * Базовые наборы (`pvp`, `base`) — обязательная совместимая основа (сеть/ROM).
//   * Фичи (`pistol`, ...) — опциональные игровые патчи поверх базы. Включаются списком:
//       applyPatchSet(rom, { base: "pvp", features: ["pistol"] })
//     Порядок/дубли фич канонизируются, поэтому fingerprint однозначен.
//   * Fingerprint базы (без фич) — предмет netcode-совместимости; набор фич выбирает хост
//     и рассылает в `match.start`, все клиенты собирают один и тот же образ.
//
// Относительный путь: ./emulator-core/patching/registry.js
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
import { pistolRuntime } from "../features/pistol.ts";
import { enemyPrizesRuntime } from "../features/enemy-prizes.ts";
import { friendlyFireDefRuntime } from "../features/friendly-fire-def.ts";
import { friendlyFireAttRuntime } from "../features/friendly-fire-att.ts";
import { playerNamesRuntime } from "../features/player-names.ts";
import { pacmanDotsRuntime } from "../features/pacman-dots.ts";
import { FEATURE_MANIFEST } from "../../shared/features.ts";

const SETS = new Map<any, any>();
const FEATURES = new Map<any, any>();

/** Зарегистрировать (или заменить) именованный набор. */
export function registerPatchSet(name: string, set: any): void {
  SETS.set(name, set);
}

/** Зарегистрировать опциональную фичу: { id, patch, runtime? }. Метаданные (title/description)
 *  берутся из shared/features.ts — здесь только проводка id → патч/рантайм. */
export function registerFeature(feature: any): void {
  if (!feature || !feature.id || !feature.patch) {
    throw new PatchError(PatchErrorCode.BAD_SET, "фича должна иметь id и patch");
  }
  if (feature.runtime) validateRuntime(feature.runtime, feature.id);
  FEATURES.set(feature.id, { id: feature.id, patch: feature.patch, runtime: feature.runtime });
}

/** Проверить форму JS-рантайма фичи (только известные методы). */
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

/** Рантаймы активных фич в детерминированном (каноническом) порядке. */
export function resolveFeatureRuntimes(features: any): { id: string; runtime: FeatureRuntime }[] {
  const ids = canonicalFeatures(features);
  const out: { id: string; runtime: FeatureRuntime }[] = [];
  for (const id of ids) {
    const f = FEATURES.get(id);
    if (f && f.runtime) out.push({ id, runtime: f.runtime });
  }
  return out;
}

/** Список фич (метаданные для UI/валидации) из единого манифеста. */
export function listFeatures() {
  return FEATURE_MANIFEST.map((f) => ({ id: f.id, title: f.title, description: f.description }));
}

/** Сверить манифест и реестр патчей (одно без другого — ошибка конфигурации). */
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

/** Канонический список id фич: строки, уникальные, отсортированные. */
export function canonicalFeatures(features: any): string[] {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  const ids = arr.map((x) => String(x)).filter(Boolean);
  return [...new Set(ids)].sort();
}

/**
 * Разрешить набор патчей: имя | дескриптор | спецификация { base, features }.
 */
export function resolvePatchSet(nameOrSpec: any): any {
  if (typeof nameOrSpec === "string") {
    if (!SETS.has(nameOrSpec)) {
      throw new PatchError(PatchErrorCode.BAD_SET, `неизвестный набор патчей: ${nameOrSpec}`);
    }
    return SETS.get(nameOrSpec);
  }
  // Спецификация фич отличается от готового дескриптора: у дескриптора `base` — это
  // объект base-verify {mapper,prgBanks,fingerprint}, а спец задаётся `features` или
  // строковым именем базы.
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
  return nameOrSpec; // готовый дескриптор
}

export function listPatchSets() {
  return [...SETS.keys()];
}

// --- Встроенные наборы и фичи ---------------------------------------------
// База `pvp` = ROM-контракт + сетевой PvP-патч (без игровых фич).
registerPatchSet("pvp", composeSets(baseNrom, pvp));
registerPatchSet("base", composeSets(baseNrom));

// Опциональные игровые фичи (метаданные — в shared/features.ts).
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

// Манифест и реестр обязаны совпадать (добавил фичу — зарегистрируй патч, и наоборот).
assertFeaturesConsistent();

export { baseNrom, pvp, pistol, enemyPrizes, friendlyFireDef, friendlyFireAtt, playerNames, pacman };
