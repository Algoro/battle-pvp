// perception-role.test.js — ролевой высокоуровневый слой: perceive для атакующего,
// общий steering (steerTo/fineSteer) и опасность от пуль противника.
import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../model/game-view.ts";
import { perceive } from "../model/perception.ts";
import { steerTo, fineSteer, nearestCover, isCover } from "../model/steer.ts";

function field32(fill = ".".repeat(32)) {
  return Array.from({ length: 32 }, () => fill);
}

test("perceive(role=att) — противники = DEF-танки, союзники = ATT, selfTeam=ATT", () => {
  const s = buildState({
    field: field32(),
    tanks: [
      { i: 0, x: 88, y: 216, team: "DEF" },
      { i: 1, x: 152, y: 216, team: "DEF" },
      { i: 2, x: 16, y: 16, team: "ATT", type: 0x80 },
      { i: 3, x: 32, y: 32, team: "ATT", type: 0xc0 },
    ],
  });
  const p = perceive(s, { role: "att" });
  assert.strictEqual(p.selfTeam, "ATT");
  assert.strictEqual(p.oppTeam, "DEF");
  // opponents = DEF-танки (цели атакующего), allies = ATT
  assert.strictEqual(p.opponents.length, 2);
  assert.ok(p.opponents.every((o) => o.tank.team === "DEF"), "противники — защитники");
  assert.strictEqual(p.allies.length, 2);
  assert.ok(p.allies.every((a) => a.tank.team === "ATT"), "союзники — атакующие");
  // DEF-цели несут полезную для атакующего инфу (уровень/жизни/каска)
  assert.ok(p.opponents[0].level !== undefined);
  assert.ok(p.opponents[0].lives !== undefined);
});

test("perceive(role=def) — обратная совместимость: enemies=ATT, defenders=DEF", () => {
  const s = buildState({
    field: field32(),
    tanks: [
      { i: 0, x: 88, y: 216, team: "DEF" },
      { i: 2, x: 16, y: 16, team: "ATT", type: 0x80 },
    ],
  });
  const p = perceive(s); // default role "def"
  assert.strictEqual(p.selfTeam, "DEF");
  assert.strictEqual(p.opponents.length, 1);
  assert.strictEqual(p.opponents[0].tank.team, "ATT");
  assert.strictEqual(p.enemies.length, 1, "enemies — АЛИАС opponents для def");
  assert.strictEqual(p.defenders.length, 2, "defenders — оба слота DEF (0 и 1)");
});

test("danger(cell) — пули ПРОТИВНИКА, угрожающие клетке (для атакующего = DEF-пули)", () => {
  const s = buildState({
    field: field32(),
    tanks: [
      { i: 0, x: 40, y: 40, team: "DEF" },       // защитник, владелец пули
      { i: 2, x: 200, y: 200, team: "ATT" },
    ],
    // пуля защитника летит вниз по колонке, владелец DEF (i=0)
    bullets: [{ i: 0, x: 40, y: 40, dir: 2 }],
  });
  const p = perceive(s, { role: "att" });
  // клетка ниже по колонке защитника — под угрозой DEF-пули
  const threatened = p.danger({ col: 5, row: 6 });
  assert.ok(threatened.length >= 1, "атакующий видит пулю защитника как опасность");
  // опасность НЕ считает свои (ATT) пули
  const p2 = perceive(buildState({
    field: field32(),
    tanks: [{ i: 2, x: 40, y: 40, team: "ATT" }],
    bullets: [{ i: 2, x: 40, y: 40, dir: 2 }],
  }), { role: "att" });
  assert.strictEqual(p2.danger({ col: 5, row: 6 }).length, 0, "свои пули не опасны");
});

test("steerTo/fineSteer — навигация атакующего танка к цели (орлу)", () => {
  const s = buildState({
    field: field32(),
    tanks: [{ i: 2, x: 16, y: 16, team: "ATT" }], // (2,2)
  });
  const goal = { col: 15, row: 26 }; // орёл
  const d = steerTo(s.field, 16, 16, goal, { allowBreak: true });
  assert.ok(d !== null, "steerTo даёт направление");
  assert.ok(d >= 0 && d <= 3, `направление 0..3, получено ${d}`);
  const df = fineSteer(s.field, 16, 16, goal, {});
  assert.strictEqual(df, d, "на открытом поле fineSteer и steerTo совпадают");
});

test("nearestCover/isCover — общий поиск укрытия", () => {
  const field = field32();
  field[10] = field[10].slice(0, 10) + "#" + field[10].slice(11); // сталь на (10,10)
  const s = buildState({ field, tanks: [] });
  const cover = nearestCover(s.field, { col: 5, row: 10 }, null);
  assert.ok(cover, "укрытие найдено рядом со сталью");
  assert.ok(isCover(s.field, cover.col, cover.row), "клетка — укрытие");
});
