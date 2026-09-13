> 🌐 **English** · [Русский](../optional-patches.md)

# Optional patch features

A mechanism that allows enabling/disabling game ROM patches ("pistol",
"enemies pick up prizes") without breaking netcode compatibility and while preserving determinism.

## Model

- **Base** (`patchSet: "pvp"`) — the mandatory compatible foundation: ROM contract +
  network PvP patch. Its fingerprint (`94cb0636`) is the subject of netcode compatibility,
  it is exchanged at join/matchmaking.
- **Features** (`features: ["pistol"]`) — optional game patches on top of the base.
  They are enabled as a list and composed into the ROM deterministically; the fingerprint depends on the ROM part
  of the set: `pvp` without features = `94cb0636`, `pvp+pistol` = `d370108f`, `pvp+enemy-prizes` = `b1940f80`,
  `pvp+pistol+enemy-prizes` = `0f0d445d`. Features implemented only by the JS runtime
  (`friendly-fire`) do not change the ROM — their fingerprint matches the
  base, and compatibility is ensured by the feature list (an unknown feature is rejected).

A feature = a ROM descriptor (`patching/patches/*`) + an optional JS runtime
(`features/*`, `FeatureRuntime`), which the core calls around the ROM frame
(`preFrame → frame() → postFrame → render`). Runtimes do not depend on `pvp.ts`,
they keep authoritative state in RAM (rollback), and visuals in `ctx.state`. Derived
visuals (e.g. the name nametable overlay) are removed by `beforeSaveState` hooks and
restored by `afterSaveState`, so that they do not end up in the snapshot/rollback.
- The feature set is chosen by the **host** in the lobby settings (`features`) or by the player in solo; the set
  is passed in `match.start` and applied by all clients **before the simulation starts**,
  so the image is identical for everyone.

## Feature settings

A feature may have a parameter schema (`settings.fields` in `shared/features.ts`):
`range` / `toggle` / `select` with `default`, bounds, and hints. The schema automatically provides:

- **UI**: `FeaturePicker` draws controls for enabled features (hidden fields with
  `requiresFeature` appear only together with the required feature);
- **validation**: `normalizeFeatureOptions()` (clamping ranges, defaults,
  discarding unknown features/fields) is applied on the backend in `normalizeSettings`;
- **defaults**: `effectiveFeatureOptions(id, raw)` — the runtime always receives
  the full set (default + overrides).

Wiring: `settings.featureOptions` (lobby) → `match.start.featureOptions` →
`EmulatorDriver.setFeatureOptions()` → `opts.featureOptions` → `FeatureContext.options`
(the runtime reads `ctx.options.<id>`). The values are identical for all clients of the match (they are set by the
host); they are not part of the ROM fingerprint, since settings currently affect only JS runtimes.

Configurable parameters of existing features: `pistol` (beam width, terrain removal),
`enemy-prizes` (which prize types are available to the enemy + the action of each: helmet, freeze,
base shield removal, armor, grenade, reinforcement, pistol ammo), `friendly-fire` (defender/attacker friendly fire, lethality, damage, self-damage), `player-names` (max length), `pacman` (bombs),
`wrap-borders` (X/Y wrap). `tower-defence` has its own settings on a separate screen.

## Core: registry and API (`emulator-core/patching/`)

- `registry.ts`:
  - `registerPatchSet(name, set)` — named base sets (`pvp`, `base`);
  - `registerFeature({ id, title, description, patch })` — optional features;
  - `canonicalFeatures(list)` — unique sorted ids (determinism);
  - `resolvePatchSet(name | descriptor | { base, features })` — assembles the set;
  - `listFeatures()` — metadata for UI/validation.
- `applyPatchSet(rom, "pvp")` or `applyPatchSet(rom, { base: "pvp", features: ["pistol"] })`.
  The report contains `features`, `fingerprint`, `applied`, `routines`.
- Composition is cached implicitly (on the fly); the order/duplicates of features do not affect the result.

## Passing through the layers

| Layer | What | Where |
|---|---|---|
| Core | `opts.features`, `hasFeature()`, `getFeatures()` | `emulator-core/pvp.ts` |
| Driver | `setPatchFeatures()`, `getPatchFeatures()` | `frontend/src/engine/emulator.ts` |
| Application | `startSolo(..., features)`, `beginOnlineMatch({ features })` | `frontend/src/application/match-controller.ts` |
| Lobby/backend | `settings.features` (validation `SUPPORTED_FEATURES`) | `backend/domain/features.ts`, `domain/lobby.ts` |
| Handoff to battle | `match.start.features` | `backend/application/match-lifecycle.ts`, `signaling/relay.ts`, `server.ts` |
| UI | feature checkboxes + options gate (4★ only with `pistol`) | `frontend/src/features.ts`, `components/*` |

`defPistol` (start with a weapon) makes sense only when the `pistol` feature is enabled; the UI
shows "4★" only then, and `setStartPistol` is a no-op without the feature.

## Invariants

- **Compatibility**: the base fingerprint is verified at join (as before). Features
  are applied after join according to the host set; an unknown feature → rejection (`PATCH_BAD_SET`).
- **Determinism**: the feature set is identical for all clients of the match (host-authoritative);
  new feature RAM bytes are included in `saveState`/rollback.
- **Layers**: `backend` does not import `emulator-core`; the feature lists of the three layers match —
  guarded by `qa/tests/features.test.ts`.
