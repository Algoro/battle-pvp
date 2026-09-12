// td-levels.test.ts — конструктор TD-уровней: ASCII 13×13 -> байты стадии ROM,
// связность коридоров, спавны/база, строимые клетки.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";
import {
  TD_MAPS,
  TD_SIZE,
  BLOCK_WALL,
  BLOCK_EMPTY,
  buildTdStageBytes,
  isConnected,
  isWallBlock,
  isBaseCell,
  tdSpawnCells,
  tdBuildableCells,
} from "../features/td-levels.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

test("td-levels: каждая карта 13×13, спавны наверху, связный путь до базы", () => {
  for (const map of TD_MAPS) {
    assert.strictEqual(map.rows.length, TD_SIZE, `${map.id}: число строк`);
    for (const row of map.rows) assert.strictEqual(row.length, TD_SIZE, `${map.id}: ширина строки`);
    const spawns = tdSpawnCells(map).map((k) => k % TD_SIZE);
    assert.deepStrictEqual(spawns, [0, 6, 12], `${map.id}: спавны ATT`);
    for (let c = 5; c <= 7; c++) {
      assert.strictEqual(isWallBlock(map, 11, c), false, `${map.id}: зона базы не должна быть стеной`);
      assert.strictEqual(isWallBlock(map, 12, c), false, `${map.id}: зона базы не должна быть стеной`);
    }
    assert.ok(isConnected(map), `${map.id}: нет связного пути от верха до базы`);
  }
});

test("td-levels: buildTdStageBytes даёт 91 байт и раскладывается обратно", () => {
  for (const map of TD_MAPS) {
    const bytes = buildTdStageBytes(map);
    assert.strictEqual(bytes.length, 91, `${map.id}: длина стадии`);
    for (let r = 0; r < TD_SIZE; r++) {
      for (let c = 0; c < TD_SIZE; c++) {
        const i = r * 14 + c;
        const b = bytes[i >> 1];
        const code = (i & 1) === 0 ? b >> 4 : b & 0x0f;
        assert.strictEqual(code, isWallBlock(map, r, c) ? BLOCK_WALL : BLOCK_EMPTY, `${map.id} ${r},${c}`);
      }
    }
  }
});

test("td-levels: ROM-патч записывает TD-карты в стадии 1..3", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: ["tower-defence"] });
  emu.loadROM(ROM);
  TD_MAPS.forEach((map, i) => {
    const blocks = emu.getStageBlocks(i + 1);
    for (let r = 0; r < TD_SIZE; r++) {
      for (let c = 0; c < TD_SIZE; c++) {
        assert.strictEqual(blocks[r * TD_SIZE + c], isWallBlock(map, r, c) ? BLOCK_WALL : BLOCK_EMPTY, `${map.id} ${r},${c}`);
      }
    }
  });
});

test("td-levels: строимые клетки — пол вне зоны базы и спавнов", () => {
  for (const map of TD_MAPS) {
    const cells = tdBuildableCells(map);
    assert.ok(cells.length > 20, `${map.id}: слишком мало строимых клеток`);
    const spawns = new Set(tdSpawnCells(map));
    for (const k of cells) {
      const r = (k / TD_SIZE) | 0,
        c = k % TD_SIZE;
      assert.strictEqual(isWallBlock(map, r, c), false, `${map.id}: башня на стене ${r},${c}`);
      assert.strictEqual(isBaseCell(r, c), false, `${map.id}: башня в зоне базы ${r},${c}`);
      assert.strictEqual(spawns.has(k), false, `${map.id}: башня на спавне ${r},${c}`);
    }
  }
});
