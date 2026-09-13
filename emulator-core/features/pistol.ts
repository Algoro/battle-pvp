// pistol.ts — JS runtime of the `pistol` feature: a super-shot beam from pressing A.
// The ROM part (drop/pickup/4th star/reset) is patching/patches/pistol.ts.
//
// Relative path: ./emulator-core/features/pistol.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureRuntime } from "../patching/runtime.ts";
import { fireRailgun, initRailgunFx, renderRailgunFx, resetRailgunFx } from "./railgun.ts";

export const pistolRuntime: FeatureRuntime = {
  init(ctx) {
    initRailgunFx(ctx);
    ctx.state.bulletBefore = [0, 0];
  },

  // Remember the bullet state of the DEF slots before the ROM frame (to suppress the normal shot).
  preFrame(ctx) {
    const mem = ctx.kernel.mem;
    ctx.state.bulletBefore = [mem[RAM.BULLET_STATUS], mem[RAM.BULLET_STATUS + 1]];
  },

  // After the frame: if a DEF with a super-weapon pressed fire — execute the beam.
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // battle not started
    const stage = mem[RAM.STAGE];
    if (stage < 1 || stage > 35) return;
    const before = ctx.state.bulletBefore as number[];
    for (let t = 0; t < DEF_PORTS; t++) {
      if (mem[RAM.PISTOL + t] !== 1) continue; // exactly 1 (RAM is initialized to 0xFF)
      if (!ctx.kernel.playerFire[t]) continue;
      // Suppress the normal bullet created by the ROM this frame.
      if (before[t] === 0 && mem[RAM.BULLET_STATUS + t] !== 0) {
        mem[RAM.BULLET_STATUS + t] = 0;
      }
      fireRailgun(ctx, t);
      const ammo = mem[RAM.PISTOL_AMMO + t] - 1;
      mem[RAM.PISTOL_AMMO + t] = ammo > 0 ? ammo : 0;
      if (ammo <= 0) mem[RAM.PISTOL + t] = 0;
    }
  },

  render(ctx) {
    renderRailgunFx(ctx);
  },

  onLoadState(ctx) {
    resetRailgunFx(ctx);
  },
};

export default pistolRuntime;
