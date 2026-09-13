> 🌐 **English** · [Русский](../rom-patching.md)

# ROM and in-memory patching

## Principle

The original ROM **is not modified**. PvP logic is added by patches to the **in-memory PRG image**
at load time, before the mapper copies PRG into CPU memory. The file `rom/original/_battle_city.nes`
remains a byte-for-byte original; the patched project is a derivative.

```
оригинал (_battle_city.nes)
   │  load → ROM.rom[0] (Uint8Array 16 КБ)
   │  applyPatchSet(rom, "pvp")   ← правит только образ в памяти
   ▼
createMapper().loadROM()  → cpu.mem  → исполнение
```

## What changes

The base set `pvp` = base + module `pvp` (network PvP). Game patches are **optional
features** (`features: ["pistol"]`, see `optional-patches.md`): they are composed on top of the base,
the fingerprint depends on the set. Base `pvp` = `94cb0636`; `pvp+pistol` = `d370108f`.

**Module `pvp` (base, network PvP):**
- **6 equal-size hooks** (JMP/JSR + NOP pads), so that the addresses of the original code do not shift:
  PRNG `$D45A`, spawn `$DB48`, direction `$DDD4`, target `$DE72`, turn `$DE84`, fire `$E171`;
- **6 new routines** in the unused zone `$EF75–$EFF6` (was filled with `$FF`):
  network ATT input, per-player respawn, and wrappers;
- **network RAM zones** `$01DB–$01ED` (`ram_net_enemy_dir/fire/respawn/state`).

**Feature `pistol`** (optional; the "pistol" prize, acquisition rules in ROM):
- **drop** `tbl_E8FA_bonus[6]`: `$04` → `$06` (the prize actually appears);
- **pickup** `tbl_E9E2_bonus_pickup_handler[6]`: `$EA48` (`RTS`) → `sub_grant_super_weapon`;
- **4th star** (hook `$EA07`) → `sub_star_pickup`: when `upgrade == 0x60` grants the super weapon;
- **reset on death** (hook `$E76A`) → `sub_clear_super_weapon`;
- **RAM** `$01EE` (`ram_pistol`) / `$01F0` (`ram_pistol_ammo`), routines in `$FF50–$FFF9`.
- The **beam effect** itself (hitscan: destruction of tiles, tanks, bullets, base) is executed by the
  JS core `PvPNes` (phase 3 of the plan): acquisition rules — in ROM, the effect — deterministically
  in `stepFrame`, state in RAM → rollback-safe. See `pistol-powerup.md`
  and `optional-patches.md`.

Full analysis — `asm-label-map.md`. Fingerprints: base `pvp` — `94cb0636`,
`pvp+pistol` — `d370108f`.

## Module `emulator-core/patching/`

| File | Purpose |
|---|---|
| `rom-image.ts` | access to PRG as an image: `map(addr)`, read/write/verify, `isFill`, `fingerprint` |
| `descriptor.ts` | descriptor validation, tokens (`jmp/jsr/abs/self`), `composeSets` |
| `linker.ts` | symbol table, routine placement, `NO_SPACE`/`OVERLAP` checks |
| `apply.ts` | `applyPatchSet(rom, "pvp")`: base check, `expect` bytes, atomic write |
| `errors.ts` | typed error codes |
| `runtime.ts` | `FeatureRuntime`/`KernelApi` contract (hooks `preFrame/postFrame/render/...`) |
| `patches/base-nrom.ts` | base (mapper0, 1×16 KB, FNV PRG `b8a818c1`, sha1 ROM) + symbols + free zone |
| `patches/pvp.ts` | network patches (routines as tokens + hooks) |
| `patches/pistol.ts` | "pistol" prize: drop/pickup/4th star/reset |
| `patches/tower-defence.ts` | TD maps in stages 1..3 + stage-completion hook `sub_td_stage_end_check` (`$FF50`) |
| `patches/{pacman,enemy-prizes,friendly-fire,player-names}.ts` | other optional features |
| `registry.ts` | named sets (`pvp` = base+pvp, `base`) + registry of optional features |

## Invariants and protection

- **Base check**: mapper/number of banks/PRG fingerprint; a foreign ROM → `PATCH_BASE_MISMATCH`.
- **`expect` bytes** for each hook: wrong revision → `PATCH_EXPECT_FAILED`.
- **Free zone**: routines are placed only in "empty" (`$FF`) ranges.
- **Overlaps/overflow**: `PATCH_OVERLAP` / `PATCH_NO_SPACE`.
- **Atomicity**: nothing is written until all checks pass.
- **Guard test** `emulator-core/tests/jsnes-pristine.test.ts` watches that jsnes is untouched.

## How to add a patch

1. Describe the bytes/routines in `patches/*.ts` (following the `pvp.ts` example), using tokens for addresses.
2. Register the set/add to `composeSets` if needed.
3. Verify reproduction: `node scripts/extract-patches.mjs --check`.
4. Run `cd emulator-core && npm test` (golden + determinism).

## Cartridge fingerprint

`nes.patching.fingerprint` (FNV-1a32 of the patched PRG) is passed into the netcode handshake,
so that only clients with identical patches play the match (see `multiplayer.md`).
