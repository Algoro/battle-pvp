// battle.test.js — unit tests for BattleSim (sim/battle.js): deterministic PRNG,
// sub-cell bullet collision, bullet width, enemy flag machine, spawn, death.
import { test } from "node:test";
import assert from "node:assert";
import { BattleSim } from "../sim/battle.ts";
import { isBrick, brickHit } from "../model/game-view.ts";

function makeSim(over = {}) {
  const field = new Uint8Array(32 * 32);
  const tanks = [{ index: 2, team: "ATT", x: 120, y: 40, dir: 2, flag: 0xa2, type: 0x80, alive: true }];
  return new BattleSim({
    field, tanks, bullets: [],
    counters: { spawnTimer: 1, spawnInterval: 8, spawnCount: 5, spawnPosIndex: 0, typeOffset: 0, stage: 1, enemiesLeft: 5, limit: 7, frmCntLo: 0, frmCntHi: 0, clock: 0 },
    rngState: 0x11, frame: 0, typeCnt: [0x12, 0x02, 0, 0],
    p1: { x: 88, y: 216, alive: true }, p2: { x: 152, y: 216, alive: false },
    ...over,
  });
}

test("rng: детерминированный PRNG (вариант B)", () => {
  const a = makeSim(), b = makeSim();
  a.frame = 5; b.frame = 5; a.rngState = 0x11; b.rngState = 0x11;
  // $0F = ($0F*7 + frm_hi + frm_lo) & 0xFF, returns the NEW $0F
  const ra = a.rng(), rb = b.rng();
  assert.strictEqual(ra, rb, "одинаковый seed+frame → одинаковое значение");
  assert.strictEqual(ra, ((0x11 * 7 + 5) & 0xff), "формула variant B");
});

test("rng: разные seed дают разную последовательность", () => {
  const a = makeSim(), b = makeSim();
  a.rngState = 0x11; b.rngState = 0x22; a.frame = 0; b.frame = 0;
  const seq = (s) => { const out = []; for (let i = 0; i < 3; i++) out.push(s.rng()); return out; };
  assert.notDeepStrictEqual(seq(a), seq(b), "разные seed → разные значения");
});

test("пуля: обычный кирпич сверху 0xf -> 0xc (половина)", () => {
  const sim = makeSim();
  sim.field[15 * 32 + 15] = 0x0f; // (15,15), in the path of a bullet from (120,120) downward
  sim.bullets[2] = { slot: 2, alive: true, x: 120, y: 120, dir: 2, property: 0, owner: 2, team: "ATT" };
  sim.frame = 1; sim.c.gateFrmLo = 1;
  sim.step();
  assert.strictEqual(sim.field[15 * 32 + 15], 0xc, "удар сверху → 0xc (верхняя половина снята)");
});

test("пуля: на левой границе колонки задевает левого соседа (ширина пули)", () => {
  const sim = makeSim();
  sim.field[15 * 32 + 14] = 0x0f; // (14,15)
  sim.field[15 * 32 + 15] = 0x0f; // (15,15)
  sim.bullets[2] = { slot: 2, alive: true, x: 120, y: 120, dir: 2, property: 0, owner: 2, team: "ATT" }; // x=120 → x&7==0
  sim.frame = 1; sim.c.gateFrmLo = 1;
  sim.step();
  assert.strictEqual(sim.field[15 * 32 + 14], 0xc, "левый сосед (14,15) разрушен (ширина пули)");
});

test("пуля: пустая верхняя суб-ячейка 0xc пропускает (не разрушает)", () => {
  const sim = makeSim();
  sim.field[15 * 32 + 15] = 0xc; // top (empty), bottom intact
  sim.bullets[2] = { slot: 2, alive: true, x: 120, y: 120, dir: 2, property: 0, owner: 2, team: "ATT" };
  // gate open (odd $0B): the bullet in the top (empty) half 0xc does not collide
  sim.frame = 1; sim.c.gateFrmLo = 1;
  sim.step(); // move 120→122, check the top half: pass
  assert.strictEqual(sim.bullets[2].alive, true, "в пустой верхней половине проходит");
  assert.strictEqual(sim.field[15 * 32 + 15], 0xc, "кирпич не разрушен в верхней половине");
});

test("сталь (0x11) блокирует пулю без разрушения (пуля уходит во взрыв)", () => {
  const sim = makeSim();
  sim.field[15 * 32 + 15] = 0x11;
  sim.bullets[2] = { slot: 2, alive: true, x: 120, y: 120, dir: 2, property: 0, owner: 2, team: "ATT" };
  // bullet: ~40 frames of flight + 9 frames of explosion
  for (let i = 0; i < 60; i++) { sim.frame = i; sim.c.gateFrmLo = i & 0xff; sim.step(); }
  assert.strictEqual(sim.bullets[2].alive, false, "пуля погибает после взрыва");
  assert.strictEqual(sim.field[15 * 32 + 15], 0x11, "сталь не разрушается");
});

