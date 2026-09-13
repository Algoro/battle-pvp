> 🌐 **English** · [Русский](../wrap-borders.md)

# Open borders (`wrap-borders`)

An optional feature: the indestructible level border is removed, and the play area becomes
a **torus** — a tank or bullet that reaches the edge comes out on the opposite side.
Global (any match/solo), enabled by a checkbox in `FeaturePicker`.

## What is removed

The border is created by the ROM routine `sub_D7CC_create_default_stage_field` (`bank_FF.asm:3779`):
it fills the whole field (32×32) with steel `$11` and only then clears the inner 26×26.
Hence the gray indestructible border both in collision and in the nametable.

ROM patch `patching/patches/wrap-borders.ts` — a single write:
`$D7CE` `A9 11` → `A9 00` (fill constant `$11` → `$00`). The inner map blocks
are not affected. The fingerprint of the set changes (as with any ROM feature).

## Torus (runtime `features/wrap-borders.ts`)

- The play area is 26×26 tiles (2..27) = 208 px. The 16 px tank center moves in the range
  `0x18..0xD8`; the distance between the seams (period) — `0xD8 − 0x18 = 192 px`.
- The wrap is done in `postFrame` (after the ROM move and the JS movement of the human tank) and
  is part of `getFrameHash()` — deterministic, without `Date`/`Math.random`.
- The wrap triggers on the actual "inside → outside" transition (the previous
  position is remembered), so enemy spawns at the top edge (`y=0`, outside the zone) do not teleport them.
  A bullet that has just appeared right behind the seam and is flying outward is wrapped (a shot at the edge).
- Before wrapping, the cells on the opposite side are checked:
  - tank — `tankPassable`: if there is brick/steel/water/eagle, the tank is stopped at the seam;
  - bullet — `!blocksBullet`: if there is an obstacle, the bullet is extinguished (`BULLET.EXPLODE`).

## Files

- `shared/features.ts` — manifest (visible feature).
- `emulator-core/patching/patches/wrap-borders.ts` — ROM border write.
- `emulator-core/features/wrap-borders.ts` — torus.
- `emulator-core/tests/wrap-borders.test.ts` — tests.
- `emulator-core/patching/registry.ts` — registration.

## Tests and verification

`emulator-core/tests/wrap-borders.test.ts`: the patch removes the border (`FIELD`/nametable = `0`),
the fingerprint changes; X and Y tank wrap; an occupied side — stopping at the seam; wrap and
extinction of a bullet; the same `getFrameHash()` for two instances. Live run: a controlled tank,
having reached the left seam, appears on the right (`X: 24 → 215`).

## Compatibility and limitations

- **Netcode**: the feature is part of the patch set; all clients of the match have the same set, otherwise
  a different fingerprint (the existing join/matchmaking mechanism).
- **Attacker AI** (`lookahead`/`plan`) does not know about the torus: the path is built over the normal field,
  so at open borders AI behavior may be suboptimal (not critical for human play;
  accounting for the torus in AI is a separate task).
- **Pacman**: the mode has its own concrete fill; the `pacman + wrap-borders` combination must be
  checked separately.
- **Pistol**: the beam is a hitscan within the screen; the torus does not apply to it.
- **Tower Defence**: the feature is orthogonal, but with open borders the enemies have more freedom —
  check balance when enabling them together.
