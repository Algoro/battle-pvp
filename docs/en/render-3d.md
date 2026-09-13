> 🌐 **English** · [Русский](../render-3d.md)

# 3D top-down view (`topdown-3d`)

An alternative three-dimensional renderer driver: a volumetric field with zoom and
rotation, **without changing the game** (RAM, core frames, rollback/desync/hashes, ROM patches
and fingerprint are untouched). Below is the design and technical details.

## 1. Problem statement

- New graphics: procedural 3D models of tanks, walls, the eagle (base), water/ice/trees,
  prizes, bullets and effects.
- A top-down 3D view with camera control: **zoom** and **rotation in different
  planes** — yaw, pitch, roll, plus panning.
- The patch is **display-only**: it reads the authoritative state (RAM/PPU) and draws
  it. No feedback into the simulation.

## 2. Place in the architecture: the renderer driver

The 3D view is **not a game patch** and not a "mode" inside the core, but a **`RenderDriver`** in the new
render layer (`render-extensions.md`). Here is its concrete implementation,
`topdown-3d`, the first of the alternative drivers.

Consequences (fully consistent with the render-layer invariants):

- it is **not** registered in `shared/features.ts` and is **not** part of the patch set
  (`applyPatchSet`, fingerprint, handshake, `match.start`); its metadata is in
  `shared/renderers.ts` (`kind: "driver"`, `provides: ["three","camera","overlay-dom"]`);
- it **does not** write to RAM, does not touch input, `stepFrame`, `saveState/loadState`, `getFrameHash`;
- it is selected **locally by each client** (solo, online and spectator), not by the host;
- it is isolated in `frontend/src/render/`; `emulator-core`, `netcode`, `backend` know nothing about it;
- compatible extensions (`particles`, `minimap`, …) are attached on top of it by the
  `RenderSystem` host; incompatible ones are skipped.

Thus switching drivers is guaranteed not to affect the match outcome: rendering never
calls `stepFrame` and receives only a read-only `SceneState`.

## 3. Architecture

```
shared/
  renderers.ts             манифест слоя рендера (id/kind/title/provides/requires)
frontend/src/
  engine/
    emulator.ts            игровое ядро БЕЗ отрисовки: stepFrame/save/load/readMem
  render/
    types.ts               RenderDriver / RenderExtension / RenderHost / SceneState
    registry.ts            registerRenderer / resolveDriver / resolveExtensions + assert
    render-system.ts       RenderSystem: композиция driver + [extensions], lifecycle
    camera-rig.ts          общая модель камеры (yaw/pitch/roll/zoom/pan)
    scene-state.ts         readScene(emu): SceneState — ЧИСТОЕ извлечение (RAM)
    tower-visual.ts        адаптация башен TD к модели танка (SceneState.towers)
    drivers/
      pixel-2d.ts          драйвер по умолчанию (текущий буфер PPU -> 2D canvas)
      topdown-3d/          ЭТОТ драйвер
        driver.ts          реализация RenderDriver (сцена/свет/земля — внутри)
        textures.ts        палитра NES + процедурные текстуры
        models/
          tank.ts          танк (DEF/ATT, 4 класса, гусеницы, башня, звёзды, каска/стан)
          terrain.ts       кирпич (квадранты!), сталь, вода, лёд, деревья, дорога
          base.ts          орёл: цел / разрушен / укреплён (лопата)
          props.ts         пули, призы (6 иконок), взрывы, спавн-маркеры, точки pacman
      extensions/
        particles.ts       пример расширения к topdown-3d (three)
        minimap.ts         пример DOM-оверлея (overlay-dom)
  components/
    GameCanvas.tsx         контейнер <RenderSystem> + RenderSettings
    SpectateView.tsx       то же для наблюдателя
    RenderSettings.tsx     выбор драйвера + расширений (локально, не в сеть)
```

`EmulatorDriver` no longer draws a frame: the game tick calls `render.frame(dtMs)` on
`RenderSystem`, which obtains `readScene(emulator)` from the provider. This covers solo
(`step`), online (`advance`/`draw`) and spectator through one path, without changing the network loop.

## 4. State extraction (no side effects)

