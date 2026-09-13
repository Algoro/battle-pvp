> 🌐 **English** · [Русский](../pistol-powerup.md)

# The "Pistol" prize and the super weapon (Railgun)

The `pistol` feature (enabled by `features: ["pistol"]`): the "pistol" prize drops and can be picked up;
the 4th star grants the same effect. The beam effect is executed by the JS runtime (`features/railgun.ts`),
the acquisition rules — by the ROM patch `pistol`. Base `pvp` without features — `94cb0636`, with pistol —
`d370108f`.

## 1. Goal

Make the **"Pistol" prize** drop/pickable (currently the ROM has its sprite, but
the prize is unused) and give the tank that picks it up a **powerful weapon**: a shot that
**in a single shot destroys any obstacles and opponents along the entire line across the whole
screen**. The implementation follows the project's principles: the ROM is immutable, the rules live in ROM,
determinism and rollback are preserved, the patch is applied in-memory and is part of the fingerprint.

## 2. What already exists in the ROM (verified against the disassembly)

### 2.1. Prizes ("bonus")
- Identifier and position: `ram_bonus_id` `$88` (0xFF — no prize), `ram_bonus_pos_X/Y`
  `$86/$87`, timer `ram_bonus_timer` `$62`.
- Drawing `sub_E23B_display_bonus_on_screen` (`$E23B`): tile = `0x81 + bonus_id*4`,
  drawn with 2 sprites of 8×16 (2×2 tiles). For `id=6` these are tiles **`0x99–0x9C`** —
  CHR indeed contains separate graphics (the pistol).
- Drop table `tbl_E8FA_bonus` (`$E8FA`, 8 bytes): `00 01 02 03 04 05 04 03`
  (helmet/clock/shovel/star/grenade/tank/grenade/star). **`6` never drops.**
- Effect table `tbl_E9E2_bonus_pickup_handler` (`$E9E2`, words): entry `id=6`
  (`$E9EE`) points to `ofs_bonus_EA48_06_RTS` (`$EA48`) — an **empty `RTS`**
  (marked `; pistol` in the disassembly).
- Pickup `sub_E972_try_to_pick_up_bonus` (`$E972`): checks only tanks `0..1`
  (`con_max_players = 1`, i.e. DEF players). ATT/enemies (2..7) do not pick up prizes.
- Spawn `sub_E8BE_spawn_bonus` (`$E8BE`) is called from `sub_E70C` (`$E7D7`) when
  a tank with `ram_tank_type & 0x04` (prize carrier) is killed.
- The spawn is driven by RNG: `sub_D44D_generate_random_number`. The `pvp` patch has already made it
  deterministic (`$D45A`), i.e. the prize sequence is synchronous across clients.

### 2.2. Bullets
- Slots `0..9`; arrays: `ram_bullet_pos_X` `$B8`, `pos_Y` `$C2`, `status` `$CC`,
  `property` `$D6` (+ 2nd player bullets at `+8`: `$C0/$CA/$D4/$DE`).
  Players — slots 0,1; enemies — 2..7.
- `sub_E08C_bullets` (`$E08C`, bytes `B5 CC D0`, continuation `$E090` `CPX #$02`) —
  bullet creation: sets `status = 0x40 | dir`, position, `property`.
- `property`: `0` normal; `1` "powerful" (200-point tank); `3` — player's 3 stars
  (check `property & 0x02` → destroys steel).
- Movement `sub_E604_bullets_movement` (`$E604`); collision with tiles
  `sub_E69A` (`$E69A`, entry from `sub_E693`); collision with tanks
  `sub_E70C` (`$E70C`); bullet-vs-bullet `sub_E910` (`$E910`).
- Block codes (`con_block_type = 0`): tile `>= 0x12` — empty; `0x08` — HQ (loss);
  `0x11` — bullet is extinguished (indestructible); `0x10` — steel (destroyed with `property&2`);
  others — brick. Tile destruction with nametable update —
  `sub_D784_write_tile_to_buffer` (`A = new tile`).

### 2.3. Fire
- DEF players: `sub_E122` (`$E122`), bullet creation call — `$E15A` (`20 8C E0`).
- ATT (human/network): `sub_E162` (`$E162`); the pvp fire hook — `$E171`; the bullet creation
  call — `$E178`. The hook returns `A=0` → fire.
