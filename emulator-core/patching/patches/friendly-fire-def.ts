// friendly-fire-def.ts — ROM descriptor of the `friendly-fire-def` feature (fully JS runtime).
//
// The ROM already handles a DEF bullet hitting a friendly DEF tank (sub_E70C, 3rd pass),
// but the effect is a stun. The feature changes the outcome to death via the JS runtime
// (features/friendly-fire-def.ts), so the ROM is not patched.
//
// Relative path: ./emulator-core/patching/patches/friendly-fire-def.ts
export const friendlyFireDef = {
  id: "friendly-fire-def",
  version: 1,
  description: "Попадание своего в своего у защитников убивает (вместо стана)",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default friendlyFireDef;
