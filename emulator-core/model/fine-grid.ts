// fine-grid.js — fine passability grid for precise tank navigation (strategic layer).
//
// Implementation of the "movement on the real fine grid" patch (battle_city_defender_ai_patch_...),
// with a fix for the author's key mistake: he defines the tank hitbox as 2×2 fine nodes (=8×8 px).
// In fact the tank hitbox in the game is 16×16 px (sub_DC97/canLead: front edge ±8 from the center),
// i.e. = 2×2 coarse tiles = **4×4 fine cells** (fine cell 4×4 px). So the "squeeze through
// an 8px seam" scenario is impossible for a real tank, but the exact fine grid is useful: accounting for partially destroyed
// bricks (quadrants 0x01..0x0f) and a correct 16×16 "configuration" during routing.
//
// Grid: each 8×8 tile -> 2×2 sub-cells of 4×4. A brick encodes occupied quadrants
// (bit0=TL, bit1=TR, bit2=BL, bit3=BR — like sub_E604/_bulletSub). Steel/water — block.

import { FIELD, TILE, DX, DY, inBounds, tankPassable, isBrick, isTree, isIce } from "./game-view.ts";

export const FINE = 2;            // divisions of a tile per side (8px -> 4px)
export const FINE_SIZE = FIELD * FINE; // 64
export const TANK_FINE = 4;       // tank hitbox 16×16 px = 4×4 fine cells (PATCH FIX: not 2×2)

// Build the fine passability grid (1=passable, 0=block). Returns Uint8Array FINE_SIZE².
export function buildFineGrid(field: any, fieldSize: number = FIELD) {
  const n = fieldSize * FINE;
  const g = new Uint8Array(n * n);
  for (let r = 0; r < fieldSize; r++) {
    for (let c = 0; c < fieldSize; c++) {
      const v = field[r * fieldSize + c];
      let mask; // occupied quadrants (bit0=TL,1=TR,2=BL,3=BR)
      if (tankPassable(v) || isTree(v) || isIce(v)) mask = 0;        // empty/road/tree/ice — open
      else if (isBrick(v)) mask = v & 0x0f;                          // brick: occupied = quadrant present
      else mask = 0x0f;                                              // steel/water/other — fully blocked
      for (let fr = 0; fr < FINE; fr++) {
        for (let fc = 0; fc < FINE; fc++) {
          const bit = 2 * fr + fc; // TL=0,TR=1,BL=2,BR=3
          g[(r * FINE + fr) * n + (c * FINE + fc)] = (mask & (1 << bit)) === 0 ? 1 : 0;
        }
      }
    }
  }
  return g;
}

// Can a tank (hitbox TANK_FINE×TANK_FINE) stand with its top-left corner at (fx,fy).
export function canOccupy(g: any, fx: number, fy: number, n: number = FINE_SIZE) {
  if (fx < 0 || fy < 0 || fx + TANK_FINE > n || fy + TANK_FINE > n) return false;
  for (let y = fy; y < fy + TANK_FINE; y++) {
    const row = y * n;
    for (let x = fx; x < fx + TANK_FINE; x++) if (!g[row + x]) return false;
  }
  return true;
}

// fine position (top-left corner of the hitbox) from the tank's pixel center.
export function tankFinePos(x: number, y: number) {
  // hitbox [x-8, x+8] (center); top-left corner = x-8. fine cell = /4.
  return { x: Math.floor((x - 8) / 4), y: Math.floor((y - 8) / 4) };
}

// fine position (top-left corner of the hitbox) so the tank stands at the center of tile {col,row}.
export function cellFinePos(col: number, row: number) {
  const px = col * 8 + 4, py = row * 8 + 4;
  return { x: Math.floor((px - 8) / 4), y: Math.floor((py - 8) / 4) };
}

// Set of fine cells corresponding to coarse cells (Set<idx=r*32+c>) for avoidance.
export function coarseToFineAvoid(coarseIdxSet: any) {
  const out = new Set();
  if (!coarseIdxSet) return out;
  for (const idx of coarseIdxSet) {
    const c = idx % FIELD, r = (idx / FIELD) | 0;
    for (let fy = 0; fy < FINE; fy++) for (let fx = 0; fx < FINE; fx++) {
      out.add((r * FINE + fy) * FINE_SIZE + (c * FINE + fx));
    }
  }
  return out;
}

