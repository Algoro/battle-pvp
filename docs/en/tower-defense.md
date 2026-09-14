> 🌐 **English** · [Русский](../tower-defense.md)

# Tower Defence mode

A solo defense mode (the hidden feature `tower-defence`): the DEF player buys and places
immobile tower tanks for points from destroying enemies; waves of AI attackers go toward the base.
The document describes the game loop, data, ROM patch, RAM contract, runtime, frontend,
economy, victory/defeat, tests, and limitations.

## 1. Goal and scope

Turn Battle City into a **tower defence for a single player (DEF)**:

1. There are specially designed levels — corridors/lanes from ATT spawn points to the base.
2. At the start of the round and between waves, the player **buys and places immobile
   tower tanks** for points earned by destroying enemies.
3. Waves of AI attackers go along the corridors to the base, shooting at towers and walls.
4. Victory — survive all waves; defeat — the base (eagle) is destroyed or lives run out
   (if a mobile tank is enabled).

Scope (strict):

- **Solo only.** Network/rollback/spectator do not participate in TD. The TD runtime must
  be deterministic (no `Date.now`/`Math.random`), but it is not required to be
  rollback-compatible: `ctx.state` is acceptable for TD game state.
- **Do not break the base.** The base fingerprint (`94cb0636`), golden tests, netcode, and
  golden hashes do not change: TD lives only as an optional feature (`tower-defence`).
- **jsnes/ROM are immutable.** Only in-memory PRG patches + subclasses.

## 2. Game loop (state machine)

```
LOBBY
  └─ “Tower Defence” → TD Setup (карта, сложность, мобильный танк вкл/выкл)
        └─ startSolo(team:"DEF", stage:tdMap, features:["tower-defence"], tdOptions)
              │
              ▼
        TD BUILD (эмулятор не шагает; редактор расстановки)
              │  «В бой»
              ▼
        TD WAVE (шаг эмулятора 60 Гц, рантайм рулит волной)
              │  враги кончились / база пала
              ▼
        TD INTERMISSION (итоги волны, начисление очков/бонус)
              │
              ├─ есть следующая волна → TD BUILD
              └─ волн больше нет     → TD VICTORY
                                     база пала/жизни 0 → TD DEFEAT
```

The mode of the TD phase — byte `RAM.TD_STATE` (see §5), so that the ROM and frontend understand the phase.
Dots, towers, projectiles, waves are in the runtime's `ctx.state` (solo, rollback not needed),
and are exposed via the new emulator API (§7).

## 3. Layer 1 — shared data `shared/tower-defence.ts`

A new module without imports (like `shared/features.ts` and `shared/renderers.ts`) —
a single source for UI, runtime, and tests.

```ts
export interface TowerTypeInfo {
  id: string;
  title: string;
  description: string;
  cost: number;
  damage: number;
  range: number;       // в блоках поля (16 px)
  fireInterval: number;// кадров между выстрелами
  projectileSpeed: number; // px/кадр
  upgradeCost: number; // стоимость апгрейда
  hp: number;          // прочность
  icon: number;        // иконка-подсказка для UI
}
export const TOWER_TYPES: TowerTypeInfo[] = [
  { id: "gun",    ... }, // 1 ствол, средняя скорострельность
  { id: "rapid",  ... }, // короткая дистанция, быстро
  { id: "sniper", ... }, // длинная дистанция, пробивает броню
  { id: "cannon", ... }, // медленный, высокий урон
];
export const TOWER_IDS = TOWER_TYPES.map(t => t.id);
export const TD_WAVES: { count: number; interval: number; types: number[] }[];
export const TD_POINTS_PER_KILL: Record<number, number>; // тип ROM-танка → очки
export const TD_MAPS: { id; title; rows }[]; export const TD_MAP_LIST; // карты
```

