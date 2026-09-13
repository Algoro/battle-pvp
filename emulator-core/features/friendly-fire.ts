// friendly-fire.ts — JS runtime of the `friendly-fire` feature (merged DEF + ATT).
//
// Two independent parts, each controlled by its own settings:
//   * defenders — a DEF bullet hitting a friendly DEF tank kills it (the ROM, sub_E70C 3rd
//     pass, only applies a stun; we turn the 0 -> 0xC8 stun transition into death). Can be
//     disabled (`defenders:false`) or made non-lethal (`defLethal:false` -> keep the stun).
//   * attackers — an enemy bullet (slots 2..7) hitting another enemy tank deals damage
//     (no such collision exists in the ROM). `damage` sets how much armor is stripped;
//     `selfDamage` also lets the shooter die from its own bullet, but only after the bullet
//     has left its muzzle (the bullet spawns inside the shooter's hitbox). The "left the
//     muzzle" bit lives in RAM (FF_ATT_CLEARED) so it survives save/load and rollback.
//
// Relative path: ./emulator-core/features/friendly-fire.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";
import { damageEnemy } from "./enemy-damage.ts";

const ENEMY_FIRST = DEF_PORTS; // 2
const ENEMY_LAST = 7;
const HIT_RADIUS = 0x0a;
const BULLET_EXPLODE = 0x33;
const BULLET_FLYING = 0x40;
const FF_STUN = 0xc8;

function ownerAlive(mem: Uint8Array, t: number): boolean {
  const flag = mem[RAM.TANK_FLAG + t];
  return (flag & 0x80) !== 0 && flag < 0xe0;
}

// --- defenders part ---
function friendlyFireDefenders(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const before = ctx.state.stunBefore as number[];
  for (let t = 0; t < DEF_PORTS; t++) {
    if (before[t] !== 0 || mem[RAM.STUN + t] !== FF_STUN) continue;
    if (ctx.options?.defLethal === false) continue; // keep the ROM stun, no death
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
}

// --- attackers part ---
function friendlyFireAttackers(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const rawDamage = Number(ctx.options?.damage ?? 1);
  const damage = Math.max(1, Math.min(3, Number.isFinite(rawDamage) ? Math.round(rawDamage) : 1));
  const selfDamage = ctx.options?.selfDamage !== false;

  let cleared = mem[RAM.FF_ATT_CLEARED];
  for (let b = ENEMY_FIRST; b <= ENEMY_LAST; b++) {
    const bit = 1 << b;
    if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== BULLET_FLYING) {
      cleared &= ~bit; // slot reset
      continue;
    }

    // Mark that the bullet has left the shooter's muzzle (or the shooter is already dead).
    if (!(cleared & bit)) {
      const dx = Math.abs(mem[RAM.BULLET_X + b] - mem[RAM.TANK_X + b]);
      const dy = Math.abs(mem[RAM.BULLET_Y + b] - mem[RAM.TANK_Y + b]);
      if (!ownerAlive(mem, b) || dx >= HIT_RADIUS || dy >= HIT_RADIUS) cleared |= bit;
    }
    const selfOk = selfDamage && (cleared & bit) !== 0;

    let hit = false;
    for (let t = ENEMY_FIRST; t <= ENEMY_LAST && !hit; t++) {
      if (t === b && !selfOk) continue; // own bullet hits the shooter only after the muzzle
      const flag = mem[RAM.TANK_FLAG + t];
      if (!(flag & 0x80) || flag >= 0xe0) continue; // only "on field"
      const dx = Math.abs(mem[RAM.BULLET_X + b] - mem[RAM.TANK_X + t]);
      if (dx >= HIT_RADIUS) continue;
      const dy = Math.abs(mem[RAM.BULLET_Y + b] - mem[RAM.TANK_Y + t]);
      if (dy >= HIT_RADIUS) continue;
      mem[RAM.BULLET_STATUS + b] = BULLET_EXPLODE;
      damageEnemy(ctx, t, damage);
      hit = true;
    }
  }
  mem[RAM.FF_ATT_CLEARED] = cleared;
}

export const friendlyFireRuntime: FeatureRuntime = {
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
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // match not started
    if (ctx.options?.defenders !== false) friendlyFireDefenders(ctx);
    if (ctx.options?.attackers !== false) friendlyFireAttackers(ctx);
  },
};

export default friendlyFireRuntime;
