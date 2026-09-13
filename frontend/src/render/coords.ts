// coords.ts — conversion of Battle City coordinates (RAM pixels, field cells) into world units.
// 1 unit = 1 field cell (8 px). The game area is bounds (26×26), origin at (col0,row0).
//
// Relative path: ./frontend/src/render/coords.ts
import type { RenderBounds } from "./types.ts";

export interface GroundPoint {
  x: number;
  z: number;
}

/** Center of a field cell (col,row — absolute buffer indices). */
export function cellCenter(b: RenderBounds, col: number, row: number): GroundPoint {
  return { x: col - b.col0 + 0.5, z: row - b.row0 + 0.5 };
}

/**
 * Tank center. RAM (x,y) is already the CENTER of the tank in pixels (see `emulator-core/io/tank-driver.ts`:
 * "RAM tank position (x,y) is the CENTER of the tank"), so we convert continuously: 8 px = 1 unit.
 * No `>>3`/rounding (otherwise 8 px jolts) and no extra offset.
 */
export function tankCenter(b: RenderBounds, px: number, py: number): GroundPoint {
  return { x: px / 8 - b.col0, z: py / 8 - b.row0 };
}

/** Object point by RAM pixel coordinates (top-left of the sprite, as stored by the ROM). */
export function pointFromPixel(b: RenderBounds, px: number, py: number): GroundPoint {
  return { x: px / 8 - b.col0, z: py / 8 - b.row0 };
}

/**
 * Sprite center, if RAM (x,y) is its top-left (the ROM draws sprites directly from these
 * coordinates: bonus `E26C: LDX ram_bonus_pos_X ; spr_X`, bullet `E100: spr_X/Y`).
 * `sizePx` — sprite size in pixels (bonus 16, bullet 8); offset to center = sizePx/16 units.
 */
export function spriteCenter(b: RenderBounds, px: number, py: number, sizePx: number): GroundPoint {
  const half = sizePx / 16;
  return { x: px / 8 - b.col0 + half, z: py / 8 - b.row0 + half };
}

/** Center of the game area. */
export function fieldCenter(b: RenderBounds): GroundPoint {
  return { x: b.cols / 2, z: b.rows / 2 };
}

/** Model rotation angle (forward = +X) for game direction 0..3. */
export const DIR_ROT = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];

/** "Forward" direction by dir (0=Up,1=Left,2=Down,3=Right) in world (x,z). */
export const FACING: { x: number; z: number }[] = [
  { x: 0, z: -1 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 1, z: 0 },
];

/** Camera yaw standing BEHIND the tank (third-person follow) for direction dir. */
export function followYaw(dir: number): number {
  const f = FACING[dir & 3];
  return Math.atan2(-f.x, -f.z);
}

export default { cellCenter, tankCenter, pointFromPixel, spriteCenter, fieldCenter, DIR_ROT, FACING, followYaw };
