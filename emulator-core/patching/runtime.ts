// runtime.ts — контракт JS-рантайма опциональной фичи (только типы, без рантайм-кода).
//
// Идея: фича = ROM-дескриптор (patching/patches/*) + JS-рантайм (features/*), который
// исполняет эффекты, не выразимые/неудобные в ROM. Ядро PvPNes вызывает хуки рантаймов
// в детерминированном порядке (канонический порядок активных фич) вокруг ROM-кадра:
//
//   preFrame → frame() → postFrame → render
//
// Инварианты:
//   * авторитетное состояние — только в RAM (0x0000–0x07FF), тогда saveState/rollback
//     работают без изменений; ctx.state — для визуального/производного (НЕ в хэше);
//   * никаких Date.now/performance.now/Math.random — только ctx.frame и RAM;
//   * рантаймы НЕ импортируют pvp.ts (только этот модуль типов, domain/rom-contract).
//
// Относительный путь: ./emulator-core/patching/runtime.ts

/** Узкий фасад ядра, доступный рантаймам. */
export interface KernelApi {
  /** Полная RAM эмулятора (cpu.mem). */
  readonly mem: Uint8Array;
  /** Nametable PPU (tile/attrib) для обновления рендера BG. */
  readonly ppuNameTable: { tile: Uint8Array | number[]; attrib: Uint8Array | number[] }[];
  /** OAM-спрайты PPU (для визуального слоя). */
  readonly ppuSpriteMem: Uint8Array;
  /** VRAM PPU (память палитр $3F00..$3F1F и pattern/nametable). */
  readonly ppuVram: Uint8Array;
  /** Пиксельный буфер кадра PPU 256×240 (0x00RRGGBB) для 2D-оверлея. */
  readonly ppuBuffer: Uint32Array;
  /** Палитра спрайтов PPU (16 цветов, 0x00RRGGBB). */
  readonly ppuSpritePalette: Uint32Array;
  /** Кнопка A (edge) по логическому порту за текущий кадр. */
  readonly playerFire: Record<number, boolean>;
  hasFeature(id: string): boolean;
  setAudioSuppressed(v: boolean): void;
}

export interface FeatureContext {
  kernel: KernelApi;
  /** Номер кадра ядра (обновляется перед каждым хуком). */
  frame: number;
  /** Per-instance + per-feature изменяемое состояние (визуал/кэш, НЕ авторитетное). */
  state: Record<string, any>;
  /** Стартовые опции ядра (opts). */
  startOptions: Record<string, any>;
}

export interface FeatureRuntime {
  /** После loadROM: инициализация состояния рантайма. */
  init?(ctx: FeatureContext): void;
  /** До ROM-кадра. */
  preFrame?(ctx: FeatureContext): void;
  /** После ROM-кадра: применение эффектов (запись — только в RAM). */
  postFrame?(ctx: FeatureContext): void;
  /** После postFrame: рендер (OAM/nametable), не пишет RAM. */
  render?(ctx: FeatureContext): void;
  /** Перед saveState: снять производные визуальные изменения (например, nametable-overlay). */
  beforeSaveState?(ctx: FeatureContext): void;
  /** После saveState: вернуть производные визуальные изменения. */
  afterSaveState?(ctx: FeatureContext): void;
  /** loadState: сбросить визуальное/производное состояние. */
  onLoadState?(ctx: FeatureContext): void;
}

export const RUNTIME_METHODS = ["init", "preFrame", "postFrame", "render", "beforeSaveState", "afterSaveState", "onLoadState"] as const;
