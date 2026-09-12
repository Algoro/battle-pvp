// td-levels.ts — конструктор уровней tower defence.
//
// Геометрия и карты вынесены в `shared/tower-defence.ts`, чтобы фронтенд (редактор
// расстановки) и рантайм пользовались одним источником без импорта emulator-core.
// Модуль оставлен точкой входа emulator-core и ре-экспортирует общие функции.
//
// Относительный путь: ./emulator-core/features/td-levels.ts
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
