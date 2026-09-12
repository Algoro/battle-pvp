// scene-state.ts — авторитетный срез состояния для рендера. Чистая функция: только
// чтение RAM (через семантический слой @core/model/game-view) и пиксельного буфера PPU.
// Ничего не пишет в память и не вызывает stepFrame.
//
// Относительный путь: ./frontend/src/render/scene-state.ts
import { readState } from "@core/model/game-view.ts";
import { RAM } from "@core/rom-contract.ts";
import {
  DEF_PORTS,
  TANK_EXPLODE,
  TANK_MOVING,
  TANK_TYPE,
  isEagleTile,
  isTankActive,
  isTankSpawning,
  tankHi,
  upgradeToStars,
} from "@core/domain.ts";
import type { RenderBounds, SceneBullet, ScenePrize, SceneState, SceneTank, SceneTower, TankVisualState } from "./types.ts";

// Игровая зона в буфере коллизий $0400: 13×13 блоков ROM = 26×26 клеток по 8 px,
// со смещением (2,2) (проверено по ROM: орёл в клетках 14..15, 26..27).
export const PLAY_BOUNDS: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };

function tankState(flag: number): TankVisualState {
  if (flag === 0) return "dead";
  if (isTankSpawning(flag)) return "spawning";
  if (tankHi(flag) === (TANK_EXPLODE & 0xf0)) return "exploding";
  // 0x80..0xD0 — «на поле» (включая стоянку/поворот human-танка: 0x88|dir).
  if (isTankActive(flag)) return "alive";
  return "dead";
}

function eaglePresent(field: Uint8Array, b: RenderBounds): boolean {
  for (let r = b.row0; r < b.row0 + b.rows; r++) {
    for (let c = b.col0; c < b.col0 + b.cols; c++) {
      if (isEagleTile(field[r * 32 + c])) return true;
    }
  }
  return false;
}

export function readSceneFromMem(
  mem: Uint8Array,
  frame: number,
  pixels: Uint32Array | null = null,
  towers: SceneTower[] = [],
): SceneState {
  const state = readState(mem);
  const field = mem.slice(RAM.FIELD, RAM.FIELD + 32 * 32);
  const bounds = PLAY_BOUNDS;

  const tanks: SceneTank[] = state.tanks.map((tk: any) => {
    const isDef = tk.index < DEF_PORTS;
    const type = tk.type | 0;
    const stars = isDef ? (upgradeToStars(mem[RAM.TANK_UPGRADE + tk.index]) as 0 | 1 | 2 | 3) : 0;
    return {
      index: tk.index,
      team: isDef ? "DEF" : "ATT",
      x: tk.x,
      y: tk.y,
      dir: (tk.flag & 3) as 0 | 1 | 2 | 3,
      state: tankState(tk.flag),
      type,
      moving: tankHi(tk.flag) === TANK_MOVING,
      stars,
      lives: isDef ? mem[RAM.LIVES + tk.index] : null,
      helmet: !!tk.helmet,
      stunned: !!tk.stunned,
      onIce: !!tk.onIce,
      flashing: !!tk.flashing,
      armored: (type & 0xf0) === TANK_TYPE.ARMOR,
      fast: (type & 0xf0) === TANK_TYPE.FAST_TANK,
    };
  });

  const bullets: SceneBullet[] = state.bullets.map((bl: any) => ({
    owner: bl.owner,
    team: bl.owner < DEF_PORTS ? "DEF" : "ATT",
    dir: bl.dir,
    x: bl.x,
    y: bl.y,
  }));

  const prize: ScenePrize | null = state.prizes.length
    ? { id: state.prizes[0].id, x: state.prizes[0].x, y: state.prizes[0].y }
    : null;

  const dotsLo = mem[RAM.DOTS_LEFT];
  const dotsHi = mem[RAM.DOTS_LEFT + 1];
  const dotsLeft = dotsLo | (dotsHi << 8);

  const started = mem[RAM.ENEMIES_LEFT] !== 0xff;
  const present = eaglePresent(field, bounds);
  const destroyed = !present && started && mem[RAM.GAME_OVER] === 0;

  return {
    frame,
    field,
    bounds,
    tanks,
    bullets,
    prize,
    towers,
    eagle: {
      col: state.eagle.col,
      row: state.eagle.row,
      fortified: mem[RAM.FORTIFIED] > 0,
      destroyed,
    },
    effects: { freezeTimer: mem[RAM.CLOCK_TIMER], dotsLeft: dotsLeft > 0 ? dotsLeft : null },
    pixels,
  };
}

// Обёртка над эмулятором: достаёт RAM/кадр/пиксельный буфер из PvPNes.
export function readScene(emu: any): SceneState {
  const nes = emu?.nes ?? emu;
  const mem: Uint8Array | undefined = nes?.cpu?.mem;
  const frame: number = nes?._frame ?? 0;
  const pixels: Uint32Array | null = nes?.ppu?.buffer ?? null;
  const towers = readTowers(emu);
  if (!mem) {
    return { ...emptyScene(), frame, pixels, towers };
  }
  return readSceneFromMem(mem, frame, pixels, towers);
}

// Башни TD живут в JS-рантайме (не в RAM) — забираем снимок через API драйвера.
function readTowers(emu: any): SceneTower[] {
  const td = emu?.getFeatureState?.("tower-defence");
  if (!td || !Array.isArray(td.towers)) return [];
  return td.towers.map((t: any) => ({
    cell: t.cell | 0,
    type: String(t.type),
    level: t.level | 0,
    hp: t.hp | 0,
    maxHp: t.maxHp | 0,
    dir: (t.dir & 3) as 0 | 1 | 2 | 3,
  }));
}

export function emptyScene(): SceneState {
  return {
    frame: 0,
    field: new Uint8Array(32 * 32),
    bounds: { ...PLAY_BOUNDS },
    tanks: [],
    bullets: [],
    prize: null,
    towers: [],
    eagle: { col: 14, row: 26, fortified: false, destroyed: false },
    effects: { freezeTimer: 0, dotsLeft: null },
    pixels: null,
  };
}

export default readScene;