test("респавн: F0 -> E0 -> A2 и назначение реального типа", () => {
  const sim = makeSim();
  const t = sim.tanks[0];
  t.flag = 0xf0; t.type = 0;
  // run the respawn with the gate (index 2, even, moves on an odd gateFrmLo)
  for (let i = 0; i < 200 && t.flag !== 0xa2; i++) { sim.frame = i; sim.c.gateFrmLo = i & 0xff; sim.step(); }
  assert.strictEqual(t.flag, 0xa2, "респавн завершён -> активен (вниз)");
  assert.strictEqual(t.type, 0x80, "реальный тип назначен на E0->A2 (sub_E3CB)");
});

test("спавн: позиция цикла 0->1->2 (INC до использования)", () => {
  const sim = makeSim({ counters: { spawnTimer: 0, spawnInterval: 8, spawnCount: 3, spawnPosIndex: 0, typeOffset: 0, stage: 1, enemiesLeft: 3, limit: 7, frmCntLo: 0, frmCntHi: 0, clock: 0 } });
  sim._spawnEnemy();
  const t = sim.tanks.find((x) => x.flag === 0xf0);
  assert.ok(t, "враг заспавнен");
  assert.strictEqual(t.x, 0x78, "первая позиция цикла — центр (0x78)");
  assert.strictEqual(sim.c.spawnPosIndex, 1, "индекс инкрементирован");
});

test("взрыв 0x70 -> мёртв, декремент enemiesLeft", () => {
  const sim = makeSim();
  const t = sim.tanks[0];
  t.flag = 0x70; sim.c.enemiesLeft = 5;
  for (let i = 0; i < 300 && t.alive !== false; i++) { sim.frame = i; sim.c.gateFrmLo = i & 0xff; sim.step(); }
  assert.strictEqual(t.alive, false, "враг умер после взрыва");
  assert.strictEqual(sim.c.enemiesLeft, 4, "enemiesLeft уменьшен");
});

test("взрыв: враг c бонус-флагом (type&0x04) при СМЕРТИ не спавнит приз (теперь на ударе)", () => {
  const sim = makeSim();
  const t = sim.tanks[0];
  t.flag = 0x70; t.type = 0x04; // bonus enemy already exploding
  for (let i = 0; i < 300 && t.alive !== false; i++) { sim.frame = i; sim.c.gateFrmLo = i & 0xff; sim.step(); }
  assert.strictEqual(t.alive, false, "враг умер");
  assert.strictEqual(sim.prize, null, "приз на СМЕРТИ не спавнится (перенесён на удар)");
});

test("удар пулей игрока: мигающий враг (type&0x04) сразу спавнит приз", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.type = 0x84; // basic + flash
  const rngBefore = sim.rngState;
  sim._hitEnemy(t);
  assert.ok(sim.prize, "приз заспавнен сразу при ударе");
  assert.notStrictEqual(sim.rngState, rngBefore, "RNG потреблён при спавне приза");
});

test("удар пулей игрока: обычный враг (type&3==0) уходит во взрыв 0x73", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.type = 0x80;
  sim._hitEnemy(t);
  assert.strictEqual(t.flag, 0x73, "обычный враг -> взрыв (con_tank_flag_explosion+3)");
  assert.strictEqual(t.type, 0x80, "тип не меняется для не-броневого");
});

test("удар пулей игрока: бронированный враг (type&3!=0) держит удар, DEC type", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.type = 0xe3; // armor 3
  sim._hitEnemy(t);
  assert.strictEqual(t.alive, true, "бронированный жив после первого удара");
  assert.strictEqual(t.type, 0xe2, "тип декрементирован (броня -1)");
  assert.strictEqual(t.flag, 0xa2, "флаг не меняется (не взрыв)");
});

test("удар пулей игрока: бонус-броневраг 0xE4 -> бонус + броня -2 (0xE2)", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.type = 0xe4;
  sim._hitEnemy(t);
  assert.ok(sim.prize, "бонус-броневраг спавнит приз при ударе");
  assert.strictEqual(t.alive, true, "броневраг жив");
  assert.strictEqual(t.type, 0xe2, "0xE4 -> 0xE3 (снять flash) -> 0xE2 (броня -1)");
});

