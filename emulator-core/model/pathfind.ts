// pathfind.js — стратегический слой навигации: взвешенный A* с модификаторами
// стоимости по типу тайла (дизайн защитного ИИ, §2.1/§7).
//
// Отличие от разрозненных BFS (`costToGoal`/`bestStep` в scan/lookahead): единый
// A* с весами из game-view (tileCost: empty/road=1, brick=3, tree=1.2, ice=1.5,
// steel/water=∞), поддержкой «прострела» кирпичей (allowBreak) и зон избегания
// (avoid — например, клетки под вражескими пулями).
//
// Все функции чистые: принимают поле (Uint8Array 1024) и клетки {col,row}.

import { FIELD, DX, DY, inBounds, cellIdx, tankPassable, isBrick, tileCost, brickHealth } from "./game-view.ts";

// Узлы 32x32; вместимость контейнера — до конца поля (независимо от эвристики).
const CAP = FIELD * FIELD;

// «Недостижимо» для BFS-поля стоимости (общий маркер для ИИ).
export const UNREACHABLE = 0x7fff;

// BFS: направление первого шага к проходимой цели (без прострела кирпичей).
// Общий примитив (перенесён из tactical-ai; точная копия семантики BFS с порядком d=0..3).
export function bfsDirection(field: any, from: any, to: any) {
  if (from.col === to.col && from.row === to.row) return null;
  if (!inBounds(to.col, to.row) || !tankPassable(field[cellIdx(to.col, to.row)])) return null;
  const visited = new Int8Array(FIELD * FIELD);
  const prev = new Int16Array(FIELD * FIELD).fill(-1);
  const q = [{ c: from.col, r: from.row }];
  visited[cellIdx(from.col, from.row)] = 1;
  let head = 0, found = false;
  while (head < q.length) {
    const cur = q[head++];
    if (cur.c === to.col && cur.r === to.row) { found = true; break; }
    for (let d = 0; d < 4; d++) {
      const nc = cur.c + DX[d], nr = cur.r + DY[d];
      if (!inBounds(nc, nr) || !tankPassable(field[cellIdx(nc, nr)])) continue;
      const idx = cellIdx(nc, nr);
      if (visited[idx]) continue;
      visited[idx] = 1; prev[idx] = d; q.push({ c: nc, r: nr });
    }
  }
  if (!found) return null;
  let c = to.col, r = to.row, d = -1;
  while (!(c === from.col && r === from.row)) {
    d = prev[cellIdx(c, r)];
    if (d < 0) return null;
    c -= DX[d]; r -= DY[d];
  }
  return d;
}

// BFS-поле стоимости достижения цели (для локального выбора шага). Движение = 1,
// «прострел» кирпича = brickCost(v) (по умолчанию max(1, прочность кирпича)).
// Перенесено из scan-ai (идентичная семантика).
export function costField(field: any, goal: any, brickCost: any = (v: number) => Math.max(1, brickHealth(v))) {
  const cost = new Int32Array(FIELD * FIELD).fill(UNREACHABLE);
  if (!inBounds(goal.col, goal.row)) return cost;
  const g = cellIdx(goal.col, goal.row);
  cost[g] = 0;
  const q = [{ c: goal.col, r: goal.row }];
  let head = 0;
  while (head < q.length) {
    const cur = q[head++];
    const cd = cost[cellIdx(cur.c, cur.r)];
    for (let d = 0; d < 4; d++) {
      const nc = cur.c + DX[d], nr = cur.r + DY[d];
      if (!inBounds(nc, nr)) continue;
      const v = field[cellIdx(nc, nr)];
      if (!(tankPassable(v) || isBrick(v))) continue;
      const idx = cellIdx(nc, nr);
      if (cost[idx] !== UNREACHABLE) continue;
      cost[idx] = cd + (isBrick(v) ? brickCost(v) : 1);
      q.push({ c: nc, r: nr });
    }
  }
  return cost;
}

