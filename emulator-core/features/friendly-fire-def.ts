// friendly-fire-def.ts — JS runtime of the `friendly-fire-def` feature.
//
// The ROM (sub_E70C, 3rd pass) already detects a DEF bullet hitting a friendly DEF tank and
// sets ram_plr_stun_timer = 0xC8. The feature turns this event into death: we clear the stun and
// destroy the tank (explosion flag, reset upgrade/pistol, SFX). 0xC8 is the only
// nonzero stun, so the transition 0 -> 0xC8 unambiguously means friendly fire.
// A helmet protects (the ROM extinguishes the bullet before the stun); a tank's own bullet doesn't hit itself (ROM by parity).
//
// Relative path: ./emulator-core/features/friendly-fire-def.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureRuntime } from "../patching/runtime.ts";

const FF_STUN = 0xc8;

export const friendlyFireDefRuntime: FeatureRuntime = {
  init(ctx) {
    const mem = ctx.kernel.mem;
    ctx.state.stunBefore = [mem[RAM.STUN], mem[RAM.STUN + 1]];
  },

  preFrame(ctx) {
    const mem = ctx.kernel.mem;
    ctx.state.stunBefore = [mem[RAM.STUN], mem[RAM.STUN + 1]];
  },

  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // battle not started
    if (ctx.options?.lethal === false) return; // disabled — the ROM's standard stun remains
    const before = ctx.state.stunBefore as number[];
    for (let t = 0; t < DEF_PORTS; t++) {
      if (before[t] !== 0 || mem[RAM.STUN + t] !== FF_STUN) continue;
      // a friendly was killed by an ally — apply death instead of a stun
      mem[RAM.TANK_FLAG + t] = 0x73; // con_tank_flag_explosion + 3
      mem[RAM.TANK_TYPE + t] = 0;
      mem[RAM.TANK_UPGRADE + t] = 0;
      if (ctx.kernel.hasFeature("pistol")) {
        mem[RAM.PISTOL + t] = 0;
        mem[RAM.PISTOL_AMMO + t] = 0;
      }
      mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
      mem[RAM.STUN + t] = 0; // the stun is no longer needed
    }
  },
};

export default friendlyFireDefRuntime;
