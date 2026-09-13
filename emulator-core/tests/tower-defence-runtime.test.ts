// tower-defence-runtime.test.ts — tower defence runtime: economy, placement,
// waves, targeting/projectiles, tower damage, victory/defeat.
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
  // Start before real gameplay (game_over_flag = 0x80), then wait for a living DEF tank.
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
  emu.cpu.mem.fill(0, RAM.FIELD, RAM.FIELD + 1024); // clean field for LOS/projectiles
  emu.featureCommand("tower-defence", { type: "configure", map: "snake", difficulty: "normal", startPoints: 300 });
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
  let s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.phase, TD_PHASE.BUILD);
  assert.strictEqual(s.points, 300);

  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.towers.length, 1);
  assert.strictEqual(s.points, 200, "стоимость пушки не списана");

  // wall (snake row1), the base zone and the spawn point are forbidden
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(1, 5), towerType: "gun" });
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(12, 6), towerType: "gun" });
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(0, 0), towerType: "gun" });
  // placing again on an occupied cell
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.towers.length, 1, "невалидные клетки не должны приниматься");

  // selling returns 60%
  emu.featureCommand("tower-defence", { type: "sell", cell: CELL(2, 1) });
  idle(emu, 1);
  s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.towers.length, 0);
  assert.strictEqual(s.points, 260, "продажа вернула 60%");
});

test("td-runtime: апгрейд башни списывает очки и повышает урон/прочность", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "configure", startPoints: 500 });
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" });
  idle(emu, 1);
  let s = emu.getFeatureState("tower-defence");
  const hp0 = s.towers[0].maxHp;
  emu.featureCommand("tower-defence", { type: "upgrade", cell: CELL(2, 1) });
  idle(emu, 1);
  s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.towers[0].level, 1);
  assert.ok(s.towers[0].maxHp > hp0, "апгрейд должен повышать прочность");
  assert.strictEqual(s.points, 500 - 100 - 60);
});

test("td-runtime: startWave запускает волну и спавнер", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const s = emu.getFeatureState("tower-defence");
  assert.strictEqual(s.phase, TD_PHASE.WAVE);
  assert.strictEqual(s.wave, 1);
  assert.ok(s.spawnLeft > 0 && s.enemiesLeft > 0, "волна не выставлена");
  // within a few frames at least one enemy appears
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
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" });
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const before = emu.getFeatureState("tower-defence").points;
  // Enemy 2 — on the same row as the turret (turret center 40,56; enemy center 88,56).
  let killed = false;
  for (let i = 0; i < 60 && !killed; i++) {
    pinEnemy(emu, 2, 80, 48);
    emu.stepFrame([{ port: 0, buttons: 0 }]);
    const flag = emu.readMem(RAM.TANK_FLAG + 2);
    if (flag === 0 || flag >= 0xe0 || (flag & 0xf0) === 0x70) killed = true;
  }
  assert.ok(killed, "враг не убит башней");
  idle(emu, 1); // let awardKills register the alive->dead transition
  assert.strictEqual(emu.getFeatureState("tower-defence").points - before, 100, "очки за убийство не начислены");
});

test("td-runtime: волна выдаёт типы врагов из своей очереди", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const m = emu.cpu.mem;
  const spawn = () => {
    m[RAM.TANK_FLAG + 2] = 0; // slot empty
    idle(emu, 1);
    m[RAM.TANK_FLAG + 2] = 0x90; // new spawn
    m[RAM.TANK_TYPE + 2] = 0xff; // the ROM set something — the runtime must override
    idle(emu, 1);
    return m[RAM.TANK_TYPE + 2];
  };
  // Wave 1: [0x80, 0x80, 0xa0, 0x80] (see shared TD_WAVES).
  assert.strictEqual(spawn(), 0x80, "первый враг — базовый");
  assert.strictEqual(spawn(), 0x80, "второй враг — базовый");
  assert.strictEqual(spawn(), 0xa0, "третий враг — быстрая пуля");
});

