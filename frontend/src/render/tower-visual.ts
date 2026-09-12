// tower-visual.ts — адаптация башни TD к модели танка для 3D-драйверов.
// Драйверы переиспользуют createTank/createVoxelTank: башня — неподвижный DEF-танк
// (звёзды = уровень апгрейда, «броня» = 2-й уровень).
//
// Относительный путь: ./frontend/src/render/tower-visual.ts
import { tankCenter } from "./coords.ts";
import type { GroundPoint } from "./coords.ts";
import type { RenderBounds, SceneTank, SceneTower } from "./types.ts";

export const TD_GRID = 13;

/** Центр блока клетки (r,c) в мировых юнитах: блок 16×16 px со смещением (16,16). */
export function towerCellCenter(b: RenderBounds, cell: number): GroundPoint {
  const c = cell % TD_GRID;
  const r = (cell / TD_GRID) | 0;
  return tankCenter(b, 24 + 16 * c, 24 + 16 * r);
}

/** Синтетический SceneTank для модели башни (индекс вне 0..7). */
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