We reuse the existing semantic layer `emulator-core/model/game-view.ts`
(`readState(mem)` → tanks/bullets/prizes/eagle/field). The wrapper `scene-state.ts`:

```ts
export interface SceneTank {
  index: number; team: "DEF" | "ATT";
  x: number; y: number;          // RAM-пиксели; мир = /8
  dir: 0 | 1 | 2 | 3;            // Up/Left/Down/Right
  state: "alive" | "spawning" | "exploding" | "dead";
  type: number;                  // 0x80/0xa0/0xc0/0xe0, bit 0x04 — мигающий
  stars: 0 | 1 | 2 | 3;          // DEF upgrade
  helmet: boolean; stunned: boolean; onIce: boolean;
  flashing: boolean; lives?: number;
}
export interface SceneState {
  frame: number;
  field: Uint8Array;             // 32×32 тайлов коллизий (копия)
  bounds: RenderBounds;          // видимая игровая зона (26×26)
  tanks: SceneTank[];
  bullets: SceneBullet[];
  prize: ScenePrize | null;
  towers: SceneTower[];          // башни tower defence (пусто в обычных режимах)
  eagle: SceneEagle;
  effects: SceneEffects;
  pixels: Uint32Array | null;    // ссылка на пиксельный буфер PPU (для pixel-2d)
}

// RenderEvent/events в финальной реализации не появились — эффекты строятся
// драйверами из дельт SceneState между кадрами.
export function readScene(emu: EmulatorDriver): SceneState; // чистая, без записи
```

- Coordinates: RAM pixel `x,y` → world `(x/8, y/8)`; an 8×8 px buffer cell = 1 unit.
  The field is 32×32, but the visible area is 26×26 cells (13×13 ROM blocks); we verify the bounds against
  `getStage()`/`StagePreview` and keep them configurable.
- `events` — for visual effects only (detecting transitions flag→0x73, bullet→0x33,
  brick destroyed, prize spawn/pickup). They are computed from prev/current slices; they do not write to RAM.
- `readScene` **never** calls `stepFrame` and does not mutate `mem`.

## 5. 3D models (procedural, low-poly)

No external assets. Geometry from three.js primitives, MeshStandard/Lambert materials,
NES palette. Battle City identity is preserved through silhouettes.

### 5.1 Tank (`models/tank.ts`)
Group: `hull` (body, slightly beveled), `turret` (sphere/cylinder), `barrel` (cylinder),
`tracks[2]` (boxes with "treads" — repeating segments), a team stripe (DEF/ATT).
- Direction `dir`: rotation of the group (Up/Left/Down/Right).
- ATT classes: basic (0x80), fast bullets (0xa0), fast (0xc0, elongated body),
  armored (0xe0, +shields, metal, armor indicator by `hitsLeft`).
- Flashing bonus enemy (`type & 0x04`): flickering emission/stripe.
- DEF: 0–3 stars on the turret (`RAM.TANK_UPGRADE`); helmet (`HELMET>0`) — a semi-transparent
  dome; stun (`STUN>0`) — rotating "stars" above the tank; ice (`onIce`) — a slight
  wobbling tilt.
- Tracks are animated by `RAM.TANK_WHEELS` (UV/segment shift) — visually, not in RAM.

### 5.2 Environment (`models/terrain.ts`)
- **Ground**: a dark plane + grid; road tiles (0x20..0x7f) — slabs of a different tone.
- **Brick**: *important* — the tile value is a bitmask of 4 quadrants
  (bit0 TL, bit1 TR, bit2 BL, bit3 BR). We assemble the model from 4 quarter-boxes, showing
  only the set bits → destruction in 3D **exactly matches** the `brickHit` logic.
  Material is brick-red, slightly rough.
- **Steel (0x10/0x11)**: a metal block with a bevel and rivets, taller than brick.
- **Water (0x12)**: an animated plane (normal/UV scroll), semi-transparent, tanks pass through.
- **Ice (0x21)**: a glossy light slab (low roughness), a slight glare.
- **Trees (0x22)**: a cluster of low-poly crowns; taller than a tank so as to cover it
  (in the original the bushes hide) — we draw on top with slight transparency.
