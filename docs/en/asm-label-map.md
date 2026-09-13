> 🌐 **English** · [Русский](../asm-label-map.md)

# ASM label map (Battle City, bank FF)

A reference to the original ROM for understanding the patching points. Source — the disassembly
`vendor/nes-disasm/Battle City` (bank_FF.asm / bank_ram.inc / bank_val.inc),
the submodule `cyneprepou4uk/NES-Games-Disassembly`. A copy of the asm is not committed to the repository;
`rom/disasm/` is a generated artifact (`.gitignore`).

## Vectors and flow

- NMI `vec_D400_NMI` — every frame: joystick reading, frame counter.
- RESET `vec_C070_RESET`.
- Round main loop: stage-start `bra_C1C5` → gameplay `bra_C1F9_loop` → stage-end `bra_C238_loop`.

## Controllers

- `sub_D689_read_joy_regs` (`$D689`) — reads `$4016/$4017`, 2 ports.
- `sub_E451_convert_Dpad_buttons` — buttons byte → direction (0=Up 1=Left 2=Down 3=Right).

## RNG

- `sub_D44D_generate_random_number` (`$D44D`) — random number generator.
- Registers: `ram_random` `$0F`, `ram_index_for_random` `$10`.
- **Patch `pvp`**: hook `$D45A` replaces the dependency on zero-page `$10`/`$00,X` with
  `random = (random*7 + frm_hi + frm_lo) & 0xFF` (determinism).

## Enemy AI (hooks of the `pvp` set)

| Original | Hook address | New code |
|---|---|---|
| `sub_DDA2` (direction selection) | `$DDD4` | `sub_net_enemy_dir` |
| `sub_DE72` (basic enemy direction) | `$DE72` | `sub_DE72_patched` |
| `$DE84` | `$DE84` | `sub_net_enemy_dir_store` |
| enemy fire (`$E171`) | `$E171` | `sub_net_enemy_fire_check` |
| spawn (`sub_DB48_enemy_spawn_handler`) | `$DB48` | `sub_DB48_patched` + `sub_net_respawn_check` |

- Targets: `ofs_000_DD7E_D0_follow_p1` / `_p2` / `_HQ`.
- Tank flags: `0x80` active (animation/movement), `0x90`, `0xA0` basic,
  `0xB0/0xC0/0xD0` follow-HQ/p2/p1, `0xE0/0xF0` respawn, `0x70` explosion (in code `0x73`).

## Spawn and round state

- `sub_E363_tank_spawn_handler`, `sub_DB48_enemy_spawn_handler`.
- `sub_C728_check_condition_for_stage_ending` — round end condition (win/loss).
- `sub_E2A9_HQ_handler` — base/eagle; `ram_game_over_flag` `$68`.

## HUD

- `sub_C7C8_print_lives_handler`, `sub_C830_draw_Ip_IIp_icons`,
  `sub_C8A2_draw_enemy_icon`, `sub_C8B1_erase_enemy_icon`.

## RAM (selective)

| Label | Address | Purpose |
|---|---|---|
| ram_btn_hold | `$06` | ports 0,1 input |
| ram_random | `$0F` | RNG register |
| ram_p1_score | `$15` | P1 score |
| ram_lives | `$51` | lives |
| ram_game_over_flag | `$68` | `$80`=game, 0=end |
| ram_enemies_left_cnt | `$80` | remaining ATT |
| ram_stage | `$85` | level |
| ram_tank_pos_X | `$90` | tank positions |
| ram_tank_flags | `$A0` | tank flags/direction |

## Network PvP RAM zone

| Label | Address | Purpose |
|---|---|---|
| ram_net_enemy_dir | `$01DB` | ATT direction (0..3, FF=none) |
| ram_net_enemy_fire | `$01E1` | fire edge |
| ram_net_enemy_respawn | `$01E7` | respawn edge |
| ram_net_enemy_state | `$01ED` | match state |
| ram_pistol | `$01EE` | 2 bytes: 1 = DEF player owns the super weapon |
| ram_pistol_ammo | `$01F0` | 2 bytes: remaining super shots |
| ram_enemy_pistol_ammo | `$01F2` | 6 bytes: super weapon ammo of enemies (`enemy-prizes`) |
| ram_dots_left | `$01FC` | 2 bytes: remaining dots (`pacman`); 0 — field cleared |
| ram_pacman_win | `$01FE` | 1 byte: DEF victory in `pacman` |
| ram_td_state | `$01FF` | 1 byte: `tower-defence` phase |

Separately, after the sound engine (`$031C–$03FB`), `$03FC–$03FF` are free; `$03FC`
is used by the `friendly-fire-att` feature:

| Label | Address | Purpose |
|---|---|---|
| ram_ff_att_cleared | `$03FC` | bitmask of enemy bullet slots that have left the shooter's "muzzle" |
| ram_enemy_prize_allow | `$03FD` | bitmask of prizes (bit id) that the enemy can take (`enemy-prizes`; `$FF` — all) |

The zone `$01DB–$01FF` (from `ram_ppu_buffer` `$0180`, which ends at `$01DA`)
is occupied by features: network (`$01DB–$01ED`), pistol (`$01EE–$01F1`), `enemy-prizes`
(`$01F2–$01FB`), `pacman` (`$01FC–$01FE`), `tower-defence` (`$01FF`). Individual features
are designed for joint enabling only where this is verified by tests.

## Prizes (bonus)

| id | Label | Effect |
|---|---|---|
| 0 | ofs_bonus_E9F0_00_helmet | helmet |
| 1 | ofs_bonus_E9F5_01_clock | freeze |
| 2 | ofs_bonus_E9FB_02_shovel | base fortification |
| 3 | ofs_bonus_EA07_03_star | upgrade (4th star = super weapon) |
| 4 | ofs_bonus_EA17_04_grenade | enemy explosion |
| 5 | ofs_bonus_EA3E_05_tank | life |
| 6 | ofs_bonus_EA48_06_RTS → sub_grant_super_weapon | **pistol** (super weapon) |

Prize graphics: tiles `0x81 + id*4`; pistol — `0x99–0x9C`. Drop table
`tbl_E8FA_bonus` (`$E8FA`), pickup — `sub_E972_try_to_pick_up_bonus` (`$E972`).
The `enemy-prizes` feature hooks the entry of `sub_E972` and adds a check for tanks 2..7 (enemies):
on collision the prize is taken (`ram_bonus_timer=0x32` + SFX), the index/`id` are written to RAM,
and the effect is executed by the JS runtime (`features/enemy-prizes.ts`): clock — freeze DEF,
shovel — remove base protection, star — enemy armor, grenade — explode DEF, tank — reinforcement,
pistol — super weapon for the enemy (with the `pistol` feature); helmet — no effect.

## Patches

Hooks are strictly equal-size (`JMP`/`JSR` + NOP pads), new code — in unused zones
`$EF75–$EFFF` (pvp) and `$FF50–$FFF9` (pistol, enemy-prizes, tower-defence). Descriptors and
linker — `emulator-core/patching/` (`patches/pvp.ts`, `patches/pistol.ts`,
`patches/tower-defence.ts`).
Reproduction check: `node scripts/extract-patches.mjs --check`.
