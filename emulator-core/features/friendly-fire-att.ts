// friendly-fire-att.ts — JS-рантайм фичи `friendly-fire-att`.
//
// ROM не проверяет попадание вражеской пули (2..7) в другого врага. Рантайм после кадра
// сам находит такие попадания (радиус < 0x0A по осям, как в sub_E70C), гасит пулю и
// применяет урон: учитывает броню (tank_type & 3), носителя приза (tank_type & 4 —
// выпадает приз) и убивает при обнулении брони. Очки не начисляются (у врагов их нет).
//
// Относительный путь: ./emulator-core/features/friendly-fire-att.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";

const ENEMY_FIRST = DEF_PORTS; // 2
const ENEMY_LAST = 7;
const HIT_RADIUS = 0x0a;
const BULLET_EXPLODE = 0x33;
const BULLET_FLYING = 0x40;
const TANK_EXPLODE = 0x73;
const POSITIONS = [0x30, 0x60, 0x90, 0xc0]; // sub_E902_convert_random_number_to_position
const BONUS_TABLE = [0, 1, 2, 3, 4, 5, 4, 3]; // tbl_E8FA_bonus

// Детерминированное выпадение приза (клиенты считают одинаково). Не трогаем, если приз активен.
function spawnPrize(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  if (mem[RAM.PRIZE_X] !== 0) return;
  const seed = (mem[RAM.RANDOM] ^ mem[RAM.FRM_CNT_LO]) & 0xff;
  mem[RAM.PRIZE_X] = POSITIONS[seed & 3];
  mem[RAM.PRIZE_Y] = POSITIONS[(seed >> 2) & 3];
  mem[RAM.PRIZE_ID] = BONUS_TABLE[(seed >> 4) & 7];
  mem[RAM.BONUS_TIMER] = 0;
  mem[RAM.SFX_BONUS_APPEAR] = 1;
}

// Урон врагу от союзной пули: броня/носитель приза/смерть (как проход 2 sub_E70C).
function damageEnemy(ctx: FeatureContext, t: number): void {
  const mem = ctx.kernel.mem;
  let type = mem[RAM.TANK_TYPE + t];
  if (type & 0x04) {
    spawnPrize(ctx);
    if (type === 0xe4) {
      type -= 1;
      mem[RAM.TANK_TYPE + t] = type;
    }
  }
  type = mem[RAM.TANK_TYPE + t];
  if ((type & 0x03) !== 0) {
    mem[RAM.TANK_TYPE + t] = type - 1; // броня ещё держит
    mem[RAM.SFX_BULLET_HIT_TANK] = 1;
    return;
  }
  mem[RAM.TANK_FLAG + t] = TANK_EXPLODE;
  mem[RAM.TANK_TYPE + t] = 0;
  mem[RAM.SFX_EXPLOSION_ENEMY] = 1;
}

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
        damageEnemy(ctx, t);
        hit = true;
      }
    }
  },
};

export default friendlyFireAttRuntime;
