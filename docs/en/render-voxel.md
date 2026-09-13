> 🌐 **English** · [Русский](../render-voxel.md)

# Voxel view (`mc-voxel`)

A "sandbox/voxel" renderer driver in the spirit of Minecraft: cubic blocks, pixel
textures, sky and day/night, water, particles, a "living world" (birds, blocky clouds, mice) and
cameras "orbit / third-person / first-person". Below is the design and technical details.

## 1. Goal

To give the renderer a "sandbox/voxel" look in the spirit of Minecraft: cubic blocks, pixel
16×16 textures, soft lighting with ambient occlusion, sky/clouds/fog, animated
water, destruction particles, day/night; at the same time — **maximally configurable** (a set
of settings and presets) and **detailed** (small details: textures, particles, shadows, effects).

Principles (do not violate):
- a new `RenderDriver` (not a patch): only reading `SceneState`, no writes to RAM, no
  `stepFrame/saveState/loadState`; selection is local (per-client), it does not go into `LobbySettings`.
- three.js (already a dependency), procedural textures; we **do not** use Mojang assets/names.
  This is a "voxel look", not Minecraft content. Texture packs are user-provided.
- Time/animations — only from `dtMs`/`scene.frame`, never `Date.now` (display determinism
  does not affect the game, but the rule is uniform).

## 2. Place in the architecture

- New driver `mc-voxel` in `shared/renderers.ts` (`kind:"driver"`,
  `provides:["three","camera","overlay-dom","voxel"]`), compatible with the extensions
  `particles`/`minimap`.
- The existing `topdown-3d` remains as the "clean" style; `mc-voxel` is the second 3D driver.
- Preview at start — via `RenderPicker`/`RendererPreview` (already present): for `mc-voxel`
  a live voxel demo scene with a slow fly-around is shown.
- Settings are stored locally (`bc_renderDriver`, `bc_renderExtensions` +
  the new `bc_renderOptions` JSON) and applied at start and in battle.

Minimal shared refactoring before the driver (phase 0): extract from `topdown-3d` the
three-scene skeleton (renderer/scene/camera/resize/lights) into `frontend/src/render/three/bootstrap.ts`,
so that `mc-voxel` and `topdown-3d` share it without duplication. `camera-rig.ts`,
`camera-controls.ts`, `scene-state.ts`, `coords.ts` are already shared.

```
frontend/src/render/
  three/
    bootstrap.ts          // WebGLRenderer + Scene + PerspectiveCamera + resize + dispose
  drivers/mc-voxel/
    driver.ts             // RenderDriver: mount/setScene/resize/render/dispose
    options.ts            // схема настроек, пресеты, валидация, сериализация
    atlas.ts              // сборка текстурного атласа
    world/
      blocks.ts           // Domain tile -> BlockId (+ UV в атласе, флаги solid/cutout/emissive)
      mesher.ts           // greedy meshing + culling + AO + vertex colors
      field.ts            // построение поля из SceneState.field, диффы, dirty-chunks
    models/
      tank.ts             // воксельный танк (классы/звёзды/каска/стан/гусеницы)
      base.ts             // орёл — блочная скульптура + состояния
      props.ts            // пули, призы (итемы), точки pacman
    sky/
      sky.ts              // купол градиента, солнце/луна, звёзды, облака, вода
    fx/
      particles.ts        // разрушение кирпича, искры, TNT-взрыв, пыль, muzzle flash
    ambient.ts            // птицы/мышки/облака («живой мир»)
    materials.ts          // opaque / cutout / translucent / emissive материалы
```

## 3. Visual language

- **Geometry**: only cubes/rectangular prisms, hard faces, no smoothing;
  the field block scale is 1 unit (8 px ≈ 16×16 texture).
- **Textures**: procedural 16×16 pixel art (option 32×32), `NearestFilter`, without
  smoothing; an atlas to minimize draw calls. The palette is closer to NES/BC, but "blocky".
- **Lighting**: Hemisphere (sky/ground) + Directional "sun"; ambient occlusion
  baked into vertex colors (smooth lighting like in MC); optionally shadows (PCFSoft).
- **Sky**: a gradient dome, sun/moon (Quads), layered flat clouds (slow
  drift), stars (Points) at night; fog tinted to the sky; modes `noon/day/sunset/night/cycle`
  (`cycle` is visual only, from `scene.frame`).