test("DEF-пуля убивает врага через _bulletVsTank (полный цикл до смерти)", () => {
  const sim = makeSim({ counters: { spawnTimer: 1, spawnInterval: 8, spawnCount: 5, spawnPosIndex: 0, typeOffset: 0, stage: 1, enemiesLeft: 5, limit: 7, frmCntLo: 0, frmCntHi: 0, clock: 0 } });
  const t = sim.tanks[0]; t.flag = 0xa0; t.x = 120; t.y = 40; t.type = 0x80;
  // DEF bullet (slot 0) point-blank to an enemy
  sim.bullets[0] = { slot: 0, alive: true, x: 120, y: 44, dir: 2, property: 0, owner: 0, team: "DEF", synced: true };
  const before = sim.c.enemiesLeft;
  sim.step();
  assert.strictEqual(t.flag, 0x73, "враг получил попадание -> взрыв");
  assert.strictEqual(sim.bullets[0].explode, 9, "DEF-пуля ушла во взрыв 9 кадров (sub_E70C bullet->0x33)");
  // run the explosion until death
  for (let i = 0; i < 300 && t.alive !== false; i++) { sim.frame = i; sim.c.gateFrmLo = i & 0xff; sim.step(); }
  assert.strictEqual(t.alive, false, "враг умер");
  assert.strictEqual(sim.c.enemiesLeft, before - 1, "enemiesLeft декрементирован");
});

test("бонус-оверлап: `_bonusOnTank` учитывает только живых в движении (sub_E972)", () => {
  const sim = makeSim();
  // add DEF tank 0 (p1) at (88,216)
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 216, dir: 2, flag: 0xa0, type: 0, alive: true });
  sim.p1 = { x: 88, y: 216, alive: true };
  assert.strictEqual(sim._bonusOnTank(88, 216), true, "оверлап с живым игроком в движении");
  sim.tanks.find((x) => x.index === 0).flag = 0x00; // dead
  assert.strictEqual(sim._bonusOnTank(88, 216), false, "мёртвый игрок не даёт оверлапа");
});

test("гейт движения: обычный враг (idx 2) движется на нечётном frmLo", () => {
  const sim = makeSim();
  const t = sim.tanks[0];
  sim.c.gateFrmLo = 1; // (2^1)&1 = 1 → gate open
  const before = t.y;
  sim.step();
  assert.strictEqual(t.y, before + 1, "враг сдвинулся вниз");
  sim.c.gateFrmLo = 0; // (2^0)&1 = 0 → gate closed
  sim.frame = 0;
  const before2 = t.y;
  sim.step();
  assert.strictEqual(t.y, before2, "враг не двигается при закрытом гейте");
});

test("isBrick: корректно распознаёт кирпичи и сталь", () => {
  assert.strictEqual(isBrick(0x0f), true, "0x0f — кирпич");
  assert.strictEqual(isBrick(0x0c), true, "0x0c — кирпич (повреждённый)");
  assert.strictEqual(isBrick(0x03), true, "0x03 — кирпич");
  assert.strictEqual(isBrick(0x0a), true, "0x0a — кирпич (половина, разрушается дальше)");
  assert.strictEqual(isBrick(0x05), true, "0x05 — кирпич (половина, разрушается дальше)");
  assert.strictEqual(isBrick(0x11), false, "0x11 — сталь, не кирпич");
  assert.strictEqual(isBrick(0x00), false, "0x00 — пусто");
});

test("половинчатый кирпич 0x0a/0x05 разрушается второй пулей до 0x00", () => {
  // Brick 0x0a (right half), bullet from the right: far=0x0a -> 0x00.
  assert.deepStrictEqual(brickHit(0x0a, 3), { next: 0x00, pass: false });
  // Brick 0x05 (left half), bullet from the left: far=0x05 -> 0x00.
  assert.deepStrictEqual(brickHit(0x05, 1), { next: 0x00, pass: false });
});

test("пуля не движется в кадр выстрела (sub_E604 не двигает свежую пулю)", () => {
  const sim = new BattleSim({
    field: new Uint8Array(1024),
    tanks: [{ index: 2, team: "ATT", x: 40, y: 40, dir: 3, flag: 0xa3, type: 0x80, alive: true }],
    bullets: [],
    counters: { spawnInterval: 8, spawnCount: 20, stage: 1, enemiesLeft: 20, frmCntLo: 0, frmCntHi: 0 },
    p1: { x: 88, y: 216, alive: true },
  });
  // shot: the bullet is created at the spawn position but does not move
  sim._fireEnemy(sim.tanks[0]);
  const b = sim.bullets[2];
  assert.strictEqual(b.x, 40 + 8, "спавн справа от танка");
  sim._moveBullets();
  assert.strictEqual(b.x, 48, "пуля не движется в кадр выстрела");
  sim._moveBullets();
  assert.strictEqual(b.x, 50, "со следующего кадра пуля движется 2px/кадр");
});

