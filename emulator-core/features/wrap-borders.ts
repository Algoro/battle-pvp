// wrap-borders.ts — JS-рантайм фичи «открытые края».
//
// ROM-патч убирает неразрушимую рамку уровня; здесь игровая зона (26×26 тайлов,
// 2..27) превращается в тор: объект, вышедший за шов, появляется с противоположной
// стороны. Границы — по центру объекта: игровая зона 208 px (26 тайлов), танк 16 px,
// поэтому центр ходит в диапазоне 0x18..0xD8, а период тора = 0xD8-0x18 = 192 px
// (объект выходит одной стороной ровно там, где входит другой).
//
// Перенос делается только при фактическом переходе «внутри → снаружи» (запоминаем
// прошлую позицию), поэтому спавн врагов у верхней кромки (y=0, вне зоны) не
// телепортирует их сразу. Если противоположная сторона занята (кирпич/сталь/вода/
// орёл), перенос не делается: танк упирается в шов, пуля гаснет. Всё в postFrame,
// до getFrameHash, без Date/Math.random — детерминировано.
//
// Относительный путь: ./emulator-core/features/wrap-borders.ts
import { RAM } from "../rom-contract.ts";
import { BULLET, blocksBullet, tankPassable } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";

const LOW = 0x18; // центр танка в первой клетке игровой зоны (тайл 2)
const HIGH = 0xd8; // центр танка в последней клетке игровой зоны (тайл 27)
const PERIOD = HIGH - LOW; // 192 px — расстояние между швами (208 - ширина танка)
const FIELD_W = 32;

interface WrapState {
  tx: (number | null)[];
  ty: (number | null)[];
  bx: (number | null)[];
  by: (number | null)[];
}

function wst(ctx: FeatureContext): WrapState {
  return (ctx.state.wrap ??= {
    tx: new Array(8).fill(null),
    ty: new Array(8).fill(null),
    bx: new Array(8).fill(null),
    by: new Array(8).fill(null),
  }) as WrapState;
}

// Свободны ли 2×2 клетки под 16-px танк с центром (cx, cy).
function tankFits(mem: Uint8Array, cx: number, cy: number): boolean {
  const c0 = (cx - 8) >> 3;
  const r0 = (cy - 8) >> 3;
  for (let r = r0; r <= r0 + 1; r++) {
    for (let c = c0; c <= c0 + 1; c++) {
      if (c < 0 || c >= FIELD_W || r < 0 || r >= FIELD_W) return false;
      if (!tankPassable(mem[RAM.FIELD + r * FIELD_W + c])) return false;
    }
  }
  return true;
}

// Вышел за шов за этот кадр? Возвращает перенесённую координату или исходную.
// prev === null — объект только что появился: танк не переносим (спавн у кромки),
// пулю переносим, если она сразу оказалась снаружи и летит наружу (выстрел у шва).
function crossAxis(prev: number | null, now: number, outwardLow: boolean, outwardHigh: boolean): number {
  if (prev === null) {
    if (outwardLow && now < LOW) return now + PERIOD;
    if (outwardHigh && now > HIGH) return now - PERIOD;
    return now;
  }
  const wasInside = prev >= LOW && prev <= HIGH;
  if (!wasInside) return now;
  if (now < LOW) return now + PERIOD;
  if (now > HIGH) return now - PERIOD;
  return now;
}

function wrapTank(ctx: FeatureContext, mem: Uint8Array, t: number): void {
  const s = wst(ctx);
  const flag = mem[RAM.TANK_FLAG + t];
  if (flag < 0x80 || flag >= 0xe0) {
    s.tx[t] = null;
    s.ty[t] = null;
    return; // мёртв/взрыв/респавн
  }

  const wrapX = ctx.options?.wrapX !== false;
  const wrapY = ctx.options?.wrapY !== false;
  let x = mem[RAM.TANK_X + t];
  let y = mem[RAM.TANK_Y + t];

  const cx = wrapX ? crossAxis(s.tx[t], x, false, false) : x;
  if (cx !== x) x = tankFits(mem, cx, y) ? cx : x < LOW ? LOW : HIGH;

  const cy = wrapY ? crossAxis(s.ty[t], y, false, false) : y;
  if (cy !== y) y = tankFits(mem, x, cy) ? cy : y < LOW ? LOW : HIGH;

  mem[RAM.TANK_X + t] = x;
  mem[RAM.TANK_Y + t] = y;
  s.tx[t] = x;
  s.ty[t] = y;
}

function wrapBullet(ctx: FeatureContext, mem: Uint8Array, b: number): void {
  const s = wst(ctx);
  if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== BULLET.FLYING) {
    s.bx[b] = null;
    s.by[b] = null;
    return;
  }

  const wrapX = ctx.options?.wrapX !== false;
  const wrapY = ctx.options?.wrapY !== false;
  let x = mem[RAM.BULLET_X + b];
  let y = mem[RAM.BULLET_Y + b];

  const dir = mem[RAM.BULLET_STATUS + b] & 3;
  const cx = wrapX ? crossAxis(s.bx[b], x, dir === 1, dir === 3) : x;
  if (cx !== x) {
    if (blocksBullet(mem[RAM.FIELD + (y >> 3) * FIELD_W + (cx >> 3)])) {
      mem[RAM.BULLET_STATUS + b] = BULLET.EXPLODE;
      s.bx[b] = null;
      s.by[b] = null;
      return;
    }
    x = cx;
    mem[RAM.BULLET_X + b] = x;
  }

  const cy = wrapY ? crossAxis(s.by[b], y, dir === 0, dir === 2) : y;
  if (cy !== y) {
    if (blocksBullet(mem[RAM.FIELD + (cy >> 3) * FIELD_W + (x >> 3)])) {
      mem[RAM.BULLET_STATUS + b] = BULLET.EXPLODE;
      s.bx[b] = null;
      s.by[b] = null;
      return;
    }
    y = cy;
    mem[RAM.BULLET_Y + b] = y;
  }

  s.bx[b] = x;
  s.by[b] = y;
}

export const wrapBordersRuntime: FeatureRuntime = {
  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // матч не начат
    for (let t = 0; t <= 7; t++) wrapTank(ctx, mem, t);
    for (let b = 0; b <= 7; b++) wrapBullet(ctx, mem, b);
  },
};

export default wrapBordersRuntime;
