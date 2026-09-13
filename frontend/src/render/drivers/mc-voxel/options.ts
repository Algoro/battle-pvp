// options.ts — typed settings for the mc-voxel driver. Schema/defaults/presets — from
// shared/renderers.ts (single source); normalization is universal (render/settings.ts).
//
// Relative path: ./frontend/src/render/drivers/mc-voxel/options.ts
import { rendererById, type RenderSettingsSpec } from "../../../../../shared/renderers.ts";
import { applyPreset, normalizeValues, specDefaults } from "../../settings.ts";

export type McTime = "noon" | "day" | "sunset" | "night" | "cycle";
export type McLighting = "flat" | "mc";
export type McAo = "off" | "simple" | "smooth";
export type McShadows = "off" | "soft";
export type McClouds = "off" | "flat" | "voxel";
export type McWater = "off" | "simple" | "animated";
export type McCameraMode = "orbit" | "third" | "first";

export interface McVoxelOptions {
  preset: string;
  cameraMode: McCameraMode;
  cameraFollow: boolean;
  time: McTime;
  lighting: McLighting;
  ao: McAo;
  shadows: McShadows;
  fog: number;
  clouds: McClouds;
  birds: boolean;
  mice: boolean;
  water: McWater;
  particles: 0 | 1 | 2;
  textureSize: 16 | 32;
  fov: number;
  outline: boolean;
  vignette: boolean;
  cloudsDrift: boolean;
}

export const MC_SETTINGS: RenderSettingsSpec = rendererById("mc-voxel")?.settings ?? { fields: [] };

export const MC_DEFAULTS: McVoxelOptions = { preset: "classic", ...specDefaults(MC_SETTINGS) } as unknown as McVoxelOptions;

export const MC_PRESET_IDS: string[] = (MC_SETTINGS.presets ?? []).map((p) => p.id);

/** Full valid set of settings from an arbitrary partial object. */
export function normalizeMcOptions(partial: unknown): McVoxelOptions {
  const preset =
    partial && typeof partial === "object" && typeof (partial as { preset?: unknown }).preset === "string"
      ? (partial as { preset: string }).preset
      : "classic";
  return { preset, ...normalizeValues(MC_SETTINGS, partial) } as unknown as McVoxelOptions;
}

/** Settings from a preset (keeping current values for fields outside the preset). */
export function optionsFromPreset(name: string, base?: Partial<McVoxelOptions>): McVoxelOptions {
  const current = normalizeValues(MC_SETTINGS, base ?? {});
  return { preset: name, ...applyPreset(MC_SETTINGS, name, current) } as unknown as McVoxelOptions;
}

export default { MC_SETTINGS, MC_DEFAULTS, MC_PRESET_IDS, normalizeMcOptions, optionsFromPreset };
