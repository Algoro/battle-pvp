// coords.ts — перевод координат Battle City (RAM-пиксели, клетки поля) в мировые юниты.
// 1 юнит = 1 клетка поля (8 px). Игровая зона — bounds (26×26), начало в (col0,row0).
//
// Относительный путь: ./frontend/src/render/coords.ts
import type { RenderBounds } from "./types.ts";

export interface GroundPoint {
  x: number;
  z: number;
}

/** Центр клетки поля (col,row — абсолютные индексы буфера). */
export function cellCenter(b: RenderBounds, col: number, row: number): GroundPoint {
  return { x: col - b.col0 + 0.5, z: row - b.row0 + 0.5 };
}

/**
 * Центр танка. RAM (x,y) — уже ЦЕНТР танка в пикселях (см. `emulator-core/io/tank-driver.ts`:
 * «RAM-позиция танка (x,y) — ЦЕНТР танка»), поэтому переводим непрерывно: 8 px = 1 юнит.
 * Никакого `>>3`/округления (иначе рывки по 8 px) и никакого лишнего смещения.
 */
export function tankCenter(b: RenderBounds, px: number, py: number): GroundPoint {
  return { x: px / 8 - b.col0, z: py / 8 - b.row0 };
}

/** Точка объекта по RAM-пиксельным координатам (top-left спрайта, как хранит ROM). */
export function pointFromPixel(b: RenderBounds, px: number, py: number): GroundPoint {
  return { x: px / 8 - b.col0, z: py / 8 - b.row0 };
}

/**
 * Центр спрайта, если RAM (x,y) — его top-left (ROM рисует спрайты напрямую из этих
 * координат: приз `E26C: LDX ram_bonus_pos_X ; spr_X`, пуля `E100: spr_X/Y`).
 * `sizePx` — размер спрайта в пикселях (приз 16, пуля 8); смещение к центру = sizePx/16 юнита.
 */
export function spriteCenter(b: RenderBounds, px: number, py: number, sizePx: number): GroundPoint {
  const half = sizePx / 16;
  return { x: px / 8 - b.col0 + half, z: py / 8 - b.row0 + half };
}

/** Центр игровой зоны. */
export function fieldCenter(b: RenderBounds): GroundPoint {
  return { x: b.cols / 2, z: b.rows / 2 };
}

/** Угол поворота модели (forward = +X) для игрового направления 0..3. */
export const DIR_ROT = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];

/** Направление «вперёд» по dir (0=Up,1=Left,2=Down,3=Right) в мировых (x,z). */
export const FACING: { x: number; z: number }[] = [
  { x: 0, z: -1 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 1, z: 0 },
];

/** Yaw камеры, стоящей ЗА танком (третий-лицо доворот) для направления dir. */
export function followYaw(dir: number): number {
  const f = FACING[dir & 3];
  return Math.atan2(-f.x, -f.z);
}

export default { cellCenter, tankCenter, pointFromPixel, spriteCenter, fieldCenter, DIR_ROT, FACING, followYaw };
