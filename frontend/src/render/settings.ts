// settings.ts — universal handling of declarative render plugin settings:
// defaults, schema normalization, preset application. Without knowledge of a specific driver.
//
// Relative path: ./frontend/src/render/settings.ts
import type { RenderSettingSpec, RenderSettingsSpec, SettingValue } from "../../../shared/renderers.ts";

export type SettingValues = Record<string, SettingValue>;

export function specDefaults(spec: RenderSettingsSpec): SettingValues {
  const out: SettingValues = {};
  for (const f of spec.fields) out[f.id] = f.default;
  return out;
}

function coerce(field: RenderSettingSpec, value: unknown, fallback: SettingValue): SettingValue {
  switch (field.type) {
    case "toggle":
      return typeof value === "boolean" ? value : fallback;
    case "range": {
      const n = typeof value === "number" && Number.isFinite(value) ? value : (typeof fallback === "number" ? fallback : 0);
      const lo = field.min ?? n;
      const hi = field.max ?? n;
      return n < lo ? lo : n > hi ? hi : n;
    }
    case "select": {
      const opts = field.options ?? [];
      return opts.some((o) => o.value === value) ? (value as SettingValue) : fallback;
    }
    default:
      return fallback;
  }
}

/** Full valid set of values per the schema (extra keys are dropped). */
export function normalizeValues(spec: RenderSettingsSpec, raw: unknown): SettingValues {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: SettingValues = {};
  for (const f of spec.fields) out[f.id] = coerce(f, src[f.id], f.default);
  return out;
}

/** Apply a preset: its values override the current ones, the rest are kept. */
export function applyPreset(spec: RenderSettingsSpec, presetId: string, current: SettingValues): SettingValues {
  const preset = spec.presets?.find((p) => p.id === presetId);
  if (!preset) return current;
  return normalizeValues(spec, { ...current, ...preset.values });
}

export default { specDefaults, normalizeValues, applyPreset };
