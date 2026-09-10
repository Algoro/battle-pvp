// sim-model.js — JS-модель движения/коллизий танка, семантически чистая и
// повторяющая ASM (bank_FF sub_DBF1/sub_DC97). Используется для точного
// предсказания движения в ИИ и для покадровой сверки с эмулятором.
//
// Направления: 0=Up,1=Left,2=Down,3=Right (как в ASM).
// Танк 13x13, RAM (x,y) — центр. Коллизия — передняя кромка из 2 точек
// (canLead) + проверка клетки, куда войдёт кромка.
import { TILE, DX, DY, cellPassable } from "../model/game-view.js";

export const HALF = 6; // полуразмер корпуса (13x13)

// Проходима ли позиция-центр танка (для справки; ASM не проверяет весь корпус,
// только переднюю кромку).
export function bodyClear(x, y, field) {
  return cellPassable(field, Math.floor(x / TILE), Math.floor(y / TILE));
}

// Коллизия передней кромки в направлении dir для шага из центра (x,y).
// Точная копия ASM sub_DC97 (2 точки кромки + клампинг).
export function canLead(x, y, dir, field) {
  const dx = DX[dir], dy = DY[dir];
  const cx = x + dx, cy = y + dy;
  const ox = dx * 8, oy = dy * 8;
  const clamp = (v, c) => (v >= c ? v - 1 : v);
  const ax = clamp(cx + ox + oy, cx), ay = clamp(cy + ox + oy, cy);
  if (!cellPassable(field, Math.floor(ax / TILE), Math.floor(ay / TILE))) return false;
  const bx = clamp(cx + ox - oy, cx), by = clamp(cy + oy - ox, cy);
  if (!cellPassable(field, Math.floor(bx / TILE), Math.floor(by / TILE))) return false;
  return true;
}

// Один шаг танка на 1px в dir, если кромка свободна. null — блокировано.
export function step(pos, dir, field) {
  if (!canLead(pos.x, pos.y, dir, field)) return null;
  return { x: pos.x + DX[dir], y: pos.y + DY[dir] };
}

// Итерация stepTank от позиции до блокировки/предела: возвращает путь [{x,y}]
// и итоговую позицию, до которой дойдёт танк, двигаясь в dir.
export function traceMovement(pos, dir, field, maxSteps = 512) {
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
