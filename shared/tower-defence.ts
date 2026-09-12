// tower-defence.ts — единые данные и геометрия режима Tower Defence.
//
// Модуль намеренно без импортов: подключают frontend (редактор/HUD) и emulator-core
// (патч/рантайм). Числа и карты — единый источник, чтобы UI показывал ровно то, что
// применяет рантайм.

// ---------------------------------------------------------------------------
// Башни
// ---------------------------------------------------------------------------
export type TdDifficulty = "easy" | "normal" | "hard";

export interface TowerTypeInfo {
  id: string;
  title: string;
  description: string;
  cost: number;
  upgradeCost: number;
  damage: number;
  /** Дальность в блоках (16 px). */
  range: number;
  /** Кадров между выстрелами. */
  fireInterval: number;
  /** Скорость снаряда, px/кадр. */
  projectileSpeed: number;
  /** Прочность башни. */
  hp: number;
  /** Иконка приза ROM (0..5), которой рисуем башню. */
  icon: number;
}

export const TOWER_TYPES: TowerTypeInfo[] = [
  {
    id: "gun",
    title: "Пушка",
    description: "Сбалансированная башня.",
    cost: 100,
    upgradeCost: 60,
    damage: 1,
    range: 6,
    fireInterval: 40,
    projectileSpeed: 3,
    hp: 3,
    icon: 5,
  },
  {
    id: "rapid",
    title: "Пулемёт",
    description: "Частый огонь, малая дальность.",
    cost: 80,
    upgradeCost: 50,
    damage: 1,
    range: 4,
    fireInterval: 18,
    projectileSpeed: 3,
    hp: 2,
    icon: 3,
  },
  {
    id: "sniper",
    title: "Снайпер",
    description: "Дальний выстрел, пробивает броню.",
    cost: 160,
    upgradeCost: 90,
    damage: 3,
    range: 11,
    fireInterval: 80,
    projectileSpeed: 5,
    hp: 2,
    icon: 1,
  },
  {
    id: "cannon",
    title: "Орудие",
    description: "Медленный, но мощный.",
    cost: 200,
    upgradeCost: 110,
    damage: 5,
    range: 7,
    fireInterval: 100,
    projectileSpeed: 2,
    hp: 4,
    icon: 4,
  },
];

export const TOWER_IDS: string[] = TOWER_TYPES.map((t) => t.id);
export const TOWER_MAX_LEVEL = 3;

export function towerById(id: string): TowerTypeInfo | null {
  return TOWER_TYPES.find((t) => t.id === id) ?? null;
}

/** Характеристики башни с учётом уровня (0..2). */
export function towerStats(type: TowerTypeInfo, level: number): {
  damage: number;
  range: number;
  fireInterval: number;
  hp: number;
} {
  const l = Math.max(0, Math.min(TOWER_MAX_LEVEL - 1, level | 0));
  return {
    damage: type.damage + l,
    range: type.range + l,
    fireInterval: Math.max(6, Math.round(type.fireInterval * (1 - 0.18 * l))),
    hp: type.hp + l,
  };
}

// ---------------------------------------------------------------------------
// Волны / экономика
// ---------------------------------------------------------------------------
export interface TdWaveDef {
  count: number;
  interval: number;
  /** Типы врагов по порядку спавна (значения ram_tank_type; список зацикливается). */
  types: number[];
}

// Типы танков ROM: 0x80 базовый, 0xa0 быстрая пуля, 0xc0 быстрый, 0xe? бронированный
// (младшие биты — остаток брони). Волны постепенно подмешивают более сильных врагов.
export const TD_TANK_BASE = 0x80;
export const TD_TANK_FAST_BULLET = 0xa0;
export const TD_TANK_FAST = 0xc0;
export const TD_TANK_ARMOR = 0xe2;

