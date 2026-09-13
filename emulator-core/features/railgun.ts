// railgun.ts — shared JS super-weapon effect (beam), used by feature runtimes.
//
// Extracted from pvp.ts so both `pistol` (DEF players) and
// `enemy-prizes` (an enemy that picked up a pistol) can use it. It works only through FeatureContext;
// the authoritative state is RAM; the beam explosion queue ctx.state.beamFx is visual.
//
// Relative path: ./emulator-core/features/railgun.ts
import { RAM } from "../rom-contract.ts";
import { PISTOL_BEAM_HALF, NUM_PLAYERS, DEF_PORTS, isEagleTile, isRoad } from "../domain.ts";
import type { FeatureContext } from "../patching/runtime.ts";

// Explosion animation tiles (like the tank): sub_DEE2 gives 0xF1/0xF5/0xF9.
export const BEAM_FX_TILES = [0xf1, 0xf5, 0xf9];

export function initRailgunFx(ctx: FeatureContext): void {
  ctx.state.beamFx = [];
}

export function resetRailgunFx(ctx: FeatureContext): void {
  if (ctx.state.beamFx) ctx.state.beamFx.length = 0;
}

// Destroy a tile: field (collision) + nametable (render).
function clearTile(ctx: FeatureContext, off: number): void {
  const mem = ctx.kernel.mem;
  mem[RAM.FIELD + off] = 0;
  for (const nt of ctx.kernel.ppuNameTable) nt.tile[off] = 0;
}

// Kill living tanks standing in the cell (col,row). Allies die too.
function killTanksAt(ctx: FeatureContext, col: number, row: number): void {
  const mem = ctx.kernel.mem;
  for (let tt = 0; tt < NUM_PLAYERS; tt++) {
    const flag = mem[RAM.TANK_FLAG + tt];
    if (!(flag & 0x80) || flag >= 0xe0) continue; // only "on field"
    if ((mem[RAM.TANK_X + tt] >> 3) !== col || (mem[RAM.TANK_Y + tt] >> 3) !== row) continue;
    mem[RAM.TANK_FLAG + tt] = 0x73; // con_tank_flag_explosion + 3
    mem[RAM.TANK_TYPE + tt] = 0;
    if (tt < DEF_PORTS) {
      mem[RAM.TANK_UPGRADE + tt] = 0;
      mem[RAM.PISTOL + tt] = 0;
      mem[RAM.PISTOL_AMMO + tt] = 0;
    }
    mem[RAM.SFX_EXPLOSION_ENEMY] = 1;
  }
}

// Remove bullets located in the cell (col,row).
function clearBulletsAt(ctx: FeatureContext, col: number, row: number): void {
  const mem = ctx.kernel.mem;
  for (let b = 0; b < 10; b++) {
    if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== 0x40) continue;
    if ((mem[RAM.BULLET_X + b] >> 3) !== col || (mem[RAM.BULLET_Y + b] >> 3) !== row) continue;
    mem[RAM.BULLET_STATUS + b] = 0;
  }
}

// Destroy the HQ (your own base too): destroyed-eagle tiles + defeat.
function destroyHq(ctx: FeatureContext): void {
  const mem = ctx.kernel.mem;
  const base = 26 * 32 + 14; // fixed base position (see sub_CC08)
  const tiles = [[0, 0xcc], [1, 0xce], [32, 0xcd], [33, 0xcf]];
  for (const [d, v] of tiles) {
    mem[RAM.FIELD + base + d] = v;
    for (const nt of ctx.kernel.ppuNameTable) nt.tile[base + d] = v;
  }
  mem[RAM.GAME_OVER] = 0x27; // defeat timer (like a normal bullet hitting the eagle)
  mem[RAM.SFX_EXPLOSION_HQ] = 1;
  mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
}

