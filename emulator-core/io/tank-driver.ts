// tank-driver.js — JS layer for controlling tanks (movement, collisions, AI).
// All tank behavior logic is moved to JS (single source); ASM remains
// for rendering/bullets/spawn/scoring. Pure functions, testable without the emulator.
//
// Directions (matches ROM tbl_E46C/E470): 0=Up, 1=Left, 2=Down, 3=Right.
// Collision field: 32x32 cells of 8px (256x256), buffer $0400-$07FF. Tank 13x13px.
// Tank RAM position (x,y) — the CENTER of the tank (the sprite renders at OAM x-8, y-1).
// Passability mirrors ASM (bank_FF $DCD5-$DCDD): see runtimePassable below.
// Relative path: ./emulator-core/io/tank-driver.js

export const TILE = 8; // field cell size in px (collisions ÷8)
export const FIELD = 32; // collision field 32x32 cells (buffer $0400-$07FF)
export const TANK = 13; // tank sprite size in px
// Half-size of the tank body (13x13). RAM (x,y) — the tank center; the sprite renders
// at OAM x-8, y-1. Collision checks the FRONT EDGE in the movement direction
// (like ASM bank_FF sub_DBF1): this way the tank doesn't sink into walls ahead, but
// can slide along walls and pass through corridors.
export const HALF = 6;

// Increments (dx, dy) by direction. The encoding matches the tank flag in ROM
// (see sub_E451/DBE9): 0=Up, 1=Left, 2=Down, 3=Right.
import { DX, DY, tankPassable as runtimePassable } from "../domain.ts";
export { DX, DY, runtimePassable };

type IsPassable = (tileId: number) => boolean;

// Runtime tile passability (collision buffer $0400). Mirrors the ASM check in
// bank_FF sub_DBF1_tank_movement ($DCD5-$DCDD):
//   BMI (bit7)        -> blocks
//   A == 0            -> passable
//   CMP #$20, BCC     -> A in 0x01..0x1F blocks; A >= 0x20 passable
// Result: 0x00 and 0x20..0x7F are passable; 0x01..0x1F and 0x80..0xFF block.
// Important: 0x0f/0x15 (water) are NOT passable for tanks, while road tiles 0x20..0x7F are passable.


// Default tile passability: only 0 (empty) is passable.
export function defaultIsPassable(tileId: number): boolean {
  return tileId === 0x00;
}

// Passability by standard Battle City semantics (stage .bin field tile nibble):
//   passable: 0 (empty) and d (water/void)
//   block: 1 (brick), 3 (steel), 4/8/9 (structures/base)
export const STAGE_SOLID = new Set([1, 3, 4, 8, 9]);
export function stagePassable(tileId: number): boolean {
  return !STAGE_SOLID.has(tileId);
}


// Can a tank body (2*HALF+1 = 13x13) be placed centered at (x,y).
// Used for canTurn/aiDirection.
export function canPlace(x: number, y: number, field: any, isPassable: IsPassable = defaultIsPassable): boolean {
  if (x - HALF < 0 || y - HALF < 0 || x + HALF > FIELD * TILE - 1 || y + HALF > FIELD * TILE - 1) return false;
  const x0 = Math.floor((x - HALF) / TILE), x1 = Math.floor((x + HALF) / TILE);
  const y0 = Math.floor((y - HALF) / TILE), y1 = Math.floor((y + HALF) / TILE);
  for (let r = y0; r <= y1; r++) {
    for (let c = x0; c <= x1; c++) {
      if (!isPassable(field[r * FIELD + c])) return false;
    }
  }
  return true;
}

// Check the tank's front edge in direction dir for a step to position (x,y)
// (x,y — the target CENTER of the tank). Exactly repeats ASM bank_FF sub_DC97
// (2-point edge collision), so the JS movement override does NOT conflict with ASM:
// if JS puts the tank where ASM considers it blocked, ASM starts "fighting" and
// movement slows down. Matching ASM also eliminates both the "braking" at bricks
// (only 2 edge points are checked, not the whole body) and the "penetration"
// into walls (both corners of the front edge are checked).
// ASM scheme (X=right: dx=1,dy=0, ox=8,oy=0):
//   target center cx=x+dx, cy=y+dy (ram_0056/57), ox=dx*8, oy=dy*8 (ram_0058/59)
//   point A: (cx+ox+oy, cy+ox+oy), point B: (cx+ox-oy, cy+oy-ox)
//   each coordinate is clamped by sub_DD6E/DD76: if v >= center -> v-1
export function canLead(x: number, y: number, dir: number, field: any, isPassable: IsPassable = defaultIsPassable): boolean {
  const dx = DX[dir];
  const dy = DY[dir];
  const cx = x + dx;
  const cy = y + dy;
  const ox = dx * 8;
  const oy = dy * 8;
  const clamp = (v: number, c: number) => (v >= c ? v - 1 : v);
  const tile = (v: number) => Math.floor(v / TILE);

  const ax = clamp(cx + ox + oy, cx);
  const ay = clamp(cy + ox + oy, cy);
  if (!cellPassable(field, ax, ay, isPassable)) return false;

  const bx = clamp(cx + ox - oy, cx);
  const by = clamp(cy + oy - ox, cy);
  if (!cellPassable(field, bx, by, isPassable)) return false;

  return true;

  // Read the collision cell by coordinate; outside the field — a block (ASM reads
  // the solid border of the $0400 buffer, so the tank does not leave the field).
  function cellPassable(f: any, px: number, py: number, isPass: IsPassable): boolean {
    const tc = tile(px);
    const tr = tile(py);
    if (tc < 0 || tc >= FIELD || tr < 0 || tr >= FIELD) return false;
    return isPass(f[tr * FIELD + tc]);
  }
}

// Step the tank by 1px in direction dir if the front edge in the new position
// does not intersect an obstacle (front-edge check, like in ASM).
// Returns the new {x,y}, or null if movement is impossible (wall/field edge).
export function stepTank(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable) {
  const nx = pos.x + DX[dir];
  const ny = pos.y + DY[dir];
  if (!canLead(pos.x, pos.y, dir, field, isPassable)) return null;
  return { x: nx, y: ny };
}

// Can the tank turn in direction dir (turning requires space, since the
// body rotates). Simplified: we check that the new body fits.
export function canTurn(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable): boolean {
  return canPlace(pos.x, pos.y, field, isPassable);
}

// ---- simple defender AI ----
// Moves to the target (x,y) with priority by vertical/horizontal.
export function aiDirection(pos: any, target: any, field: any, isPassable: IsPassable = defaultIsPassable): number | null {
  // first align by row/column, then go to the target
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const candidates =
    Math.abs(dy) > Math.abs(dx)
      ? [dy > 0 ? 2 : 0, dx > 0 ? 3 : 1] // down/up, then right/left
      : [dx > 0 ? 3 : 1, dy > 0 ? 2 : 0];
  for (const dir of candidates) {
    if (stepTank(pos, dir, field, isPassable) !== null) return dir;
  }
  return null; // blocked on all sides
}

// ---- tank position update over one frame ----
// If player input is given (direction 0..3) — move by it; otherwise AI.
// Returns the new position (or the current one if movement is impossible).
export function tickTank(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable) {
  const next = stepTank(pos, dir, field, isPassable);
  return next ?? pos;
}
