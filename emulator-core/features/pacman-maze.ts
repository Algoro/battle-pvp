// pacman-maze.ts — авторский лабиринт режима «Pac-Man» и его сборка в формат ROM-стадии.
//
// Формат стадии: 13×13 блоков по 16×16 px, 14 нибблов на строку (13 блоков + паддинг,
// т.к. ROM делает лишний INC счётчика), чётный индекс — старший ниббл, stride 7 байт = 91.
// Коды блоков (tbl_DACB): 0x09 = бетон (стена), 0x0D = пусто (коридор).
//
// Лабиринт генерируется детерминированным DFS по «ячейкам» (нечётные координаты) плюс
// открытая кольцевая дорожка по периметру; гарантированно связный. Область базы не трогаем.
//
// Относительный путь: ./emulator-core/features/pacman-maze.ts

export const BLOCK_WALL = 0x09; // полный бетон
export const BLOCK_EMPTY = 0x0d; // полный пустой блок
export const MAZE_SIZE = 13;
export const STAGE_BYTES = 91;
export const DOT_TILE = 0x69; // маленький центрированный квадрат (точка) из CHR bank1

// Детерминированный LCG (без Math.random — архитектурный тест).
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 0;
  };
}

const BASE_R0 = 11,
  BASE_R1 = 12,
  BASE_C0 = 5,
  BASE_C1 = 7;

function isBaseBlock(r: number, c: number): boolean {
  return r >= BASE_R0 && r <= BASE_R1 && c >= BASE_C0 && c <= BASE_C1;
}

// Генерация лабиринта: true = стена. Ячейки — нечётные (r,c) 1..11; DFS прорубает проходы.
function generate(): boolean[] {
  const N = MAZE_SIZE;
  const wall = new Array<boolean>(N * N).fill(true);
  const idx = (r: number, c: number) => r * N + c;
  const carve = (r: number, c: number) => {
    wall[idx(r, c)] = false;
  };

  // Открытая кольцевая дорожка по периметру (туннели/спавны).
  for (let i = 0; i < N; i++) {
    carve(0, i);
    carve(N - 1, i);
    carve(i, 0);
    carve(i, N - 1);
  }
  // Ячейки лабиринта на нечётных координатах.
  for (let r = 1; r < N; r += 2) for (let c = 1; c < N; c += 2) carve(r, c);

  // DFS (perfect maze) по ячейкам с фиксированным seed.
  const rnd = lcg(0x9e3779b9);
  const visited = new Set<number>();
  const stack: [number, number][] = [[1, 1]];
  carve(1, 1);
  visited.add(idx(1, 1));
  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const all: [number, number][] = [
      [r - 2, c],
      [r + 2, c],
      [r, c - 2],
      [r, c + 2],
    ];
    const dirs = all.filter(([nr, nc]) => nr >= 1 && nr < N - 1 && nc >= 1 && nc < N - 1 && !visited.has(idx(nr, nc)));
    if (dirs.length === 0) {
      stack.pop();
      continue;
    }
    const [nr, nc] = dirs[rnd() % dirs.length];
    carve((r + nr) >> 1, (c + nc) >> 1); // прорубить стену между ячейками
    carve(nr, nc);
    visited.add(idx(nr, nc));
    stack.push([nr, nc]);
  }

  // Область базы — всегда коридор (её замурует ROM-патч).
  for (let r = BASE_R0; r <= BASE_R1; r++) for (let c = BASE_C0; c <= BASE_C1; c++) carve(r, c);

  return wall;
}

const GRID: boolean[] = generate();

/** Стена в блоке. */
export function isWallBlock(r: number, c: number): boolean {
  if (r < 0 || c < 0 || r >= MAZE_SIZE || c >= MAZE_SIZE) return true;
  return GRID[r * MAZE_SIZE + c];
}

export function blockCode(r: number, c: number): number {
  return isWallBlock(r, c) ? BLOCK_WALL : BLOCK_EMPTY;
}

/** 91 байт стадии (13 строк × 7 байт; 14 нибблов на строку: 13 блоков + паддинг). */
export function buildStageBytes(): Uint8Array {
  const out = new Uint8Array(STAGE_BYTES);
  let k = 0;
  for (let r = 0; r < MAZE_SIZE; r++) {
    for (let c = 0; c <= MAZE_SIZE; c++) {
      const code = c < MAZE_SIZE ? blockCode(r, c) & 0x0f : 0;
      const bi = k >> 1;
      out[bi] = k % 2 === 0 ? (out[bi] & 0x0f) | (code << 4) : (out[bi] & 0xf0) | code;
      k++;
    }
  }
  return out;
}

export interface Bomb {
  off: number;
  id: number;
}
/** Field-смещение верхней-левой клетки блока (2+2c, 2+2r). */
export function blockCellOff(r: number, c: number): number {
  return (2 + 2 * r) * 32 + (2 + 2 * c);
}
export function blockCenterOff(r: number, c: number): number {
  return blockCellOff(r, c);
}

// Бомбы (P2) — всегда в четырёх углах; все — «бомба» (grenade, id 4).
export const BOMBS: Bomb[] = [
  { r: 0, c: 0, id: 4 },
  { r: 0, c: 12, id: 4 },
  { r: 12, c: 0, id: 4 },
  { r: 12, c: 12, id: 4 },
].map((b) => ({ off: blockCenterOff(b.r, b.c), id: b.id }));

/** Клетки-точки: все блоки-коридоры, кроме базы и клеток бомб (бомба — BG 2×2). */
export function dotCells(): number[] {
  const out: number[] = [];
  const bombSet = new Set<number>();
  for (const b of BOMBS) {
    bombSet.add(b.off);
    bombSet.add(b.off + 1);
    bombSet.add(b.off + 32);
    bombSet.add(b.off + 33);
  }
  for (let r = 0; r < MAZE_SIZE; r++) {
    for (let c = 0; c < MAZE_SIZE; c++) {
      if (isWallBlock(r, c) || isBaseBlock(r, c)) continue;
      const off = blockCellOff(r, c);
      if (bombSet.has(off)) continue;
      out.push(off);
    }
  }
  return out;
}

export default { buildStageBytes, dotCells, BOMBS, DOT_TILE, STAGE_BYTES, isWallBlock };
