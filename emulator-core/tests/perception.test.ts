// perception.test.js — verification of the strategic battle perception layer.
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.ts";
import { perceive, threatToBase, enemyClass, isBlinkSpawn, BLINK_SPAWN_INDICES } from "../model/perception.ts";

// Field 32x32: empty, eagle at (15,26) by default.
function openField() {
  return Array.from({ length: 32 }, () => ".".repeat(32));
}

test("enemyClass — классификация по типу", () => {
  assert.strictEqual(enemyClass(0x80), "basic");
  assert.strictEqual(enemyClass(0xa0), "power");
  assert.strictEqual(enemyClass(0xc0), "fast");
  assert.strictEqual(enemyClass(0xe3), "armor");
  assert.strictEqual(enemyClass(0x00), "basic");
});

test("BLINK_SPAWN_INDICES / isBlinkSpawn — мигающие 4/11/18", () => {
  assert.deepStrictEqual(BLINK_SPAWN_INDICES, [4, 11, 18]);
  assert.ok(isBlinkSpawn(4));
  assert.ok(isBlinkSpawn(11));
  assert.ok(isBlinkSpawn(18));
  assert.ok(!isBlinkSpawn(5));
});

test("threatToBase — больше угрозы при большей близости/скорости/LOS", () => {
  // close fast with LOS to the base
  const near = threatToBase({ cls: "fast", dBase: 3, losBase: true, pathCost: 3 });
  // far slow without LOS
  const far = threatToBase({ cls: "basic", dBase: 20, losBase: false, pathCost: 20 });
  assert.ok(near > far, "близкий быстрый враг опаснее далёкого медленного");
  // close fast without LOS is more dangerous than the same without speed/LOS
  const noLos = threatToBase({ cls: "basic", dBase: 3, losBase: false, pathCost: 3 });
  assert.ok(near > noLos);
});

test("perceive — строит согласованную картину", () => {
  const field = openField();
  // enemies: fast near the base, armor far away, flashing
  const s = buildState({
    field,
    tanks: [
      { i: 2, x: 112, y: 200, team: "ATT", type: 0xc0 },  // (14,25) near the eagle (15,26)
      { i: 3, x: 16, y: 16, team: "ATT", type: 0xe3 },    // (2,2) far away
      { i: 4, x: 120, y: 208, team: "ATT", type: 0x84 },  // flashing normal (15,26) on the eagle
    ],
  });
  const p = perceive(s);
  assert.strictEqual(p.enemies.length, 3);
  assert.strictEqual(p.base.col, 15);
  assert.strictEqual(p.base.row, 26);

  // the fast enemy must have the greatest threat (close to the base)
  const fast = p.enemies.find((e) => e.cls === "fast");
  const armor = p.enemies.find((e) => e.cls === "armor");
  assert.ok(fast.threatToBase > armor.threatToBase);

  // the flashing one is classified
  const flash = p.enemies.find((e) => e.flashing);
  assert.ok(flash);
  assert.strictEqual(flash.hitsLeft, 1);
});

test("perceive — очередь спавна (nextBlink)", () => {
  const s = buildState({ field: openField(), tanks: [] });
  // spawnCount=20 → spawned=0 → the next flashing = 4
  assert.strictEqual(perceive(s).spawn.nextBlink, 4);
  // spawned 3 (remaining 17) → next 4; spawned 4 (remaining 16) → 11
  s.mem[0x7f] = 17;
  assert.strictEqual(perceive(s).spawn.nextBlink, 4);
  s.mem[0x7f] = 16;
  assert.strictEqual(perceive(s).spawn.nextBlink, 11);
  s.mem[0x7f] = 3;
  assert.strictEqual(perceive(s).spawn.nextBlink, 18);
  s.mem[0x7f] = 1;
  assert.strictEqual(perceive(s).spawn.nextBlink, null);
});

test("perceive — модель пуль (скорость/траектория)", () => {
  const s = buildState({
    field: openField(),
    tanks: [{ i: 2, x: 8, y: 8, team: "ATT", type: 0xc0 }],
    bullets: [{ i: 2, x: 8, y: 8, dir: 2 }], // down, owner fast → 4px
  });
  const p = perceive(s);
  assert.strictEqual(p.bullets.length, 1);
  assert.strictEqual(p.bullets[0].speed, 4);
  assert.ok(p.bullets[0].cells.length > 0);
  assert.strictEqual(p.bullets[0].cells[0].col, 1);
  assert.strictEqual(p.bullets[0].cells[0].row, 2); // bullet at (1,1), next cell down
});

test("perceive — защитники: уровень/жизни/каска/стан/лёд", () => {
  const field = openField();
  field[26] = "I".repeat(26) + "E" + "I".repeat(5); // ice around the eagle? no, eagle at (26? )
  const s = buildState({
    field,
    tanks: [
      { i: 0, x: 8, y: 208, team: "DEF", type: 0x60 }, // (1,26) on ice
      { i: 1, x: 88, y: 216, team: "DEF", type: 0x00 },
    ],
  });
  s.mem[0x51] = 3; s.mem[0x52] = 2;
  s.mem[0x0101] = 2;
  s.mem[0x89] = 1; // player 0 helmet
  const p = perceive(s.refresh());
  assert.strictEqual(p.defenders.length, 2);
  assert.strictEqual(p.defenders[0].level, 2);
  assert.strictEqual(p.defenders[0].lives, 3);
  assert.strictEqual(p.defenders[1].lives, 2);
  assert.strictEqual(p.defenders[0].helmet, true);
  assert.strictEqual(p.defenders[1].helmet, false);
  // ice: tank 0 at (1,26) — let's check the tile classification
  assert.strictEqual(p.tileType(1, 26), "ice");
});

test("perceive — intercept: точка пересечения пули", () => {
  const s = buildState({
    field: openField(),
    tanks: [{ i: 2, x: 8, y: 8, team: "ATT", type: 0x80 }],
    bullets: [{ i: 2, x: 8, y: 8, dir: 2 }], // down column 1
  });
  const p = perceive(s);
  const b = p.bullets[0];
  const shotFrom = { col: 3, row: 0 };
  const inter = p.intercept(shotFrom, b);
  assert.ok(inter, "есть точка перехвата на линии колонки 1");
  assert.strictEqual(inter.col, 1);
});
