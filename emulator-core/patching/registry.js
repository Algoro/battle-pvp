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
import { composeSets } from "./descriptor.js";
import { PatchError, PatchErrorCode } from "./errors.js";
import { baseNrom } from "./patches/base-nrom.js";
import { pvp } from "./patches/pvp.js";
import { pistol } from "./patches/pistol.js";

const SETS = new Map();
const FEATURES = new Map();

/** Зарегистрировать (или заменить) именованный набор. */
export function registerPatchSet(name, set) {
  SETS.set(name, set);
}

/** Зарегистрировать опциональную фичу: { id, title, description, patch, defaultEnabled? }. */
export function registerFeature(feature) {
  if (!feature || !feature.id || !feature.patch) {
    throw new PatchError(PatchErrorCode.BAD_SET, "фича должна иметь id и patch");
  }
  FEATURES.set(feature.id, { defaultEnabled: false, ...feature });
}

/** Список фич (метаданные для UI/валидации), в детерминированном порядке. */
export function listFeatures() {
  return [...FEATURES.values()]
    .map((f) => ({ id: f.id, title: f.title || f.id, description: f.description || "", defaultEnabled: !!f.defaultEnabled }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Канонический список id фич: строки, уникальные, отсортированные. */
export function canonicalFeatures(features) {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  const ids = arr.map((x) => String(x)).filter(Boolean);
  return [...new Set(ids)].sort();
}

/**
 * Разрешить набор патчей: имя | дескриптор | спецификация { base, features }.
 */
export function resolvePatchSet(nameOrSpec) {
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

// Опциональные игровые фичи.
registerFeature({
  id: "pistol",
  title: "Пистолет (супер-оружие)",
  description: "Приз «пистолет» и 4-я звезда: луч, сносящий всё по линии.",
  patch: pistol,
});

export { baseNrom, pvp, pistol };