// Step cost (entering a fine position) by the dominant surface under the hitbox.
function surfaceCost(field: any, fx: number, fy: number, n: number) {
  let ice = false, tree = false;
  for (let y = fy; y < fy + TANK_FINE; y++) {
    for (let x = fx; x < fx + TANK_FINE; x++) {
      const c = Math.floor((x * 4 + 2) / TILE), r = Math.floor((y * 4 + 2) / TILE);
      if (!inBounds(c, r)) continue;
      const v = field[r * FIELD + c];
      if (isIce(v)) ice = true;
      else if (isTree(v)) tree = true;
    }
  }
  return ice ? 1.5 : tree ? 1.2 : 1;
}

// Min binary heap (A*).
class MinHeap {
  a: any[];
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node: any) {
    const a = this.a; a.push(node);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

// Shift the start to the nearest valid fine position if the current one doesn't fit (tank on a boundary).
// Intermediate BFS positions are limited only by the fine-grid bounds (not the hitbox) — otherwise from
// a corner where the hitbox doesn't fit at any neighboring position, relaxation would get stuck.
function relaxStart(g: any, start: any, n: number) {
  const seen = new Set();
  const q = [{ x: start.x, y: start.y }];
  const key = (x: number, y: number) => y * n + x;
  seen.add(key(start.x, start.y));
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if (canOccupy(g, cur.x, cur.y, n)) return cur;
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const k = key(nx, ny);
      if (seen.has(k)) continue;
      seen.add(k); q.push({ x: nx, y: ny });
    }
  }
  return null;
}

// A* over fine positions (top-left corner of the hitbox). Returns the path (without the start, with the goal)
// or null. opts: { avoid: Set<fineIdx>, maxCost }.
export function fineAStar(g: any, start: any, goal: any, opts: any = {}, n: number = FINE_SIZE, field: any = null) {
  if (start.x === goal.x && start.y === goal.y) return null;
  if (!canOccupy(g, goal.x, goal.y, n)) return null;
  const origin = canOccupy(g, start.x, start.y, n) ? start : relaxStart(g, start, n);
  if (!origin) return null;
  const gScore = new Float64Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const sIdx = origin.y * n + origin.x;
  const gIdx = goal.y * n + goal.x;
  const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
  gScore[sIdx] = 0;
  const open = new MinHeap();
  open.push({ idx: sIdx, x: origin.x, y: origin.y, f: h(origin.x, origin.y) });

  while (open.size) {
    const cur = open.pop();
    if (cur.idx === gIdx) {
      const path = [];
      let i = gIdx;
      while (i !== sIdx) {
        const d = came[i];
        if (d < 0) break;
        path.push({ x: i % n, y: (i / n) | 0 });
        i = (i % n) - DX[d] + ((i / n) | 0) * n - DY[d] * n;
      }
      path.reverse();
      return path;
    }
    for (let d = 0; d < 4; d++) {
      const nx = cur.x + DX[d], ny = cur.y + DY[d];
      if (nx < 0 || ny < 0 || nx + TANK_FINE > n || ny + TANK_FINE > n) continue;
      if (!canOccupy(g, nx, ny, n)) continue;
      const nIdx = ny * n + nx;
      if (opts.avoid && opts.avoid.has(nIdx)) continue;
      const step = field ? surfaceCost(field, nx, ny, n) : 1;
      const ng = gScore[cur.idx] + step;
      if (opts.maxCost !== undefined && ng > opts.maxCost) continue;
      if (ng < gScore[nIdx]) {
        gScore[nIdx] = ng; came[nIdx] = d;
        open.push({ idx: nIdx, x: nx, y: ny, f: ng + h(nx, ny) });
      }
    }
  }
  return null;
}

// Direction of the first step (0..3) toward the goal, or null.
export function finePathDirection(g: any, start: any, goal: any, opts: any = {}, n: number = FINE_SIZE, field: any = null) {
  const path = fineAStar(g, start, goal, opts, n, field);
  if (!path || !path.length) return null;
  const first = path[0];
  const dx = first.x - start.x, dy = first.y - start.y;
  for (let d = 0; d < 4; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return null;
}

// Path length (in fine steps) via orthogonal A*. Infinity — unreachable.
// Used for the feasibility model ("gravity well" patch): estimating the defender's raid time
// and the threat's arrival at the base via the real route length rather than a heuristic.
export function finePathLen(g: any, start: any, goal: any, opts: any = {}, n: number = FINE_SIZE, field: any = null) {
  const path = fineAStar(g, start, goal, opts, n, field);
  if (!path) return Infinity;
  return path.length;
}
