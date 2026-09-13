// steer.js — shared "steering" layer: navigation + cover for ANY tank (attacker or
// defender), on top of fine-grid (exact 16×16 hitbox) and coarse-A*.
//
// Deduplication: previously BFS/cover/navigation were duplicated in tactical/scan/lookahead and
// defender-strategy. Here — unified functions:
//   - fineSteer()   — fine direction to the goal (bypassing partially destroyed bricks, 16×16);
//   - steerTo()     — combined: fine, then coarse with brick punch-through (if allowBreak);
//   - nearestCover()/isCover() — nearest cover (a cell next to an obstacle).

import { buildFineGrid, tankFinePos, cellFinePos, coarseToFineAvoid, finePathDirection, FINE_SIZE } from "./fine-grid.ts";
import { pathDirection } from "./pathfind.ts";
import { inBounds, cellIdx, tankPassable, isBrick, DX, DY } from "./game-view.ts";

// Fine direction (0..3) to the goal for an arbitrary tank centered at (tankX,tankY).
// opts: { avoid: Set<coarseIdx>, avoidFine: Set<fineIdx>, maxCost }.
export function fineSteer(field: any, tankX: number, tankY: number, goalCell: any, opts: any = {}) {
  const g = buildFineGrid(field);
  const start = tankFinePos(tankX, tankY);
  const goal = cellFinePos(goalCell.col, goalCell.row);
  const avoid = opts.avoidFine ?? coarseToFineAvoid(opts.avoid);
  return finePathDirection(g, start, goal, { avoid, maxCost: opts.maxCost }, FINE_SIZE, field);
}

// Combined steering: fine route, and if unreachable — coarse with brick punch-through
// (if opts.allowBreak !== false). Returns the direction (0..3) or null.
export function steerTo(field: any, tankX: number, tankY: number, goalCell: any, opts: any = {}) {
  const d = fineSteer(field, tankX, tankY, goalCell, opts);
  if (d !== null) return d;
  if (opts.allowBreak === false) return null;
  const from = { col: Math.floor(tankX / 8), row: Math.floor(tankY / 8) };
  return pathDirection(field, from, goalCell, { allowBreak: true, avoid: opts.avoid });
}

// Passable cell next to an obstacle (cover).
export function isCover(field: any, c: number, r: number) {
  if (!inBounds(c, r) || !tankPassable(field[cellIdx(c, r)])) return false;
  for (let d = 0; d < 4; d++) {
    const nc = c + DX[d], nr = r + DY[d];
    if (inBounds(nc, nr) && !tankPassable(field[cellIdx(nc, nr)])) return true;
  }
  return false;
}

// Nearest cover from cell `from` (passable, bypasses brick; avoid — forbidden cells).
export function nearestCover(field: any, from: any, avoid: any) {
  const q = [{ c: from.col, r: from.row }];
  const visited = new Uint8Array(1024);
  visited[cellIdx(from.col, from.row)] = 1;
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    if ((cur.c !== from.col || cur.r !== from.row) && isCover(field, cur.c, cur.r)) return { col: cur.c, row: cur.r };
    for (let d = 0; d < 4; d++) {
      const nc = cur.c + DX[d], nr = cur.r + DY[d];
      if (!inBounds(nc, nr)) continue;
      const idx = cellIdx(nc, nr);
      if (avoid && avoid.has(idx)) continue;
      if (visited[idx]) continue;
      const v = field[idx];
      if (!(tankPassable(v) || isBrick(v))) continue;
      visited[idx] = 1;
      q.push({ c: nc, r: nr });
    }
  }
  return null;
}
