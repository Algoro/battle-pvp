// steer.js — общий «steering» слой: навигация + укрытие для ЛЮБОГО танка (атакующего или
// защитника), поверх fine-grid (точный хитбокс 16×16) и коарс-A*.
//
// Дедупликация: раньше BFS/cover/навигация дублировались в tactical/scan/lookahead и
// defender-strategy. Здесь — единые функции:
//   - fineSteer()   — fine-направление к цели (обход частично разрушенных кирпичей, 16×16);
//   - steerTo()     — сводно: fine, затем коарс с прострелом кирпичей (если allowBreak);
//   - nearestCover()/isCover() — ближайшее укрытие (клетка рядом с препятствием).

import { buildFineGrid, tankFinePos, cellFinePos, coarseToFineAvoid, finePathDirection, FINE_SIZE } from "./fine-grid.js";
import { pathDirection } from "./pathfind.js";
import { inBounds, cellIdx, tankPassable, isBrick, DX, DY } from "./game-view.js";

// Fine-направление (0..3) к цели для произвольного танка с центром (tankX,tankY).
// opts: { avoid: Set<coarseIdx>, avoidFine: Set<fineIdx>, maxCost }.
export function fineSteer(field, tankX, tankY, goalCell, opts = {}) {
  const g = buildFineGrid(field);
  const start = tankFinePos(tankX, tankY);
  const goal = cellFinePos(goalCell.col, goalCell.row);
  const avoid = opts.avoidFine ?? coarseToFineAvoid(opts.avoid);
  return finePathDirection(g, start, goal, { avoid, maxCost: opts.maxCost }, FINE_SIZE, field);
}

// Сводный steering: fine-маршрут, при недостижимости — коарс с прострелом кирпичей
// (если opts.allowBreak !== false). Возвращает направление (0..3) или null.
export function steerTo(field, tankX, tankY, goalCell, opts = {}) {
  const d = fineSteer(field, tankX, tankY, goalCell, opts);
  if (d !== null) return d;
  if (opts.allowBreak === false) return null;
  const from = { col: Math.floor(tankX / 8), row: Math.floor(tankY / 8) };
  return pathDirection(field, from, goalCell, { allowBreak: true, avoid: opts.avoid });
}

// Проходимая клетка рядом с препятствием (укрытие).
export function isCover(field, c, r) {
  if (!inBounds(c, r) || !tankPassable(field[cellIdx(c, r)])) return false;
  for (let d = 0; d < 4; d++) {
    const nc = c + DX[d], nr = r + DY[d];
    if (inBounds(nc, nr) && !tankPassable(field[cellIdx(nc, nr)])) return true;
  }
  return false;
}

// Ближайшее укрытие от клетки `from` (проходимо, обходит кирпич; avoid — запрещённые клетки).
export function nearestCover(field, from, avoid) {
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