Shared geometry is here too: `TD_SIZE = 13`, block 16 px (`TD_BASE_*` — base zone),
functions `tdMapById`, `tdBlocks`, `tdBuildableCells`, `tdSpawnCells`, `buildTdStageBytes`.
UI and runtime use the same module `shared/tower-defence.ts` (without imports).

## 4. Layer 2 — the "level designer" and ROM patch

### 4.1 Adapting the stage designer

Currently the only "level designer" is `features/pacman-maze.ts`
(DFS maze → 91-byte stage format). We adapt it into a **TD designer**:

- New `emulator-core/features/td-levels.ts`:
  - 13×13 ASCII maps (characters: `#` concrete, `.` floor, `S` ATT spawn, `E` floor near the base) —
    readable and hand-editable;
  - `buildTdStageBytes(ascii): Uint8Array` — the same packing as in `pacman-maze`
    (14 nibbles/row, stride 7 = 91, even index — high nibble);
  - `tdSpawnCells(map)`, `tdBuildableCells(map)`, `isWallBlock`, `isBaseCell` — exported
    for the editor and runtime (no `Math.random`).
- 3 maps: `snake`, `lanes` (corridors), `zigzag` — different lanes.

Verification: the map bytes are read by `readStage()` and match the ASCII (round-trip test).

### 4.2 ROM descriptor `patches/tower-defence.ts`

Following the `patches/pacman.ts` example:

- `writes` for stages 1..3 (`tbl_F07A`, 91 bytes each) — TD maps.
- Stage completion hook `sub_C728_check_condition_for_stage_ending` ($C728):
  we patch the entry so that in TD mode the stage **does not end** on `enemies_left==0`
  during BUILD/INTERMISSION (see §5). Options:
  - implemented: JMP to the routine `sub_td_stage_end_check` in the free zone `$FF50..$FFF9`;
    while `TD_STATE != 0` and there is no game over — return A=0 (Z=1, "stage not finished"),
    defeat (game over) passes.
- Base and spawns on TD maps: the eagle in the center of the bottom, ATT spawn points at the edges —
  as in the original format (we check `field` collisions with a test).

### 4.3 Registration

- `shared/features.ts`: add `{ id: "tower-defence", hidden: true, ... }`
  (`hidden` — do not show in the common `FeaturePicker`; TD is enabled by a separate
  screen). Extend `FeatureInfo` with the field `hidden?: boolean`.
- `patching/registry.ts`: `registerFeature({ id:"tower-defence", patch, runtime })`.
- `assertFeaturesConsistent()` will itself verify the manifest and registry.
- Backend: `SUPPORTED_FEATURES` will get the id automatically, but `FeaturePicker`
  filters `hidden` — the checkbox will not appear in the lobby.

## 5. TD RAM contract

There is almost no free RAM: `0x01DB–0x01FF` (37 bytes) is already occupied by features, and
`0x0150–0x017F` is the stack, `0x0180–0x01DA` is `ram_ppu_buffer`, `0x0200–0x02FF` is OAM.
Therefore **we keep the authoritative TD state in `ctx.state`** (solo), and add to RAM only what
the ROM hook and the frontend need:

| Address | Name | Purpose |
|---|---|---|
| `0x01FF` | `TD_STATE` | 0=off, 1=BUILD, 2=WAVE, 3=INTERMISSION, 4=VICTORY, 5=DEFEAT |

The selected map is passed via `featureCommand("tower-defence", {type:"configure"})` (not via RAM).

The addresses are fixed in `rom-contract.ts`; TD compatibility with other features
is checked by patching tests (on routine overlap the linker gives `PATCH_OVERLAP`).

Dots, the tower list (cell, type, hp, cooldown, direction), projectiles (x, y, dir,
owner, ttl), wave number — in `ctx.state`. `onLoadState` resets derived
state (in TD `saveState/loadState` are not used; document the limitation).

## 6. Layer 3 — runtime `features/tower-defence.ts`

Implemented by two modules:

