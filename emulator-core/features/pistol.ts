// pistol.ts — JS-рантайм фичи `pistol`: супер-выстрел лучом от нажатия A.
// ROM-часть (выпадение/подбор/4-я звезда/сброс) — patching/patches/pistol.ts.
//
// Относительный путь: ./emulator-core/features/pistol.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureRuntime } from "../patching/runtime.ts";
import { fireRailgun, initRailgunFx, renderRailgunFx, resetRailgunFx } from "./railgun.ts";

export const pistolRuntime: FeatureRuntime = {
  init(ctx) {
    initRailgunFx(ctx);
    ctx.state.bulletBefore = [0, 0];
  },

  // Запомнить состояние пуль DEF-слотов до ROM-кадра (для подавления обычного выстрела).
  preFrame(ctx) {
    const mem = ctx.kernel.mem;
    ctx.state.bulletBefore = [mem[RAM.BULLET_STATUS], mem[RAM.BULLET_STATUS + 1]];
  },

  // После кадра: если DEF с супер-оружием нажал огонь — исполнить луч.
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    const stage = mem[RAM.STAGE];
    if (stage < 1 || stage > 35) return;
    const before = ctx.state.bulletBefore as number[];
    for (let t = 0; t < DEF_PORTS; t++) {
      if (mem[RAM.PISTOL + t] !== 1) continue; // ровно 1 (RAM инициализируется 0xFF)
      if (!ctx.kernel.playerFire[t]) continue;
      // Подавить обычную пулю, созданную ROM в этот кадр.
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