// Минимальная бинарная куча (приоритет = f = g + h).
class MinHeap {
  a: any[];
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node: any) {
    const a = this.a;
    a.push(node);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

// Стоимость входа в клетку для навигации танка. По умолчанию проходимые тайлы
// (empty/road/tree/ice) стоят tileCost; при allowBreak кирпич проходим за tileCost
// (простреливается). Сталь/вода и вне поля — Infinity.
function defaultCost(field: any, c: number, r: number, allowBreak: boolean) {
  if (!inBounds(c, r)) return Infinity;
  const v = field[cellIdx(c, r)];
  if (tankPassable(v)) return tileCost(v);
  if (allowBreak && isBrick(v)) return tileCost(v);
  return Infinity;
}

function heuristic(a: any, b: any) {
  // допустимая эвристика: мах-компонента <= евклидово <= Manhattan; берём Manhattan
  // (A* с допустимой эвристикой — кратчайший путь по весам >=1).
  return Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
}

// Найти путь от `from` к `to` взвешенным A*. Возвращает массив клеток {col,row}
// (без старта, включая цель) или null, если цель недостижима/непроходима.
// opts: { cost, allowBreak, avoid (Set idx), maxCost, startFromNeighbor }
//   - cost: пользовательская функция (field,c,r)=>число (по умолчанию defaultCost).
//   - avoid: клетки, которые запрещено посещать (idx = r*32+c).
//   - maxCost: обрезка — не исследовать клетки дороже maxCost.
export function aStar(field: any, from: any, to: any, opts: any = {}) {
  if (!from || !to || from.col === to.col && from.row === to.row) return null;
  if (!inBounds(from.col, from.row) || !inBounds(to.col, to.row)) return null;
  const costFn = opts.cost || ((f: any, c: number, r: number) => defaultCost(f, c, r, opts.allowBreak));
  if (!isFinite(costFn(field, to.col, to.row))) return null; // цель непроходима

  const g = new Float64Array(CAP).fill(Infinity);
  const came = new Int32Array(CAP).fill(-1); // направление d, по которому пришли
  const start = cellIdx(from.col, from.row);
  const goal = cellIdx(to.col, to.row);
  const h = heuristic(from, to);
  g[start] = 0;
  const open = new MinHeap();
  open.push({ idx: start, f: h });

  while (open.size) {
    const cur = open.pop();
    const c = cur.idx % FIELD, r = (cur.idx / FIELD) | 0;
    if (cur.idx === goal) {
      // восстановить путь
      const path = [];
      let i = goal;
      while (i !== start) {
        const d = came[i];
        if (d < 0) break;
        path.push({ col: i % FIELD, row: (i / FIELD) | 0 });
        i = (i % FIELD) - DX[d] + ((i / FIELD) | 0) * FIELD - DY[d] * FIELD;
      }
      path.reverse();
      return path;
    }
    if (cur.f !== g[cur.idx] + heuristic({ col: c, row: r }, to)) continue; // устаревшая запись
    for (let d = 0; d < 4; d++) {
      const nc = c + DX[d], nr = r + DY[d];
      const nidx = cellIdx(nc, nr);
      if (opts.avoid && opts.avoid.has(nidx)) continue;
      const step = costFn(field, nc, nr);
      if (!isFinite(step)) continue;
      const ng = g[cur.idx] + step;
      if (opts.maxCost !== undefined && ng > opts.maxCost) continue;
      if (ng < g[nidx]) {
        g[nidx] = ng;
        came[nidx] = d;
        open.push({ idx: nidx, f: ng + heuristic({ col: nc, row: nr }, to) });
      }
    }
  }
  return null;
}

// Направление первого шага к цели по A*, либо null.
export function pathDirection(field: any, from: any, to: any, opts: any = {}) {
  const path = aStar(field, from, to, opts);
  if (!path || !path.length) return null;
  const first = path[0];
  const dc = first.col - from.col, dr = first.row - from.row;
  for (let d = 0; d < 4; d++) if (DX[d] === dc && DY[d] === dr) return d;
  return null;
}

// Достижима ли цель (без учёта avoid/стоимости — только топология).
export function isReachable(field: any, from: any, to: any, opts: any = {}) {
  return aStar(field, from, to, { ...opts, maxCost: undefined }) !== null;
}

// Суммарная стоимость кратчайшего пути (или Infinity, если недостижимо).
export function pathCost(field: any, from: any, to: any, opts: any = {}) {
  const g = new Float64Array(CAP).fill(Infinity);
  const start = cellIdx(from.col, from.row);
  const goal = cellIdx(to.col, to.row);
  const costFn = opts.cost || ((f: any, c: number, r: number) => defaultCost(f, c, r, opts.allowBreak));
  if (!isFinite(costFn(field, to.col, to.row))) return Infinity;
  g[start] = 0;
  const open = new MinHeap();
  open.push({ idx: start, f: heuristic(from, to) });
  while (open.size) {
    const cur = open.pop();
    const c = cur.idx % FIELD, r = (cur.idx / FIELD) | 0;
    if (cur.idx === goal) return g[goal];
    if (cur.f !== g[cur.idx] + heuristic({ col: c, row: r }, to)) continue;
    for (let d = 0; d < 4; d++) {
      const nidx = cellIdx(c + DX[d], r + DY[d]);
      if (opts.avoid && opts.avoid.has(nidx)) continue;
      const step = costFn(field, c + DX[d], r + DY[d]);
      if (!isFinite(step)) continue;
      const ng = g[cur.idx] + step;
      if (ng < g[nidx]) { g[nidx] = ng; open.push({ idx: nidx, f: ng + heuristic({ col: c + DX[d], row: r + DY[d] }, to) }); }
    }
  }
  return Infinity;
}