- **Water**: a separate translucent layer, 2 layers of animated UV + a slight wave; the option
  "transparency/depth".
- **Effects**: particles of the destroyed block's color (brick/steel/ice), sparks, TNT explosion,
  dust from under the tracks, muzzle flash (a point light for 1 frame), prize glint/floating,
  slight foliage sway (vertex shader), a splash on water.
- **Highlight/outline**: a black outline of blocks in MC style (option), highlighting the cell
  under the camera cursor (decorative, if enabled).

## 4. Mapping the Battle City domain → blocks

Collision buffer tiles (`@core/domain` `TILE`) → blocks:

| Domain | Values | Block | Features |
|---|---|---|---|
| Empty | `0x00` | air | not rendered |
| Brick | `0x01..0x0f`, `0x13/0x14` | bricks | **by quadrants** (4 sub-cubes, like `brickHit`): intact/damaged; cracks by remainder |
| Steel | `0x10/0x11` | iron_block / smooth_stone | metal, glints, sparks on hit |
| Water | `0x12` | water | animated, translucent |
| Ice | `0x21` | packed_ice / blue_ice | semi-transparent, slippery face |
| Trees | `0x22` | oak_leaves | cutout/alpha, sway, hides tanks (drawn on top) |
| Road | `0x20..0x7f` (except water/ice/tree) | dirt_path / gravel | decorative ground, no collision |
| Eagle | `0xc8..0xcb` | base structure | see below |
| Field frame | steel rim outside bounds | cobblestone/bedrock frame | arena border |

**Eagle/HQ**: a block sculpture on a pedestal of quartz/stone brick; states:
intact (gold blocks/"nether star" in the beak), destroyed (debris/cracked), fortified (a cage
of iron bars/obsidian shell). Position/state — from `scene.eagle`.

**Tanks (`models/tank.ts`)**: voxel models made of cubes:
- tracks — "iron/gray" blocks with an animated tread texture offset;
- hull — the team's wool (DEF gold/yellow, ATT white-gray), armored — iron armor
  + bolted plates, fast — an elongated hull;
- turret + barrel (a cubic piston/hopper texture);
- flashing bonus enemy — "sea lantern/redstone lamp" (emission pulse);
- DEF stars — small "gold ingot/nether star" on the turret; helmet — a glass dome;
  stun — floating "spark" particles; ice — a slight tilt/slide.
- Rotation by `dir`, tracks are animated by `moving`.

**Bullets** — a small emissive cube ("fire charge/magma") + trail particles.
**Prizes** — floating rotating "items" (blocky): helmet→iron helmet palette,
clock→clock, shovel→shovel, star→nether star, grenade→TNT, life→heart/golden apple,
pistol→crossbow. Bob+spin+glint.
**Pacman dots** — "glowstone dust"/XP orbs (Points/InstancedMesh).

Positions/centering — already verified `coords.ts` (tank: RAM=center; prize 16×16 and bullet
8×8: RAM=top-left → `spriteCenter`).

## 5. Technical design (three.js)

### 5.1 Texture atlas
- 16×16 tiles are packed into an atlas (e.g. 8×8 tiles = 128×128) → one texture, 1 material
  per pass (opaque/cutout/water/emissive), `NearestFilter`, `generateMipmaps:false`.
- Pixel-art generators on `canvas`: brick (offset rows + seam), stone/cobblestone
  (noise), iron (frame+rivets), ice (faces), log (annual rings), leaves
  (noise+alpha), ground/gravel, wool (team tint), glass, TNT, "star", etc.
- **Texture packs**: the setting `texturePack: "builtin" | "<url>"` (a PNG atlas or a manifest
  by block names). We do not bundle third-party packs; the user connects their own.

### 5.2 Chunks, greedy meshing, AO
- The 26×26×H field is split into 8×8 chunks (1 layer of blocks in height, H=1 for walls; tanks —
  separate models). Rebuild — only dirty chunks (diff of `SceneState.field`).
- `mesher.ts`: greedy meshing of identical faces (merging into quads) + culling of
  invisible faces between solid blocks; faces with alpha/water — separate passes.
- `AO`: for each face corner we count 3 neighbors (the classic MC formula) → vertex color
  (shading); modes `off/simple/smooth`.

