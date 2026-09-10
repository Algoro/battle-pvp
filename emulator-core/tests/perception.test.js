// perception.test.js — проверка стратегического слоя восприятия боя.
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.js";
import { perceive, threatToBase, enemyClass, isBlinkSpawn, BLINK_SPAWN_INDICES } from "../model/perception.js";

// Поле 32x32: пустое, орёл на (15,26) по умолчанию.
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
  // близкий fast с LOS к базе
  const near = threatToBase({ cls: "fast", dBase: 3, losBase: true, pathCost: 3 });
  // далёкий slow без LOS
  const far = threatToBase({ cls: "basic", dBase: 20, losBase: false, pathCost: 20 });
  assert.ok(near > far, "близкий быстрый враг опаснее далёкого медленного");
  // близкий fast без LOS опаснее, чем тот же без скорости/LOS
  const noLos = threatToBase({ cls: "basic", dBase: 3, losBase: false, pathCost: 3 });
  assert.ok(near > noLos);
});

test("perceive — строит согласованную картину", () => {
  const field = openField();
  // враги: fast вблизи базы, armor вдали, мигающий
  const s = buildState({
    field,
    tanks: [
      { i: 2, x: 112, y: 200, team: "ATT", type: 0xc0 },  // (14,25) у орла (15,26)
      { i: 3, x: 16, y: 16, team: "ATT", type: 0xe3 },    // (2,2) далеко
      { i: 4, x: 120, y: 208, team: "ATT", type: 0x84 },  // мигающий обычный (15,26) на орле
    ],
  });
  const p = perceive(s);
  assert.strictEqual(p.enemies.length, 3);
  assert.strictEqual(p.base.col, 15);
  assert.strictEqual(p.base.row, 26);

  // fast враг должен иметь наибольшую угрозу (близко к базе)
  const fast = p.enemies.find((e) => e.cls === "fast");
  const armor = p.enemies.find((e) => e.cls === "armor");
  assert.ok(fast.threatToBase > armor.threatToBase);

  // мигающий классифицирован
  const flash = p.enemies.find((e) => e.flashing);
  assert.ok(flash);
  assert.strictEqual(flash.hitsLeft, 1);
});

test("perceive — очередь спавна (nextBlink)", () => {
  const s = buildState({ field: openField(), tanks: [] });
  // spawnCount=20 → spawned=0 → следующий мигающий = 4
  assert.strictEqual(perceive(s).spawn.nextBlink, 4);
  // spawned 3 (remaining 17) → следующий 4; spawned 4 (remaining 16) → 11
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
    bullets: [{ i: 2, x: 8, y: 8, dir: 2 }], // вниз, владелец fast → 4px
  });
  const p = perceive(s);
  assert.strictEqual(p.bullets.length, 1);
  assert.strictEqual(p.bullets[0].speed, 4);
  assert.ok(p.bullets[0].cells.length > 0);
  assert.strictEqual(p.bullets[0].cells[0].col, 1);
  assert.strictEqual(p.bullets[0].cells[0].row, 2); // пуля в (1,1), следующая клетка вниз
});

test("perceive — защитники: уровень/жизни/каска/стан/лёд", () => {
  const field = openField();
  field[26] = "I".repeat(26) + "E" + "I".repeat(5); // лёд вокруг орла? нет, орёл на (26? ) 
  const s = buildState({
    field,
    tanks: [
      { i: 0, x: 8, y: 208, team: "DEF", type: 0x60 }, // (1,26) на льду
      { i: 1, x: 88, y: 216, team: "DEF", type: 0x00 },
    ],
  });
  s.mem[0x51] = 3; s.mem[0x52] = 2;
  s.mem[0x0101] = 2;
  s.mem[0x89] = 1; // каска игрока 0
  const p = perceive(s.refresh());
  assert.strictEqual(p.defenders.length, 2);
  assert.strictEqual(p.defenders[0].level, 2);
  assert.strictEqual(p.defenders[0].lives, 3);
  assert.strictEqual(p.defenders[1].lives, 2);
  assert.strictEqual(p.defenders[0].helmet, true);
  assert.strictEqual(p.defenders[1].helmet, false);
  // лёд: танк 0 на (1,26) — проверим классификацию тайла
  assert.strictEqual(p.tileType(1, 26), "ice");
});

test("perceive — intercept: точка пересечения пули", () => {
  const s = buildState({
    field: openField(),
    tanks: [{ i: 2, x: 8, y: 8, team: "ATT", type: 0x80 }],
    bullets: [{ i: 2, x: 8, y: 8, dir: 2 }], // вниз по колонке 1
  });
  const p = perceive(s);
  const b = p.bullets[0];
  const shotFrom = { col: 3, row: 0 };
  const inter = p.intercept(shotFrom, b);
  assert.ok(inter, "есть точка перехвата на линии колонки 1");
  assert.strictEqual(inter.col, 1);
});
