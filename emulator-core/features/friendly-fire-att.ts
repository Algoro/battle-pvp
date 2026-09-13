// friendly-fire-att.ts — JS-рантайм фичи `friendly-fire-att`.
//
// ROM не проверяет попадание вражеской пули (2..7) в другого врага. Рантайм после кадра
// сам находит такие попадания (радиус < 0x0A по осям, как в sub_E70C), гасит пулю и
// применяет урон через общий `enemy-damage.ts` (броня/носитель приза/смерть).
//
// Стрелок тоже может погибнуть от собственной пули — но только когда пуля уже вышла из
// его «дула»: при выстреле пуля спавнится в хитбоксе танка, поэтому без этой задержки
// каждый враг убивал бы себя в момент выстрела. Факт «пуля покинула дуло» храним битом
// в RAM (FF_ATT_CLEARED), чтобы состояние переживало save/load и rollback.
//
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

function ownerAlive(mem: Uint8Array, t: number): boolean {
  const flag = mem[RAM.TANK_FLAG + t];
  return (flag & 0x80) !== 0 && flag < 0xe0;
}

export const friendlyFireAttRuntime: FeatureRuntime = {
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    const rawDamage = Number(ctx.options?.damage ?? 1);
    const damage = Math.max(1, Math.min(3, Number.isFinite(rawDamage) ? Math.round(rawDamage) : 1));
    const selfDamage = ctx.options?.selfDamage !== false;

    let cleared = mem[RAM.FF_ATT_CLEARED];
    for (let b = ENEMY_FIRST; b <= ENEMY_LAST; b++) {
      const bit = 1 << b;
      if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== BULLET_FLYING) {
        cleared &= ~bit; // пуля не летит — слот сброшен
        continue;
      }

      // Отмечаем, что пуля вышла из дула стрелка (или стрелок уже мёртв).
      if (!(cleared & bit)) {
        const dx = Math.abs(mem[RAM.BULLET_X + b] - mem[RAM.TANK_X + b]);
        const dy = Math.abs(mem[RAM.BULLET_Y + b] - mem[RAM.TANK_Y + b]);
        if (!ownerAlive(mem, b) || dx >= HIT_RADIUS || dy >= HIT_RADIUS) cleared |= bit;
      }
      const selfOk = selfDamage && (cleared & bit) !== 0;

      let hit = false;
      for (let t = ENEMY_FIRST; t <= ENEMY_LAST && !hit; t++) {
        if (t === b && !selfOk) continue; // своя пуля бьёт стрелка только после выхода из дула
        const flag = mem[RAM.TANK_FLAG + t];
        if (!(flag & 0x80) || flag >= 0xe0) continue; // только «на поле»
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
