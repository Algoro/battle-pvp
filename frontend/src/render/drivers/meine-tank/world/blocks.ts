// blocks.ts — Minecraft block registry for the `meine-tank` driver and the mapping
// from Battle City collision tiles to blocks. Data-driven: textures come from the
// curated Faithful atlas.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/blocks.ts
import { isBrick, isSteel, isWater, isIce, isTree, isEagleTile, isRoad } from "@core/domain.ts";
import type { MtTheme } from "../options.ts";

export type BlockPass = "opaque" | "cutout" | "translucent" | "water";
export type BlockTint = "none" | "grass" | "foliage";

export interface BlockDef {
  pass: BlockPass;
  /** Bottom/height of the block in field-cell units. */
  y0: number;
  h: number;
  solid: boolean;
  top: string;
  side: string;
  bottom: string;
  tint?: BlockTint;
}

/** Grass/foliage biome tints (Minecraft plains). */
export const GRASS_TINT = 0x91bd59;
export const FOLIAGE_TINT = 0x77ab2f;

export const BLOCK: Record<string, BlockDef> = {
  brick: { pass: "opaque", y0: 0, h: 1, solid: true, top: "bricks", side: "bricks", bottom: "bricks" },
  brickDamaged: {
    pass: "opaque",
    y0: 0,
    h: 0.62,
    solid: true,
    top: "cracked_stone_bricks",
    side: "cracked_stone_bricks",
    bottom: "bricks",
  },
  steel: { pass: "opaque", y0: 0, h: 1, solid: true, top: "iron_block", side: "iron_block", bottom: "iron_block" },
  // Water and ice are floor-level tiles in Battle City, not raised blocks:
  // thin slabs just above the ground so they read as flush.
  water: {
    pass: "water",
    y0: 0,
    h: 0.05,
    solid: false,
    top: "water_still",
    side: "water_still",
    bottom: "water_still",
  },
  ice: { pass: "translucent", y0: 0, h: 0.05, solid: true, top: "blue_ice", side: "blue_ice", bottom: "blue_ice" },
  leaves: {
    pass: "cutout",
    y0: 0,
    h: 1,
    solid: false,
    top: "oak_leaves",
    side: "oak_leaves",
    bottom: "oak_leaves",
    tint: "foliage",
  },
  path: { pass: "opaque", y0: 0, h: 0.16, solid: false, top: "dirt_path_top", side: "dirt_path_side", bottom: "dirt" },
  frame: { pass: "opaque", y0: 0, h: 1.05, solid: true, top: "stone_bricks", side: "stone_bricks", bottom: "bedrock" },
};

interface ThemeBlocks {
  groundTop: string;
  groundSide: string;
  groundBottom: string;
  groundTint?: BlockTint;
  roadTop: string;
  roadSide: string;
  roadBottom: string;
}

const THEMES: Record<MtTheme, ThemeBlocks> = {
  classic: {
    groundTop: "grass_block_top",
    groundSide: "grass_block_side",
    groundBottom: "dirt",
    groundTint: "grass",
    roadTop: "dirt_path_top",
    roadSide: "dirt_path_side",
    roadBottom: "dirt",
  },
  desert: {
    groundTop: "sand",
    groundSide: "sandstone_top",
    groundBottom: "sand",
    roadTop: "sandstone_top",
    roadSide: "sandstone_top",
    roadBottom: "sand",
  },
  wasteland: {
    groundTop: "coarse_dirt",
    groundSide: "coarse_dirt",
    groundBottom: "dirt",
    roadTop: "gravel",
    roadSide: "gravel",
    roadBottom: "dirt",
  },
};

export function themeBlocks(theme: MtTheme): ThemeBlocks {
  return THEMES[theme] ?? THEMES.classic;
}

function popcount(v: number): number {
  let n = 0;
  for (let b = 0; b < 4; b++) if (v & (1 << b)) n++;
  return n;
}

/** Block for a collision-buffer tile value (null = air / separate model). */
export function blockForTile(v: number, theme: MtTheme = "classic"): BlockDef | null {
  if (v === 0) return null;
  if (isBrick(v)) {
    if (v === 0x0f || v === 0x13 || v === 0x14) return BLOCK.brick;
    const q = popcount(v & 0x0f);
    if (q === 0) return null;
    return { ...BLOCK.brickDamaged, h: 0.3 + 0.7 * (q / 4) };
  }
  if (isSteel(v)) return BLOCK.steel;
  if (isWater(v)) return BLOCK.water;
  if (isIce(v)) return BLOCK.ice;
  if (isTree(v)) return BLOCK.leaves;
  if (isEagleTile(v)) return null; // eagle — a separate model
  if (isRoad(v)) {
    const t = themeBlocks(theme);
    return { ...BLOCK.path, top: t.roadTop, side: t.roadSide, bottom: t.roadBottom };
  }
  return null;
}

/** Solid occupancy at level y (for face culling and AO). */
export function solidAt(def: BlockDef | null, y: number): boolean {
  return !!def && def.solid && y >= def.y0 - 1e-6 && y <= def.y0 + def.h + 1e-6;
}

export default { BLOCK, blockForTile, solidAt, themeBlocks, GRASS_TINT, FOLIAGE_TINT };