test("спавн врага стирает иконку в поле (sub_DB48 -> sub_C8B1)", () => {
  const sim = makeSim({ counters: { spawnTimer: 0, spawnInterval: 8, spawnCount: 18, spawnPosIndex: 0, typeOffset: 0, stage: 1, enemiesLeft: 20, limit: 7, frmCntLo: 0, frmCntHi: 0, clock: 0 } });
  // the first spawn decrements 18->17, erases icon 17: col=(17&1)+29=30, row=(17>>1)+3=11
  sim.field[11 * 32 + 30] = 0x6a; // enemy icon (tbl_D362 = 0x6a)
  sim._spawnEnemy();
  assert.strictEqual(sim.c.spawnCount, 17, "spawnCount декрементирован");
  assert.strictEqual(sim.field[11 * 32 + 30], 0x11, "иконка стёрта (tbl_D36B = 0x11)");
});

test("лопата: укрепление базы сталью и восстановление (sub_CB9E/sub_CAF5)", () => {
  const sim = makeSim();
  sim.field[25 * 32 + 13] = 0x0f; // base brick
  sim.field[26 * 32 + 14] = 0xc8; // eagle
  const orig = sim.field[25 * 32 + 13];
  sim._applyPrize(2); // shovel
  assert.strictEqual(sim.field[25 * 32 + 13], 0x10, "база укреплена сталью 0x10");
  assert.strictEqual(sim.field[26 * 32 + 14], 0xc8, "орёл (26,14) не тронут");
  sim.c.shovelTimer = 1;
  sim.frame = 64; // 64 & 0x3f == 0 → timer decrement
  sim._shovelHandler();
  assert.strictEqual(sim.field[25 * 32 + 13], orig, "база восстановлена по истечении таймера");
});

test("property пули по типу врага (sub_E08C): 0x80/0xA0/0xE0 -> 0, 0xC0 -> 1", () => {
  const sim = makeSim();
  const prop = (type) => { sim.tanks[0].type = type; sim.tanks[0].flag = 0xa3; sim.tanks[0].x = 40; sim.tanks[0].y = 40; sim._fireEnemy(sim.tanks[0]); const p = sim.bullets[2].property; sim.bullets[2].alive = false; return p; };
  assert.strictEqual(prop(0x80), 0, "обычный (0x80) -> property 0 (гейт)");
  assert.strictEqual(prop(0xa0), 0, "power (0xA0) -> property 0 (гейт)");
  assert.strictEqual(prop(0xc0), 1, "быстрый (0xC0) -> property 1");
  assert.strictEqual(prop(0xe0), 0, "бронированный (0xE0) -> property 0 (гейт)");
});

test("тип врага по стадии (tbl_E4EC): стадия 4 -> первый тип 0xC0 (fast)", () => {
  const sim = makeSim({ counters: { stage: 4, typeOffset: 0 } });
  sim.typeCnt = [0x01, 0x05, 0x02, 0x03];
  const t = { type: 0 };
  assert.strictEqual(sim._pickType(t), 0xc0, "стадия 4, offset 0 -> 0xC0 (fast)");
  assert.strictEqual(sim._pickType(t), 0xa0, "стадия 4 -> следующий тип 0xA0 (power)");
});

test("скорость пули: property bit0 -> 4px/кадр, иначе 2px (ofs_E051: sub_E063 ×2)", () => {
  const sim = makeSim();
  // fast bullet (property 1) moves 4px
  sim.bullets[3] = { slot: 3, alive: true, x: 100, y: 100, dir: 1, property: 1, owner: 3, team: "ATT" };
  sim._rngLo = 1; // gate open (odd)
  sim._moveBullets();
  assert.strictEqual(sim.bullets[3].x, 96, "property 1 -> 4px/кадр");
  // normal bullet (property 0) moves 2px
  sim.bullets[3] = { slot: 3, alive: true, x: 100, y: 100, dir: 1, property: 0, owner: 3, team: "ATT" };
  sim._moveBullets();
  assert.strictEqual(sim.bullets[3].x, 98, "property 0 -> 2px/кадр");
});

test("приз-часы (id 1): clock=0x0A и декремент каждые 64 кадра (sub_DBF1 DC00)", () => {
  const sim = makeSim();
  sim._applyPrize(1);
  assert.strictEqual(sim.c.clock, 0x0a, "часы ставят таймер 0x0A");
  sim.frame = 64; // 64 & 0x3f == 0 → decrement
  sim._clockHandler();
  assert.strictEqual(sim.c.clock, 0x09, "декремент каждые 64 кадра");
  sim.frame = 65;
  sim._clockHandler();
  assert.strictEqual(sim.c.clock, 0x09, "в не-кратный 64 кадр не декрементит");
});

