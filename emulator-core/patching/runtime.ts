// runtime.ts — contract of the JS runtime of an optional feature (types only, no runtime code).
//
// Idea: a feature = a ROM descriptor (patching/patches/*) + a JS runtime (features/*) that
// performs effects that are not expressible/convenient in ROM. The PvPNes core calls the runtime hooks
// in a deterministic order (the canonical order of active features) around the ROM frame:
//
//   preFrame → frame() → postFrame → render
//
// Invariants:
//   * the authoritative state is only in RAM (0x0000–0x07FF), so saveState/rollback
//     work unchanged; ctx.state — for visual/derived data (NOT in the hash);
//   * no Date.now/performance.now/Math.random — only ctx.frame and RAM;
//   * runtimes do NOT import pvp.ts (only this type module, domain/rom-contract).
//
// Relative path: ./emulator-core/patching/runtime.ts

/** Narrow core facade available to runtimes. */
export interface KernelApi {
  /** Full emulator RAM (cpu.mem). */
  readonly mem: Uint8Array;
  /** PPU nametable (tile/attrib) for updating BG rendering. */
  readonly ppuNameTable: { tile: Uint8Array | number[]; attrib: Uint8Array | number[] }[];
  /** PPU OAM sprites (for the visual layer). */
  readonly ppuSpriteMem: Uint8Array;
  /** PPU VRAM (palette memory $3F00..$3F1F and pattern/nametable). */
  readonly ppuVram: Uint8Array;
  /** PPU 256×240 frame pixel buffer (0x00RRGGBB) for the 2D overlay. */
  readonly ppuBuffer: Uint32Array;
  /** PPU sprite palette (16 colors, 0x00RRGGBB). */
  readonly ppuSpritePalette: Uint32Array;
  /** A button (edge) by logical port for the current frame. */
  readonly playerFire: Record<number, boolean>;
  hasFeature(id: string): boolean;
  setAudioSuppressed(v: boolean): void;
}

export interface FeatureContext {
  kernel: KernelApi;
  /** Core frame number (updated before each hook). */
  frame: number;
  /** Per-instance + per-feature mutable state (visual/cache, NOT authoritative). */
  state: Record<string, any>;
  /** Core startup options (opts). */
  startOptions: Record<string, any>;
  /** This feature's settings (default values + overrides from the match). */
  readonly options: Record<string, string | number | boolean>;
  /** This feature's id (for channel addressing). */
  readonly id: string;
  /** This feature's order queue from the host (UI). Read/cleared in preFrame. */
  readonly orders: unknown[];
  /** "feature → host" channel: the feature publishes a state snapshot here for the UI. */
  readonly status: Record<string, any>;
}

export interface FeatureRuntime {
  /** After loadROM: initialize the runtime state. */
  init?(ctx: FeatureContext): void;
  /** Before the ROM frame. */
  preFrame?(ctx: FeatureContext): void;
  /** After the ROM frame: apply effects (writes — to RAM only). */
  postFrame?(ctx: FeatureContext): void;
  /** After postFrame: render (OAM/nametable), does not write RAM. */
  render?(ctx: FeatureContext): void;
  /** Before saveState: remove derived visual changes (e.g., nametable overlay). */
  beforeSaveState?(ctx: FeatureContext): void;
  /** After saveState: restore derived visual changes. */
  afterSaveState?(ctx: FeatureContext): void;
  /** loadState: reset visual/derived state. */
  onLoadState?(ctx: FeatureContext): void;
}

export const RUNTIME_METHODS = ["init", "preFrame", "postFrame", "render", "beforeSaveState", "afterSaveState", "onLoadState"] as const;
