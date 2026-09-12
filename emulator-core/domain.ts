// domain.js — СЕМАНТИКА домена Battle City (тайлы, флаги танков, пули, направления).
//
// Дополняет rom-contract.js (адреса RAM/ROM): здесь именованные константы и предикаты,
// чтобы в коде не оставалось «магии» вида `0xa0 | dir`, `hi >= 0x90`, `v <= 0x0f`.
// Единый источник для ядра, модели ИИ, симулятора и патчинга.
//
// Относительный путь: ./emulator-core/domain.js
import { BTN } from "./rom-contract.ts";

export { BTN };

// ---------------------------------------------------------------------------
// Направления: 0=Up, 1=Left, 2=Down, 3=Right (совпадает с flag&3 в ROM).
// ---------------------------------------------------------------------------
export const DIR = { UP: 0, LEFT: 1, DOWN: 2, RIGHT: 3 };
export const DIR_VEC = [
  { dx: 0, dy: -1 }, // Up
  { dx: -1, dy: 0 }, // Left
  { dx: 0, dy: 1 }, // Down
  { dx: 1, dy: 0 }, // Right
];
export const DX = DIR_VEC.map((v) => v.dx);
export const DY = DIR_VEC.map((v) => v.dy);
export const DIR_BTN = [BTN.Up, BTN.Left, BTN.Down, BTN.Right];

// Логические танки/порты: 0,1 — DEF ($4016/$4017), 2..7 — ATT (сетевые/ИИ).
export const NUM_PLAYERS = 8;
export const DEF_PORTS = 2;

export function dirToBtn(dir: number): number {
  return DIR_BTN[dir & 3];
}
// Первое нажатое направление из маски (Up, Left, Down, Right) или null.
export function btnToDir(buttons: number): number | null {
  for (let d = 0; d < 4; d++) if (buttons & DIR_BTN[d]) return d;
  return null;
}

// ---------------------------------------------------------------------------
// Флаги танка (ram_tank_flags): 0x00 пусто/мертв; активен 0x90..0xd0;
// «на поле» (включая анимацию) 0x80..0xd0; респавн 0xe0..; взрыв 0x73.
// ---------------------------------------------------------------------------
export const TANK_MOVING = 0xa0; // движется: 0xa0 | dir
export const TANK_STANDING = 0x88; // разворот/стоянка: 0x88 | dir
export const TANK_EXPLODE = 0x73;
export const TANK_RESPAWN = 0xe0;
export const TANK_RESPAWN_FLAG = 0xf0; // выставляется при респавне DEF
export const TANK_EMPTY = 0x00;

export function tankHi(flag: number): number { return flag & 0xf0; }
export function isTankAlive(flag: number): boolean { const hi = tankHi(flag); return hi >= 0x90 && hi <= 0xd0; }
export function isTankActive(flag: number): boolean { const hi = tankHi(flag); return hi >= 0x80 && hi <= 0xd0; }
export function isTankSpawning(flag: number): boolean { return tankHi(flag) >= TANK_RESPAWN; }
export function isTankDead(flag: number): boolean { return flag === TANK_EMPTY; }
export function tankDir(flag: number): number { return flag & 3; }
export function movingFlag(dir: number): number { return TANK_MOVING | (dir & 3); }
export function standingFlag(dir: number): number { return TANK_STANDING | (dir & 3); }

// ---------------------------------------------------------------------------
// Типы танков (ram_tank_type): 0x80 базовый, 0xa0 быстрые пули, 0xc0 быстрый,
// 0xe0 бронированный. Бит 0x04 — мигающий (бонусный) враг.
// ---------------------------------------------------------------------------
export const TANK_TYPE = { BASE: 0x80, FAST_BULLET: 0xa0, FAST_TANK: 0xc0, ARMOR: 0xe0 };

// Сколько попаданий выдерживает танк по типу (см. hitsLeft).
export function tankHits(type: number): number {
  if (type & 0x04) return 1;
  if ((type & 0xf0) === TANK_TYPE.ARMOR) return (type & 0x03) + 1;
  return 1;
}
// Приблизительная скорость танка по типу (для планирования ИИ).
export function tankSpeed(type: number): number {
  if (type < 0x80) return 1.0;
  const base = type & 0xf0;
  if (base === TANK_TYPE.FAST_TANK) return 1.6;
  if (base === TANK_TYPE.ARMOR) return 0.8;
  return 1.0;
}
// Свойство пули (см. bulletProperty): 3 — усиленная, 1 — быстрая, 0 — обычная.
export function bulletProperty(type: number): number {
  const hi = type & 0xf0;
  if (hi === 0x60) return 3;
  if (hi === 0xc0 || hi === 0x20 || hi === 0x40) return 1;
  return 0;
}
export function bulletSpeed(type: number): number { return (bulletProperty(type) & 0x01) ? 4 : 2; }

