// water.ts — pond depth for `meine-tank`: every connected body of water gets a whole-block
// depth derived from its area (a larger pond is deeper). Pure and read-only.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/water.ts
import { isWater } from "@core/domain.ts";
import type { RenderBounds } from "../../../types.ts";
import type { BlockDef } from "./blocks.ts";

/** Depth in full blocks for a pond of `area` tiles (1..4). */
export function depthForArea(area: number): number {
  if (area <= 1) return 1;
  return Math.max(1, Math.min(4, Math.round(Math.sqrt(area))));
}

/** Water surface sits a little below the arena level, like a Minecraft source block. */
export const WATER_SURFACE_INSET = 0.1;

/** A pond block: `depth` whole blocks sunk below the arena surface. */
export function waterBlock(base: BlockDef, depth: number): BlockDef {
  return { ...base, y0: -depth, h: depth - WATER_SURFACE_INSET };
}

/**
 * Depth (in blocks) for every water tile, indexed by the same `row*32+col` layout as the
 * collision buffer. Cells of one connected pond share the depth; non-water cells stay 0.
 */
export function computeWaterDepths(field: Uint8Array, bounds: RenderBounds): Uint8Array {
  const depths = new Uint8Array(32 * 32);
  const seen = new Uint8Array(32 * 32);
  const stack: number[] = [];
  const { col0, row0, cols, rows } = bounds;
  const lastCol = col0 + cols - 1;
  const lastRow = row0 + rows - 1;

  for (let r = row0; r <= lastRow; r++) {
    for (let c = col0; c <= lastCol; c++) {
      const start = r * 32 + c;
      if (seen[start] || !isWater(field[start])) continue;
      const cells: number[] = [];
      stack.length = 0;
      stack.push(start);
      seen[start] = 1;
      while (stack.length) {
        const idx = stack.pop()!;
        cells.push(idx);
        const cc = idx & 31;
        const rr = (idx - cc) / 32;
        if (cc > col0) {
          const n = idx - 1;
          if (!seen[n] && isWater(field[n])) {
            seen[n] = 1;
            stack.push(n);
          }
        }
        if (cc < lastCol) {
          const n = idx + 1;
          if (!seen[n] && isWater(field[n])) {
            seen[n] = 1;
            stack.push(n);
          }
        }
        if (rr > row0) {
          const n = idx - 32;
          if (!seen[n] && isWater(field[n])) {
            seen[n] = 1;
            stack.push(n);
          }
        }
        if (rr < lastRow) {
          const n = idx + 32;
          if (!seen[n] && isWater(field[n])) {
            seen[n] = 1;
            stack.push(n);
          }
        }
      }
      const depth = depthForArea(cells.length);
      for (const idx of cells) depths[idx] = depth;
    }
  }
  return depths;
}

export default { computeWaterDepths, depthForArea, waterBlock };
