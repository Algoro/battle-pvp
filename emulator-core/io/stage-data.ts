// stage-data.js — разбор данных стадий Battle City из образа ROM (в памяти).
//
// Данные стадий: tbl_F07A_stage_data, 35 стадий по 91 байту (0x5B).
// Каждая стадия — 13x13 = 169 блоков, упакованных по 2 блока в байт
// (чётный индекс — старший ниббл, нечётный — младший). ВАЖНО: в каждой строке
// расходуется 14 ниббл-позиций (13 блоков + 1 пропуск) = 7 байт, итого 13*7 = 91.
// Идентификатор блока (ниббл) -> 4 тайла CHR: tbl_DACB_block_data (16 * 4 байта).
// Идентификатор блока -> атрибут (палитра): tbl_DABB_nametable_attribute (16 байт).
//
// Относительный путь: ./emulator-core/io/stage-data.js

export const STAGE_COUNT = 35;
export const STAGE_COLS = 13;
export const STAGE_ROWS = 13;
export const STAGE_BLOCKS = STAGE_COLS * STAGE_ROWS; // 169
export const STAGE_STRIDE = 91;

import { ROM as ROM_ADDR } from "../rom-contract.ts";

const CPU_STAGE_TABLE = ROM_ADDR.STAGE_TABLE;
const CPU_BLOCK_ATTR = ROM_ADDR.BLOCK_ATTR;
const CPU_BLOCK_TILES = ROM_ADDR.BLOCK_TILES;

// CPU-адрес -> offset в PRG-банке 0 (NROM-128, окно $8000/$C000 зеркалится).
function prgOffset(cpuAddr: number): number {
  return cpuAddr & 0x3fff;
}

/** Нормализовать номер стадии в 1..35 (как в ROM: >35 идут по второму кругу). */
export function normalizeStage(stage: number): number {
  let s = Math.floor(Number(stage) || 1);
  if (s < 1) s = 1;
  if (s > STAGE_COUNT) s = ((s - 1) % STAGE_COUNT) + 1;
  return s;
}

/** Байты стадии (91 байт) из PRG-банка ROM. */
export function readStageBytes(rom: any, stage: number): Uint8Array {
  const s = normalizeStage(stage);
  const bank = rom.rom[0];
  const base = prgOffset(CPU_STAGE_TABLE) + (s - 1) * STAGE_STRIDE;
  return bank.subarray(base, base + STAGE_STRIDE);
}

/** 169 идентификаторов блоков (13x13, построчно; 14 ниббл/строку с пропуском). */
export function readStageBlocks(rom: any, stage: number): Uint8Array {
  const bytes = readStageBytes(rom, stage);
  const blocks = new Uint8Array(STAGE_BLOCKS);
  for (let row = 0; row < STAGE_ROWS; row++) {
    for (let col = 0; col < STAGE_COLS; col++) {
      const i = row * 14 + col;
      const b = bytes[i >> 1];
      blocks[row * STAGE_COLS + col] = (i & 1) === 0 ? b >> 4 : b & 0x0f;
    }
  }
  return blocks;
}

/** 4 индекса тайлов CHR для блока (TL, TR, BL, BR). */
export function readBlockTiles(rom: any, blockId: number): number[] {
  const bank = rom.rom[0];
  const base = prgOffset(CPU_BLOCK_TILES) + (blockId & 0x0f) * 4;
  return [bank[base], bank[base + 1], bank[base + 2], bank[base + 3]];
}

/** Атрибут (палитра) блока. */
export function readBlockAttribute(rom: any, blockId: number): number {
  return rom.rom[0][prgOffset(CPU_BLOCK_ATTR) + (blockId & 0x0f)];
}

/** Полное описание стадии: блоки + тайлы/атрибуты для рендера. */
export function readStage(rom: any, stage: number) {
  const s = normalizeStage(stage);
  const blocks = readStageBlocks(rom, s);
  const tiles = new Uint8Array(STAGE_BLOCKS * 4);
  const attrs = new Uint8Array(STAGE_BLOCKS);
  for (let i = 0; i < STAGE_BLOCKS; i++) {
    const id = blocks[i];
    const t = readBlockTiles(rom, id);
    tiles.set(t, i * 4);
    attrs[i] = readBlockAttribute(rom, id);
  }
  return { stage: s, cols: STAGE_COLS, rows: STAGE_ROWS, blocks, tiles, attrs };
}

export const STAGE_CPU = {
  stageTable: CPU_STAGE_TABLE,
  blockAttr: CPU_BLOCK_ATTR,
  blockTiles: CPU_BLOCK_TILES,
};
