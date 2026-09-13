// friendly-fire-att.ts — JS runtime of the `friendly-fire-att` feature.
//
// The ROM does not check an enemy bullet (2..7) hitting another enemy. After the frame the runtime
// finds such hits itself (radius < 0x0A per axis, like in sub_E70C), extinguishes the bullet, and
// applies damage via the shared `enemy-damage.ts` (armor/prize carrier/death).
//
// The shooter can also die from its own bullet — but only once the bullet has left
// its "barrel": on firing, the bullet spawns inside the tank's hitbox, so without this delay
// every enemy would kill itself at the moment of firing. We store the fact "the bullet left the barrel" as a bit
// in RAM (FF_ATT_CLEARED), so the state survives save/load and rollback.
//
// No points are awarded (enemies have none).
//
// Relative path: ./emulator-core/features/friendly-fire-att.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS } from "../domain.ts";
import type { FeatureRuntime } from "../patching/runtime.ts";
import { damageEnemy } from "./enemy-damage.ts";

const ENEMY_FIRST = DEF_PORTS; // 2
const ENEMY_LAST = 7;
const HIT_RADIUS = 0x0a;
const BULLET_EXPLODE = 0x33;
const BULLET_FLYING = 0x40;

function ownerAlive(mem: Uint8Array, t: number): boolean {
  const flag = mem[RAM.TANK_FLAG + t];
  return (flag & 0x80) !== 0 && flag < 0xe0;
}

export const friendlyFireAttRuntime: FeatureRuntime = {
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // battle not started
    const rawDamage = Number(ctx.options?.damage ?? 1);
    const damage = Math.max(1, Math.min(3, Number.isFinite(rawDamage) ? Math.round(rawDamage) : 1));
    const selfDamage = ctx.options?.selfDamage !== false;

    let cleared = mem[RAM.FF_ATT_CLEARED];
    for (let b = ENEMY_FIRST; b <= ENEMY_LAST; b++) {
      const bit = 1 << b;
      if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== BULLET_FLYING) {
        cleared &= ~bit; // bullet is not flying — slot reset
        continue;
      }

      // Mark that the bullet has left the shooter's barrel (or the shooter is already dead).
      if (!(cleared & bit)) {
        const dx = Math.abs(mem[RAM.BULLET_X + b] - mem[RAM.TANK_X + b]);
        const dy = Math.abs(mem[RAM.BULLET_Y + b] - mem[RAM.TANK_Y + b]);
        if (!ownerAlive(mem, b) || dx >= HIT_RADIUS || dy >= HIT_RADIUS) cleared |= bit;
      }
      const selfOk = selfDamage && (cleared & bit) !== 0;

      let hit = false;
      for (let t = ENEMY_FIRST; t <= ENEMY_LAST && !hit; t++) {
        if (t === b && !selfOk) continue; // own bullet hits the shooter only after leaving the barrel
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
  },
};

export default friendlyFireAttRuntime;
