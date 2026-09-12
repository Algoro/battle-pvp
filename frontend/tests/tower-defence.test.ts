// tower-defence.test.ts — общая геометрия/данные режима TD (используются UI и ядром).
import { test } from "node:test";
import assert from "node:assert";
import {
  TD_MAPS,
  TD_MAP_LIST,
  TD_SIZE,
  TD_WAVES,
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
import { readScene, readSceneFromMem } from "../src/render/scene-state.ts";
import { RAM } from "@core/rom-contract.ts";

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

test("td-shared: волны задают корректные типы врагов", () => {
  const allowed = new Set([0x80, 0xa0, 0xc0, 0xe0]);
  for (const w of TD_WAVES) {
    assert.ok(w.types.length > 0, "у волны должна быть очередь типов");
    for (const t of w.types) assert.ok(allowed.has(t & 0xf0), `неизвестный тип ${t.toString(16)}`);
  }
  assert.ok(TD_WAVES.some((w) => w.types.some((t) => (t & 0xf0) === 0xe0)), "нет бронированных врагов");
  assert.ok(TD_WAVES[0].types.includes(0xa0), "в первой волне ожидается быстрая пуля");
});

test("td-render: башни попадают в SceneState (3D-драйверы)", () => {
  const mem = new Uint8Array(0x10000);
  mem[RAM.ENEMIES_LEFT] = 20;
  mem[RAM.GAME_OVER] = 0x80;
  mem[RAM.PRIZE_ID] = 0xff;
  const towers = [{ cell: 27, type: "gun", level: 1, hp: 2, maxHp: 3, dir: 3 as const }];
  const direct = readSceneFromMem(mem, 7, null, towers);
  assert.deepStrictEqual(direct.towers, towers);

  const fake: any = {
    getFeatureState: (id: string) => (id === "tower-defence" ? { towers } : null),
    nes: { cpu: { mem }, _frame: 3, ppu: { buffer: null } },
  };
  const viaEmu = readScene(fake);
  assert.strictEqual(viaEmu.towers.length, 1);
  assert.strictEqual(viaEmu.towers[0].cell, 27);
  assert.strictEqual(viaEmu.towers[0].dir, 3);
});