// ---------------------------------------------------------------------------
// Тайлы поля (буфер коллизий $0400, значения в байтах).
// ---------------------------------------------------------------------------
export const TILE = {
  EMPTY: 0x00,
  STEEL: 0x10,
  STEEL_ALT: 0x11,
  WATER: 0x12,
  ICE: 0x21,
  TREE: 0x22,
  EAGLE_MIN: 0xc8,
  EAGLE_MAX: 0xcb,
};
export const BRICK_MIN = 0x01;
export const BRICK_MAX = 0x0f;
export const BRICK_EXTRA = [0x13, 0x14]; // варианты стадий
// Битовая маска квадрантов кирпича (совпадает с логикой brickHit).
export const BRICK_QUADRANT = { TL: 0x01, TR: 0x02, BL: 0x04, BR: 0x08 };

export function isBrick(v: number): boolean {
  return (v >= BRICK_MIN && v <= BRICK_MAX) || BRICK_EXTRA.includes(v);
}
export function isSteel(v: number): boolean { return v === TILE.STEEL || v === TILE.STEEL_ALT; }
export function isWater(v: number): boolean { return v === TILE.WATER; }
export function isIce(v: number): boolean { return v === TILE.ICE; }
export function isTree(v: number): boolean { return v === TILE.TREE; }
export function isEagleTile(v: number): boolean { return v >= TILE.EAGLE_MIN && v <= TILE.EAGLE_MAX; }
// Танки проходимы: 0x00 и дорожные тайлы 0x20..0x7F (воду/лёд/деревья см. отдельно).
export function tankPassable(v: number): boolean { return v === 0x00 || (v >= 0x20 && v < 0x80); }
export function isRoad(v: number): boolean { return v >= 0x20 && v < 0x80 && v !== TILE.ICE && v !== TILE.TREE; }
// Блокирует пулю: всё, кроме пустого, дорог и разрушаемого кирпича.
export function blocksBullet(v: number): boolean { return v !== 0 && !(v >= 0x20 && v < 0x80) && !isBrick(v); }
// «Здоровье» кирпича: целый 0x0f — 2, повреждённые — 1.
export function brickHealth(v: number): number { return v === 0x0f ? 2 : isBrick(v) ? 1 : 0; }

// ---------------------------------------------------------------------------
// Статус пули (ram_bullet_status): 0x40|dir — летит, 0x33 — взрыв, 0x01 — маркер-занято.
// ---------------------------------------------------------------------------
export const BULLET = { NONE: 0x00, BUSY: 0x01, FLYING: 0x40, EXPLODE: 0x33 };
export function isBulletFlying(s: number): boolean { return (s & 0xf0) === BULLET.FLYING; }
export function bulletDir(s: number): number { return s & 3; }
export function flyingBullet(dir: number): number { return BULLET.FLYING | (dir & 3); }

// ---------------------------------------------------------------------------
// Апгрейд DEF-танка (ram_tank_upgrade): шаги 0x20, максимум 0x60 (3 звезды).
// ---------------------------------------------------------------------------
export const UPGRADE = { STEP: 0x20, MAX: 0x60, MAX_STARS: 3 };
// Супер-оружие «пистолет»: N выстрелов при подборе/старте.
export const PISTOL_SHOTS = 3;
// Полуширина луча в тайлах: ширина = 2*HALF+1 (HALF=1 -> 3 тайла).
export const PISTOL_BEAM_HALF = 1;
export function starsToUpgrade(stars: number): number {
  const n = Math.max(0, Math.min(UPGRADE.MAX_STARS, Math.floor(Number(stars) || 0)));
  return n * UPGRADE.STEP;
}
export function upgradeToStars(u: number): number {
  return Math.max(0, Math.min(UPGRADE.MAX_STARS, Math.floor((u || 0) / UPGRADE.STEP)));
}

export default {
  DIR, DIR_VEC, DX, DY, DIR_BTN, dirToBtn, btnToDir, NUM_PLAYERS, DEF_PORTS,
  TANK_TYPE, tankHits, tankSpeed, bulletProperty, bulletSpeed,
  TILE, isBrick, isSteel, isWater, isIce, isTree, isEagleTile, tankPassable, isRoad, blocksBullet, brickHealth,
  BULLET, isBulletFlying, bulletDir, flyingBullet,
  UPGRADE, starsToUpgrade, upgradeToStars, PISTOL_SHOTS, PISTOL_BEAM_HALF,
};
