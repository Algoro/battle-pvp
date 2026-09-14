> 🌐 **English** · [Русский](../emulator-api.md)

# Core API (`emulator-core` / `PvPNes`)

`PvPNes` is a subclass of the **immutable** `NES` from jsnes (submodule `vendor/jsnes`).
Relative path: `./emulator-core/pvp.ts`. Battle City patches are applied to the
in-memory PRG image (see `rom-patching.md`).

## Creating and loading a ROM

```js
import PvPNes, { BTN } from "./emulator-core/pvp.ts";

const emu = new PvPNes({ patchSet: "pvp", features: ["pistol"], attAI: "lookahead", defAI: "plan" });
emu.loadROM(originalRomBytes);       // Uint8Array/ArrayBuffer — the ORIGINAL ROM
emu.patching;                        // patch application report: { features, fingerprint, applied, routines }
```

Sound is enabled with the options `sampleRate: 48000` + `onAudioSample` (see `audio.md`).

Without `patchSet` the core works on the ROM "as is" (used in tests with an already patched
image). With `patchSet: "pvp"` the original is loaded and patched only in memory.

## API

| Method | Description |
|---|---|
| `loadROM(data)` | Loads the ROM. With `opts.patchSet`, applies patches before `createMapper()`. |
| `stepFrame(inputs)` | One frame. `inputs = [{port, buttons}]`; `buttons` — a bitmask (A=$01 B=$02 Select=$04 Start=$08 Up=$10 Down=$20 Left=$40 Right=$80). Returns the frame hash. |
| `saveState()` / `loadState(bytes)` | Deterministic binary state snapshot (including the full RAM image). |
| `getFrameHash()` | FNV-1a32 over `cpu.mem` — for desync detection. |
| `readMem(addr)` | Reads a byte from CPU memory. |
| `patching` | Patch application report after `loadROM` with `patchSet`: `{ fingerprint, applied, routines }`. |
| `setStartStage(stage)` | Starting stage of the game (1..35), injected deterministically. |
| `setStartStars(stars)` | Starting DEF team stars (0..3) — tank upgrade (`ram_tank_upgrade`). |
| `setStartPistol(on)` | Starting DEF super-weapon (analog of the 4th star): max stars + pistol (`ram_pistol`/`ram_pistol_ammo`). No-op without the `pistol` feature. |
| `setFeatureOptions(options)` / `getFeatureOptions()` | Feature settings (`id → values`); applied on the next `reset()`. See `optional-patches.md`. |
| `opts.features` | Optional feature-patches (`features: ["pistol"]`) are passed to the `PvPNes` constructor and applied in `loadROM`. At the frontend level — `EmulatorDriver.setPatchFeatures()`/`getPatchFeatures()` (applied on the next `reset()`). See `optional-patches.md`. |
| `setPlayerNames(map)` | Map `port → name` for the `player-names` feature: the name is drawn above the tank (BG-overlay nametable, ROM font). Does not affect the hash/rollback. |
| `getStage(stage)` / `getStageBlocks(stage)` / `getStageCount()` | Stage data from the ROM in memory (13×13 blocks, CHR tiles, attributes) for preview. |
| `getBlockTiles(id)` / `getBlockAttribute(id)` | CHR tiles and stage block palette (needed to preview TD maps from `shared/`). |
| `featureCommand(id, order)` | Generic command channel to a feature: `id` — feature id, `order` is placed on its queue (processed by the runtime in `preFrame`). |
| `getFeatureState(id)` | Snapshot of the state the feature publishes for the UI (the feature's object or `null`). |
| `setAudioSuppressed(bool)` | Audio gate: when `true`, `onAudioSample` is not called (rollback replay). |
| `setHumanTank(port)` / `setHumanDefTank(port)` | Mark a tank as human-controlled (AI does not play it). |
| `setAttAI(mode)` / `setDefAI(mode)` | AI mode (see `ai.md`). |

## Inputs (ports)

- Ports `0,1` (**DEF**) → hardware `$4016/$4017`.
- Ports `2..7` (**ATT**) → RAM zone `ram_net_*` (written by the core):
  - `ram_net_enemy_dir` `$01DB` (6 b): 0=Up 1=Left 2=Down 3=Right, `FF`=no input;
  - `ram_net_enemy_fire` `$01E1` (6 b): fire edge;
  - `ram_net_enemy_respawn` `$01E7` (6 b): respawn edge.
- Edge detection (`press = hold & ~prev`) is performed inside the core for ports `2..7`.

## Determinism

- The game loop does not use `Date.now`/`performance.now`/`Math.random`.
- PRNG (`$0F`) is deterministic and is part of save/load state.
- `getFrameHash()` is identical across independent instances with the same input.
- WASM (`emulator-core/wasm/hash.c` → `hash.wasm`) — a verified port of the FNV-1a hot path
  (test `wasm.test.ts`); the runtime uses the JS implementation.

## Rendering and introspection

- `emu.ppu.buffer` — `Uint32Array(256×240)` of the current frame (in canvas: `0xff000000 | buf[i]`).
- `emu.cpu.mem` — the full CPU address space (RAM + ROM).
- `FeatureContext.options` — the settings values of the current feature (defaults + overrides), `FeatureContext.kernel` provides visual buffers: `ppuNameTable`, `ppuSpriteMem`, `ppuVram`,
  as well as `ppuBuffer` (frame buffer) and `ppuSpritePalette` (sprite palette) —
  used by 2D overlays of features (e.g. TD).

### Rendering layer (drivers and extensions)

Drawing is moved out of the core into a separate layer (`frontend/src/render/`, see
`render-extensions.md`). The host calls `EmulatorDriver.setFrameRenderer(fn)` once,
and `step()`/`draw()` invoke the installed callback; what to draw with is determined by the selected
**render driver**:

- `pixel-2d` (default) — the PPU frame 256×240;
- `topdown-3d` — volumetric field (`render-3d.md`);
- `meine-tank` — voxel world with Minecraft textures (`render-meine-tank.md`).

Extensions (`minimap`, `particles`) are overlaid by the host `RenderSystem`. Drivers read
only `SceneState` (`readScene`, from RAM/PPU) and do not affect the core step, hashes, save/load and
the net protocol; the choice is stored locally (`bc_renderDriver`/`bc_renderExtensions`).
