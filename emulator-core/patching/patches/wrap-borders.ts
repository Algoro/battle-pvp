// wrap-borders.ts — ROM descriptor of the "open borders" feature.
//
// The ROM routine `sub_D7CC_create_default_stage_field` (bank_FF.asm:3779) fills the whole
// field (32×32) with tile $11 (steel) and only then clears the inner 26×26. Because of this
// an indestructible gray frame remains along the level edges (both in collision and in the nametable).
//
// The patch is exactly one write: the fill constant $11 is changed to $00, so the frame
// disappears both as an obstacle and visually; the inner map blocks remain. Transferring
// objects through the resulting seam is done by the JS runtime `features/wrap-borders.ts`.
//
// Relative path: ./emulator-core/patching/patches/wrap-borders.ts

export const wrapBorders = {
  id: "wrap-borders",
  version: 1,
  description: "Открытые края: без неразрушимой рамки уровня (телепорт по краям — в рантайме)",
  symbols: {},
  free: [],
  routines: [],
  writes: [
    {
      id: "stage-fill-empty",
      at: 0xd7ce, // LDA #$11 inside sub_D7CC_create_default_stage_field
      len: 2,
      expect: "A9 11",
      bytes: [0xa9, 0x00],
    },
  ],
};

export default wrapBorders;
