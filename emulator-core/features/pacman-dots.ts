// pacman-dots.ts — JS-рантайм режима «Pac-Man»: точки, сбор, счётчик, победа, бомбы.
//
// Точки/бомбы перерисовываются в nametable КАЖДЫЙ кадр из JS-множества — это перекрывает
// любые перерисовки поля игрой и даёт стабильный вид/сбор. Источник истины — ctx.state.dots
// (несъеденные); после loadState множество восстанавливается по nametable.
//
// Уровень-лабиринт и замуровка базы — ROM-патч `pacman`.
//
// Относительный путь: ./emulator-core/features/pacman-dots.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS, isTankActive } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";
import { DOT_TILE, dotCells, BOMBS } from "./pacman-maze.ts";

const HUD_OFF = 5 * 32 + 12; // "STAGE" в nametable $28AC
const DOT_CELLS = dotCells();

function hudPalette(ctx: FeatureContext): number {
  for (const nt of ctx.kernel.ppuNameTable) {
    const t = nt.tile[HUD_OFF];
    if (t >= 0x41 && t <= 0x5a) return nt.attrib[HUD_OFF] & 0x0c;
  }
  return 0;
}

// Палитра для иконки приза: BG-палитра, ближайшая к спрайтовой палитре 2 (которой ROM
// рисует приз-спрайт). У BG цвет 0 — общий фон, сравниваем цвета 1..3.
function bombPalette(ctx: FeatureContext): number {
  const v = ctx.kernel.ppuVram;
  const spr2 = [1, 2, 3].map((k) => v[0x3f18 + k] & 0x3f); // sprite palette 2 = $3F18
  let best = 0;
  let bestScore = -1;
  for (let j = 0; j < 4; j++) {
    const bg = [1, 2, 3].map((k) => v[0x3f00 + 4 * j + k] & 0x3f);
    const score = bg.reduce((acc, c, i) => acc + (c === spr2[i] ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return (best << 2) & 0x0c;
}

function rebuildDots(ctx: FeatureContext): Set<number> {
  const left = new Set<number>();
  for (const off of DOT_CELLS) if (ctx.kernel.ppuNameTable[0].tile[off] === DOT_TILE) left.add(off);
  ctx.state.dots = left;
  return left;
}

function renderDots(ctx: FeatureContext, pal: number): void {
  const dots: Set<number> = ctx.state.dots;
  const nts = ctx.kernel.ppuNameTable;
  for (const off of DOT_CELLS) {
    const has = dots.has(off);
    const tile = has ? DOT_TILE : 0;
    for (const nt of nts) {
      nt.tile[off] = tile;
      if (has) nt.attrib[off] = pal;
      else if (nt.attrib[off] === pal) nt.attrib[off] = 0;
    }
  }
}

// Бомбы рисуются BG-тайлами 2×2 (иконка приза в CHR разбита на 4 квадранта):
// base = 0x81 + id*4; верх [base-1, base+1], низ [base, base+2].
// OAM не годится — игра каждый кадр затирает его DMA.
function renderBombsBG(ctx: FeatureContext): void {
  const nts = ctx.kernel.ppuNameTable;
  const bombs = ctx.state.bombs as { off: number; id: number; taken: boolean }[];
  const flash = Math.floor(ctx.frame / 8) % 2 === 0;
  const pal = bombPalette(ctx);
  for (const b of bombs) {
    const base = 0x81 + b.id * 4;
    const show = !b.taken && flash;
    const t = [base - 1, base + 1, base, base + 2]; // TL, TR, BL, BR
    const cells = [b.off, b.off + 1, b.off + 32, b.off + 33];
    for (let k = 0; k < 4; k++) {
      for (const nt of nts) {
        nt.tile[cells[k]] = show ? t[k] & 0xff : 0;
        if (show) nt.attrib[cells[k]] = pal;
      }
    }
  }
}

// Сбор: хитбокс точки — целый блок 16×16 (пересечение прямоугольника танка и блока).
function collect(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const dots: Set<number> = ctx.state.dots;
  let picked = 0;
  for (let t = 0; t < DEF_PORTS; t++) {
    if (!isTankActive(mem[RAM.TANK_FLAG + t])) continue;
    const x0 = mem[RAM.TANK_X + t];
    const y0 = mem[RAM.TANK_Y + t];
    const x1 = x0 + 15;
    const y1 = y0 + 15;
    for (const off of dots) {
      const col = off % 32;
      const row = (off / 32) | 0;
      const bx0 = col * 8;
      const by0 = row * 8;
      const bx1 = bx0 + 15;
      const by1 = by0 + 15;
      if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) continue;
      dots.delete(off);
      picked++;
    }
  }
  if (picked > 0) {
    // «вака-вака»: чередуем два КОРОТКИХ звука ROM (выстрел / попадание в танк)
    const alt = ctx.state.sfxAlt as boolean;
    ctx.kernel.mem[alt ? RAM.SFX_BULLET_HIT_TANK : RAM.SFX_SHOT] = 1;
    ctx.state.sfxAlt = !alt;
  }
}

function pickBombs(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const bombs = ctx.state.bombs as { off: number; id: number; taken: boolean }[];
  for (const b of bombs) {
    if (b.taken) continue;
    const bx0 = (b.off % 32) * 8;
    const by0 = ((b.off / 32) | 0) * 8;
    const bx1 = bx0 + 15;
    const by1 = by0 + 15;
    for (let t = 0; t < DEF_PORTS; t++) {
      if (!isTankActive(mem[RAM.TANK_FLAG + t])) continue;
      const x0 = mem[RAM.TANK_X + t];
      const y0 = mem[RAM.TANK_Y + t];
      if (x0 + 15 < bx0 || x0 > bx1 || y0 + 15 < by0 || y0 > by1) continue;
      b.taken = true;
      // Выдаём настоящий ROM-приз у танка (дальше эффект применяет штатная логика).
      // Не блокируемся активным призом — перезаписываем (иначе бомбу «не взять»).
      mem[RAM.PRIZE_X] = x0;
      mem[RAM.PRIZE_Y] = y0;
      mem[RAM.PRIZE_ID] = b.id;
      mem[RAM.BONUS_TIMER] = 0;
      mem[RAM.SFX_BONUS_APPEAR] = 1;
      break;
    }
  }
}

export const pacmanDotsRuntime: FeatureRuntime = {
  init(ctx) {
    ctx.state.seededStage = -1;
    ctx.state.dots = new Set<number>();
    ctx.state.sfxAlt = false;
    ctx.state.bombs = BOMBS.map((b) => ({ off: b.off, id: b.id, taken: false }));
  },

  // Рендер ДО ROM-кадра: если игра перетирает nametable в кадре, следующий preFrame
  // всё равно успеть не может, но так кадр рисуется с точками/бомбами без задержки.
  preFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return;
    const stage = mem[RAM.STAGE];
    if (ctx.state.seededStage !== stage) return;
    const pal = hudPalette(ctx);
    renderDots(ctx, pal);
    renderBombsBG(ctx);
  },

  postFrame(ctx) {
    const mem = ctx.kernel.mem;
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    const stage = mem[RAM.STAGE];
    if (stage < 1 || stage > 35) return;
    if (ctx.state.seededStage !== stage) {
      ctx.state.dots = new Set<number>(DOT_CELLS);
      for (const b of ctx.state.bombs as { taken: boolean }[]) b.taken = false;
      ctx.state.seededStage = stage;
      mem[RAM.PACMAN_WIN] = 0;
    }
    collect(ctx);
    pickBombs(ctx);
    const pal = hudPalette(ctx);
    renderDots(ctx, pal);
    renderBombsBG(ctx);
    const left = (ctx.state.dots as Set<number>).size;
    mem[RAM.DOTS_LEFT] = left & 0xff;
    mem[RAM.DOTS_LEFT + 1] = (left >> 8) & 0xff;
    if (left === 0) mem[RAM.PACMAN_WIN] = 1;
  },

  onLoadState(ctx) {
    rebuildDots(ctx);
  },
};

export default pacmanDotsRuntime;