export const TD_WAVES: TdWaveDef[] = [
  { count: 4, interval: 60, types: [0x80, 0x80, 0xa0, 0x80] },
  { count: 5, interval: 58, types: [0x80, 0x80, 0xa0, 0x80, 0x80] },
  { count: 6, interval: 55, types: [0x80, 0xa0, 0x80, 0xc0, 0x80, 0xa0] },
  { count: 7, interval: 52, types: [0x80, 0xa0, 0xc0, 0x80, 0xa0, 0xc0, 0x80] },
  { count: 8, interval: 50, types: [0x80, 0xa0, 0x80, 0xc0, 0xa0, 0x80, 0xc0, 0xa0] },
  { count: 10, interval: 46, types: [0x80, 0x80, 0xa0, 0xc0, 0xa0, 0xc0, 0xe2, 0xa0, 0x80, 0xc0] },
  { count: 12, interval: 42, types: [0x80, 0xa0, 0xc0, 0xa0, 0xe2, 0xc0, 0x80, 0xa0, 0xe2, 0xc0, 0xa0, 0x80] },
  { count: 14, interval: 38, types: [0xa0, 0xc0, 0x80, 0xe2, 0xa0, 0xc0, 0xe2, 0x80, 0xc0, 0xa0, 0xe2, 0xc0, 0x80, 0xa0] },
  { count: 16, interval: 34, types: [0x80, 0xa0, 0xe2, 0xc0, 0xa0, 0xe2, 0xc0, 0x80, 0xe2, 0xa0, 0xc0, 0xe2, 0x80, 0xc0, 0xa0, 0xe2] },
  { count: 20, interval: 30, types: [0xa0, 0xc0, 0xe2, 0xa0, 0xe2, 0xc0, 0xe2, 0xa0, 0xc0, 0xe2, 0xe2, 0xc0, 0xa0, 0xe2, 0xc0, 0xa0, 0xe2, 0xc0, 0xe2, 0xc0] },
];

/** Пул моделей башен в рендере. */
export const TD_MAX_TOWERS = 16;

export const TD_DIFFICULTIES: { id: TdDifficulty; title: string; startPoints: number; countScale: number }[] = [
  { id: "easy", title: "Легко", startPoints: 350, countScale: 0.75 },
  { id: "normal", title: "Норма", startPoints: 300, countScale: 1 },
  { id: "hard", title: "Сложно", startPoints: 250, countScale: 1.3 },
];

export function difficultyById(id: string) {
  return TD_DIFFICULTIES.find((d) => d.id === id) ?? TD_DIFFICULTIES[1];
}

/** Очки за убийство врага по типу ROM-танка (старший ниббл ram_tank_type). */
export const TD_POINTS_PER_KILL: Record<number, number> = {
  0x80: 100,
  0xa0: 200,
  0xc0: 300,
  0xe0: 400,
};

export function pointsForTankType(type: number): number {
  if (type & 0x04) return 500;
  return TD_POINTS_PER_KILL[type & 0xf0] ?? 100;
}

export const TD_SELL_RATIO = 0.6;

export interface TdConfig {
  map: string;
  difficulty: TdDifficulty;
  startPoints: number;
  waves: number;
  mobileTank: boolean;
}

export const TD_DEFAULT_CONFIG: TdConfig = {
  map: "snake",
  difficulty: "normal",
  startPoints: 300,
  waves: TD_WAVES.length,
  mobileTank: true,
};

export const TD_PHASE = {
  OFF: 0,
  BUILD: 1,
  WAVE: 2,
  INTERMISSION: 3,
  VICTORY: 4,
  DEFEAT: 5,
} as const;

// ---------------------------------------------------------------------------
// Карты (геометрия)
// ---------------------------------------------------------------------------
export const TD_SIZE = 13;
export const TD_STRIDE = 91;
export const BLOCK_WALL = 0x09; // бетон (в поле — 0x10, не разрушается пулей)
export const BLOCK_EMPTY = 0x0d;
export const TD_BASE_R0 = 11;
export const TD_BASE_R1 = 12;
export const TD_BASE_C0 = 5;
export const TD_BASE_C1 = 7;

export interface TdMapDef {
  id: string;
  title: string;
  /** 13 строк по 13 символов: '#' стена, '.' пол, 'S' спавн ATT, 'E' пол у базы. */
  rows: string[];
}

export const TD_MAPS: TdMapDef[] = [
  {
    id: "snake",
    title: "Змейка",
    rows: [
      "S.....S.....S",
      "############.",
      ".............",
      ".############",
      ".............",
      "############.",
      ".............",
      ".############",
      ".............",
      "############.",
      ".............",
      ".............",
      ".............",
    ],
  },
  {
    id: "lanes",
    title: "Коридоры",
    rows: [
      "S.....S.....S",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".#.#.#.#.#.#.",
      ".............",
      ".............",
    ],
  },
  {
    id: "zigzag",
    title: "Зигзаг",
    rows: [
      "S.....S.....S",
      "##########.##",
      ".............",
      "##.##########",
      ".............",
      "##########.##",
      ".............",
      "##.##########",
      ".............",
      "##########.##",
      ".............",
      ".............",
      ".............",
    ],
  },
];

