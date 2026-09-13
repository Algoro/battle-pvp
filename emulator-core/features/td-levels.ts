// td-levels.ts — tower defence level constructor.
//
// The geometry and maps were moved to `shared/tower-defence.ts` so that the frontend (placement
// editor) and the runtime use a single source without importing emulator-core.
// The module is left as the emulator-core entry point and re-exports the shared functions.
//
// Relative path: ./emulator-core/features/td-levels.ts
export {
  TD_SIZE,
  TD_STRIDE,
  BLOCK_WALL,
  BLOCK_EMPTY,
  TD_BASE_R0,
  TD_BASE_R1,
  TD_BASE_C0,
  TD_BASE_C1,
  TD_MAPS,
  TD_MAP_IDS,
  tdMapById,
  tdMapStage,
  isBaseCell,
  isWallBlock,
  tdSpawnCells,
  tdBuildableCells,
  blockCode,
  buildTdStageBytes,
  isConnected,
} from "../../shared/tower-defence.ts";
export type { TdMapDef } from "../../shared/tower-defence.ts";

import {
  buildTdStageBytes,
  TD_MAPS,
  TD_MAP_IDS,
  tdMapById,
  tdBuildableCells,
  tdSpawnCells,
  isWallBlock,
} from "../../shared/tower-defence.ts";

export default {
  buildTdStageBytes,
  TD_MAPS,
  TD_MAP_IDS,
  tdMapById,
  tdBuildableCells,
  tdSpawnCells,
  isWallBlock,
};
