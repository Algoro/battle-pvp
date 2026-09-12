// types.ts — контракты СЛОЯ РЕНДЕРА: драйверы, расширения, хост и авторитетный срез.
//
// Инварианты:
//   * всё, что получает драйвер/расширение, — это ТОЛЬКО read-only SceneState;
//   * слой рендера не вызывает методы ядра, меняющие состояние (stepFrame/saveState/…);
//   * драйвер ровно один, расширений — сколько угодно (упорядочены).
//
// Относительный путь: ./frontend/src/render/types.ts
import type { CameraRig } from "./camera-rig.ts";

// --- Авторитетный срез для отрисовки (из RAM; без записи) -------------------

export interface RenderBounds {
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}

export type TankVisualState = "dead" | "spawning" | "exploding" | "alive";

export interface SceneTank {
  index: number;
  team: "DEF" | "ATT";
  /** RAM-пиксели (8 px на клетку поля). */
  x: number;
  y: number;
  dir: 0 | 1 | 2 | 3;
  state: TankVisualState;
  type: number;
  moving: boolean;
  stars: 0 | 1 | 2 | 3;
  lives: number | null;
  helmet: boolean;
  stunned: boolean;
  onIce: boolean;
  flashing: boolean;
  armored: boolean;
  fast: boolean;
}

export interface SceneBullet {
  owner: number;
  team: "DEF" | "ATT";
  dir: number;
  x: number;
  y: number;
}

export interface ScenePrize {
  id: number;
  x: number;
  y: number;
}

export interface SceneEagle {
  col: number;
  row: number;
  fortified: boolean;
  destroyed: boolean;
}

export interface SceneEffects {
  freezeTimer: number;
  dotsLeft: number | null;
}

export interface SceneState {
  frame: number;
  /** Копия буфера коллизий 32×32 (значения тайлов из domain.TILE). */
  field: Uint8Array;
  bounds: RenderBounds;
  tanks: SceneTank[];
  bullets: SceneBullet[];
  prize: ScenePrize | null;
  eagle: SceneEagle;
  effects: SceneEffects;
  /** Ссылка на пиксельный буфер PPU (для драйвера pixel-2d; не копия). */
  pixels: Uint32Array | null;
}

// --- Хост и сущности ---------------------------------------------------------

export interface RenderHost {
  /** Точка монтирования: драйвер сам создаёт canvas/DOM. */
  container: HTMLElement;
  width: number;
  height: number;
  capabilities: Set<string>;
  camera: CameraRig;
  scene: SceneState;
  dtMs: number;
  /** Произвольный обмен между драйвером и расширениями (например, three-контекст). */
  shared: Record<string, unknown>;
  /** Локальный игрок (для камеры «из глаз»): порт танка. */
  viewer: { port: number };
}

export interface RenderDriver {
  readonly id: string;
  mount(host: RenderHost): void | Promise<void>;
  setScene(scene: SceneState): void;
  resize(width: number, height: number): void;
  render(dtMs: number): void;
  dispose(): void;
  /** Необязательные настройки драйвера (локальные, display-only). */
  setOptions?(options: unknown): void;
}

export interface RenderExtension {
  id: string;
  order?: number;
  mount(host: RenderHost): void | Promise<void>;
  beforeRender?(scene: SceneState, dtMs: number): void;
  afterRender?(scene: SceneState, dtMs: number): void;
  resize?(width: number, height: number): void;
  dispose?(): void;
}
