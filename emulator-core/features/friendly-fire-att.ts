// friendly-fire-att.ts — JS-рантайм фичи `friendly-fire-att`.
//
// ROM не проверяет попадание вражеской пули (2..7) в другого врага. Рантайм после кадра
// сам находит такие попадания (радиус < 0x0A по осям, как в sub_E70C), гасит пулю и
// применяет урон через общий `enemy-damage.ts` (броня/носитель приза/смерть).
// Очки не начисляются (у врагов их нет).
//
// Относительный путь: ./emulator-core/features/friendly-fire-att.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureRuntime } from "../patching/runtime.ts";
import { damageEnemy } from "./enemy-damage.ts";

const ENEMY_FIRST = DEF_PORTS; // 2
const ENEMY_LAST = 7;
const HIT_RADIUS = 0x0a;
const BULLET_EXPLODE = 0x33;
const BULLET_FLYING = 0x40;

export const friendlyFireAttRuntime: FeatureRuntime = {
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    for (let b = ENEMY_FIRST; b <= ENEMY_LAST; b++) {
      if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== BULLET_FLYING) continue;
      let hit = false;
      for (let t = ENEMY_FIRST; t <= ENEMY_LAST && !hit; t++) {
        if (t === b) continue; // своя пуля по себе не бьёт
        const flag = mem[RAM.TANK_FLAG + t];
        if (!(flag & 0x80) || flag >= 0xe0) continue; // только «на поле»
        const dx = Math.abs(mem[RAM.BULLET_X + b] - mem[RAM.TANK_X + t]);
        if (dx >= HIT_RADIUS) continue;
        const dy = Math.abs(mem[RAM.BULLET_Y + b] - mem[RAM.TANK_Y + t]);
        if (dy >= HIT_RADIUS) continue;
        mem[RAM.BULLET_STATUS + b] = BULLET_EXPLODE;
        damageEnemy(ctx, t, 1);
        hit = true;
      }
    }
  },
};

export default friendlyFireAttRuntime;
