// tower-defence-runtime.test.ts — рантайм tower defence: экономика, расстановка,
// волны, таргетинг/снаряды, урон по башням, победа/поражение.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { RAM } from "../rom-contract.ts";
import { TD_PHASE } from "../../shared/tower-defence.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function boot(features = ["tower-defence"]) {
  const emu = new PvPNes({ patchSet: "pvp", features, attAI: "off", defAI: "off" });
  emu.loadROM(ROM);
  // Start до реального геймплея (game_over_flag = 0x80), затем ждём живого DEF-танка.
  for (let f = 1; f <= 3000; f++) {
    emu.stepFrame([{ port: 0, buttons: f % 30 === 0 ? BTN.Start : 0 }]);
    if (emu.readMem(RAM.GAME_OVER) === 0x80) break;
  }
  emu.cpu.mem[RAM.PAUSE] = 0;
  for (let f = 0; f < 400; f++) {
    const flag = emu.readMem(RAM.TANK_FLAG);
    if ((flag & 0x80) && flag < 0xe0) break;
    emu.stepFrame([{ port: 0, buttons: 0 }]);
  }
  emu.cpu.mem.fill(0, RAM.FIELD, RAM.FIELD + 1024); // чистое поле для LOS/снарядов
  emu.tdOrder({ type: "configure", map: "snake", difficulty: "normal", startPoints: 300 });
  idle(emu, 1);
  return emu;
}
const idle = (emu: PvPNes, n = 1) => {
  for (let i = 0; i < n; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
};
const CELL = (r: number, c: number) => r * 13 + c;
function pinEnemy(emu: PvPNes, t: number, x: number, y: number, type = 0x80) {
  const m = emu.cpu.mem;
  m[RAM.TANK_X + t] = x;
  m[RAM.TANK_Y + t] = y;
  m[RAM.TANK_FLAG + t] = 0x90;
  m[RAM.TANK_TYPE + t] = type;
}

test("td-runtime: configure и валидация расстановки", () => {
  const emu = boot();
  let s = emu.getTowerDefence();
  assert.strictEqual(s.phase, TD_PHASE.BUILD);
  assert.strictEqual(s.points, 300);

  emu.tdOrder({ type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  s = emu.getTowerDefence();
  assert.strictEqual(s.towers.length, 1);
  assert.strictEqual(s.points, 200, "стоимость пушки не списана");

  // стена (snake row1), зона базы и точка спавна запрещены
  emu.tdOrder({ type: "place", cell: CELL(1, 5), towerType: "gun" });
  emu.tdOrder({ type: "place", cell: CELL(12, 6), towerType: "gun" });
  emu.tdOrder({ type: "place", cell: CELL(0, 0), towerType: "gun" });
  // повторная постановка на занятую клетку
  emu.tdOrder({ type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  s = emu.getTowerDefence();
  assert.strictEqual(s.towers.length, 1, "невалидные клетки не должны приниматься");

  // продажа возвращает 60%
  emu.tdOrder({ type: "sell", cell: CELL(2, 1) });
  idle(emu, 1);
  s = emu.getTowerDefence();
  assert.strictEqual(s.towers.length, 0);
  assert.strictEqual(s.points, 260, "продажа вернула 60%");
});

test("td-runtime: апгрейд башни списывает очки и повышает урон/прочность", () => {
  const emu = boot();
  emu.tdOrder({ type: "configure", startPoints: 500 });
  emu.tdOrder({ type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  let s = emu.getTowerDefence();
  const hp0 = s.towers[0].maxHp;
  emu.tdOrder({ type: "upgrade", cell: CELL(2, 1) });
  idle(emu, 1);
  s = emu.getTowerDefence();
  assert.strictEqual(s.towers[0].level, 1);
  assert.ok(s.towers[0].maxHp > hp0, "апгрейд должен повышать прочность");
  assert.strictEqual(s.points, 500 - 100 - 60);
});

test("td-runtime: startWave запускает волну и спавнер", () => {
  const emu = boot();
  emu.tdOrder({ type: "startWave" });
  idle(emu, 1);
  const s = emu.getTowerDefence();
  assert.strictEqual(s.phase, TD_PHASE.WAVE);
  assert.strictEqual(s.wave, 1);
  assert.ok(s.spawnLeft > 0 && s.enemiesLeft > 0, "волна не выставлена");
  // за несколько кадров появляется хотя бы один враг
  let seen = false;
  for (let i = 0; i < 400 && !seen; i++) {
    idle(emu, 1);
    for (let t = 2; t <= 7; t++) {
      const flag = emu.readMem(RAM.TANK_FLAG + t);
      if ((flag & 0x80) && flag < 0xe0) seen = true;
    }
  }
  assert.ok(seen, "враги не заспавнились");
});

test("td-runtime: башня стреляет по линии и убивает врага (очки)", () => {
  const emu = boot();
  emu.tdOrder({ type: "place", cell: CELL(2, 1), towerType: "gun" });
  emu.tdOrder({ type: "startWave" });
  idle(emu, 1);
  const before = emu.getTowerDefence().points;
  // Враг 2 — на одной строке с башней (центр башни 40,56; враг центр 88,56).
  let killed = false;
  for (let i = 0; i < 60 && !killed; i++) {
    pinEnemy(emu, 2, 80, 48);
    emu.stepFrame([{ port: 0, buttons: 0 }]);
    const flag = emu.readMem(RAM.TANK_FLAG + 2);
    if (flag === 0 || flag >= 0xe0 || (flag & 0xf0) === 0x70) killed = true;
  }
  assert.ok(killed, "враг не убит башней");
  idle(emu, 1); // дать awardKills зафиксировать переход alive->мертв
  assert.strictEqual(emu.getTowerDefence().points - before, 100, "очки за убийство не начислены");
});

test("td-runtime: волна выдаёт типы врагов из своей очереди", () => {
  const emu = boot();
  emu.tdOrder({ type: "startWave" });
  idle(emu, 1);
  const m = emu.cpu.mem;
  const spawn = () => {
    m[RAM.TANK_FLAG + 2] = 0; // слот пуст
    idle(emu, 1);
    m[RAM.TANK_FLAG + 2] = 0x90; // новый спавн
    m[RAM.TANK_TYPE + 2] = 0xff; // ROM поставил что-то — рантайм должен переопределить
    idle(emu, 1);
    return m[RAM.TANK_TYPE + 2];
  };
  // Волна 1: [0x80, 0x80, 0xa0, 0x80] (см. shared TD_WAVES).
  assert.strictEqual(spawn(), 0x80, "первый враг — базовый");
  assert.strictEqual(spawn(), 0x80, "второй враг — базовый");
  assert.strictEqual(spawn(), 0xa0, "третий враг — быстрая пуля");
});

test("td-runtime: вражеская пуля снимает прочность башни", () => {
  const emu = boot();
  emu.tdOrder({ type: "place", cell: CELL(2, 1), towerType: "gun" });
  emu.tdOrder({ type: "startWave" });
  idle(emu, 1);
  const hp0 = emu.getTowerDefence().towers[0].hp;
  const m = emu.cpu.mem;
  m[RAM.BULLET_STATUS + 2] = 0x40; // летит
  m[RAM.BULLET_X + 2] = 40;
  m[RAM.BULLET_Y + 2] = 56;
  idle(emu, 1);
  const hp1 = emu.getTowerDefence().towers[0].hp;
  assert.strictEqual(hp1, hp0 - 1, "попадание вражеской пули не сняло hp");
});

test("td-runtime: зачистка последней волны -> VICTORY, game over -> DEFEAT", () => {
  const emu = boot();
  emu.tdOrder({ type: "configure", waves: 1 });
  emu.tdOrder({ type: "startWave" });
  idle(emu, 1);
  const m = emu.cpu.mem;
  m[RAM.SPAWN_CNT] = 0;
  m[RAM.ENEMIES_LEFT] = 0;
  for (let t = 2; t <= 7; t++) m[RAM.TANK_FLAG + t] = 0;
  idle(emu, 1);
  assert.strictEqual(emu.getTowerDefence().phase, TD_PHASE.VICTORY);

  // Поражение: база уничтожена (game over) во время волны.
  const emu2 = boot();
  emu2.tdOrder({ type: "startWave" });
  idle(emu2, 1);
  emu2.cpu.mem[RAM.GAME_OVER] = 0;
  idle(emu2, 1);
  assert.strictEqual(emu2.getTowerDefence().phase, TD_PHASE.DEFEAT);

  // Поражение при мобильном танке: кончились жизни командира.
  const emu3 = boot();
  emu3.setHumanDefTank(0); // как MatchController при mobileTank: жизни не «дотираются»
  emu3.tdOrder({ type: "startWave" });
  idle(emu3, 1);
  emu3.cpu.mem[RAM.LIVES] = 0;
  idle(emu3, 1);
  assert.strictEqual(emu3.getTowerDefence().phase, TD_PHASE.DEFEAT, "0 жизней командира должно быть поражением");

  // Без мобильного танка жизни не учитываются (оборону держат только башни).
  const emu4 = boot();
  emu4.tdOrder({ type: "configure", mobileTank: false });
  emu4.tdOrder({ type: "startWave" });
  idle(emu4, 1);
  emu4.cpu.mem[RAM.LIVES] = 0;
  idle(emu4, 1);
  assert.notStrictEqual(emu4.getTowerDefence().phase, TD_PHASE.DEFEAT, "без танка жизни не должны завершать матч");
});
