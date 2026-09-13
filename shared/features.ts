// features.ts — единый манифест опциональных фич (метаданные + настройки для UI/валидации).
//
// Источник истины по `id/title/description/hidden` и по схеме настроек фичи. Из него
// выводятся:
//   * backend SUPPORTED_FEATURES и нормализация featureOptions (валидация лобби),
//   * frontend OPTIONAL_FEATURES (чекбоксы и авто-UI настроек),
//   * emulator-core listFeatures()/effectiveFeatureOptions (значения для рантаймов).
// Добавление фичи: строка здесь + registerFeature в emulator-core (+ patch/runtime).
// Добавление настройки: поле `settings` здесь; UI и валидация подхватят автоматически.
//
// Модуль намеренно без импортов (его подключают все слои, включая domain).

export type FeatureSettingValue = string | number | boolean;

export interface FeatureSettingOption {
  value: FeatureSettingValue;
  label: string;
}

/** Декларативное описание одной настройки фичи (для авто-UI и нормализации). */
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
  /** Настройка имеет смысл только при включённой другой фиче (напр. enemy-prizes → pistol). */
  requiresFeature?: string;
}

export interface FeatureSettingsSpec {
  fields: FeatureSettingSpec[];
}

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
  /** true — не показывать в общем выборе патчей (включается отдельным режимом). */
  hidden?: boolean;
  /** Настраиваемые параметры фичи (генерируют UI автоматически). */
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
        {
          id: "freezeFrames",
          label: "Заморозка DEF (кадры)",
          type: "range",
          default: 10,
          min: 1,
          max: 30,
          step: 1,
          hint: "Длительность эффекта приза-часов.",
        },
        {
          id: "reinforcement",
          label: "Подкрепление за приз-танк",
          type: "toggle",
          default: true,
          hint: "Выкл — приз-танк врага не увеличивает число оставшихся врагов.",
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
    // Настройки режима (карта/сложность/волны) задаются на отдельном экране Tower Defence,
    // а не через общий список настроек фич.
  },
];

export const FEATURE_IDS: string[] = FEATURE_MANIFEST.map((f) => f.id);

const BY_ID = new Map(FEATURE_MANIFEST.map((f) => [f.id, f]));

export function featureInfo(id: string): FeatureInfo | undefined {
  return BY_ID.get(id);
}

/** Значения по умолчанию для настроек фичи (пустой объект, если настроек нет). */
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
 * Нормализовать карту настроек из лобби/соло: только известные фичи и поля,
 * значения приведены к типу и зажаты в диапазон. Отсутствующие поля не добавляются
 * (их подставит `effectiveFeatureOptions`).
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

/** Полные настройки фичи: значения по умолчанию + нормализованные переопределения. */
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
