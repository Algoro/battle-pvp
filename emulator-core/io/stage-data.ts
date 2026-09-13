// stage-data.js — parsing Battle City stage data from the ROM image (in memory).
//
// Stage data: tbl_F07A_stage_data, 35 stages of 91 bytes each (0x5B).
// Each stage — 13x13 = 169 blocks packed two blocks per byte
// (even index — high nibble, odd — low). IMPORTANT: each row
// consumes 14 nibble positions (13 blocks + 1 skip) = 7 bytes, total 13*7 = 91.
// Block id (nibble) -> 4 CHR tiles: tbl_DACB_block_data (16 * 4 bytes).
// Block id -> attribute (palette): tbl_DABB_nametable_attribute (16 bytes).
//
// Relative path: ./emulator-core/io/stage-data.js

export const STAGE_COUNT = 35;
export const STAGE_COLS = 13;
export const STAGE_ROWS = 13;
export const STAGE_BLOCKS = STAGE_COLS * STAGE_ROWS; // 169
export const STAGE_STRIDE = 91;

import { ROM as ROM_ADDR } from "../rom-contract.ts";

const CPU_STAGE_TABLE = ROM_ADDR.STAGE_TABLE;
const CPU_BLOCK_ATTR = ROM_ADDR.BLOCK_ATTR;
const CPU_BLOCK_TILES = ROM_ADDR.BLOCK_TILES;

// CPU address -> offset in PRG bank 0 (NROM-128, window $8000/$C000 is mirrored).
function prgOffset(cpuAddr: number): number {
  return cpuAddr & 0x3fff;
}

/** Normalize the stage number to 1..35 (like the ROM: >35 go around a second time). */
export function normalizeStage(stage: number): number {
  let s = Math.floor(Number(stage) || 1);
  if (s < 1) s = 1;
  if (s > STAGE_COUNT) s = ((s - 1) % STAGE_COUNT) + 1;
  return s;
}

/** Stage bytes (91 bytes) from the ROM PRG bank. */
export function readStageBytes(rom: any, stage: number): Uint8Array {
  const s = normalizeStage(stage);
  const bank = rom.rom[0];
  const base = prgOffset(CPU_STAGE_TABLE) + (s - 1) * STAGE_STRIDE;
  return bank.subarray(base, base + STAGE_STRIDE);
}

/** 169 block ids (13x13, row by row; 14 nibbles/row with a skip). */
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

/** 4 CHR tile indices for a block (TL, TR, BL, BR). */
export function readBlockTiles(rom: any, blockId: number): number[] {
  const bank = rom.rom[0];
  const base = prgOffset(CPU_BLOCK_TILES) + (blockId & 0x0f) * 4;
  return [bank[base], bank[base + 1], bank[base + 2], bank[base + 3]];
}

/** Block attribute (palette). */
export function readBlockAttribute(rom: any, blockId: number): number {
  return rom.rom[0][prgOffset(CPU_BLOCK_ATTR) + (blockId & 0x0f)];
}

/** Full stage description: blocks + tiles/attributes for rendering. */
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