- Both branches ultimately call **`sub_E08C`** — this is the single point for the "super shot".

### 2.4. Patching infrastructure
- `emulator-core/patching/`: descriptors `routines` (symbols, `at`/first-fit, tokens
  `jmpT/jsrT/absT/selfJmpT`) and `writes` (hook by address, `len`, `expect`, bytes).
  The linker places only in declared `free` zones filled with `0xFF`, and checks
  atomicity/overlaps. `applyPatchSet(rom, "pvp")`; `composeSets`; `registry.ts`.
- Free (`0xFF`) PRG zones: **`$EF75–$EFFF`** (occupied by the `pvp` patch),
  **`$FF50–$FFF9` (170 bytes)**, `$D3DD–$D3FF` (35), `$FD46–$FD4F` (10).
- Consumers: `scripts/prepare.mjs` (builds `rom/disasm/_battle_city.nes`,
  constant `PRG_FNV = 94cb0636`), `emulator-core/tests/patching.test.ts`
  (fingerprint `94cb0636`), `qa/tests/asm-patch.test.ts`,
  `emulator-core/tests/golden-replay.test.ts` (`GOLDEN_HASH = 34e8ff73`),
  `qa/golden-state.ts`, `emulator-core/tests/no-magic-addresses.test.ts` (address regex),
  `emulator-core/rom-contract.ts` (single source of RAM/ROM).
- The JS core `PvPNes` (`emulator-core/pvp.ts`): `loadROM` → `applyPatchSet`;
  `stepFrame` = `_readInputs` → AI → `_applyHumanPreFrame` → `frame()` →
  `_applyHumanPostFrame` → `_unstuckTanks`; `saveState/loadState` encode **all RAM
  `0x0000–0x07FF`**. `sim/*` — a test-only JS model. The lookahead AI uses
  `EmulatorPredictor` (the real emulator, `ai/rollforward.ts`), i.e. the patch is taken into account.

## 3. Feature design

### 3.1. Specification
- The pistol is prize `id=6`, drops onto the field like the others (position/RNG — as before,
  frequency — as for regular prizes; adjustable if desired).
- Available **only to DEF players** (tanks 0,1) — like all prizes now; ATT/AI do not
  pick up. We do not extend `sub_E972`.
- **The second source of the super weapon is the 4th star:** tank upgrade in the original is
  limited to `0x60` (3 stars): `ofs_bonus_EA07_03_star` does `RTS` when `ram_tank_upgrade == 0x60`.
  Now picking up a star at the maximum (i.e. the 4th) grants **the same effect
  as the pistol** (see §3.3, step 6). Both paths lead to a common grant routine.
- The player who picks it up receives **N super shots** (by default **N=3**; stored in
  RAM), after which firing returns to normal. It lasts until the ammo is exhausted or
  until the tank dies (whichever comes first). If the weapon is already owned, a repeated pickup
  (pistol/4th star) **replenishes ammo to N** and does not stack.
- The super shot is a **hitscan (beam)**: on the frame of the shot it instantly "burns through"
  the line from the tank to the screen edge in the facing direction:
  - destroys **any** tiles (brick and steel), writes `0` to the field and updates
    the nametable via `sub_D784_write_tile_to_buffer`;
  - destroys **live tanks in the lane**, including an **allied DEF tank** (friendly fire);
  - **destroys the HQ (base), including its own**, and starts the standard defeat
    sequence (like a regular bullet: `ram_game_over_flag = 0x27`, `sub_CC08_draw_destroyed_eagle`,
    SFX) — agreed;
  - removes enemy bullets in the lane;
  - does not go outside the field bounds (important: otherwise the byte X/Y will "wrap"
    and the tank teleports);
  - visuals: **a beam + a series of explosions** along the line for several frames, SFX.
- Why hitscan and not a "flying piercing bullet": in the ROM, bullet movement uses byte
  coordinates without an edge check; a piercing bullet, having knocked down the border, will "wrap"
  through `x=255→0`. Hitscan solves "across the whole screen" in a single pass, is simpler, deterministic, and
  does not require editing the four collision subroutines. Visually, a beam/a series of
  explosions can be shown (option).

