// tank-driver.js — JS-слой управления танками (движение, коллизии, ИИ).
// Вся логика поведения танков переносится на JS (единый источник), ASM остаётся
// для рендера/пуль/спавна/счёта. Чистые функции, тестируемые без эмулятора.
//
// Направления (совпадает с ROM tbl_E46C/E470): 0=Up, 1=Left, 2=Down, 3=Right.
// Поле коллизий: 32x32 ячейки по 8px (256x256), буфер $0400-$07FF. Танк 13x13px.
// RAM-позиция танка (x,y) — ЦЕНТР танка (спрайт рендерится в OAM x-8, y-1).
// Проходимость зеркалит ASM (bank_FF $DCD5-$DCDD): см. runtimePassable ниже.
// Относительный путь: ./emulator-core/io/tank-driver.js

export const TILE = 8; // размер ячейки поля в px (коллизии ÷8)
export const FIELD = 32; // поле коллизий 32x32 ячейки (буфер $0400-$07FF)
export const TANK = 13; // размер спрайта танка в px
// Полуразмер корпуса танка (13x13). RAM (x,y) — центр танка; спрайт рендерится
// в OAM x-8, y-1. Коллизия проверяет ПЕРЕДНЮЮ кромку в направлении движения
// (как в ASM bank_FF sub_DBF1): так танк не проваливается в стены впереди, но
// может скользить вдоль стен и проходить коридоры.
export const HALF = 6;

// Приращения (dx, dy) по направлению. Кодировка совпадает с флагом танка в ROM
// (см. sub_E451/DBE9): 0=Up, 1=Left, 2=Down, 3=Right.
import { DX, DY, tankPassable as runtimePassable } from "../domain.ts";
export { DX, DY, runtimePassable };

type IsPassable = (tileId: number) => boolean;

// Проходимость runtime-тайла (буфер коллизий $0400). Зеркалит проверку ASM в
// bank_FF sub_DBF1_tank_movement ($DCD5-$DCDD):
//   BMI (бит7)        -> блокирует
//   A == 0            -> проходимо
//   CMP #$20, BCC     -> A в 0x01..0x1F блокирует; A >= 0x20 проходимо
// Итог: проходимы 0x00 и 0x20..0x7F; блокируют 0x01..0x1F и 0x80..0xFF.
// Важно: 0x0f/0x15 (вода) НЕ проходимы для танков, а дорожные тайлы 0x20..0x7F проходимы.


// Проходимость тайла по умолчанию: только 0 (пусто) проходим.
export function defaultIsPassable(tileId: number): boolean {
  return tileId === 0x00;
}

// Проходимость по стандартной семантике Battle City (тайл-ниббл поля стадии .bin):
//   проходимы: 0 (пусто) и d (вода/пустота)
//   блокируют: 1 (кирпич), 3 (сталь), 4/8/9 (структуры/база)
export const STAGE_SOLID = new Set([1, 3, 4, 8, 9]);
export function stagePassable(tileId: number): boolean {
  return !STAGE_SOLID.has(tileId);
}


// Можно ли разместить корпус танка (2*HALF+1 = 13x13) по центру (x,y).
// Используется для canTurn/aiDirection.
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

// Проверка передней кромки танка в направлении dir для шага в позицию (x,y)
// (x,y — целевой ЦЕНТР танка). В точности повторяет ASM bank_FF sub_DC97
// (коллизия 2 точек кромки), чтобы JS-оверрайд движения НЕ конфликтовал с ASM:
// если JS поставит танк туда, где ASM считает блок, ASM начнёт «бороться» и
// движение замедлится. Совпадение с ASM устраняет и «торможение» у кирпичей
// (проверяются только 2 точки кромки, а не весь корпус), и «проникновение»
// в стены (проверяются оба угла передней кромки).
// Схема ASM (X=вправо: dx=1,dy=0, ox=8,oy=0):
//   центр_цели cx=x+dx, cy=y+dy (ram_0056/57), ox=dx*8, oy=dy*8 (ram_0058/59)
//   точка A: (cx+ox+oy, cy+ox+oy), точка B: (cx+ox-oy, cy+oy-ox)
//   каждая координата клампится sub_DD6E/DD76: если v >= центр -> v-1
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

  // Чтение ячейки коллизий по координате; за границей поля — блок (ASM читает
  // сплошную кайму буфера $0400, так что танк не выходит за пределы поля).
  function cellPassable(f: any, px: number, py: number, isPass: IsPassable): boolean {
    const tc = tile(px);
    const tr = tile(py);
    if (tc < 0 || tc >= FIELD || tr < 0 || tr >= FIELD) return false;
    return isPass(f[tr * FIELD + tc]);
  }
}

// Шаг танка на 1px в направлении dir, если передняя кромка в новом положении
// не пересекает препятствие (проверка передней кромки, как в ASM).
// Возвращает новый {x,y} либо null, если движение невозможно (стена/край поля).
export function stepTank(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable) {
  const nx = pos.x + DX[dir];
  const ny = pos.y + DY[dir];
  if (!canLead(pos.x, pos.y, dir, field, isPassable)) return null;
  return { x: nx, y: ny };
}

// Может ли танк повернуть в направлении dir (для поворота нужно место, т.к.
// корпус поворачивается). Для простоты: проверяем, что новый корпус встаёт.
export function canTurn(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable): boolean {
  return canPlace(pos.x, pos.y, field, isPassable);
}

// ---- простой ИИ защитника ----
// Идёт к цели (x,y) с приоритетом по вертикали/горизонтали.
export function aiDirection(pos: any, target: any, field: any, isPassable: IsPassable = defaultIsPassable): number | null {
  // сначала выравниваемся по строке/колонке, затем идём к цели
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const candidates =
    Math.abs(dy) > Math.abs(dx)
      ? [dy > 0 ? 2 : 0, dx > 0 ? 3 : 1] // вниз/вверх, затем вправо/влево
      : [dx > 0 ? 3 : 1, dy > 0 ? 2 : 0];
  for (const dir of candidates) {
    if (stepTank(pos, dir, field, isPassable) !== null) return dir;
  }
  return null; // заблокирован со всех сторон
}

// ---- обновление позиции танка за один кадр ----
// Если задан ввод игрока (direction 0..3) — двигаем по нему; иначе ИИ.
// Возвращает новую позицию (либо текущую, если движение невозможно).
export function tickTank(pos: any, dir: number, field: any, isPassable: IsPassable = defaultIsPassable) {
  const next = stepTank(pos, dir, field, isPassable);
  return next ?? pos;
}
