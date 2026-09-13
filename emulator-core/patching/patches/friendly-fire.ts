// friendly-fire.ts — ROM descriptor of the `friendly-fire` feature (fully JS runtime).
//
// The ROM already handles a DEF bullet hitting a friendly DEF tank (sub_E70C, 3rd pass), but
// only as a stun; the enemy-vs-enemy bullet collision does not exist at all. Both behaviours
// are implemented by the JS runtime (features/friendly-fire.ts), so the ROM is not patched.
//
// Relative path: ./emulator-core/patching/patches/friendly-fire.ts
export const friendlyFire = {
  id: "friendly-fire",
  version: 1,
  description: "Friendly fire: defender-on-defender and attacker-on-attacker damage",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default friendlyFire;
