// tower-visual.ts — adapting a TD tower to the tank model for 3D drivers.
// Drivers reuse createTank/createVoxelTank: the tower is a stationary DEF tank
// (stars = upgrade level, "armor" = 2nd level).
//
// Relative path: ./frontend/src/render/tower-visual.ts
import { tankCenter } from "./coords.ts";
import type { GroundPoint } from "./coords.ts";
import type { RenderBounds, SceneTank, SceneTower } from "./types.ts";

export const TD_GRID = 13;

/** Center of cell block (r,c) in world units: block 16×16 px with offset (16,16). */
export function towerCellCenter(b: RenderBounds, cell: number): GroundPoint {
  const c = cell % TD_GRID;
  const r = (cell / TD_GRID) | 0;
  return tankCenter(b, 24 + 16 * c, 24 + 16 * r);
}

/** Synthetic SceneTank for the tower model (index outside 0..7). */
export function towerToSceneTank(tw: SceneTower, index: number): SceneTank {
  const level = Math.max(0, Math.min(2, tw.level | 0));
  return {
    index: 100 + index,
    team: "DEF",
    x: 0,
    y: 0,
    dir: (tw.dir & 3) as 0 | 1 | 2 | 3,
    state: "alive",
    type: 0x80,
    moving: false,
    stars: level as 0 | 1 | 2 | 3,
    lives: null,
    helmet: tw.hp < tw.maxHp,
    stunned: false,
    onIce: false,
    flashing: false,
    armored: level >= 2,
    fast: false,
  };
}
