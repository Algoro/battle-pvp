// types.ts — RENDER LAYER contracts: drivers, extensions, host and authoritative slice.
//
// Invariants:
//   * everything a driver/extension receives is ONLY a read-only SceneState;
//   * the render layer does not call core methods that change state (stepFrame/saveState/…);
//   * there is exactly one driver, any number of extensions (ordered).
//
// Relative path: ./frontend/src/render/types.ts
import type { CameraRig } from "./camera-rig.ts";

// --- Authoritative slice for drawing (from RAM; without writes) -------------------

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
  /** RAM pixels (8 px per field cell). */
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

/** Stationary tower defence tower (from the JS runtime, not from RAM). */
export interface SceneTower {
  /** Field cell r*13+c (block 16×16 px). */
  cell: number;
  /** Tower type id (see shared/tower-defence). */
  type: string;
  /** Upgrade level 0..2. */
  level: number;
  hp: number;
  maxHp: number;
  /** Barrel direction 0..3. */
  dir: 0 | 1 | 2 | 3;
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
  /** Copy of the 32×32 collision buffer (tile values from domain.TILE). */
  field: Uint8Array;
  bounds: RenderBounds;
  tanks: SceneTank[];
  bullets: SceneBullet[];
  prize: ScenePrize | null;
  /** Tower defence towers (empty in normal modes). */
  towers: SceneTower[];
  eagle: SceneEagle;
  effects: SceneEffects;
  /** Reference to the PPU pixel buffer (for the pixel-2d driver; not a copy). */
  pixels: Uint32Array | null;
}

// --- Host and entities ---------------------------------------------------------

export interface RenderHost {
  /** Mount point: the driver creates the canvas/DOM itself. */
  container: HTMLElement;
  width: number;
  height: number;
  capabilities: Set<string>;
  camera: CameraRig;
  scene: SceneState;
  dtMs: number;
  /** Arbitrary exchange between the driver and extensions (for example, the three context). */
  shared: Record<string, unknown>;
  /** Local player (for the first-person camera): tank port. */
  viewer: { port: number };
}

export interface RenderDriver {
  readonly id: string;
  mount(host: RenderHost): void | Promise<void>;
  setScene(scene: SceneState): void;
  resize(width: number, height: number): void;
  render(dtMs: number): void;
  dispose(): void;
  /** Optional driver settings (local, display-only). */
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
