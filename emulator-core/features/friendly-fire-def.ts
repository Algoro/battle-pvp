// friendly-fire-def.ts — JS-рантайм фичи `friendly-fire-def`.
//
// ROM (sub_E70C, 3-й проход) уже детектирует попадание DEF-пули в союзного DEF-танка и
// ставит ram_plr_stun_timer = 0xC8. Фича превращает это событие в смерть: снимаем стан и
// уничтожаем танк (флаг взрыва, сброс апгрейда/пистолета, SFX). 0xC8 — единственный
// ненулевой стан, поэтому переход 0 -> 0xC8 однозначно означает friendly fire.
// Каска защищает (ROM гасит пулю до стана), своя пуля по себе не проходит (ROM по чётности).
//
// Относительный путь: ./emulator-core/features/friendly-fire-def.ts
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
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    const before = ctx.state.stunBefore as number[];
    for (let t = 0; t < DEF_PORTS; t++) {
      if (before[t] !== 0 || mem[RAM.STUN + t] !== FF_STUN) continue;
      // союзник убит своим — применяем смерть вместо стана
      mem[RAM.TANK_FLAG + t] = 0x73; // con_tank_flag_explosion + 3
      mem[RAM.TANK_TYPE + t] = 0;
      mem[RAM.TANK_UPGRADE + t] = 0;
      if (ctx.kernel.hasFeature("pistol")) {
        mem[RAM.PISTOL + t] = 0;
        mem[RAM.PISTOL_AMMO + t] = 0;
      }
      mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
      mem[RAM.STUN + t] = 0; // стан больше не нужен
    }
  },
};

export default friendlyFireDefRuntime;