### 3.2. Data (RAM)
- Since only DEF (tanks 0,1) are involved, **2–4 new bytes** are enough: 1 byte per
  player ("owns" bit + shot counter) or 2 flag bytes + 2 ammo bytes.
  The exact free address —
  **to be confirmed by checking**: candidates are the tail of the PvP zone (`$01EE–$01FF`) or
  a free area (`$0111–$017E`), checking that `ram_ppu_buffer`
  (`$0180`) and indexed arrays do not write there. Register in `rom-contract.ts`,
  `no-magic-addresses`, and the contract test; cover with `state-codec` (rollback/saveState).

### 3.3. Original ROM path design (not implemented; see §5)
New module `emulator-core/patching/patches/pistol.ts`, composed as
`composeSets(baseNrom, pvp, pistol)` and registered under the name `pvp`
(so that the frontend/tests change nothing; only the fingerprint changes). Contents:

1. **Drop.** `writes`: `$E900` (write of `tbl_E8FA_bonus`, index 6) expectedly `04`
   → `06` (or index 7 `03→06`; frequency — see §3.1). Alternative: do not touch the table, but
   grant the pistol by condition (e.g. after N kills) — more complex, a separate phase.
2. **Pickup.** `writes`: word `$E9EE` (`48 EA`) → `absT("sub_pistol_pickup")`.
   New routine `sub_pistol_pickup` (in `$FF50+`): `X` = player index; set the flag
   (and/or ammo), optionally raise the upgrade to max, play SFX, `RTS`.
   Optionally extend `sub_E972` to ATT (currently only `0..1`).
3. **Bullet creation hook.** `writes`: `$E08C`, `len=3`, `expect = B5 CC D0` →
   `jmp("sub_bullets_pistol_hook")`. Hook:
   - `LDA ram_bullet_status,X; BNE rts` (busy slot — as in the original);
   - if tank `X` has the pistol → `JMP sub_railgun`;
   - otherwise `JMP $E090` (continue the original after the 3 overwritten bytes);
   - `rts: RTS`.
   A single hook covers both DEF (`sub_E122`) and ATT (`sub_E162`) — both branches call
   `sub_E08C`.
4. **`sub_railgun`** (new routine, `$FF50+`), input `X` = tank index (0/1):
   - direction from `ram_tank_flags,X & 3`; starting point — the tank position;
   - step-by-step traversal over cells along the beam (32 tiles):
     - field tile: if not empty → `sub_D784_write_tile_to_buffer(A=0)`;
     - if the tile is the **HQ** (`0x08`): destroy and start the standard defeat
       (`ram_game_over_flag=0x27`, `sub_CC08_draw_destroyed_eagle`, SFX) — works also
       for its own base (agreed);
     - tanks 0..7 (including an allied DEF) in the cell → explosion
       (`ram_tank_flags=0x73`, `ram_tank_type=0`, SFX);
     - bullets in the cell → zero the status;
   - stop at the field boundary; ammo deduction/flag clearing at 0; SFX; `RTS`.
5. **Visuals (agreed).** Beam + a series of explosions along the line: 3–6 calls to
   `sub_DEE2_draw_bullet_explosion` along the beam (or a new bullet-sprite status via
   the dispatcher `$E4D8/$E4E2`). A HUD pistol icon next to lives — optional
   (`sub_C830_draw_Ip_IIp_icons`).
6. **4th star.** `writes`: `$EA07`, `len=3`, `expect = BD 01 01`
   (`LDA ram_tank_upgrade,X`) → `jmp("sub_star_pickup")`. The new routine `sub_star_pickup`
   (`X` = player) repeats the original and, when exhausted:
   - if upgrade `< 0x60` → as before: `upgrade += 0x20`, `tank_type = upgrade`, `RTS`;
   - if `== 0x60` → `JMP sub_grant_super_weapon` (shared routine with the pistol).
   `sub_grant_super_weapon` sets the ownership flag and `ammo = N` (replenishment).