- **Returning to the lobby** resets features to the base (`MatchController.clear`) — so that
  the fingerprint for subsequent join/quick-match remains the base one.

## How to add a new optional feature

Feature metadata (`id/title/description`) lives in a single manifest **`shared/features.ts`**.
From it, UI checkboxes (`frontend OPTIONAL_FEATURES`) and backend validation
(`backend SUPPORTED_FEATURES`) are derived automatically — there is no need to edit the UI/backend. The patch
registry is checked against the manifest at startup (`assertFeaturesConsistent`).

1. `emulator-core/patching/patches/<new>.ts` — ROM descriptor (routines/writes/free or empty).
2. `emulator-core/features/<new>.ts` — JS runtime (`FeatureRuntime`), if needed.
3. `registerFeature({ id, patch, runtime? })` in `registry.ts` — wiring only.
4. A row in `shared/features.ts` (`FEATURE_MANIFEST`).
5. Gate JS effects — the runtime is present only for the active feature (`hasFeature` is not needed).
6. Tests: patching (fingerprint, if the ROM changes), headless behavior,
   manifest/registry consistency (`qa/tests/features.test.ts`, `architecture.test.ts`).
7. Documentation: this file + `rom-patching.md`.

## Tests

- `emulator-core/tests/patching.test.ts` — features change the fingerprint; canonicalization;
  an unknown feature is rejected.
- `emulator-core/tests/pistol.test.ts` — the `pistol` feature is enabled (`features: ["pistol"]`).
- `emulator-core/tests/enemy-prizes.test.ts` — `enemy-prizes`: the enemy takes a prize and
  receives the effect (clock/shovel/grenade/tank/star/pistol), without the feature — no; the player
  picks up as before; the combination with `pistol` composes without overlaps.
- `emulator-core/tests/friendly-fire.test.ts` — `friendly-fire-def` (a friendly kills a friendly)
  and `friendly-fire-att` (damage to an allied armored vehicle with prize drop; the shooter can die
  from their own bullet, but only after it has left their "muzzle" — flag in `ram_ff_att_cleared`),
  without features — no.
- `emulator-core/tests/player-names.test.ts` — a name above the tank (glyphs/centering/movement),
  no names/feature — nothing, the hash does not change, the overlay does not get into `saveState`.
- `emulator-core/tests/pacman.test.ts` — `pacman` mode: ROM maze (stage 1), walling up
  the base with concrete, dots/collection by DEF tanks, counter, victory by clearing, prize bombs; without the feature —
  normal Battle City.
- `qa/tests/architecture.test.ts` — runtimes `features/**` do not depend on `pvp.ts` and
  are deterministic (no `Date.now/performance.now/Math.random`).
- `qa/tests/features.test.ts` — the backend/core/frontend lists match.
- `qa/golden`, `golden-replay` — base `pvp` (without features).

## Open edges (`wrap-borders`)

- **ROM** (`patches/wrap-borders.ts`): a single write `$D7CE` `A9 11` → `A9 00` — the level
  border (steel `$11`) is no longer filled into either collision or the nametable.
- **JS runtime** (`features/wrap-borders.ts`): the 26×26 play area becomes a torus —
  an object that goes past the seam appears on the opposite side. Wrapping happens on the actual
  "inside → outside" transition; if the opposite side is occupied — a tank is stopped, a bullet
  is extinguished. Deterministic, in `postFrame`.
- Details — `wrap-borders.md`.

## Tower Defence (solo mode)

The `tower-defence` feature (`hidden: true` — enabled not by a checkbox but by the
"Tower Defence" button in the lobby):

- **ROM part** (`patches/tower-defence.ts`): writes 3 TD maps into stages 1..3
  (geometry — `shared/tower-defence.ts`, packing 91 bytes) and hooks stage completion
  `sub_C728` with the routine `sub_td_stage_end_check` in the free zone `$FF50..$FFF9`.
  While `TD_STATE != 0`, the stage does not end on `enemies_left == 0` (waves are driven by the
  runtime); defeat (base destroyed) always passes.
- **RAM**: `RAM.TD_STATE` (`0x01FF`) — phase: 0 off, 1 BUILD, 2 WAVE, 3 INTERMISSION,
  4 VICTORY, 5 DEFEAT. The rest of the TD state is in `ctx.state` (solo, rollback not needed).
- **JS runtime** (`features/tower-defence.ts`): economy (points for kills),
  placement (`configure/place/sell/upgrade/startWave` via `PvPNes.featureCommand(id, order)`),
  targeting/projectiles, damage to towers, waves, victory/defeat. The snapshot for the UI is
  `PvPNes.getFeatureState(id)`. The core itself does not know specific features — the channel is generic.
- **Shared damage**: `features/enemy-damage.ts` (armor/prize/death) is used by both
  friendly-fire and towers.
- **Rendering**: 2D — blending tank/bullet sprites directly into the PPU pixel buffer (render hook); 3D (`topdown-3d`/`mc-voxel`) —
  towers from `SceneState.towers` as immobile DEF tanks (stars = level).
- **Enemy types**: `TD_WAVES[].types` — the `ram_tank_type` queue in spawn order
  (basic/fast bullet/fast/armored); the runtime overrides the type at spawn.

Limitation: TD is solo-only; `saveState/loadState` are not supported in TD;
base HP was not added (the base withstands one hit, as in the original).