- **Eagle/base** (`models/base.ts`): pedestal + eagle; states — intact (gold),
  destroyed (gray, "broken", when `game_over`), fortified (steel dome/cage,
  `RAM.FORTIFIED>0`). Position — from `eagle` (search for EAGLE tiles).

### 5.3 Objects (`models/props.ts`)
- **Bullet**: a small glowing capsule, oriented by `dir`, emission + slight pulsation.
- **Prizes (id 0..5)**: a floating rotating icon based on the ROM: helmet(0), clock(1),
  shovel(2), star(3), grenade(4), life/tank(5). Position from `PRIZE_X/Y`, bob animation.
- **Explosions**: a short particle burst/expanding sprite from `events` (tank/bullet/brick/HQ).
- **Spawn marker**: a rotating sign at the enemy spawn point (respawn flag 0xe0).
- **Pac-Man** (optional): dots — small glowing pills (Instanced), bombs — prize icons.

## 6. Camera and controls (zoom + rotation in different planes)

`camera-rig.ts` stores `{ yaw, pitch, roll, distance, target }`, computes the camera
position on a sphere around `target`, and applies `roll` with a quaternion.

Control handles:
- **Mouse**: LMB — orbit (yaw/pitch), RMB/Shift — pan, wheel — zoom.
- **Touch**: 1 finger — orbit, 2 fingers — pinch zoom + pan.
- **Keyboard**: Q/E — yaw, R/F — pitch, Z/C — roll, +/- — zoom, Space — reset.
- **`View3DControls` panel**: Zoom, Yaw, Pitch, Roll sliders + *field tilt* in X/Y/Z
  (rotating the field itself, not just the camera) and the presets "Top", "Isometric", "Free".

We implement "rotate in different planes" in two ways at once:
1. **Camera yaw/pitch/roll** — orbit along three axes;
2. **Euler rotation of the scene root** (`fieldRotation x/y/z`) — tilt the field itself
   (for example, lay the "table" at an angle) without touching the camera.

Clamp pitch (so as not to go under the floor), free yaw, roll ±180°. Smooth damping
in the rAF render loop (visual only, without stepping the core).

## 7. Integration into the render loop

- The driver mounts into the `RenderSystem` container and creates the needed canvas/DOM
  itself (a WebGL context is incompatible with 2D on the same canvas — that is why `pixel-2d` and `topdown-3d`
  have their own elements, and the host toggles visibility).
- `topdown-3d` is lazy: `three` is loaded on the first selection of the driver (`load()` in the
  registry), so the base 2D bundle does not grow. No WebGL → `RenderSystem` falls back to
  `pixel-2d` with a notification.
- The scene is updated from the game tick via `render.frame(dtMs)`; the driver's internal rAF
  is responsible only for animations/camera. There is no double `stepFrame`.
- Driver/extension selection is persisted (`bc_renderDriver`, `bc_renderExtensions`) and
  shared between `GameCanvas` and `SpectateView` via `RenderSettings`.

## 8. Performance

- The field is static: `InstancedMesh` for brick/steel/trees/road; rebuild only
  when the buffer changes (dirty diffs, not the whole frame).
- One directional + ambient light; shadows off by default (toggle).
- Tanks/bullets/prizes — a small number of objects; pacman dots — Instanced.
- Target — a stable 60 fps with 8 tanks.

## 9. Invariants and their verification with tests

- **The game does not change**: `emulator-core` test: two runs of identical inputs, in one
  `readScene` is called between frames, in the other it is not; `getFrameHash()` and the bytes of
  `saveState` match.
- **SceneState is deterministic and pure**: `readScene(mem)` does not mutate the input; identical
  mem → identical snapshot (`frontend/tests/scene-state.test.ts` unit tests).
- **Architectural enforcement** (`qa/tests/architecture.test.ts`): the modules
  `frontend/src/render/*` are not imported from `emulator-core`/`netcode`/`backend`;
  `emulator-core` does not depend on `three`/DOM.
- `camera-rig.ts` — pure pose/clamp functions (`frontend/tests/camera-rig.test.ts`).