- `features/tower-defence.ts` — hook dispatcher and state: economy,
  placement/sale/upgrade, targeting/LOS, projectiles, damage to towers, waves, phases.
- `features/enemy-damage.ts` — the shared `damageEnemy()` (armor/prize carrier/death),
  extracted from `friendly-fire.ts` and reused by it and by towers.

Hooks:

- `init`: `TD_STATE=BUILD`, state, points; RAM is not touched before the game starts.
- `preFrame`: processing of `ctx.orders` (the feature channel); in BUILD after the match starts,
  spawn counters are zeroed so that waves do not start before "To battle".
- `postFrame`: points for the enemy transition `alive→explosion`; assigning the wave type at spawn;
  tower aiming/shots; projectile movement and damage; damage to towers from enemy
  bullets; in WAVE — wave control, in INTERMISSION — pause → BUILD/VICTORY;
  when `GAME_OVER != 0x80` (or 0 commander lives) → DEFEAT.
- `render`: towers/projectiles are blitted with sprite tiles directly into the PPU frame buffer
  (`ppuBuffer`), since the BG table points to PT1 and tanks are in PT0.
- `onLoadState`: reset of derived state (in TD `saveState/loadState` are not used).

Interaction with the core (`pvp.ts`):

- `featureCommand("tower-defence", order)` — orders `configure/place/sell/upgrade/startWave`
  (puts them into `ctx.orders`, processed in `preFrame`).
- `getFeatureState("tower-defence")` — a snapshot for the UI: phase, points, wave/total waves,
  tower list, projectiles, `started`.
- Validity/cost are computed in the runtime via `shared/tower-defence.ts` (the UI does not
  duplicate the rules). `MatchController.startTowerDefence(config)` configures the match.

## 7. Layer 4 — frontend

### 7.1 Setup screen `components/TowerDefenceSetup.tsx`

- Map selection (preview via `StagePreview`), difficulty, mobile tank on/off,
  starting points (by difficulty).
- "Start" button → `match.controller.startTowerDefence(opts)`.
- The entry point is a button in `LobbyBrowser` next to "Solo".

### 7.2 Placement editor `components/TowerPlacementEditor.tsx`

An adaptation of `StagePreview`:

- Draws the stage (ROM tiles/palettes) + a 13×13 grid + buildable highlighting.
- Mouse/touch: click a cell — place the selected type; repeat/right-click — remove;
  keyboard — cursor movement, `Z`/`Enter` — place, `X` — sell,
  `U` — upgrade.
- Panel: available types (cost/damage/range), current points, wave, the
  "To battle" button, results of the previous wave.
- The component knows nothing about netcode/cores — it works via props/callbacks of the
  TD controller (the dependency rules are preserved).

### 7.3 Game screen `components/TowerDefenceView.tsx`

- Runs the emulator loop (auto-start of the match, then rAF `stepFrame`), renders the battle
  view via the shared `RenderSystem`.
- In BUILD it shows the editor and shop, sends `emu.featureCommand("tower-defence", ...)`;
  the HUD reads `emu.getFeatureState("tower-defence")`; the result — by the `TD_STATE` phase.

### 7.4 Integration

- `App.tsx`: screen `{ name: "td" }` + setup modal (`showTdSetup`);
  `GameCanvas` is unchanged — TD draws a separate `TowerDefenceView`.
- HUD — inside `TowerDefenceView` (points, wave `n/N`, phase, shop, result).
- `engine/emulator.ts`: proxy `featureCommand`/`getFeatureState`; `styles.css`: TD styles.

## 8. Economy and waves

- **Points per kill** (by ROM tank type, as in the original score):
  basic 100, rapid-fire 200, fast 300, armored 400 (+ a bonus per
  wave). `TD_POINTS_PER_KILL` — in `shared`.