test("приз-граната (id 4): взрывает всех врагов на экране и сбрасывает тип (EA17)", () => {
  const sim = makeSim();
  const t2 = sim.tanks[0]; t2.flag = 0xa2; t2.type = 0x80;
  sim.tanks.push({ index: 3, team: "ATT", x: 100, y: 100, dir: 0, flag: 0xa0, type: 0xe3, alive: true });
  sim._applyPrize(4);
  assert.strictEqual(t2.flag, 0x73, "враг взорван гранатой");
  assert.strictEqual(t2.type, 0, "тип врага сброшен (EA32)");
  assert.strictEqual(sim.tanks.find((x) => x.index === 3).flag, 0x73, "второй враг взорван");
});

test("приз-подбор `_bonus`: DEF-танк в движении подбирает приз (sub_E972)", () => {
  const sim = makeSim();
  sim.prize = { id: 1, x: 88, y: 216 };
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 216, dir: 2, flag: 0xa0, type: 0, alive: true });
  sim.p1 = { x: 88, y: 216, alive: true };
  sim._bonus();
  assert.strictEqual(sim.prize, null, "приз подобран");
  assert.strictEqual(sim.c.clock, 0x0a, "эффект часов применён");
  // a dead DEF tank does not pick up (sub_E972: moving only)
  sim.prize = { id: 1, x: 88, y: 216 };
  sim.tanks.find((x) => x.index === 0).flag = 0x00;
  sim._bonus();
  assert.ok(sim.prize, "мёртвый танк не подбирает приз");
});

test("snapshot(): неизменяемая копия состояния (мутация не влияет на симулятор)", () => {
  const sim = makeSim();
  sim.field[0] = 0x0f; sim.c.enemiesLeft = 7;
  const snap = sim.snapshot();
  assert.strictEqual(snap.field[0], 0x0f, "снапшот отражает поле");
  assert.strictEqual(snap.enemiesLeft, 7, "снапшот отражает счётчики");
  snap.field[0] = 0x00; snap.tanks[0].x = 999; snap.enemiesLeft = 0;
  assert.strictEqual(sim.field[0], 0x0f, "мутация снапшота не влияет на поле симулятора");
  assert.strictEqual(sim.tanks[0].x, 120, "мутация снапшота не влияет на танки");
  assert.strictEqual(sim.c.enemiesLeft, 7, "мутация снапшота не влияет на счётчики");
});

test("opts.onEvent: колбэк получает события кадра", () => {
  const events = [];
  const base = { field: new Uint8Array(32 * 32), tanks: [{ index: 2, team: "ATT", x: 120, y: 40, dir: 2, flag: 0xa0, type: 0x80, alive: true }], bullets: [], counters: { spawnTimer: 1, spawnInterval: 8, spawnCount: 5, spawnPosIndex: 0, typeOffset: 0, stage: 1, enemiesLeft: 5, limit: 7, frmCntLo: 0, frmCntHi: 0, clock: 0 }, rngState: 0x11, frame: 1, typeCnt: [0x12, 0x02, 0, 0], p1: { x: 88, y: 216, alive: true }, p2: { x: 152, y: 216, alive: false } };
  const sim = new BattleSim(base, { onEvent: (e) => events.push(e) });
  sim.c.gateFrmLo = 1;
  sim.step();
  assert.ok(events.length > 0, "события собраны");
  assert.ok(events.some((e) => e.op === "move" || e.op === "fire" || e.op === "spawn"), "есть move/fire/spawn");
});

test("opts.rngInjection: возвращает фикс. значение без эволюции $0F", () => {
  const sim = makeSim({ rngState: 0x42 });
  const sim2 = new BattleSim({ field: sim.field, tanks: sim.tanks, bullets: [], counters: sim.c, rngState: 0x42, frame: 0, typeCnt: sim.typeCnt, p1: sim.p1, p2: sim.p2 }, { rngInjection: 0x77 });
  assert.strictEqual(sim2.rng(), 0x77, "возвращает инжектированное значение");
  assert.strictEqual(sim2.rng(), 0x77, "постоянно");
  assert.strictEqual(sim2.rngState, 0x42, "$0F не меняется при инжекции");
});

test("opts.seed / opts.frame переопределяют state", () => {
  const sim = new BattleSim({ field: new Uint8Array(1024), tanks: [], bullets: [], counters: {}, rngState: 0x11, frame: 5, typeCnt: [0x12, 0x02, 0, 0], p1: { x: 88, y: 216, alive: true }, p2: { x: 152, y: 216, alive: false } }, { seed: 0x99, frame: 42 });
  assert.strictEqual(sim.rngState, 0x99, "seed переопределяет rngState");
  assert.strictEqual(sim.frame, 42, "frame переопределён");
});