7. **Reset on death.** Defeat of a DEF tank zeroes `ram_tank_upgrade,X` and
   `ram_tank_type,X` (`sub_E70C` `$E76A/$E76D`). Add the super weapon reset there too:
   `writes` at `$E76A` (`expect = 9D 01 01`) → `jsr("sub_clear_super_weapon")`, where
   the routine zeroes `ram_tank_upgrade,X`, `ram_pistol,X` and `ram_ammo,X`, and on exit
   **leaves `A=0`** (before the hook there is `LDA #$00`, and immediately after — `STA ram_tank_type,X`
   at `$E76D`, which uses the same `A`).
   The fallback path (if some other defeat is found) — zero the flag on `flag == 0` in
   `_defRespawn`; but the ROM hook is preferable.

## 4. Testing
- **Headless (emulator-core/qa)**: pickup of prize 6 (`spawnBonus(6,x,y)` + tank driving up);
  pickup of the **4th star** (upgrade to `0x60`, then another star) grants the weapon, while the 1st–3rd
  stars do not; a super shot destroys brick/steel (field → 0, nametable buffer
  updated); destroys an enemy and an ally in the line; hitting the HQ starts defeat;
  does not leave the bounds and does not "wrap" coordinates; a non-super shot is unchanged
  (regression); ammo/replenishment to N/flag clearing; tank death resets
  the flag/ammo; SFX does not affect the hash.
- **Determinism/rollback**: save/load and periodic save/load at the moment of a super shot
  are equivalent to a continuous run.
- **Patching**: `node scripts/extract-patches.mjs --check` reproduces the built ROM;
  the fingerprint is stable; the `jsnes-pristine` guard is unaffected.
- **Golden**: deliberately update `GOLDEN_HASH` and `qa/golden/*` (changing the prize drop
  table changes the state).
- **sim isolation**: make sure pistol scenarios do not get into the `emu` vs `sim` comparisons
  (or explicitly exclude/document them).
- **E2E (opt.)**: lobby → start → super shot is visible/synced on both clients.

## 5. Actual implementation

- ROM patch `emulator-core/patching/patches/pistol.ts` (set `pvp = base + pvp + pistol`,
  fingerprint `d370108f`): drop of id 6, pickup, 4th star, reset on death.
- RAM `ram_pistol` `$01EE`, `ram_pistol_ammo` `$01F0` (`rom-contract.ts`).
- The beam effect — the JS runtime `emulator-core/features/railgun.ts` (`fireRailgun`/`renderRailgunFx`), called from `features/pistol.ts`:
  hitscan over cells, destruction of **any obstacles and terrain — brick, steel,
  water, ice, bushes** (except road and HQ), tanks (including an ally),
  bullets, base; N=3; **beam width = `2*PISTOL_BEAM_HALF+1`** tiles
  (`domain.ts`, currently 3 tiles, can be changed with a single constant); **visuals — an explosion
  (animation like the tank's) on each destroyed cell**: the JS queue `ctx.state.beamFx` + `renderRailgunFx` draws 8×16 tile pairs `0xF1/0xF5/0xF9` into free (off-screen)
  engine OAM sprites — pure visualization, does not write `cpu.mem` (hash/network unaffected);
  SFX. The destruction state is in RAM → `saveState`/rollback work.
- **Start option**: `setStartPistol(true)` (in `StartupInjector` + `PvPNes` + `EmulatorDriver`)
  grants DEF maximum stars (`0x60`) and the pistol at start. Wiring: UI (`StarsSelect`
  button "4★🔫" → `LobbyBrowser`/`CreateRoomDialog`/`LobbyRoom`) → lobby settings
  `defPistol` (`domain/lobby.ts`, `match-lifecycle.ts`, `relay`/`server`) → `match.start`
  → `MatchController` (`startSolo`/`startOnline`) → `setStartPistol`.
- Tests: `emulator-core/tests/pistol.test.ts` (13), `backend/tests/lobby.test.ts`
  (normalizeSettings.defPistol), fingerprints updated (`patching.test.ts`,
  `prepare.mjs`) and golden (`GOLDEN_HASH = 34e8ff73` in `tests/golden-replay.test.ts`).
- Reason for the fallback: the railgun does not fit entirely in ASM into a continuous free ROM zone
  (`$FF50–$FFF9` = 170 B; a single routine cannot occupy two zones), and the acquisition rules
  remained in ROM. If a full ROM version is needed — write more compactly/extend the zones.