- **Starting capital** depends on difficulty; enough for 2–3 towers.
- **Cost/upgrade/sale** — in `TOWER_TYPES`; sale — 60% of the invested amount.
- **Towers live between waves**, purchase/rearrangement — in BUILD.
  (Sale and relocation — optional, in phase 5.)
- **Waves**: `TD_WAVES` — an array of `{ count, interval, types }`; difficulty scales
  count, the runtime assigns the enemy type from `types` at spawn. Spawn via `enemies_left`/`SPAWN_TIMER`.
- **Base**: classic (one hit) — defeat. If desired, in phase 5:
  base HP with repair between waves (intercept `sub_E2A9_HQ_handler`).
- **Lives**: if the mobile tank is enabled — standard 3, defeat at 0.

## 9. Victory/defeat

- The runtime writes `TD_STATE = VICTORY/DEFEAT`; the frontend shows the result.
- Conditions: VICTORY — all waves passed; DEFEAT — `GAME_OVER==0` (eagle),
  or DEF lives exhausted (if the tank is enabled).
- We do not touch `determineWinner` (used in netcode/pacman); in the TD branch
  `GameCanvas` determines the result only by `TD_STATE`.

## 10. Tests

- `emulator-core/tests/tower-defence.test.ts` — targeting/LOS, projectiles, armor,
  damage to towers, economy, waves, phase transitions, win/lose.
- `emulator-core/tests/td-levels.test.ts` — ASCII↔bytes, spawns/base/buildable cells.
- `qa/tests/features.test.ts` — manifest↔registry (existing, will pick up the id).
- `qa/tests/architecture.test.ts` — runtimes without `pvp`, without `Date`/`Math.random`;
  if needed, a new rule: `shared/tower-defence.ts` without imports.
- `frontend/tests/tower-defence.test.ts` — editor geometry, cost/validity,
  the TD controller phase machine on fake ports.
- `qa` e2e (`e2e:online`) is not affected; if desired — a separate TD scene.
- Base golden/fingerprint — unchanged (the feature is optional).

## 11. Risks and limitations

- **Stage-completion interception**: `sub_C728` returns Z=0 when `enemies_left==0`;
  in BUILD this is unacceptable. The phase 0 spike confirms the hook; a fallback is
  to keep `enemies_left=1` outside WAVE.
- **AI path along corridors**: enemies use the existing `lookahead` (target —
  the base); maps must be passable and not break navigation (`fine-grid`).
- **2D overlay**: towers/projectiles are blitted with sprite tiles directly into the PPU frame buffer
  (`ppuBuffer`) — BG does not fit (the background table is PT1, tanks are in PT0), and an OAM write
  from hooks does not survive into the visible frame.
- **RAM**: the TD authority is in `ctx.state`; rollback/`loadState` are not
  supported in TD (document). `TD_STATE` is the only new byte.
- **Balance**: the numbers (points/cost/waves) are tuned in phase 5, moved into `shared`.
- **3D**: implemented — `SceneState.towers` + `render/tower-visual.ts`, towers are drawn
  in `topdown-3d`/`meine-tank`.

## 12. Out of scope

- Networked TD (rollback-compatible economy/placement).
- Campaign/meta-progression between matches, saves.
- New CHR assets: we use tiles from the original ROM.

## 13. Quick links

- `shared/features.ts`, `shared/renderers.ts` — examples of manifests without imports.
- `emulator-core/patching/runtime.ts` — the `FeatureRuntime`/`KernelApi` contract.
- `emulator-core/features/pacman-maze.ts` — stage designer (example).
- `emulator-core/features/friendly-fire-att.ts` — JS damage to the enemy (example).
- `emulator-core/features/railgun.ts` — drawing over the ROM (example).
- `frontend/src/components/StagePreview.tsx` — the basis of the placement editor.
- `frontend/src/application/match-controller.ts` — the solo mode start point.
- `vendor/nes-disasm/Battle City/bank_FF.asm` — `sub_C728`, `DE15` (kill), `DB48` (spawn).
