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

// id приза -> настройка «доступен врагу» (выкл — приз остаётся на поле).
const ALLOW_FIELD: Record<number, string> = {
  0: "allowHelmet",
  1: "allowClock",
  2: "allowShovel",
  3: "allowStar",
  4: "allowGrenade",
  5: "allowTank",
  6: "allowPistol",
};

function allowMask(options: Record<string, unknown>): number {
  let mask = 0;
  for (const [id, field] of Object.entries(ALLOW_FIELD)) {
    if (options[field] !== false) mask |= 1 << Number(id);
  }
  return mask & 0xff;
}

// Снять защиту базы: кирпич и сталь вокруг орла -> пусто; штаб не трогаем.
// Область стен базы — те же клетки, что рисует sub_CAF5_draw_default_base (rows 24..27, cols 12..17).
function clearBaseProtection(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const onlyBricks = ctx.options?.shovelMode === "bricks";
  for (let row = 24; row <= 27; row++) {
    for (let col = 12; col <= 17; col++) {
      const off = row * 32 + col;
      const v = mem[RAM.FIELD + off];
      const remove = onlyBricks ? isBrick(v) : isBrick(v) || isSteel(v);
      if (!remove) continue;
      mem[RAM.FIELD + off] = 0;
      for (const nt of ctx.kernel.ppuNameTable) nt.tile[off] = 0;
    }
  }
  mem[RAM.FORTIFIED] = 0; // ram_shovel_timer: остановить восстановление/мигание
}

// Апгрейд брони врага на ступень (0x80 -> 0xa0 -> 0xc0 -> 0xe0), сохраняя младшие биты.
function upgradeEnemyArmor(ctx: FeatureContext, idx: number, levels = 1): void {
  const mem = ctx.kernel.mem;
  const type = mem[RAM.TANK_TYPE + idx];
  const hi = Math.min(0xe0, (type & 0xe0) + 0x20 * Math.max(1, levels));
  mem[RAM.TANK_TYPE + idx] = (type & 0x1f) | hi;
}

// Взорвать защитников (granata в руках врага): штатная последовательность взрыва.
function explodeDefenders(ctx: FeatureContext, lethal: boolean): void {
  const mem = ctx.kernel.mem;
  for (let t = 0; t < DEF_PORTS; t++) {
    const flag = mem[RAM.TANK_FLAG + t];
    if (!(flag & 0x80) || flag >= 0xe0) continue; // только «на поле»
    if (lethal) {
      mem[RAM.TANK_FLAG + t] = 0x73;
      mem[RAM.TANK_TYPE + t] = 0;
      mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
    } else {
      mem[RAM.STUN + t] = 0xc8; // стан вместо взрыва
    }
  }
}

function applyEffect(ctx: FeatureContext, idx: number, id: number): void {
  const mem = ctx.kernel.mem;
  switch (id) {
    case 1: { // clock — заморозить защитников
      const frames = Math.max(1, Math.min(0xff, Math.round(Number(ctx.options?.freezeFrames ?? FREEZE_FRAMES) || FREEZE_FRAMES)));
      for (let t = 0; t < DEF_PORTS; t++) mem[RAM.PRIZE_FREEZE + t] = frames;
      break;
    }
    case 2: // shovel — снять защиту базы
      clearBaseProtection(ctx);
      break;
    case 0: // helmet — по настройке: ничего или +1 броня
      if (ctx.options?.helmetEffect === "armor") upgradeEnemyArmor(ctx, idx, 1);
      break;
    case 3: { // star — броня врага на starLevels ступеней
      const levels = Math.max(1, Math.min(3, Math.round(Number(ctx.options?.starLevels ?? 1) || 1)));
      upgradeEnemyArmor(ctx, idx, levels);
      break;
    }
    case 4: // grenade — взорвать (или стан) защитников
      explodeDefenders(ctx, ctx.options?.grenadeLethal !== false);
      break;
    case 5: { // tank — подкрепление (можно отключить настройкой)
      if (ctx.options?.reinforcement !== false && mem[RAM.ENEMIES_LEFT] !== 0xff && mem[RAM.ENEMIES_LEFT] < 0xff) {
        const add = Math.max(1, Math.min(3, Math.round(Number(ctx.options?.reinforceCount ?? 1) || 1)));
        mem[RAM.ENEMIES_LEFT] = (mem[RAM.ENEMIES_LEFT] + add) & 0xff;
      }
      break;
    }
    case 6: // pistol — супер-оружие врагу (только вместе с фичей `pistol`)
      if (ctx.kernel.hasFeature("pistol") && idx >= ENEMY_FIRST) {
        const ammo = Math.max(1, Math.min(10, Math.round(Number(ctx.options?.pistolAmmo ?? PISTOL_SHOTS) || PISTOL_SHOTS)));
        mem[RAM.ENEMY_PISTOL_AMMO + (idx - ENEMY_FIRST)] = ammo;
      }
      break;
    default:
      break; // неизвестные — без эффекта
  }
}

export const enemyPrizesRuntime: FeatureRuntime = {
  init(ctx) {
    initRailgunFx(ctx);
    const mem = ctx.kernel.mem;
    mem[RAM.ENEMY_PRIZE_ALLOW] = allowMask(ctx.options || {});
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
    mem[RAM.ENEMY_PRIZE_ALLOW] = allowMask(ctx.options || {}); // переживает rollback/loadState
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