### 5.3 Materials and light
- `materials.ts`: opaque (MeshLambert/Standard + atlas), cutout (leaves, alphaTest),
  translucent (water/ice, depthWrite:false), emissive (lava/lamp/bullet, prizes).
- `lighting.ts`: HemisphereLight + DirectionalLight (sun), optionally
  `shadowMap: PCFSoft`, shadow-camera by the field bounds; day/night changes color/direction.

### 5.4 Sky and atmosphere (`sky/`)
- A `BackSide` sky dome with a vertical gradient (top/horizon), sun/moon —
  billboard quads, stars — Points, clouds — several flat layers with slow
  drift. Fog (`FogExp2`/linear) is consistent with the horizon and `renderDistance`.
- Time modes: `noon/day/sunset/night/cycle`; `cycle` is animated from the renderer's running
  time (visually), without affecting the game.

### 5.5 Camera
- We inherit the shared `CameraRig` (yaw/pitch/roll/zoom/pan + field tilt). The actual MC options:
  `cameraMode: orbit | third | first` (the game is controlled by the WASD tank, the camera is view only),
  `cameraFollow` (smoothly turn to follow the tank), `fov` (50..95).
  `collision`/`headBob`/`smooth` from the original design are not implemented.

### 5.6 Effects (`fx/`)
- A particle pool (Points/InstancedMesh) for events from `SceneState` (tank explosion, hit
  on brick/steel, shot, respawn). Colors — from the block texture. Density — a setting.
- An instantaneous point light for a shot/explosion (limited so as not to hurt performance).

## 6. Settings and presets

`McVoxelOptions` (JSON in `bc_renderOptions`), with validation and defaults:

```
cameraMode: "orbit" | "third" | "first"
cameraFollow: boolean
time: "noon" | "day" | "sunset" | "night" | "cycle"
lighting: "mc" | "flat"
ao: "off" | "simple" | "smooth"      # не ambientOcclusion
shadows: "off" | "soft"
fog: 0..1
clouds: "off" | "flat" | "voxel"     # не volumetric
birds: boolean
mice: boolean
water: "off" | "simple" | "animated"
particles: 0..2
textureSize: 16 | 32
fov: 50..95
outline: boolean
vignette: boolean                     # пост-обработка: только виньетка
cloudsDrift: boolean
```

The settings schema generates the UI automatically (`shared/renderers.ts`, `settings`/presets).

Presets: **Classic Voxel** (noon, mc light, AO smooth, shadows off), **Survival** (cycle,
shadows soft, fog, particles 2), **Cinematic** (sunset, bloom, grade mc, shadows soft),
**Performance** (flat light, AO off, shadows off, small renderDistance, particles 0),
**Retro 16** (textureSize16, outline on, no post).

UI: an extension of the view-selection panel (`RenderPicker` before start + `RenderSettings` in battle):
sections "Style", "Light/shadows", "Sky/fog", "Water/particles", "Camera", "Post-processing",
preset selection and "Reset". The preview updates live when settings change.

## 7. Performance

- Atlas + greedy meshing + chunks → a handful of draw calls per field; dirty rebuild.
- Instancing for particles/dots; object pools; frustum culling (built in).
- Shadows/bloom/volumetric clouds — only per setting; shadows — low resolution.
- Budget: **60 fps** with 8 tanks on a mid-range GPU; field ≤ ~5k triangles (greedy),
  ≤ ~100 draw calls, particles ≤ 2k.
- The "Performance" preset as a safety net for weak/mobile devices.

## 8. Tests and enforcement

- Pure modules: `blocks.ts` (tile→block table), `options.ts` (presets/validation),
  `mesher.ts` (greedy merging, quad count, AO values), `atlas.ts` (UV layout).
- Contract: `mc-voxel` in `shared/renderers.ts` + `assertRenderersConsistent`
  (`qa/tests/renderers.test.ts`); extension compatibility by capabilities.
- Architecture (already present): the render layer does not import `pvp.ts`, does not call
  `stepFrame/saveState/loadState`, the core/network/backend do not pull in the render layer.
- The "display only" invariant: `readScene` is pure (a test exists); changing the driver/settings
  does not affect hashes/save/load.
- Optional: a Playwright screenshot of the preview (visual smoke), not in the mandatory CI.

## 9. Out of scope

- Real Minecraft assets/mobs/crafting; sound (can be a separate phase).
- Changing game logic/rules; any writes to RAM.
