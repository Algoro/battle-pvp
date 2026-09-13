// sim-model.js — JS model of tank movement/collision, semantically pure and
// repeating ASM (bank_FF sub_DBF1/sub_DC97). Used for accurate
// movement prediction in AI and for frame-by-frame verification against the emulator.
//
// Directions: 0=Up,1=Left,2=Down,3=Right (as in ASM).
// Tank 13x13, RAM (x,y) — center. Collision — the front edge of 2 points
// (canLead) + a check of the cell the edge will enter.
import { TILE, DX, DY, cellPassable } from "../model/game-view.ts";

export const HALF = 6; // half-size of the body (13x13)

// Is the tank's center position passable (for reference; ASM does not check the whole body,
// only the front edge).
export function bodyClear(x: number, y: number, field: any): boolean {
  return cellPassable(field, Math.floor(x / TILE), Math.floor(y / TILE));
}

// Collision of the front edge in direction dir for a step from center (x,y).
// An exact copy of ASM sub_DC97 (2 edge points + clamping).
export function canLead(x: number, y: number, dir: number, field: any): boolean {
  const dx = DX[dir], dy = DY[dir];
  const cx = x + dx, cy = y + dy;
  const ox = dx * 8, oy = dy * 8;
  const clamp = (v: number, c: number) => (v >= c ? v - 1 : v);
  const ax = clamp(cx + ox + oy, cx), ay = clamp(cy + ox + oy, cy);
  if (!cellPassable(field, Math.floor(ax / TILE), Math.floor(ay / TILE))) return false;
  const bx = clamp(cx + ox - oy, cx), by = clamp(cy + oy - ox, cy);
  if (!cellPassable(field, Math.floor(bx / TILE), Math.floor(by / TILE))) return false;
  return true;
}

// One tank step of 1px in dir if the edge is free. null — blocked.
export function step(pos: { x: number; y: number }, dir: number, field: any): { x: number; y: number } | null {
  if (!canLead(pos.x, pos.y, dir, field)) return null;
  return { x: pos.x + DX[dir], y: pos.y + DY[dir] };
}

// Iterate stepTank from the position to blocking/limit: returns the path [{x,y}]
// and the final position the tank will reach moving in dir.
export function traceMovement(pos: { x: number; y: number }, dir: number, field: any, maxSteps: number = 512) {
  const path = [{ ...pos }];
  let p = { ...pos };
  for (let i = 0; i < maxSteps; i++) {
    const n = step(p, dir, field);
    if (!n) break;
    p = n;
    path.push({ ...p });
  }
  return { path, final: p, steps: path.length - 1 };
}