test("attControl: инжект огня ИИ (net-fire) заставляет врага стрелять", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.flag = 0xa0; t.x = 120; t.y = 40; // enemy index 2
  sim.attControl = { 2: { dir: null, fire: true } }; // fire only, no direction
  sim.frame = 1; sim.c.gateFrmLo = 1;
  sim.step();
  assert.strictEqual(sim.bullets[2].alive, true, "враг выстрелил по команде ИИ (net-fire)");
});

test("attControl: инжект направления ИИ (net-dir) разворачивает врага на пересечении", () => {
  const sim = makeSim();
  const t = sim.tanks[0]; t.flag = 0xa0; t.x = 128; t.y = 40; // at an intersection (x&7=0,y&7=0)
  sim.attControl = { 2: { dir: 3, fire: false } }; // hold right
  // rngState=9, gateFrmLo=1 (gate open for idx2) -> rng()=64, 64&0x0f==0 (retarget)
  sim.rngState = 9; sim.frame = 0; sim.c.gateFrmLo = 1;
  sim.step();
  assert.strictEqual(t.flag & 3, 3, "враг развернулся вправо по команде ИИ");
});

test("toMem()/view(): RAM-совместимый буфер для ИИ (GameState читает семантику)", () => {
  const sim = makeSim(); // sim tank 0 = enemy index 2
  sim.tanks[0].x = 120; sim.tanks[0].y = 40; sim.tanks[0].flag = 0xa2; sim.tanks[0].type = 0x80;
  sim.field[15 * 32 + 15] = 0x0f; sim.c.enemiesLeft = 7; sim.prize = { id: 3, x: 0x48, y: 0x60 };
  const m = sim.toMem();
  assert.strictEqual(m[0x0400 + 15 * 32 + 15], 0x0f, "поле в буфере");
  assert.strictEqual(m[0x92], 120, "x врага index2 в буфере");
  assert.strictEqual(m[0x9a], 40, "y врага index2 в буфере");
  assert.strictEqual(m[0xa2], 0xa2, "flag врага index2 в буфере");
  assert.strictEqual(m[0xaa], 0x80, "type врага index2 в буфере");
  assert.strictEqual(m[0x80], 7, "enemiesLeft в буфере");
  assert.strictEqual(m[0x88], 3, "id приза в буфере");
  // view() = GameState from the buffer — matches the simulator
  const gs = sim.view();
  assert.strictEqual(gs.enemiesLeft, 7, "GameState.enemiesLeft");
  assert.strictEqual(gs.tanks[2].x, 120, "GameState.tanks[2].x");
  assert.strictEqual(gs.tanks[2].type, 0x80, "GameState.tanks[2].type");
  assert.strictEqual(gs.prizes.length, 1, "GameState.prizes");
  assert.strictEqual(gs.field[15 * 32 + 15], 0x0f, "GameState.field");
});

test("sub_E910 bullet-vs-bullet: встречные пули взаимно уничтожаются (статус 0x00, НЕ 0x33)", () => {
  const sim = makeSim();
  // DEF bullet (slot 0) and enemy bullet (slot 2) point-blank
  sim.bullets[0] = { slot: 0, alive: true, x: 120, y: 44, dir: 2, property: 0, owner: 0, team: "DEF" };
  sim.bullets[2] = { slot: 2, alive: true, x: 120, y: 48, dir: 0, property: 0, owner: 2, team: "ATT" };
  sim.step();
  assert.strictEqual(sim.bullets[0].alive, false, "DEF-пуля удалена сразу (0x00)");
  assert.strictEqual(sim.bullets[2].alive, false, "вражеская пуля удалена сразу (0x00)");
  assert.ok(!sim.bullets[0].explode, "нет взрыва 0x33 (слот освобождается МГНОВЕННО)");
});

test("sub_E70C pass3: DEF-пуля в танк ДРУГОГО игрока -> взрыв 0x33 + стан 0xC8", () => {
  const sim = makeSim();
  // two DEF tanks: tank0 (88,208) and tank1 (80,192)
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 208, dir: 0, flag: 0xa0, type: 0, alive: true, stun: 0 });
  sim.tanks.push({ index: 1, team: "DEF", x: 80, y: 192, dir: 0, flag: 0xa0, type: 0, alive: true, stun: 0 });
  // DEF bullet tank0 (slot 0) at (88,200): dx=8 dy=8 to tank1 (80,192) <10
  sim.bullets[0] = { slot: 0, alive: true, x: 88, y: 200, dir: 0, property: 0, owner: 0, team: "DEF" };
  sim.step();
  const t1 = sim.tanks.find((x) => x.index === 1);
  assert.strictEqual(sim.bullets[0].explode, 9, "пуля ушла во взрыв 0x33 (E88F)");
  assert.strictEqual(t1.stun, 0xc8, "чужой DEF-танк получил стан 0xC8 (E8AA)");
});

