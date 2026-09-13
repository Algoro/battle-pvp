// manifest.ts — curated asset manifest for the `meine-tank` renderer.
//
// Only the listed textures are extracted from the source resource pack
// (`scripts/build-meine-tank-textures.mjs`); the whole pack is never bundled.
// Logical `name` is what the code uses; `path` is the location inside the pack
// under `assets/minecraft/textures/`.
//
// This module is dependency-free on purpose: the build script imports it via
// Node's native type stripping, and frontend tests validate it without a DOM.

export type AssetKind = "block" | "item" | "particle" | "environment" | "entity";

export interface TextureAsset {
  /** Logical name used by the code (block registry, models, particle atlas). */
  name: string;
  /** Path inside the resource pack under `assets/minecraft/textures/` (with extension). */
  path: string;
  kind: AssetKind;
  /** Frame count for a vertical animation strip (e.g. water_still = 32). */
  animated?: number;
}

function blocks(names: string[]): TextureAsset[] {
  return names.map((n) => ({ name: n, path: `block/${n}.png`, kind: "block" }));
}

function items(names: string[]): TextureAsset[] {
  return names.map((n) => ({ name: n, path: `item/${n}.png`, kind: "item" }));
}

function numbered(prefix: string, count: number, kind: AssetKind, dir: string): TextureAsset[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}`,
    path: `${dir}/${prefix}${i}.png`,
    kind,
  }));
}

const BLOCK_TEXTURES = blocks([
  // Field: destructible walls, indestructible steel, water, ice, foliage, road, ground.
  "bricks",
  "cracked_stone_bricks",
  "iron_block",
  "netherite_block",
  "water_still",
  "water_flow",
  "blue_ice",
  "packed_ice",
  "oak_leaves",
  "dirt_path_top",
  "dirt_path_side",
  "grass_block_top",
  "grass_block_side",
  "dirt",
  "coarse_dirt",
  "gravel",
  "cobblestone",
  "mossy_cobblestone",
  "bedrock",
  "stone_bricks",
  "sand",
  "sandstone_top",
  // Eagle / HQ.
  "quartz_block_top",
  "quartz_block_side",
  "chiseled_quartz_block",
  "gold_block",
  "gilded_blackstone",
  "obsidian",
  "crying_obsidian",
  "iron_bars",
  "deepslate_tiles",
  "blackstone_top",
  "anvil_top",
  "polished_blackstone_bricks",
  "lodestone_top",
  "beacon",
  // Tanks.
  "yellow_concrete",
  "white_concrete",
  "light_gray_concrete",
  "gray_concrete",
  "red_concrete",
  "black_concrete",
  "polished_blackstone",
  "smooth_stone",
  "cut_copper",
  "dispenser_front",
  "dropper_front",
  "piston_top",
  "lightning_rod",
  "redstone_lamp",
  "sea_lantern",
  "shroomlight",
  "glass",
  // Props and explosives.
  "tnt_top",
  "tnt_side",
  "tnt_bottom",
  "magma",
  "glowstone",
  // Habitats and decoration.
  "bee_nest_side",
  "beehive_side",
  "torch",
  "lantern",
  "short_grass",
  "fern",
  "dead_bush",
  "poppy",
  "dandelion",
  "cornflower",
  "allium",
  "azure_bluet",
  "oxeye_daisy",
  "blue_orchid",
  "red_tulip",
  "orange_tulip",
  "white_tulip",
  "lily_of_the_valley",
  "cactus_top",
  "cactus_side",
  "oak_log",
  "cobweb",
  "snow",
  // Outer world: terrain, biomes, mountains, volcanoes.
  "stone",
  "andesite",
  "granite",
  "diorite",
  "ice",
  "powder_snow",
  "spruce_log",
  "spruce_leaves",
  "birch_log",
  "birch_leaves",
  "dark_oak_leaves",
  "podzol_top",
  "mycelium_top",
  "red_sand",
  "red_sandstone_top",
  "terracotta",
  "white_terracotta",
  "orange_terracotta",
  "brown_terracotta",
  "clay",
  "basalt_side",
  "basalt_top",
  "smooth_basalt",
  "blackstone",
  "lava_still",
  "lava_flow",
]);

const ITEM_TEXTURES = items([
  "nether_star",
  "iron_helmet",
  "iron_shovel",
  "golden_apple",
  "crossbow_standby",
  "fire_charge",
  "ender_pearl",
  "gold_nugget",
  "iron_ingot",
  "gunpowder",
]);

const PARTICLE_TEXTURES: TextureAsset[] = [
  ...numbered("explosion_", 16, "particle", "particle"),
  ...numbered("big_smoke_", 12, "particle", "particle"),
  ...["flame", "critical_hit", "enchanted_hit", "flash", "lava", "bubble", "glow", "heart", "note", "angry"].map(
    (n) => ({ name: n, path: `particle/${n}.png`, kind: "particle" as const }),
  ),
];

const ENVIRONMENT_TEXTURES: TextureAsset[] = [
  { name: "sun", path: "environment/celestial/sun.png", kind: "environment" },
  { name: "moon_full", path: "environment/celestial/moon/full_moon.png", kind: "environment" },
];

// Wave 1 fauna skins (Faithful entity textures, exactly 2x vanilla resolution).
const ENTITY_TEXTURES: TextureAsset[] = [
  { name: "bee", path: "entity/bee/bee.png", kind: "entity" },
  { name: "parrot_green", path: "entity/parrot/parrot_green.png", kind: "entity" },
  { name: "parrot_blue", path: "entity/parrot/parrot_blue.png", kind: "entity" },
  { name: "parrot_grey", path: "entity/parrot/parrot_grey.png", kind: "entity" },
  { name: "parrot_red_blue", path: "entity/parrot/parrot_red_blue.png", kind: "entity" },
  { name: "parrot_yellow_blue", path: "entity/parrot/parrot_yellow_blue.png", kind: "entity" },
  { name: "chicken", path: "entity/chicken/chicken_temperate.png", kind: "entity" },
  { name: "bat", path: "entity/bat/bat.png", kind: "entity" },
  { name: "allay", path: "entity/allay/allay.png", kind: "entity" },
  // Wave 2 + dragons (outer world).
  { name: "rabbit_brown", path: "entity/rabbit/rabbit_brown.png", kind: "entity" },
  { name: "fox", path: "entity/fox/fox.png", kind: "entity" },
  { name: "fox_snow", path: "entity/fox/fox_snow.png", kind: "entity" },
  { name: "dragon", path: "entity/enderdragon/dragon.png", kind: "entity" },
  // Livestock and aquatic.
  { name: "cow", path: "entity/cow/cow_temperate.png", kind: "entity" },
  { name: "pig", path: "entity/pig/pig_temperate.png", kind: "entity" },
  { name: "frog", path: "entity/frog/frog_temperate.png", kind: "entity" },
  { name: "axolotl", path: "entity/axolotl/axolotl_lucy.png", kind: "entity" },
];

/** Animated block textures: vertical strips with an explicit frame count. */
const ANIMATED: Record<string, number> = { water_still: 32, water_flow: 32, lava_still: 32, lava_flow: 32 };

export const MEINE_TANK_TEXTURES: TextureAsset[] = [
  ...BLOCK_TEXTURES,
  ...ITEM_TEXTURES,
  ...PARTICLE_TEXTURES,
  ...ENVIRONMENT_TEXTURES,
  ...ENTITY_TEXTURES,
].map((a) => (ANIMATED[a.name] ? { ...a, animated: ANIMATED[a.name] } : a));

/** Texture name -> asset (throws on duplicates). */
export const TEXTURE_BY_NAME: Map<string, TextureAsset> = (() => {
  const map = new Map<string, TextureAsset>();
  for (const a of MEINE_TANK_TEXTURES) {
    if (map.has(a.name)) throw new Error(`meine-tank: duplicate texture name «${a.name}»`);
    map.set(a.name, a);
  }
  return map;
})();

/** License file that must ship next to the extracted textures. */
export const LICENSE_FILE = "LICENSE.txt";

export default MEINE_TANK_TEXTURES;