// Process one beam cell: tile/tanks/bullets. true — hit the HQ.
function beamCell(ctx: FeatureContext, col: number, row: number): boolean {
  const mem = ctx.kernel.mem;
  const off = row * 32 + col;
  const tile = mem[RAM.FIELD + off];
  if ((tile & 0xfc) === 0xc8) {
    destroyHq(ctx);
    return true;
  }
  // The beam destroys everything except empty, road, and HQ: brick, steel, water, ice, bushes.
  // The `terrain:false` setting keeps the terrain, killing only tanks and bullets.
  if (ctx.options?.terrain !== false && tile !== 0 && !isEagleTile(tile) && !isRoad(tile)) {
    clearTile(ctx, off);
    const fx = ctx.state.beamFx as { x: number; y: number; age: number }[];
    if (fx.length < 128) fx.push({ x: col * 8 + 4, y: row * 8 + 4, age: 0 });
  }
  killTanksAt(ctx, col, row);
  clearBulletsAt(ctx, col, row);
  return false;
}

// Beam: burns a line to the field edge, destroying tiles, tanks, and bullets.
// The state (RAM) is deterministic and is part of saveState/rollback.
export function fireRailgun(ctx: FeatureContext, t: number): void {
  const mem = ctx.kernel.mem;
  const dir = mem[RAM.TANK_FLAG + t] & 3;
  const dx = [0, -1, 0, 1][dir];
  const dy = [-1, 0, 1, 0][dir];
  const px = dx === 0 ? 1 : 0;
  const py = dy === 0 ? 1 : 0;
  const rawHalf = Number(ctx.options?.beamHalf ?? PISTOL_BEAM_HALF);
  const H = Math.max(0, Math.min(3, Number.isFinite(rawHalf) ? Math.round(rawHalf) : PISTOL_BEAM_HALF)); // beam width = 2*H+1 tiles
  let col = mem[RAM.TANK_X + t] >> 3;
  let row = mem[RAM.TANK_Y + t] >> 3;
  for (let i = 0; i < 32; i++) {
    col += dx;
    row += dy;
    if (col < 0 || col > 31 || row < 0 || row > 31) break;
    let hitHq = false;
    for (let k = -H; k <= H; k++) {
      const c = col + px * k;
      const r = row + py * k;
      if (c < 0 || c > 31 || r < 0 || r > 31) continue;
      if (beamCell(ctx, c, r)) hitHq = true;
    }
    if (hitHq) break;
  }
  mem[RAM.SFX_SHOT] = 1;
}

// Render beam explosions into free OAM sprites (Y>=0xF0 — off-screen).
// Pure visualization: it does not write cpu.mem, so it doesn't affect hash/network.
export function renderRailgunFx(ctx: FeatureContext): void {
  const sm = ctx.kernel.ppuSpriteMem;
  const queue = ctx.state.beamFx as { x: number; y: number; age: number }[] | undefined;
  if (!queue || queue.length === 0) return;
  const free: number[] = [];
  for (let i = 0; i < 64; i++) if (sm[i * 4] >= 0xf0) free.push(i);

  const next: { x: number; y: number; age: number }[] = [];
  let fi = 0;
  for (const fx of queue) {
    if (fi + 1 >= free.length) {
      next.push(fx); // no room — show in the coming frames
      continue;
    }
    const T = BEAM_FX_TILES[Math.min(fx.age, BEAM_FX_TILES.length - 1)];
    const y = (fx.y - 8) & 0xff;
    const i0 = free[fi++];
    const i1 = free[fi++];
    sm[i0 * 4] = y; sm[i0 * 4 + 1] = T; sm[i0 * 4 + 2] = 0x03; sm[i0 * 4 + 3] = (fx.x - 8) & 0xff;
    sm[i1 * 4] = y; sm[i1 * 4 + 1] = (T + 2) & 0xff; sm[i1 * 4 + 2] = 0x03; sm[i1 * 4 + 3] = fx.x & 0xff;
    if (++fx.age < BEAM_FX_TILES.length) next.push(fx);
  }
  ctx.state.beamFx = next;
}
