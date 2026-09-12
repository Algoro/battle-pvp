// blocks.ts — отображение тайлов поля Battle City в воксельные блоки (стиль sandbox).
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/world/blocks.ts
import { isBrick, isSteel, isWater, isIce, isTree, isRoad, isEagleTile } from "@core/domain.ts";

export type BlockPass = "opaque" | "cutout" | "water";

export interface BlockDef {
  pass: BlockPass;
  /** Низ/высота блока в юнитах (1 юнит = клетка поля). */
  y0: number;
  h: number;
  solid: boolean;
  top: string;
  side: string;
  bottom: string;
}

export const BLOCK: Record<string, BlockDef> = {
  brick: { pass: "opaque", y0: 0, h: 1, solid: true, top: "brick", side: "brick", bottom: "brick" },
  brickDamaged: { pass: "opaque", y0: 0, h: 0.62, solid: true, top: "brickCracked", side: "brickCracked", bottom: "brick" },
  steel: { pass: "opaque", y0: 0, h: 1, solid: true, top: "steel", side: "steel", bottom: "steel" },
  water: { pass: "water", y0: 0, h: 0.86, solid: false, top: "water", side: "water", bottom: "water" },
  ice: { pass: "water", y0: 0, h: 0.9, solid: true, top: "ice", side: "ice", bottom: "ice" },
  leaves: { pass: "cutout", y0: 0.5, h: 1, solid: false, top: "leaves", side: "leaves", bottom: "leaves" },
  path: { pass: "opaque", y0: 0, h: 0.16, solid: false, top: "path", side: "dirt", bottom: "dirt" },
  gravel: { pass: "opaque", y0: 0, h: 0.14, solid: false, top: "gravel", side: "gravel", bottom: "dirt" },
  frame: { pass: "opaque", y0: 0, h: 1.1, solid: true, top: "cobble", side: "cobble", bottom: "cobble" },
};

function popcount(v: number): number {
  let n = 0;
  for (let b = 0; b < 4; b++) if (v & (1 << b)) n++;
  return n;
}

/** Блок для значения тайла (или null = «воздух»/рисуется отдельной моделью). */
export function blockForTile(v: number): BlockDef | null {
  if (v === 0) return null;
  if (isBrick(v)) {
    const full = v === 0x0f || v === 0x13 || v === 0x14;
    if (full) return BLOCK.brick;
    const q = popcount(v & 0x0f);
    if (q === 0) return null;
    return { ...BLOCK.brickDamaged, h: 0.35 + 0.65 * (q / 4) };
  }
  if (isSteel(v)) return BLOCK.steel;
  if (isWater(v)) return BLOCK.water;
  if (isIce(v)) return BLOCK.ice;
  if (isTree(v)) return BLOCK.leaves;
  if (isEagleTile(v)) return null; // орёл — отдельная модель
  if (isRoad(v)) return BLOCK.path;
  return null;
}

/** Занятость блока на уровне y (для отсечения граней и AO). */
export function solidAt(def: BlockDef | null, y: number): boolean {
  return !!def && def.solid && y >= def.y0 - 1e-6 && y <= def.y0 + def.h + 1e-6;
}

export default { BLOCK, blockForTile, solidAt };
