// ai-switch.test.js — переключение ИИ на лету + трейс решений (pvp.js).
// Проверяет: setAttAI/setDefAI меняют режим, сбрасывают состояние, не ломают игру;
// трейс собирает события решений/убийств, getTrace/clearTrace и лимит работают.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.js";
import { planDefense } from "../ai/tactical-ai.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function startStage1(opts = {}) {
  const nes = new PvPNes({ noRender: true, ...opts });
  nes.loadROM(readFileSync(join(root, "rom", "disasm", "_battle_city.nes")));
  for (let i = 0; i < 60; i++) nes.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    nes.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) nes.stepFrame([{ port: 0, buttons: 0 }]);
    if (nes.cpu.mem[0x80] === 20) break;
  }
  return nes;
}

test("getAttModes/getDefModes отдают известные режимы; getAttAI/getDefAI — текущие", () => {
  const nes = startStage1({ attAI: "lookahead", defAI: "plan" });
  assert.deepStrictEqual(nes.getAttModes(), ["plan", "scan", "lookahead", "strategy-att", "asm", "off"]);
  assert.deepStrictEqual(nes.getDefModes(), ["plan", "scan", "lookahead", "strategy", "off"]);
  assert.strictEqual(nes.getAttAI(), "lookahead");
  assert.strictEqual(nes.getDefAI(), "plan");
});

test("setAttAI/setDefAI меняют режим на лету и продолжают игру детерминированно", () => {
  const nes = startStage1({ attAI: "plan", defAI: "plan" });
  // прогрев несколько кадров
  for (let f = 0; f < 30; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  nes.setAttAI("scan");
  nes.setDefAI("lookahead");
  assert.strictEqual(nes.getAttAI(), "scan");
  assert.strictEqual(nes.getDefAI(), "lookahead");
  // игра продолжается без исключений и даёт валидный hash
  let h = null;
  for (let f = 0; f < 60; f++) h = nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.match(h, /^[0-9a-f]{8}$/, "кадр продолжает считаться после смены ИИ");
});

test("переключение на неизвестный режим бросает ошибку", () => {
  const nes = startStage1();
  assert.throws(() => nes.setAttAI("nope"), /Неизвестный режим атакующих/);
  assert.throws(() => nes.setDefAI("nope"), /Неизвестный режим защитников/);
});

test("трейс собирает решения ИИ, события смены режима и убийства; clearTrace сбрасывает", () => {
  const nes = startStage1({ attAI: "plan", defAI: "plan" });
  nes.setTraceEnabled(true);
  nes.setTraceCap(1000);
  for (let f = 0; f < 60; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  nes.setAttAI("lookahead");
  nes.setDefAI("scan");
  for (let f = 0; f < 20; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);

  const tr = nes.getTrace();
  assert.ok(tr.length > 0, "трейс непустой");
  // события решений атакующих и защитников
  assert.ok(tr.some((e) => e.side === "att" && e.event === "decision"), "есть решения атакующих");
  assert.ok(tr.some((e) => e.side === "def" && e.event === "decision"), "есть решения защитников");
  // события смены режима
  assert.ok(tr.some((e) => e.event === "attAI" && e.detail === "lookahead"), "залогирована смена attAI");
  assert.ok(tr.some((e) => e.event === "defAI" && e.detail === "scan"), "залогирована смена defAI");
  // каждый трейс-элемент имеет id/frame/side
  for (const e of tr.slice(0, 10)) {
    assert.ok(typeof e.id === "number", "id числовой");
    assert.ok(typeof e.frame === "number", "frame числовой");
  }
  // лимит соблюдается
  nes.setTraceCap(50);
  for (let f = 0; f < 20; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.ok(nes.getTrace().length <= 50, "трейс обрезан по лимиту");
  // очистка
  nes.clearTrace();
  assert.strictEqual(nes.getTrace().length, 0, "clearTrace очищает трейс");
});

test("трейс выключен по умолчанию и не копит события, пока не включён", () => {
  const nes = startStage1();
  for (let f = 0; f < 30; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.strictEqual(nes.getTrace().length, 0, "по умолчанию трейс пуст");
  nes.setTraceEnabled(true);
  nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.ok(nes.getTrace().length > 0, "после включения события копятся");
});

test("attAI 'off' замораживает врагов; defAI 'off' ставит союзника", () => {
  const nes = startStage1({ attAI: "plan", defAI: "plan" });
  // прогрев: даём врагам появиться на поле
  for (let f = 0; f < 200; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  nes.setAttAI("off");
  const pos = () => Array.from({ length: 6 }, (_, i) => `${nes.cpu.mem[0x92 + i]},${nes.cpu.mem[0x9a + i]}`).join("|");
  const p0 = pos();
  for (let f = 0; f < 40; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const p1 = pos();
  assert.strictEqual(p0, p1, "враги не двигаются при 'off'");
  // смена на реальный режим размораживает и игра продолжается
  nes.setAttAI("scan");
  assert.strictEqual(nes.getAttAI(), "scan");
  const h = nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.match(h, /^[0-9a-f]{8}$/);
  // defAI 'off' не роняет кадр
  nes.setDefAI("off");
  const h2 = nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.match(h2, /^[0-9a-f]{8}$/);
});

test("setAttAI не разчеловечивает танк живого игрока (регресс: самопроизвольная стрельба)", () => {
  // Игрок за атакующего (танк 2). Смена ИИ атакующих в меню НЕ должна убирать танк 2
  // из humanTanks, иначе его начинает рулить атакующий ИИ (самопроизвольные выстрелы).
  const nes = startStage1({ attAI: "lookahead", defAI: "lookahead" });
  nes.setHumanTank(2);
  assert.ok(nes.humanTanks.has(2), "танк 2 человеческий до смены");
  nes.setAttAI("scan");
  nes.setAttAI("lookahead");
  assert.ok(nes.humanTanks.has(2), "танк 2 остаётся человеческим после смены ИИ");
  // "off" замораживает ИИ-врагов, но не трогает человеческий танк игрока
  nes.setAttAI("off");
  assert.ok(nes.humanTanks.has(2), "при 'off' танк 2 остаётся человеческим");
  assert.ok(nes.humanTanks.has(3), "ИИ-враг 3 заморожен при 'off'");
  nes.setAttAI("plan");
  assert.ok(nes.humanTanks.has(2), "после возврата танк 2 снова человеческий");
});

test("человеческий ATT-танк не стреляет самопроизвольно (RNG-огонь ASM заблокирован)", () => {
  // Игрок за атакующего (танк 2), defAI="off" — враги не стреляют, танк игрока жив.
  // Без нажатия A слот пули не должен становиться 0x40 (самопроизвольный выстрел),
  // а при нажатии A — должен стрелять легитимно.
  const nes = startStage1({ attAI: "lookahead", defAI: "off" });
  nes.setHumanTank(2);
  const alive = () => { const f = nes.cpu.mem[0xa2]; const h = f & 0xf0; return h >= 0x90 && h <= 0xd0; };
  let sp = 0, firing = false;
  for (let f = 0; f < 800; f++) {
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: 0 }]);
    const b = nes.cpu.mem[0xcc + 2];
    const live = (b & 0xf0) === 0x40;
    if (live && !firing) sp++;
    firing = live;
  }
  assert.ok(alive(), "танк 2 жив");
  assert.strictEqual(sp, 0, "без A танк 2 не стреляет самопроизвольно");
  // легитимная стрельба по кнопке работает
  let leg = 0; firing = false;
  for (let f = 0; f < 100; f++) {
    const A = (f >= 30 && f < 35) ? BTN.A : 0;
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: A }]);
    const b = nes.cpu.mem[0xcc + 2];
    const live = (b & 0xf0) === 0x40;
    if (live && !firing && f >= 30 && f < 35) leg++;
    firing = live;
  }
  assert.ok(leg >= 1, "при нажатии A танк 2 стреляет (легитимно)");
});

