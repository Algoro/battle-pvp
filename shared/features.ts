// features.ts — unified manifest of optional features (metadata + settings for UI/validation).
//
// Source of truth for `id/title/description/hidden` and for the feature settings schema. From it
// are derived:
//   * backend SUPPORTED_FEATURES and featureOptions normalization (lobby validation),
//   * frontend OPTIONAL_FEATURES (checkboxes and auto-UI for settings),
//   * emulator-core listFeatures()/effectiveFeatureOptions (values for the runtimes).
// Adding a feature: a line here + registerFeature in emulator-core (+ patch/runtime).
// Adding a setting: a `settings` field here; UI and validation pick it up automatically.
//
// The module intentionally has no imports (it is included by all layers, including domain).

export type FeatureSettingValue = string | number | boolean;

export interface FeatureSettingOption {
  value: FeatureSettingValue;
  label: string;
}

/** Declarative description of a single feature setting (for auto-UI and normalization). */
export interface FeatureSettingSpec {
  id: string;
  label: string;
  type: "select" | "range" | "toggle";
  default: FeatureSettingValue;
  options?: FeatureSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** The setting only makes sense when another feature is enabled (e.g. enemy-prizes → pistol). */
  requiresFeature?: string;
}

export interface FeatureSettingsSpec {
  fields: FeatureSettingSpec[];
}

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
  /** true — do not show in the general patch selection (enabled by a separate mode). */
  hidden?: boolean;
  /** Configurable feature parameters (generate UI automatically). */
  settings?: FeatureSettingsSpec;
}

export const FEATURE_MANIFEST: FeatureInfo[] = [
  {
    id: "pistol",
    title: "Пистолет (супер-оружие)",
    description: "Приз «пистолет» и 4-я звезда: луч, сносящий всё по линии.",
    settings: {
      fields: [
        {
          id: "beamHalf",
          label: "Ширина луча",
          type: "range",
          default: 1,
          min: 0,
          max: 3,
          step: 1,
          hint: "0 — один тайл, 3 — семь тайлов в поперечнике.",
        },
        {
          id: "terrain",
          label: "Сносить ландшафт",
          type: "toggle",
          default: true,
          hint: "Выкл — луч убивает танки и пули, но не разрушает кирпич/сталь/воду.",
        },
      ],
    },
  },
  {
    id: "enemy-prizes",
    title: "Враги берут призы",
    description: "Танки 2..7 забирают приз и получают его эффект (каска — нет).",
    settings: {
      fields: [
        // Which prize types the enemy can pick up (off — the prize stays on the field for DEF).
        { id: "allowHelmet", label: "Доступна каска", type: "toggle", default: true },
        { id: "allowClock", label: "Доступны часы", type: "toggle", default: true },
        { id: "allowShovel", label: "Доступна лопата", type: "toggle", default: true },
        { id: "allowStar", label: "Доступна звезда", type: "toggle", default: true },
        { id: "allowGrenade", label: "Доступна граната", type: "toggle", default: true },
        { id: "allowTank", label: "Доступен танк", type: "toggle", default: true },
        { id: "allowPistol", label: "Доступен пистолет", type: "toggle", default: true },
        // Effect of each prize type.
        {
          id: "helmetEffect",
          label: "Каска: действие",
          type: "select",
          default: "none",
          options: [
            { value: "none", label: "Без эффекта" },
            { value: "armor", label: "Повышает броню" },
          ],
          hint: "Что даёт каска врагу (в оригинале — ничего).",
        },
        {
          id: "freezeFrames",
          label: "Часы: заморозка DEF (кадры)",
          type: "range",
          default: 10,
          min: 1,
          max: 30,
          step: 1,
        },
        {
          id: "shovelMode",
          label: "Лопата: снятие защиты",
          type: "select",
          default: "full",
          options: [
            { value: "full", label: "Кирпич и сталь" },
            { value: "bricks", label: "Только кирпич" },
          ],
        },
        {
          id: "starLevels",
          label: "Звезда: уровней брони",
          type: "range",
          default: 1,
          min: 1,
          max: 3,
          step: 1,
        },
        {
          id: "grenadeLethal",
          label: "Граната: смертельно",
          type: "toggle",
          default: true,
          hint: "Выкл — защитники получают стан вместо взрыва.",
        },
        {
          id: "reinforcement",
          label: "Танк: подкрепление",
          type: "toggle",
          default: true,
        },
        {
          id: "reinforceCount",
          label: "Танк: сколько врагов добавить",
          type: "range",
          default: 1,
          min: 1,
          max: 3,
          step: 1,
        },
        {
          id: "pistolAmmo",
          label: "Пистолет: выстрелов врагу",
          type: "range",
          default: 3,
          min: 1,
          max: 10,
          step: 1,
          requiresFeature: "pistol",
        },
      ],
    },
  },
  {
    id: "friendly-fire-def",
    title: "Friendly fire (защитники)",
    description: "Попадание защитника в союзника убивает его.",
    settings: {
      fields: [
        {
          id: "lethal",
          label: "Смертельный огонь по союзнику",
          type: "toggle",
          default: true,
          hint: "Выкл — остаётся штатный стан ROM (союзник выживает).",
        },
      ],
    },
  },
  {
    id: "friendly-fire-att",
    title: "Friendly fire (атакующие)",
    description: "Попадание врага в союзного врага наносит урон.",
    settings: {
      fields: [
        {
          id: "damage",
          label: "Урон по союзному врагу",
          type: "range",
          default: 1,
          min: 1,
          max: 3,
          step: 1,
          hint: "Сколько уровней брони снимает попадание.",
        },
        {
          id: "selfDamage",
          label: "Стрелок гибнет от своей пули",
          type: "toggle",
          default: true,
          hint: "Самоурон возможен только после того, как пуля вышла из «дула» стрелка.",
        },
      ],
    },
  },
  {
    id: "player-names",
    title: "Имена над танками",
    description: "Имя игрока отображается над его танком (шрифт ROM).",
    settings: {
      fields: [
        {
          id: "maxLen",
          label: "Макс. длина имени",
          type: "range",
          default: 10,
          min: 3,
          max: 10,
          step: 1,
        },
      ],
    },
  },
  {
    id: "pacman",
    title: "Pac-Man (сбор точек)",
    description: "Лабиринт из бетона, DEF собирают точки; бомбы-призы; победа по зачистке.",
    settings: {
      fields: [
        {
          id: "bombs",
          label: "Бомбы-призы",
          type: "toggle",
          default: true,
          hint: "Выкл — в лабиринте не выпадают бомбы.",
        },
      ],
    },
  },
  {
    id: "wrap-borders",
    title: "Открытые края (телепорт)",
    description: "Неразрушимая рамка уровня убрана: танки и пули, дойдя до края, выходят с противоположной стороны.",
    settings: {
      fields: [
        { id: "wrapX", label: "Телепорт по горизонтали", type: "toggle", default: true },
        { id: "wrapY", label: "Телепорт по вертикали", type: "toggle", default: true },
      ],
    },
  },
  {
    id: "tower-defence",
    title: "Tower Defence",
    description: "Соло-режим обороны: покупка и расстановка неподвижных танков-башен, волны врагов.",
    hidden: true,
    // Mode settings (map/difficulty/waves) are configured on a separate Tower Defence screen,
    // not through the general feature settings list.
  },
];

