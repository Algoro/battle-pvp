> 🌐 **English** · [Русский](../render-meine-tank.md)

# Voxel view `meine-tank` (Minecraft-fidelity)

A dedicated `RenderDriver` designed for maximum similarity to Minecraft, using **selected**
textures from the Faithful 32x resource pack (never the whole pack). Like every render
driver it is display-only: it reads a read-only `SceneState` and never affects RAM, core
frames, rollback/desync, hashes or the fingerprint.

## 1. Difference from `mc-voxel`

- `mc-voxel` is a procedural "voxel look"; `meine-tank` uses real textures and MC shapes
  (full cube, slab, cross plants, billboard items).
- The new driver is self-contained: only shared scaffolding is reused
  (`three/bootstrap`, `camera-rig`, `camera-controls`, `coords`, `render/settings`,
  `render/types`); `mc-voxel` internals are not imported.
- Adds configurable fauna (bees, parrots, chickens, bats, allays) on real entity skins.

## 2. Assets and license

- Manifest: `frontend/src/render/drivers/meine-tank/textures/manifest.ts` — only the needed
  textures (blocks/items/particles/environment/entity, ~140 files).
- Extraction: `node scripts/build-meine-tank-textures.mjs [pack.zip]` — writes to
  `frontend/public/textures/meine-tank/` (the source `.zip` is git-ignored).
- Faithful v3 license: `frontend/public/textures/meine-tank/LICENSE.txt`, attribution in
  `THIRD_PARTY.md` and `frontend/public/THIRD_PARTY.txt`. The pack is not monetized.

## 3. Architecture

```
frontend/src/render/drivers/meine-tank/
  driver.ts            RenderDriver: mount/setScene/setOptions/resize/render/dispose
  options.ts           settings types (schema lives in shared/renderers.ts)
  materials.ts         opaque / cutout / translucent / water (animated + wave)
  textures/            manifest, loader, atlas, animated
  world/               blocks, mesher, field, decor
  models/              lib, tank, base, props; mobs/{boxuv, geometry, defs}
  fauna/               manager (spawning/behaviour/animations)
  fx/                  particles (sprite atlas), sprites
  sky/                 sky (day/night, sun/moon, stars, clouds)
```

## 4. World

- The field from `SceneState.field`: brick → `bricks` (damaged → `cracked_stone_bricks`
  with per-quadrant height), steel → `iron_block`, water → animated `water_still`,
  ice → `blue_ice`, trees → `oak_leaves` (cutout, biome tint), road → `dirt_path`,
  ground → `grass_block_top` + `grass_block_side`.
- Mesher: shared-face culling, smooth AO, tint, separate passes (opaque/cutout/
  translucent/water), optional outline.
- Stage themes: `classic` / `desert` / `wasteland` (change ground and road).
- Decor (`decor`): flowers, grass, boulders — seeded from field size, no collision.

## 5. Models and effects

- Tanks built from block textures (team hull `*_concrete`, tracks, turret, barrel,
  bonus lamp, stars, helmet, stun).
- HQ from quartz/gold; "fortified" and "destroyed" states.
- Prizes are flat MC item sprites (including animated `clock_*`); bullets use
  `fire_charge`/`magma` with a trail.
- Particles use a sprite atlas (`explosion_*`, `big_smoke_*`, `flame`, `critical_hit`, …).

## 6. Outer world (border and life beyond)

The arena no longer floats in a void: optionally a plateau border and an extensive world
beyond it are generated (`world/outer.ts`, `world/noise.ts`, `world/biomes.ts`).

- **Border** (`border`): `off` / `edge` (low stone kerb + plateau cliff) / `wall`
  (2.4-high wall with a crenellated cap).
- **Terrain** (`outerWorld`): `off` / `hills` / `full` (rivers, forests, volcanoes).
  Height uses seeded fBm + ridge noise; the plateau is blended near the arena and the
  terrain falls off toward the outer edge.
- **Biomes** (`outerBiome`): `mixed` (by temperature/humidity), `plains`, `forest`,
  `desert`, `snow`, `volcanic`. Surface/edge/depth use real blocks (`grass_block`, `sand`,
  `snow`, `basalt`, `blackstone`, …), grass gets a biome tint, snowy peaks and stone above 18.
- **Rivers** (`outerRivers`): channels from ridge noise, water at level −1 (animated
  `water_still`).
- **Trees** (`outerTrees`): seeded planting (oak/birch/spruce/cactus) via `InstancedMesh`;
  a trunk plus a few crown layers.
- **Volcanoes** (`outerVolcano`): 1–2 cones (basalt/blackstone), a lava crater (animated
  `lava_still`, emissive) and `magma` fields.
- **Lava rivers**: channels are traced downhill from the crater (steepest descent, with
  widening). Where lava touches water the water cells turn into **obsidian**; trees near
  lava become **charred stumps** (`basalt`). Everything is computed **once** per world
  rebuild (`world/lava.ts`); there is no per-frame simulation.
- **Outer mobs** (`outerMobs`): rabbits and foxes spawn on the terrain, walk on its height
  (`heightAt`) and avoid the edge.
- **Dragons** (`outerDragons`): a large MC model (`enderdragon/dragon`) flying high above
  the world, with flapping wings and gentle sway.
- **Radius** (`outerRadius`, 24–96) bounds generation; the world is built once per settings
  change and the terrain is split into per-material chunks (frustum culling).

## 7. Fauna

- Real entity skins, models built with MC box-UV (`models/mobs/boxuv.ts`,
  `models/mobs/geometry.ts`).
- Species: **bee, parrot, chicken, bat, allay** (arena) and **rabbit, fox, cow, pig,
  frog, axolotl, dragon** (outer world).
- Behaviour: wandering, edge avoidance, reactions to tanks in `lively` mode, walking on
  the outer terrain.
- Fully configurable: `fauna` (off/ambient/lively), `faunaDensity`, groups
  (`faunaBees`, `faunaBirds`, `faunaBats`, `faunaAllay`, `faunaSmall`, `faunaLivestock`,
  `faunaAquatic`), `faunaTime`, shadows.

## 8. Graphics and settings

The image goes through **ACES HDR tone mapping** (`renderer.toneMapping`) with adjustable
**exposure**, and **normal maps** are generated procedurally from the albedo (Sobel on
luminance) — blocks and bricks gain relief without an external PBR pack. Materials are PBR
(`MeshStandardMaterial`: map + normal map, roughness/metalness); water uses a wave vertex
shader.

Schema lives in `shared/renderers.ts` (auto-UI): camera and FOV, time of day, lighting, AO,
shadows, fog, clouds, water, decor, theme, particles, texture size (32/16), outline, the
"Graphics" group (exposure, relief), the "Outer world" block and the fauna block. Presets:
`vanilla`, `cinematic`, `lively`, `performance`, `retro16`. Stored locally
(`bc_renderOptions`), never sent to the lobby.

Next graphics steps (in progress): safe emissive bloom, SSAO, water reflections, physical
sky and volumetric clouds — as separate options.

## 9. Tests

- `frontend/tests/meine-tank.test.ts` — manifest, tile/theme mapping, settings,
  `faunaGroups`, particles, noise (determinism/range), biome selection, snowy peaks.
- `qa/tests/renderers.test.ts` — manifest/registry consistency.
- Live visual run — Playwright (`qa/e2e/meine-tank.spec.ts`).