test("стоящий человеческий ATT-танк не анимирует гусеницы (нет дёрганья)", () => {
  const nes = startStage1({ attAI: "lookahead", defAI: "off" });
  nes.setHumanTank(2);
  const alive = () => { const f = nes.cpu.mem[0xa2]; const h = f & 0xf0; return h >= 0x90 && h <= 0xd0; };
  let started = nes.cpu.mem[0x80] !== 0xff;
  for (let f = 0; f < 400; f++) {
    if (nes.cpu.mem[0x80] !== 0xff) started = true;
    const autoRespawn = started && !alive() && f % 30 === 0;
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: autoRespawn ? BTN.Start : 0 }]);
    if (alive()) break;
  }
  // даём танку пройти (чтобы был lastPlayerDir) и стоим без ввода
  for (let f = 0; f < 20; f++) nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: BTN.Down }]);
  let wheelChanges = 0, prev = null;
  for (let f = 0; f < 40; f++) {
    const w = nes.cpu.mem[0xb2]; // tank_wheels[2]
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: 0 }]);
    if (prev !== null && w !== nes.cpu.mem[0xb2]) wheelChanges++;
    prev = nes.cpu.mem[0xb2];
  }
  assert.strictEqual(wheelChanges, 0, "гусеницы не анимируются у стоящего танка (нет дёрганья)");
});

test("planDefense управляет DEF-танком в состоянии 0x80 (не выпадает из-под контроля)", () => {
  // Регресс: раньше planDefense использовал строгий aliveFlag (0x90..0xd0) для проверки
  // inField. Флаг DEF-танка в норме гуляет по 0x80..0x8f (крутятся гусеницы/поворот), и в
  // этот момент защитник «выпадал» из-под контроля ИИ — не двигался и не стрелял, пока
  // флаг не вернётся в 0x90+. Это делало защитника «тупым»/замирающим.
  const nes = startStage1({ attAI: "plan", defAI: "plan" });
  const m = nes.cpu.mem;
  // выровняем DEF0 (88,200) и врага t2 (88,120) в одной колонке, очистим линию
  m[0x90] = 88; m[0x98] = 200; m[0xa0] = 0xa0;
  m[0x92] = 88; m[0x9a] = 120; m[0xa2] = 0xa0; m[0xaa] = 0x80;
  for (let r = 15; r < 26; r++) m[0x400 + r * 32 + 11] = 0;
  // DEF0 в состоянии 0x80 (0x84), DEF1 в 0xa0 — оба должны управляться planDefense.
  m[0xa0] = 0x84; m[0xa1] = 0xa0;
  let controlled0 = false, controlled1 = false;
  for (let f = 0; f < 5; f++) {
    const res = planDefense(m, f);
    if ((res.buttons.get(0) || 0) !== 0) controlled0 = true;
    if ((res.buttons.get(1) || 0) !== 0) controlled1 = true;
    m[0xa0] = 0x84; m[0xa1] = 0xa0;
    nes.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  }
  assert.ok(controlled0, "DEF0 в состоянии 0x80 должен управляться planDefense (не выпадать)");
  assert.ok(controlled1, "DEF1 в состоянии 0xa0 должен управляться planDefense");
});
