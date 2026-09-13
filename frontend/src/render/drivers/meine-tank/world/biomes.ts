// biomes.ts — biome palettes and selection for the `meine-tank` outer world.
// Pure: given noise inputs it returns the palette, so it is unit-testable.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/biomes.ts
import type { MtBiome } from "../options.ts";

export type TreeKind = "oak" | "spruce" | "birch" | "cactus" | "burnt";

export interface TreeSpec {
  kind: TreeKind;
  trunk: string;
  leaves: string;
  height: number;
  crown: number;
}

export interface BiomePalette {
  id: string;
  surface: string;
  side: string;
  subsurface: string;
  deep: string;
  tint?: "grass" | "foliage";
  /** Snow replaces the surface above this height (world units); 0 disables. */
  snowLine: number;
  trees: TreeSpec[];
  treeDensity: number;
  lava?: boolean;
}

const OAK: TreeSpec = { kind: "oak", trunk: "oak_log", leaves: "oak_leaves", height: 5, crown: 2 };
const BIRCH: TreeSpec = { kind: "birch", trunk: "birch_log", leaves: "birch_leaves", height: 6, crown: 2 };
const SPRUCE: TreeSpec = { kind: "spruce", trunk: "spruce_log", leaves: "spruce_leaves", height: 8, crown: 2 };
const CACTUS: TreeSpec = { kind: "cactus", trunk: "cactus_side", leaves: "cactus_top", height: 3, crown: 0 };

export const BIOMES: Record<string, BiomePalette> = {
  plains: {
    id: "plains",
    surface: "grass_block_top",
    side: "grass_block_side",
    subsurface: "dirt",
    deep: "stone",
    tint: "grass",
    snowLine: 14,
    trees: [OAK],
    treeDensity: 0.03,
  },
  forest: {
    id: "forest",
    surface: "grass_block_top",
    side: "grass_block_side",
    subsurface: "dirt",
    deep: "stone",
    tint: "grass",
    snowLine: 14,
    trees: [OAK, BIRCH, SPRUCE],
    treeDensity: 0.16,
  },
  desert: {
    id: "desert",
    surface: "sand",
    side: "sand",
    subsurface: "sandstone_top",
    deep: "stone",
    snowLine: 0,
    trees: [CACTUS],
    treeDensity: 0.02,
  },
  snow: {
    id: "snow",
    surface: "snow",
    side: "snow",
    subsurface: "dirt",
    deep: "stone",
    snowLine: 0,
    trees: [SPRUCE],
    treeDensity: 0.08,
  },
  volcanic: {
    id: "volcanic",
    surface: "blackstone_top",
    side: "basalt_side",
    subsurface: "basalt_side",
    deep: "blackstone",
    snowLine: 0,
    trees: [],
    treeDensity: 0,
    lava: true,
  },
};

/** Select a palette. `volcanicMask` in [0,1] wins above 0.72 in mixed mode. */
export function pickBiome(mode: MtBiome, temp: number, humid: number, volcanicMask: number): BiomePalette {
  if (mode === "volcanic") return BIOMES.volcanic;
  if (mode === "plains") return BIOMES.plains;
  if (mode === "forest") return BIOMES.forest;
  if (mode === "desert") return BIOMES.desert;
  if (mode === "snow") return BIOMES.snow;
  if (volcanicMask > 0.72) return BIOMES.volcanic;
  if (temp < 0.34) return BIOMES.snow;
  if (humid > 0.62) return BIOMES.forest;
  if (temp > 0.66 && humid < 0.42) return BIOMES.desert;
  return BIOMES.plains;
}

/** Surface texture given the column height (snow caps and rocky peaks). */
export function surfaceFor(
  palette: BiomePalette,
  height: number,
): { top: string; side: string; tint?: "grass" | "foliage" } {
  if (height >= 18) return { top: "stone", side: "stone" };
  if (palette.snowLine > 0 && height >= palette.snowLine) return { top: "snow", side: "snow" };
  return { top: palette.surface, side: palette.side, tint: palette.tint };
}

export default { BIOMES, pickBiome, surfaceFor };