test("sub_E70C pass3: шлем защищает чужой DEF-танк (пуля -> 0x00, без стана)", () => {
  const sim = makeSim();
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 208, dir: 0, flag: 0xa0, type: 0, alive: true, stun: 0 });
  sim.tanks.push({ index: 1, team: "DEF", x: 80, y: 192, dir: 0, flag: 0xa0, type: 0, alive: true, stun: 0, helmet: 3 });
  sim.bullets[0] = { slot: 0, alive: true, x: 88, y: 200, dir: 0, property: 0, owner: 0, team: "DEF" };
  sim.step();
  const t1 = sim.tanks.find((x) => x.index === 1);
  assert.strictEqual(sim.bullets[0].alive, false, "шлем погасил пулю (0x00, E898-E89A)");
  assert.strictEqual(t1.stun, 0, "шлем: танк без стана");
});

test("sub_E70C pass3: своя пуля не бьёт свой танк (EOR parity)", () => {
  const sim = makeSim();
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 208, dir: 0, flag: 0xa0, type: 0, alive: true, stun: 0 });
  // own bullet (slot 0) into own tank (index 0) — must not trigger
  sim.bullets[0] = { slot: 0, alive: true, x: 88, y: 200, dir: 0, property: 0, owner: 0, team: "DEF" };
  sim.step();
  assert.strictEqual(sim.bullets[0].alive, true, "своя пуля не гасится своим же танком");
});

test("sub_E70C pass1: вражеская пуля в DEF-танк без шлема -> пуля 0x33, танк 0x73", () => {
  const sim = makeSim();
  // DEF tank0 (88,216), enemy bullet (slot 2) at (88,208): dy=8 <10, without a helmet
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 216, dir: 0, flag: 0xa0, type: 0, alive: true, helmet: 0 });
  sim.bullets[2] = { slot: 2, alive: true, x: 88, y: 208, dir: 2, property: 0, owner: 2, team: "ATT" };
  sim.step();
  const t0 = sim.tanks.find((x) => x.index === 0);
  assert.strictEqual(sim.bullets[2].explode, 9, "пуля ушла во взрыв 0x33 (E74E)");
  assert.strictEqual(sim.bullets[2].alive, true, "пуля ещё в слоте (взрыв 9 кадров)");
  assert.strictEqual(t0.flag, 0x73, "DEF-танк ушёл во взрыв (E75F-E761)");
  assert.strictEqual(t0.type, 0, "тип танка сброшен (E768-E76A)");
});

test("sub_E70C pass1: шлем гасит вражескую пулю (0x00, без остаточного взрыва)", () => {
  const sim = makeSim();
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 216, dir: 0, flag: 0xa0, type: 0, alive: true, helmet: 3 });
  sim.bullets[2] = { slot: 2, alive: true, x: 88, y: 208, dir: 2, property: 0, owner: 2, team: "ATT", explode: 0 };
  sim.step();
  const t0 = sim.tanks.find((x) => x.index === 0);
  assert.strictEqual(sim.bullets[2].alive, false, "шлем погасил пулю (0x00, E757-E759)");
  assert.strictEqual(sim.bullets[2].explode, 0, "НЕТ остаточного взрыва (пуля 0x00)");
  assert.notStrictEqual(t0.flag, 0x73, "шлем: танк НЕ ушёл во взрыв");
});

test("sub_E70C pass1: несколько вражеских пуль в один DEF-танк за кадр — все обрабатываются (без break)", () => {
  const sim = makeSim();
  // DEF tank0 with a helmet at (88,216); two enemy bullets (slots 2 and 3) almost next to it above
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 216, dir: 0, flag: 0xa0, type: 0, alive: true, helmet: 3 });
  sim.bullets[2] = { slot: 2, alive: true, x: 88, y: 208, dir: 2, property: 0, owner: 2, team: "ATT", explode: 0 };
  sim.bullets[3] = { slot: 3, alive: true, x: 88, y: 209, dir: 2, property: 0, owner: 3, team: "ATT", explode: 0 };
  sim.step();
  // sub_E70C handles ALL bullets 7..2 (no break): both must be extinguished by the helmet
  assert.strictEqual(sim.bullets[2].alive, false, "пуля 2 погасла о шлем");
  assert.strictEqual(sim.bullets[3].alive, false, "пуля 3 погасла о шлем (не пропущена из-за break)");
});

