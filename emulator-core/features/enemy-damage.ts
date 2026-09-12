// enemy-damage.ts — общий JS-урон по вражескому танку (броня, носитель приза, смерть).
//
// Вынесено из `friendly-fire-att.ts`, чтобы правила урона совпадали у friendly fire и
// башен tower defence (единый источник). Для совместимости поведение при
// damage=1/pierce=false в точности повторяет оригинальный friendly-fire.
//
// Относительный путь: ./emulator-core/features/enemy-damage.ts
import { RAM } from "../rom-contract.ts";
import type { FeatureContext } from "../patching/runtime.ts";

export const POSITIONS = [0x30, 0x60, 0x90, 0xc0]; // sub_E902_convert_random_number_to_position
export const BONUS_TABLE = [0, 1, 2, 3, 4, 5, 4, 3]; // tbl_E8FA_bonus
const TANK_EXPLODE = 0x73;

/** Детерминированное выпадение приза (не трогаем, если приз активен). */
export function spawnPrize(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  if (mem[RAM.PRIZE_X] !== 0) return;
  const seed = (mem[RAM.RANDOM] ^ mem[RAM.FRM_CNT_LO]) & 0xff;
  mem[RAM.PRIZE_X] = POSITIONS[seed & 3];
  mem[RAM.PRIZE_Y] = POSITIONS[(seed >> 2) & 3];
  mem[RAM.PRIZE_ID] = BONUS_TABLE[(seed >> 4) & 7];
  mem[RAM.BONUS_TIMER] = 0;
  mem[RAM.SFX_BONUS_APPEAR] = 1;
}

/**
 * Урон врагу: снять броню/носителя приза, при обнулении — взорвать.
 *  - pierce  — «бронебойный» выстрел: снимает всю броню за попадание;
 *  - damage  — сколько уровней брони снимает обычное попадание (>=1).
 * Возвращает true, если танк уничтожен.
 */
export function damageEnemy(ctx: FeatureContext, t: number, damage = 1, pierce = false): boolean {
  const mem = ctx.kernel.mem;
  let type = mem[RAM.TANK_TYPE + t];
  // Носитель приза (бит 0x04): теряет бонус и выпускает приз.
  if (type & 0x04) {
    spawnPrize(ctx);
    if (type === 0xe4) {
      type -= 1;
      mem[RAM.TANK_TYPE + t] = type;
    }
  }
  type = mem[RAM.TANK_TYPE + t];
  const armor = type & 0x03;
  if (armor > 0) {
    if (pierce) {
      mem[RAM.TANK_TYPE + t] = type & 0xf0;
    } else {
      const hits = Math.min(Math.max(1, damage), armor);
      mem[RAM.TANK_TYPE + t] = type - hits;
    }
    mem[RAM.SFX_BULLET_HIT_TANK] = 1;
    return false;
  }
  mem[RAM.TANK_FLAG + t] = TANK_EXPLODE;
  mem[RAM.TANK_TYPE + t] = 0;
  mem[RAM.SFX_EXPLOSION_ENEMY] = 1;
  return true;
}

export default { damageEnemy, spawnPrize, POSITIONS, BONUS_TABLE };
