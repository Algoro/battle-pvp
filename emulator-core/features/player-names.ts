// player-names.ts — JS-рантайм фичи `player-names`: имя игрока над его танком.
//
// Рендер — BG-тайлами nametable (шрифт ROM: tile index == ASCII-код, CHR bank1).
// Overlay производный/визуальный: не пишет cpu.mem (хэш кадров не меняется) и
// снимается перед saveState (см. before/afterSaveState), чтобы не попадать в снапшот.
//
// Поведение (согласовано): имя из лобби/матча; ≤10 символов; центрируется над танком;
// цвет — палитра HUD-текста; показывается живым танкам людей (DEF+ATT); нет имени — ничего.
//
// Относительный путь: ./emulator-core/features/player-names.ts
import { RAM } from "../rom-contract.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";

const MAX_LEN = 10;
const HUD_OFF = 5 * 32 + 12; // "STAGE" в nametable-адресе $28AC

type SavedCell = { off: number; glyph: number; nt: { tile: number; attrib: number }[] };

function sanitize(name: unknown): string {
  const s = String(name ?? "");
  let out = "";
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) out += ch;
  }
  return out.trim().slice(0, MAX_LEN);
}

function normalizeNames(src: any): Record<number, string> {
  const out: Record<number, string> = {};
  if (!src) return out;
  if (Array.isArray(src)) {
    src.forEach((n, i) => {
      const s = sanitize(n);
      if (s) out[i] = s;
    });
  } else if (src instanceof Map) {
    for (const [k, v] of src) {
      const s = sanitize(v);
      if (s) out[Number(k)] = s;
    }
  } else if (typeof src === "object") {
    for (const k of Object.keys(src)) {
      const s = sanitize(src[k]);
      if (s) out[Number(k)] = s;
    }
  }
  return out;
}

// Палитра HUD-текста: значение attrib клетки "STAGE" (первый nametable, где лежит буква).
function hudPalette(ctx: FeatureContext): number {
  for (const nt of ctx.kernel.ppuNameTable) {
    const t = nt.tile[HUD_OFF];
    if (t >= 0x41 && t <= 0x5a) return nt.attrib[HUD_OFF] & 0x0c;
  }
  return 0;
}

function restoreOverlay(ctx: FeatureContext): void {
  const cells = ctx.state.overlay as SavedCell[] | undefined;
  if (!cells || cells.length === 0) return;
  const nts = ctx.kernel.ppuNameTable;
  for (const c of cells) {
    for (let i = 0; i < nts.length; i++) {
      const nt = nts[i];
      if (nt.tile[c.off] !== c.glyph) continue; // клетку изменила игра — не трогаем
      const saved = c.nt[i];
      if (!saved) continue;
      nt.tile[c.off] = saved.tile;
      nt.attrib[c.off] = saved.attrib;
    }
  }
  ctx.state.overlay = [];
}

function gameActive(mem: Uint8Array): boolean {
  const stage = mem[RAM.STAGE];
  return mem[RAM.ENEMIES_LEFT] !== 0xff && stage >= 1 && stage <= 35;
}

function applyOverlay(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  if (!gameActive(mem)) return;
  const names = normalizeNames(ctx.startOptions?.names);
  const nts = ctx.kernel.ppuNameTable;
  const pal = hudPalette(ctx);
  const applied = new Map<number, SavedCell>();
  for (const key of Object.keys(names)) {
    const port = Number(key);
    const flag = mem[RAM.TANK_FLAG + port];
    if (!(flag & 0x80) || flag >= 0xe0) continue; // только живой «на поле»
    const text = names[port];
    const row = (mem[RAM.TANK_Y + port] >> 3) - 1;
    if (row < 0 || row > 31) continue;
    const start = (mem[RAM.TANK_X + port] >> 3) - ((text.length - 1) >> 1);
    for (let i = 0; i < text.length; i++) {
      const col = start + i;
      if (col < 0 || col > 31) continue;
      const off = row * 32 + col;
      if (applied.has(off)) continue;
      const glyph = text.charCodeAt(i);
      const saved = nts.map((nt) => ({ tile: nt.tile[off], attrib: nt.attrib[off] }));
      for (const nt of nts) {
        nt.tile[off] = glyph;
        nt.attrib[off] = pal;
      }
      applied.set(off, { off, glyph, nt: saved });
    }
  }
  ctx.state.overlay = [...applied.values()];
}

export const playerNamesRuntime: FeatureRuntime = {
  init(ctx) {
    ctx.state.overlay = [];
  },

  postFrame(ctx) {
    restoreOverlay(ctx);
    applyOverlay(ctx);
  },

  // Overlay — производный визуал; в снапшот не должен попадать.
  beforeSaveState(ctx) {
    restoreOverlay(ctx);
  },
  afterSaveState(ctx) {
    applyOverlay(ctx);
  },

  onLoadState(ctx) {
    restoreOverlay(ctx);
  },
};

export default playerNamesRuntime;
