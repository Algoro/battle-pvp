// fine-grid.js — мелкая сетка проходимости для точной навигации танка (стратегический слой).
//
// Реализация патча «движение по настоящей мелкой сетке» (battle_city_defender_ai_patch_...),
// с исправлением ключевой ошибки автора: он задаёт хитбокс танка как 2×2 fine-узла (=8×8 px).
// На самом деле хитбокс танка в игре 16×16 px (sub_DC97/canLead: передняя кромка ±8 от центра),
// т.е. = 2×2 коарс-тайла = **4×4 fine-клетки** (fine-клетка 4×4 px). Поэтому сценарий «squeeze через
// 8px-стык» невозможен для реального танка, но точная fine-сетка полезна: учёт частично разрушенных
// кирпичей (квадранты 0x01..0x0f) и корректная 16×16 «конфигурация» при маршрутизации.
//
// Сетка: каждый тайл 8×8 -> 2×2 суб-клетки 4×4. Кирпич кодирует занятые квадранты
// (bit0=TL, bit1=TR, bit2=BL, bit3=BR — как sub_E604/_bulletSub). Сталь/вода — блок.

import { FIELD, TILE, DX, DY, inBounds, tankPassable, isBrick, isTree, isIce } from "./game-view.js";

export const FINE = 2;            // делений тайла на сторону (8px -> 4px)
export const FINE_SIZE = FIELD * FINE; // 64
export const TANK_FINE = 4;       // хитбокс танка 16×16 px = 4×4 fine-клетки (ИСПРАВЛЕНИЕ патча: не 2×2)

// Строит fine-сетку проходимости (1=проходимо, 0=блок). Возвращает Uint8Array FINE_SIZE².
export function buildFineGrid(field, fieldSize = FIELD) {
  const n = fieldSize * FINE;
  const g = new Uint8Array(n * n);
  for (let r = 0; r < fieldSize; r++) {
    for (let c = 0; c < fieldSize; c++) {
      const v = field[r * fieldSize + c];
      let mask; // занятые квадранты (bit0=TL,1=TR,2=BL,3=BR)
      if (tankPassable(v) || isTree(v) || isIce(v)) mask = 0;        // пусто/дорога/дерево/лёд — открыто
      else if (isBrick(v)) mask = v & 0x0f;                          // кирпич: занято = наличие квадранта
      else mask = 0x0f;                                              // сталь/вода/прочее — полностью блок
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

// Может ли танк (хитбокс TANK_FINE×TANK_FINE) стоять с верхним-левым углом в (fx,fy).
export function canOccupy(g, fx, fy, n = FINE_SIZE) {
  if (fx < 0 || fy < 0 || fx + TANK_FINE > n || fy + TANK_FINE > n) return false;
  for (let y = fy; y < fy + TANK_FINE; y++) {
    const row = y * n;
    for (let x = fx; x < fx + TANK_FINE; x++) if (!g[row + x]) return false;
  }
  return true;
}

// fine-позиция (верхний-левый угол хитбокса) из пиксельного центра танка.
export function tankFinePos(x, y) {
  // хитбокс [x-8, x+8] (центр); верхний-левый угол = x-8. fine-клетка = /4.
  return { x: Math.floor((x - 8) / 4), y: Math.floor((y - 8) / 4) };
}

// fine-позиция (верхний-левый угол хитбокса), чтобы танк стоял в центре тайла {col,row}.
export function cellFinePos(col, row) {
  const px = col * 8 + 4, py = row * 8 + 4;
  return { x: Math.floor((px - 8) / 4), y: Math.floor((py - 8) / 4) };
}

// Множество fine-клеток, соответствующих coarse-клеткам (Set<idx=r*32+c>) для избегания.
export function coarseToFineAvoid(coarseIdxSet) {
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

// Стоимость шага (входа в fine-позицию) по доминирующей поверхности под хитбоксом.
function surfaceCost(field, fx, fy, n) {
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

// Минимальная бинарная куча (A*).
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(node) {
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

// Сдвиг старта к ближайшей валидной fine-позиции, если текущая не влезает (танк на границе).
// Промежуточные позиции BFS ограничены только границами fine-сетки (не хитбокса) — иначе из
// угла, где хитбокс не влезает ни у одной соседней позиции, релаксация бы застряла.
function relaxStart(g, start, n) {
  const seen = new Set();
  const q = [{ x: start.x, y: start.y }];
  const key = (x, y) => y * n + x;
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

// A* по fine-позициям (верхний-левый угол хитбокса). Возвращает путь (без старта, с целью)
// или null. opts: { avoid: Set<fineIdx>, maxCost }.
export function fineAStar(g, start, goal, opts = {}, n = FINE_SIZE, field = null) {
  if (start.x === goal.x && start.y === goal.y) return null;
  if (!canOccupy(g, goal.x, goal.y, n)) return null;
  const origin = canOccupy(g, start.x, start.y, n) ? start : relaxStart(g, start, n);
  if (!origin) return null;
  const gScore = new Float64Array(n * n).fill(Infinity);
  const came = new Int32Array(n * n).fill(-1);
  const sIdx = origin.y * n + origin.x;
  const gIdx = goal.y * n + goal.x;
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);
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

// Направление первого шага (0..3) к цели, либо null.
export function finePathDirection(g, start, goal, opts = {}, n = FINE_SIZE, field = null) {
  const path = fineAStar(g, start, goal, opts, n, field);
  if (!path || !path.length) return null;
  const first = path[0];
  const dx = first.x - start.x, dy = first.y - start.y;
  for (let d = 0; d < 4; d++) if (DX[d] === dx && DY[d] === dy) return d;
  return null;
}

// Длина пути (в fine-шагах) по ортогональному A*. Infinity — недостижимо.
// Используется для feasibility-модели (патч «gravity well»): оценка времени рейда
// защитника и прихода угрозы к базе через реальную длину маршрута, а не эвристику.
export function finePathLen(g, start, goal, opts = {}, n = FINE_SIZE, field = null) {
  const path = fineAStar(g, start, goal, opts, n, field);
  if (!path) return Infinity;
  return path.length;
}