export const TD_MAP_IDS: string[] = TD_MAPS.map((m) => m.id);
export const TD_MAP_LIST: { id: string; title: string }[] = TD_MAPS.map((m) => ({ id: m.id, title: m.title }));

export function tdMapById(id: string): TdMapDef {
  return TD_MAPS.find((m) => m.id === id) ?? TD_MAPS[0];
}

/** Номер ROM-стадии для карты (TD-карты записаны в стадии 1..N). */
export function tdMapStage(id: string): number {
  const i = TD_MAPS.findIndex((m) => m.id === id);
  return i < 0 ? 1 : i + 1;
}

export function isBaseCell(r: number, c: number): boolean {
  return r >= TD_BASE_R0 && r <= TD_BASE_R1 && c >= TD_BASE_C0 && c <= TD_BASE_C1;
}

function cellAt(map: TdMapDef, r: number, c: number): string {
  return map.rows[r]?.[c] ?? "#";
}

export function isWallBlock(map: TdMapDef, r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= TD_SIZE || c >= TD_SIZE) return true;
  return cellAt(map, r, c) === "#";
}

export function tdSpawnCells(map: TdMapDef): number[] {
  const out: number[] = [];
  for (let r = 0; r < TD_SIZE; r++)
    for (let c = 0; c < TD_SIZE; c++) if (cellAt(map, r, c) === "S") out.push(r * TD_SIZE + c);
  return out;
}

/** Клетки, допустимые для башни: пол вне зоны базы и вне спавнов. */
export function tdBuildableCells(map: TdMapDef): number[] {
  const out: number[] = [];
  for (let r = 0; r < TD_SIZE; r++) {
    for (let c = 0; c < TD_SIZE; c++) {
      const ch = cellAt(map, r, c);
      if (ch !== "." && ch !== "E") continue;
      if (isBaseCell(r, c)) continue;
      out.push(r * TD_SIZE + c);
    }
  }
  return out;
}

export function blockCode(ch: string): number {
  return ch === "#" ? BLOCK_WALL : BLOCK_EMPTY;
}

/** 91 байт стадии: 14 нибблов/строку (13 блоков + паддинг), stride 7 байт. */
export function buildTdStageBytes(map: TdMapDef): Uint8Array {
  const out = new Uint8Array(TD_STRIDE);
  let k = 0;
  for (let r = 0; r < TD_SIZE; r++) {
    for (let c = 0; c <= TD_SIZE; c++) {
      const code = c < TD_SIZE ? blockCode(cellAt(map, r, c)) & 0x0f : 0;
      const bi = k >> 1;
      out[bi] = k % 2 === 0 ? (out[bi] & 0x0f) | (code << 4) : (out[bi] & 0xf0) | code;
      k++;
    }
  }
  return out;
}

/** Связный путь от верхней кромки до базы (BFS по полу). */
export function isConnected(map: TdMapDef): boolean {
  const visited = new Set<number>();
  const queue: [number, number][] = [];
  for (let c = 0; c < TD_SIZE; c++) {
    if (!isWallBlock(map, 0, c)) {
      visited.add(c);
      queue.push([0, c]);
    }
  }
  while (queue.length) {
    const [r, c] = queue.shift()!;
    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const) {
      const nr = r + dr,
        nc = c + dc;
      if (nr < 0 || nc < 0 || nr >= TD_SIZE || nc >= TD_SIZE) continue;
      if (isWallBlock(map, nr, nc)) continue;
      const key = nr * TD_SIZE + nc;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push([nr, nc]);
    }
  }
  return visited.has((TD_BASE_R0 - 1) * TD_SIZE + 6) || visited.has(TD_BASE_R0 * TD_SIZE + 6);
}

export default {
  TOWER_TYPES,
  TOWER_IDS,
  towerById,
  towerStats,
  TD_WAVES,
  TD_DIFFICULTIES,
  difficultyById,
  TD_POINTS_PER_KILL,
  pointsForTankType,
  TD_DEFAULT_CONFIG,
  TD_PHASE,
  TD_MAPS,
  TD_MAP_LIST,
  tdMapById,
  tdMapStage,
  isBaseCell,
  isWallBlock,
  tdSpawnCells,
  tdBuildableCells,
  buildTdStageBytes,
  isConnected,
};
