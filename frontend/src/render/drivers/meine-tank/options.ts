// options.ts — typed settings for the `meine-tank` driver. The schema, defaults and
// presets live in shared/renderers.ts (single source); normalization is universal.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/options.ts
import { rendererById, type RenderSettingsSpec } from "../../../../../shared/renderers.ts";
import { applyPreset, normalizeValues, specDefaults } from "../../settings.ts";

export type MtCameraMode = "orbit" | "third" | "first";
export type MtTime = "noon" | "day" | "sunset" | "night" | "cycle";
export type MtLighting = "flat" | "mc";
export type MtAo = "off" | "simple" | "smooth";
export type MtShadows = "off" | "soft";
export type MtClouds = "off" | "flat" | "voxel";
export type MtWater = "off" | "simple" | "animated";
export type MtDecor = "off" | "light" | "full";
export type MtTheme = "classic" | "desert" | "wasteland";
export type MtFauna = "off" | "ambient" | "lively";
export type MtFaunaTime = "auto" | "day" | "night";
export type MtBorder = "off" | "edge" | "wall";
export type MtOuterWorld = "off" | "hills" | "full";
export type MtBiome = "mixed" | "plains" | "forest" | "desert" | "snow" | "volcanic";

export interface MtOptions {
  preset: string;
  cameraMode: MtCameraMode;
  cameraFollow: boolean;
  fov: number;
  time: MtTime;
  lighting: MtLighting;
  ao: MtAo;
  shadows: MtShadows;
  fog: number;
  clouds: MtClouds;
  water: MtWater;
  decor: MtDecor;
  theme: MtTheme;
  particles: 0 | 1 | 2;
  textureSize: 32 | 16;
  outline: boolean;
  exposure: number;
  normalMaps: boolean;
  border: MtBorder;
  outerWorld: MtOuterWorld;
  outerBiome: MtBiome;
  outerRadius: number;
  outerRivers: boolean;
  outerTrees: boolean;
  outerVolcano: boolean;
  outerMobs: boolean;
  outerDragons: boolean;
  fauna: MtFauna;
  faunaDensity: 0 | 1 | 2;
  faunaBees: boolean;
  faunaBirds: boolean;
  faunaBats: boolean;
  faunaAllay: boolean;
  faunaSmall: boolean;
  faunaLivestock: boolean;
  faunaAquatic: boolean;
  faunaTime: MtFaunaTime;
  faunaShadows: boolean;
}

export const MT_SETTINGS: RenderSettingsSpec = rendererById("meine-tank")?.settings ?? { fields: [] };

export const MT_DEFAULTS: MtOptions = {
  preset: "vanilla",
  ...specDefaults(MT_SETTINGS),
} as unknown as MtOptions;

export const MT_PRESET_IDS: string[] = (MT_SETTINGS.presets ?? []).map((p) => p.id);

/** Full valid set of settings from an arbitrary partial object. */
export function normalizeMtOptions(partial: unknown = null): MtOptions {
  const preset =
    partial && typeof partial === "object" && typeof (partial as { preset?: unknown }).preset === "string"
      ? (partial as { preset: string }).preset
      : "vanilla";
  return { preset, ...normalizeValues(MT_SETTINGS, partial) } as unknown as MtOptions;
}

/** Settings from a preset (keeping current values for fields outside the preset). */
export function optionsFromPreset(name: string, base?: Partial<MtOptions>): MtOptions {
  const current = normalizeValues(MT_SETTINGS, base ?? {});
  return { preset: name, ...applyPreset(MT_SETTINGS, name, current) } as unknown as MtOptions;
}

/** Which fauna groups are enabled, honoring the global `fauna` mode. */
export function faunaGroups(o: MtOptions): {
  bees: boolean;
  birds: boolean;
  bats: boolean;
  allay: boolean;
  small: boolean;
  livestock: boolean;
  aquatic: boolean;
} {
  const off = o.fauna === "off";
  return {
    bees: !off && o.faunaBees,
    birds: !off && o.faunaBirds,
    bats: !off && o.faunaBats,
    allay: !off && o.faunaAllay,
    small: !off && o.faunaSmall,
    livestock: !off && o.faunaLivestock,
    aquatic: !off && o.faunaAquatic,
  };
}

export default { MT_SETTINGS, MT_DEFAULTS, MT_PRESET_IDS, normalizeMtOptions, optionsFromPreset, faunaGroups };