test("td-runtime: башня наводится на врага со сдвигом 8 px (дорожки)", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" }); // turret center (40,56)
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const before = emu.getFeatureState("tower-defence").points;
  let killed = false;
  for (let i = 0; i < 150 && !killed; i++) {
    pinEnemy(emu, 2, 40, 48); // enemy center (48,56): an offset of exactly 8 px
    emu.stepFrame([{ port: 0, buttons: 0 }]);
    const now = emu.readMem(RAM.TANK_FLAG + 2);
    if (!((now & 0x80) !== 0 && now < 0xe0)) killed = true;
  }
  assert.ok(killed, "башня не убила врага со сдвигом 8 px");
  assert.strictEqual(emu.getFeatureState("tower-defence").towers[0].dir, 3, "ствол должен повернуться вправо");
  idle(emu, 1);
  assert.strictEqual(emu.getFeatureState("tower-defence").points - before, 100, "очки за убийство не начислены");
});

test("td-runtime: вражеская пуля снимает прочность башни", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "place", cell: CELL(2, 1), towerType: "gun" });
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const hp0 = emu.getFeatureState("tower-defence").towers[0].hp;
  const m = emu.cpu.mem;
  m[RAM.BULLET_STATUS + 2] = 0x40; // flying
  m[RAM.BULLET_X + 2] = 40;
  m[RAM.BULLET_Y + 2] = 56;
  idle(emu, 1);
  const hp1 = emu.getFeatureState("tower-defence").towers[0].hp;
  assert.strictEqual(hp1, hp0 - 1, "попадание вражеской пули не сняло hp");
});

test("td-runtime: зачистка последней волны -> VICTORY, game over -> DEFEAT", () => {
  const emu = boot();
  emu.featureCommand("tower-defence", { type: "configure", waves: 1 });
  emu.featureCommand("tower-defence", { type: "startWave" });
  idle(emu, 1);
  const m = emu.cpu.mem;
  m[RAM.SPAWN_CNT] = 0;
  m[RAM.ENEMIES_LEFT] = 0;
  for (let t = 2; t <= 7; t++) m[RAM.TANK_FLAG + t] = 0;
  idle(emu, 1);
  assert.strictEqual(emu.getFeatureState("tower-defence").phase, TD_PHASE.VICTORY);

  // Defeat: the base is destroyed (game over) during a wave.
  const emu2 = boot();
  emu2.featureCommand("tower-defence", { type: "startWave" });
  idle(emu2, 1);
  emu2.cpu.mem[RAM.GAME_OVER] = 0;
  idle(emu2, 1);
  assert.strictEqual(emu2.getFeatureState("tower-defence").phase, TD_PHASE.DEFEAT);

  // Defeat with a mobile tank: the commander's lives ran out.
  const emu3 = boot();
  emu3.setHumanDefTank(0); // like MatchController with mobileTank: lives are not "topped up"
  emu3.featureCommand("tower-defence", { type: "startWave" });
  idle(emu3, 1);
  emu3.cpu.mem[RAM.LIVES] = 0;
  idle(emu3, 1);
  assert.strictEqual(emu3.getFeatureState("tower-defence").phase, TD_PHASE.DEFEAT, "0 жизней командира должно быть поражением");

  // Without a mobile tank lives are not counted (only the turrets hold the defense).
  const emu4 = boot();
  emu4.featureCommand("tower-defence", { type: "configure", mobileTank: false });
  emu4.featureCommand("tower-defence", { type: "startWave" });
  idle(emu4, 1);
  emu4.cpu.mem[RAM.LIVES] = 0;
  idle(emu4, 1);
  assert.notStrictEqual(emu4.getFeatureState("tower-defence").phase, TD_PHASE.DEFEAT, "без танка жизни не должны завершать матч");
});
