// tower-defence.test.ts — общая геометрия/данные режима TD (используются UI и ядром).
import { test } from "node:test";
import assert from "node:assert";
import {
  TD_MAPS,
  TD_MAP_LIST,
  TD_SIZE,
  TOWER_TYPES,
  towerById,
  towerStats,
  tdMapStage,
  tdBuildableCells,
  tdSpawnCells,
  isBaseCell,
  isWallBlock,
  pointsForTankType,
  difficultyById,
  TD_DEFAULT_CONFIG,
} from "../../shared/tower-defence.ts";

test("td-shared: карты задокументированы и стадии совпадают", () => {
  assert.strictEqual(TD_MAPS.length, TD_MAP_LIST.length);
  TD_MAP_LIST.forEach((m, i) => {
    assert.strictEqual(tdMapStage(m.id), i + 1);
    assert.strictEqual(TD_MAPS[i].id, m.id);
  });
  for (const map of TD_MAPS) {
    assert.strictEqual(map.rows.length, TD_SIZE);
    for (const row of map.rows) assert.strictEqual(row.length, TD_SIZE);
  }
});

test("td-shared: строимые клетки — пол вне базы и спавнов", () => {
  for (const map of TD_MAPS) {
    const buildable = tdBuildableCells(map);
    assert.ok(buildable.length > 20);
    const spawns = new Set(tdSpawnCells(map));
    for (const cell of buildable) {
      const r = (cell / TD_SIZE) | 0;
      const c = cell % TD_SIZE;
      assert.strictEqual(isWallBlock(map, r, c), false);
      assert.strictEqual(isBaseCell(r, c), false);
      assert.ok(!spawns.has(cell));
    }
  }
});

test("td-shared: типы башен корректны, апгрейд усиливает", () => {
  assert.ok(TOWER_TYPES.length >= 3);
  for (const t of TOWER_TYPES) {
    assert.ok(t.cost > 0 && t.damage > 0 && t.range > 0 && t.hp > 0);
    assert.ok(towerById(t.id));
    const s0 = towerStats(t, 0);
    const s1 = towerStats(t, 1);
    assert.ok(s1.damage >= s0.damage && s1.range >= s0.range && s1.hp >= s0.hp);
    assert.ok(s1.fireInterval <= s0.fireInterval);
  }
  assert.strictEqual(towerById("nope"), null);
});

test("td-shared: очки за типы и сложности", () => {
  assert.strictEqual(pointsForTankType(0x80), 100);
  assert.strictEqual(pointsForTankType(0xe0), 400);
  assert.strictEqual(pointsForTankType(0x84), 500); // бонусный
  assert.strictEqual(difficultyById("nope").id, TD_DEFAULT_CONFIG.difficulty);
});
