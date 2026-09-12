// enemy-prizes.ts — JS-рантайм фичи `enemy-prizes`: эффекты приза, забранного врагом.
// ROM-часть (хук sub_E972) записывает пару (индекс врага, id приза) в RAM и поглощает
// приз; этот рантайм применяет эффект подобравшему/защитникам.
//
// Соответствие (согласовано):
//   0 helmet — без эффекта (только поглощение);
//   1 clock  — заморозить защитников (DEF 0,1);
//   2 shovel — снять защиту базы полностью (кирпич+сталь -> пусто, перманентно);
//   3 star   — апгрейд брони врага;
//   4 grenade— взорвать защитников;
//   5 tank   — подкрепление (ENEMIES_LEFT++);
//   6 pistol — супер-оружие врагу (если включена фича `pistol`).
//
// Относительный путь: ./emulator-core/features/enemy-prizes.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS, PISTOL_SHOTS, isBrick, isSteel } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";
import { fireRailgun, initRailgunFx, renderRailgunFx, resetRailgunFx } from "./railgun.ts";

const FREEZE_FRAMES = 0x0a; // как ram_clock_timer в ROM
const ENEMY_FIRST = 2; // танки 2..7 — враги/ATT

// Снять защиту базы: кирпич и сталь вокруг орла -> пусто; штаб не трогаем.
// Область стен базы — те же клетки, что рисует sub_CAF5_draw_default_base (rows 24..27, cols 12..17).
function clearBaseProtection(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  for (let row = 24; row <= 27; row++) {
    for (let col = 12; col <= 17; col++) {
      const off = row * 32 + col;
      const v = mem[RAM.FIELD + off];
      if (!isBrick(v) && !isSteel(v)) continue;
      mem[RAM.FIELD + off] = 0;
      for (const nt of ctx.kernel.ppuNameTable) nt.tile[off] = 0;
    }
  }
  mem[RAM.FORTIFIED] = 0; // ram_shovel_timer: остановить восстановление/мигание
}

// Апгрейд брони врага на ступень (0x80 -> 0xa0 -> 0xc0 -> 0xe0), сохраняя младшие биты.
function upgradeEnemyArmor(ctx: FeatureContext, idx: number): void {
  const mem = ctx.kernel.mem;
  const type = mem[RAM.TANK_TYPE + idx];
  const hi = Math.min(0xe0, (type & 0xe0) + 0x20);
  mem[RAM.TANK_TYPE + idx] = (type & 0x1f) | hi;
}

// Взорвать защитников (granata в руках врага): штатная последовательность взрыва.
function explodeDefenders(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  for (let t = 0; t < DEF_PORTS; t++) {
    const flag = mem[RAM.TANK_FLAG + t];
    if (!(flag & 0x80) || flag >= 0xe0) continue; // только «на поле»
    mem[RAM.TANK_FLAG + t] = 0x73;
    mem[RAM.TANK_TYPE + t] = 0;
    mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
  }
}

function applyEffect(ctx: FeatureContext, idx: number, id: number): void {
  const mem = ctx.kernel.mem;
  switch (id) {
    case 1: // clock — заморозить защитников
      for (let t = 0; t < DEF_PORTS; t++) mem[RAM.PRIZE_FREEZE + t] = FREEZE_FRAMES;
      break;
    case 2: // shovel — снять защиту базы
      clearBaseProtection(ctx);
      break;
    case 3: // star — броня врага
      upgradeEnemyArmor(ctx, idx);
      break;
    case 4: // grenade — взорвать защитников
      explodeDefenders(ctx);
      break;
    case 5: // tank — подкрепление
      if (mem[RAM.ENEMIES_LEFT] !== 0xff && mem[RAM.ENEMIES_LEFT] < 0xff) {
        mem[RAM.ENEMIES_LEFT] = (mem[RAM.ENEMIES_LEFT] + 1) & 0xff;
      }
      break;
    case 6: // pistol — супер-оружие врагу (только вместе с фичей `pistol`)
      if (ctx.kernel.hasFeature("pistol") && idx >= ENEMY_FIRST) {
        mem[RAM.ENEMY_PISTOL_AMMO + (idx - ENEMY_FIRST)] = PISTOL_SHOTS;
      }
      break;
    default:
      break; // helmet и неизвестные — без эффекта
  }
}

export const enemyPrizesRuntime: FeatureRuntime = {
  init(ctx) {
    initRailgunFx(ctx);
    const mem = ctx.kernel.mem;
    mem[RAM.ENEMY_PRIZE_IDX] = 0xff;
    mem[RAM.ENEMY_PRIZE_ID] = 0xff;
    for (let t = 0; t < DEF_PORTS; t++) mem[RAM.PRIZE_FREEZE + t] = 0;
    for (let t = 0; t < 6; t++) mem[RAM.ENEMY_PISTOL_AMMO + t] = 0;
    ctx.state.enemyBulletBefore = new Array(6).fill(0);
  },

  preFrame(ctx) {
    const mem = ctx.kernel.mem;
    const before = ctx.state.enemyBulletBefore as number[];
    for (let i = 0; i < 6; i++) before[i] = mem[RAM.BULLET_STATUS + ENEMY_FIRST + i];
  },

  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    // 1) событие подбора приза врагом (запись ROM-хука)
    const idx = mem[RAM.ENEMY_PRIZE_IDX];
    if (idx !== 0xff) {
      const id = mem[RAM.ENEMY_PRIZE_ID];
      mem[RAM.ENEMY_PRIZE_IDX] = 0xff;
      mem[RAM.ENEMY_PRIZE_ID] = 0xff;
      if (idx >= ENEMY_FIRST && idx <= 7) applyEffect(ctx, idx, id);
    }
    // 2) враг с супер-оружием: обычный выстрел заменяем лучом
    const before = ctx.state.enemyBulletBefore as number[];
    for (let i = 0; i < 6; i++) {
      const t = ENEMY_FIRST + i;
      if (mem[RAM.ENEMY_PISTOL_AMMO + i] <= 0) continue;
      // выстрел врага (ROM/AI) в этом кадре: пуля появилась
      if (before[i] !== 0 || mem[RAM.BULLET_STATUS + t] === 0) continue;
      mem[RAM.BULLET_STATUS + t] = 0; // подавить обычную пулю
      fireRailgun(ctx, t);
      const ammo = mem[RAM.ENEMY_PISTOL_AMMO + i] - 1;
      mem[RAM.ENEMY_PISTOL_AMMO + i] = ammo > 0 ? ammo : 0;
    }
  },

  render(ctx) {
    renderRailgunFx(ctx);
  },

  onLoadState(ctx) {
    resetRailgunFx(ctx);
  },
};

export default enemyPrizesRuntime;