export const FEATURE_IDS: string[] = FEATURE_MANIFEST.map((f) => f.id);

const BY_ID = new Map(FEATURE_MANIFEST.map((f) => [f.id, f]));

export function featureInfo(id: string): FeatureInfo | undefined {
  return BY_ID.get(id);
}

/** Default values for feature settings (empty object if there are no settings). */
export function featureDefaults(id: string): Record<string, FeatureSettingValue> {
  const out: Record<string, FeatureSettingValue> = {};
  const spec = BY_ID.get(id)?.settings;
  if (!spec) return out;
  for (const f of spec.fields) out[f.id] = f.default;
  return out;
}

function coerce(spec: FeatureSettingSpec, value: unknown): FeatureSettingValue {
  switch (spec.type) {
    case "toggle":
      return typeof value === "boolean" ? value : value === "false" ? false : Boolean(value);
    case "range": {
      let n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return spec.default;
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      if (spec.step) n = Math.round(n / spec.step) * spec.step;
      return n;
    }
    case "select": {
      const opts = spec.options ?? [];
      const match = opts.find((o) => o.value === value || String(o.value) === String(value));
      return match ? match.value : spec.default;
    }
    default:
      return spec.default;
  }
}

/**
 * Normalize the settings map from lobby/solo: only known features and fields,
 * values are coerced to type and clamped to range. Missing fields are not added
 * (they will be filled in by `effectiveFeatureOptions`).
 */
export function normalizeFeatureOptions(raw: unknown): Record<string, Record<string, FeatureSettingValue>> {
  const out: Record<string, Record<string, FeatureSettingValue>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [featureId, values] of Object.entries(raw as Record<string, unknown>)) {
    const spec = BY_ID.get(featureId)?.settings;
    if (!spec || !values || typeof values !== "object") continue;
    const src = values as Record<string, unknown>;
    const clean: Record<string, FeatureSettingValue> = {};
    for (const field of spec.fields) {
      if (Object.prototype.hasOwnProperty.call(src, field.id)) clean[field.id] = coerce(field, src[field.id]);
    }
    if (Object.keys(clean).length) out[featureId] = clean;
  }
  return out;
}

/** Full feature settings: default values + normalized overrides. */
export function effectiveFeatureOptions(
  id: string,
  raw?: Record<string, FeatureSettingValue> | null,
): Record<string, FeatureSettingValue> {
  const out = featureDefaults(id);
  if (!raw) return out;
  const spec = BY_ID.get(id)?.settings;
  if (!spec) return out;
  for (const field of spec.fields) {
    if (Object.prototype.hasOwnProperty.call(raw, field.id)) {
      out[field.id] = coerce(field, (raw as Record<string, unknown>)[field.id]);
    }
  }
  return out;
}

export default FEATURE_MANIFEST;
