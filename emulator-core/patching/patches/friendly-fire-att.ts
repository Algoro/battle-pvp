// friendly-fire-att.ts — ROM descriptor of the `friendly-fire-att` feature (fully JS runtime).
//
// There is no "enemy bullet → another enemy" collision in the ROM, so the pass is entirely implemented
// by the JS runtime (features/friendly-fire-att.ts); the ROM is not patched.
//
// Relative path: ./emulator-core/patching/patches/friendly-fire-att.ts
export const friendlyFireAtt = {
  id: "friendly-fire-att",
  version: 1,
  description: "Попадание врага в союзного врага наносит урон (с бронёй и призом)",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default friendlyFireAtt;
