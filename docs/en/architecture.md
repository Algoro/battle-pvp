> 🌐 **English** · [Русский](../architecture.md)

# Architecture

Battle City PvP is an extension on top of the classic Battle City (NES). The **DEF**
team (2 tanks) defends the headquarters, the **ATT** team (up to 6) plays the former
enemy tanks. The emulator and the ROM are immutable components; everything else is
extensions around them.

## Layers

```
frontend/       React/TS SPA: canvas rendering, lobby, chat, spectator, HUD
netcode/        rollback-netcode: protocol, RollbackSession, transports
emulator-core/  core: PvPNes (extends jsnes NES), BattleCityPPU, patching/, features/ (feature JS runtimes), ai/, sim/, model/, io/
shared/         import-free manifests and shared data: features.ts, renderers.ts, tower-defence.ts
backend/        Node: HTTP + WS, matchmaking, lobby/rooms, signaling relay, SQLite
rom/            original/ (your ROM), patches/, disasm/ (asm reference), build utilities
vendor/jsnes/   git submodule: immutable jsnes upstream
```

## Immutable components

- **jsnes** — submodule `vendor/jsnes`. Not edited. The `emulator-core/src` copy
  is generated from it (`scripts/prepare.mjs`); guard test `jsnes-pristine.test.ts`.
  Extensions: `PvPNes extends NES`, `BattleCityPPU extends PPU` (`ppu-ext.ts`).
- **ROM** — the file is not modified. PvP patches are applied to the in-memory PRG image
  (`emulator-core/patching/`). For details, see `rom-patching.md`.

## ROM contract and certification

- **`rom-contract.ts`** — the single source of truth for RAM/ROM addresses (previously
  thousands of "magic" numbers were scattered around). Used by the core, the AI model, the sim, patching.
  Control bytes are verified by `assertRomContract()` (`startup.ts`).
- **`domain.ts`** — domain semantics: directions (`DIR_VEC`, `DIR_BTN`, `btnToDir`),
  tank flags (`isTankAlive/Active`, `movingFlag`), tiles (`isBrick/Steel`, `tankPassable`),
  bullets (`isBulletFlying`), upgrade (`starsToUpgrade`). Removes duplication and "magic" like `0xa0|dir`.
- **Enforcement** (`tests/no-magic-addresses.test.ts`): prohibits raw RAM/ROM addresses outside
  `rom-contract/domain/startup` — "magic" regressions are caught in CI.
- **`startup.ts`** — declarative boot/apply API for startup options (stage, stars,
  super-weapon `setStartPistol`): a single verifiable hook on entry to `sub_F000_draw_stage` instead of ad-hoc.
- **`features/*.ts`** — feature JS runtimes (feature settings — `ctx.options`, schema in `shared/features.ts`) (called by the core around the ROM frame
  `preFrame → frame() → postFrame → render`); shared enemy damage — `features/enemy-damage.ts`,
  pistol beam — `features/railgun.ts` (`fireRailgun`/`renderRailgunFx`), solo `tower-defence` —
  `features/tower-defence.ts`. Contract — `patching/runtime.ts`.
- **`patching/patches/pistol.ts`** — the "pistol" power-up (drop/pickup/4th star/reset);
  the beam effect is in JS (`features/railgun.ts`). See `pistol-powerup.md`.
- **`io/trace.ts`** — the AI trace was moved out of `PvPNes` (decomposing the god object);
  `stepFrame` was split into `_resetNetZone/_readInputs/_applyAttAIDecisions`.
- **`ai/rollforward.ts`** — prediction of the future on the **real emulator** (saveState +
  fast-forward), certified by a test; the basis for dropping the separate JS model (`sim/*`).
- **Golden certification** (`tests/golden-replay.test.ts`): core golden hash, convergence of
  two instances, save/load equivalence, determinism of startup options.
- **WS validation** (`backend/signaling/schema.ts`) — a declarative message schema.

## Match flow

1. A player selects a team (lobby or quick match) → the backend issues a room and a port.
2. WS signaling pairs WebRTC (SDP/ICE, STUN/TURN); on failure — relay via the backend.
3. `RollbackSession` wraps `PvPNes`: each frame the client sends its input, predicts
   opponents' input (2v2/N — via `MultiTransport`), and on late input — rolls back and replays.
4. Rendering: `nes.ppu.buffer` → canvas. Comparing `getFrameHash()` detects desync;
   on divergence — resync from a snapshot.

## Data flows and determinism

- Inputs: DEF ports `0,1` → `$4016/$4017`; ATT ports `2..7` → RAM zone `ram_net_*` (`$01DB+`).
- PRNG (`sub_D44D`) is deterministic — depends only on its own register and frame counters.
- `stepFrame(inputs)` is deterministic: same input → same `getFrameHash()`;
  `saveState/loadState` includes the full RAM image.

## Key decisions

- **Equal-size patches**: hooks of strictly equal size (JMP/JSR + NOP), new code in the
  unused zone `$EF75–$EFFF`; addresses of the original code do not shift.
- **Cartridge fingerprint** (`cartridgeFingerprint`) in the handshake — a match only with identical patches.
- **Transport**: WebRTC (P2P) with relay fallback; full-mesh network for N players.
- **Frontend**: lobby logic moved into the `use-lobby.ts` hook (App — screens/match);
  `relay` uses a dispatch table instead of a big `switch`.