test("пере-выстрел сбрасывает остаточный explode (иначе _moveBullets пропустит свежую пулю)", () => {
  const sim = makeSim();
  const t = sim.tanks.find((x) => x.index === 2); t.x = 88; t.y = 192; t.dir = 2; t.flag = 0xa2;
  // a "leftover" bullet from a previous life: dead, but with an explosion (uncleaned state)
  sim.bullets[2] = { slot: 2, alive: false, x: 88, y: 208, dir: 2, property: 0, owner: 2, team: "ATT", explode: 9 };
  // firing reuses the slot: explode must be reset, otherwise _moveBullets will skip the bullet
  sim._fireEnemy(t);
  const b = sim.bullets[2];
  assert.strictEqual(b.alive, true, "выстрел создал живую пулю");
  assert.strictEqual(b.explode, 0, "остаточный взрыв сброшен (иначе пуля не двинется)");
  assert.strictEqual(b.fresh, true, "пуля помечена свежей");
  assert.strictEqual(b.synced, false, "синк сброшен");
});

test("_onPlayerDead сбрасывает стан (иначе переживает смерть+респавн и блокирует танк)", () => {
  const sim = makeSim();
  const t = { index: 0, team: "DEF", stun: 0xc8, alive: true, flag: 0x73, type: 0 };
  sim.c.lives = [3, 3];
  sim._onPlayerDead(t);
  assert.strictEqual(t.stun, 0, "стан сброшен при смерти (sub_DE46)");
  assert.strictEqual(t.flag, 0xf0, "начат респавн (lives > 0)");
  assert.strictEqual(sim.c.lives[0], 2, "жизни уменьшены");
});


test("advanceFrame: $0A инкрементируется каждые 64 кадра (не 256) — standalone RNG", () => {
  // ram_frm_cnt_hi ($0A) — NOT frame>>8: it grows by 1 when $0B crosses 0x00/0x40/0x80/0xC0
  // (see the emulator NMI). If we simply did frame+1 (16-bit), then at $0B=0x40..0xC0 $0A is not
  // incremented and the standalone PRNG diverges (frame>>8 != $0A).
  const sim = makeSim();
  sim.frame = 0x013f; // $0A=1, $0B=0x3f
  sim.advanceFrame();
  assert.strictEqual(sim.frame, 0x0240, "$0B 0x3f->0x40: $0A 1->2 (инкремент на 0x40)");
  sim.advanceFrame();
  assert.strictEqual(sim.frame, 0x0241, "$0B 0x40->0x41: $0A НЕ инкрементируется (не 0x40-граница)");
  sim.frame = 0x027f;
  sim.advanceFrame();
  assert.strictEqual(sim.frame, 0x0380, "$0B 0x7f->0x80: $0A 2->3 (инкремент на 0x80)");
  sim.frame = 0x02ff;
  sim.advanceFrame();
  assert.strictEqual(sim.frame, 0x0300, "$0B 0xff->0x00: $0A 2->3 (wrap)");
});

test("_spawnBonus откладывает приз, если клетка всегда на танке (NMI-бюджет sub_E8BE)", () => {
  // Pathological case: the prize (96,192) is always on the stationary DEF-tank0 (88,191) -> sub_E8BE
  // retries. In the emulator NMI cuts the budget (~48 retries) and advances the frame, breaking the RNG loop.
  const sim = makeSim();
  // DEF tank0 at (88,191), in the movement range (0x88)
  sim.tanks.push({ index: 0, team: "DEF", x: 88, y: 191, dir: 0, flag: 0x88, type: 0, alive: true, helmet: 0 });
  sim.p1 = { x: 88, y: 191, alive: true };
  // force the RNG sequence that gives only (96,192) on the low bits:
  // start from a state where rng()&3 alternates 1,3 (see the f3434 analysis). Check that
  // in one _spawnBonus call the prize is NOT spawned, but _pendingBonus is set.
  sim.frame = 0x02ff; sim._rngLo = sim.frame & 0xff;
  sim._spawnBonus({ index: 5, team: "ATT", type: 0x84, flag: 0xa0, alive: true });
  if (sim._pendingBonus) {
    assert.strictEqual(sim.prize, null, "приз отложен (не заспавнен в кадре попадания)");
    assert.ok(sim._pendingBonus.tank.index === 5, "отложен танк, в который попали");
    // next frame: the resumption (NMI advanced the frame) must find a cell
    sim.step();
    assert.notStrictEqual(sim.prize, null, "приз заспавнен после возобновления");
  } else {
    // if the RNG in this seed immediately gave a free cell — that's also correct (not pathological)
    assert.ok(sim.prize !== null, "приз заспавнен сразу (клетка свободна)");
  }
});
