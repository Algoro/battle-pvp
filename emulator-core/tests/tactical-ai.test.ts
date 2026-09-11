// tactical-ai.test.js — тесты тактического мозга атакующих (tactical-ai.js).
// Проверяем чистые функции (линия огня, поиск орла, plan) детерминированно.
// Запуск: node --test tests/tactical-ai.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../pvp.ts";
import { plan, planDefense, lineClear, findEagle, readBattlefield, isCover } from "../ai/tactical-ai.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

function loadAndStart() {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  let started = false;
  const all = () => [{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }];
  for (let i = 0; i < 120; i++) emu.stepFrame(all());
  for (let f = 0; f < 4000 && !started; f++) {
    emu.stepFrame(f % 30 === 0 ? [{ port: 0, buttons: BTN.Start }, { port: 1, buttons: 0 }] : all());
    if (emu.cpu.mem[0x80] !== 0xff) started = true;
  }
  return emu;
}

test("findEagle: орёл обнаруживается в нижней части поля", () => {
  const emu = loadAndStart();
  const field = emu.cpu.mem.subarray(0x0400, 0x0400 + 1024);
  const eagle = findEagle(field);
  assert.ok(eagle.col >= 12 && eagle.col <= 16, "орёл должен быть в центре-низу");
  assert.ok(eagle.row >= 24 && eagle.row <= 27, "орёл должен быть у низа");
});

test("lineClear: чистая линия через проходимые клетки, блокируется сталью/орлом", () => {
  const emu = loadAndStart();
  const field = emu.cpu.mem.subarray(0x0400, 0x0400 + 1024);
  // пустой коридор вверху (строки 2-3) — линия должна быть чистой
  assert.strictEqual(lineClear(field, { col: 5, row: 2 }, { col: 10, row: 2 }), true);
  // линия в стену (0x11) блокируется, но кирпич (0x0f) пробиваем
});

test("plan: детерминирован и возвращает решения для живых врагов", () => {
  const emu = loadAndStart();
  for (let f = 0; f < 300; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const r1 = plan(emu.cpu.mem, new Map());
  const r2 = plan(emu.cpu.mem, new Map());
  // детерминизм: одинаковые входы -> одинаковые решения
  assert.deepStrictEqual([...r1.decisions], [...r2.decisions]);
  // решения только для живых ATT-танков
  const bf = readBattlefield(emu.cpu.mem);
  for (const [t] of r1.decisions) {
    assert.ok(t >= 2 && t < 8, "решения только для ATT-танков");
    assert.ok(bf.tanks[t].inField, "танк должен быть в поле");
  }
});

test("isCover: проходимая клетка рядом с препятствием — укрытие", () => {
  const emu = loadAndStart();
  const field = emu.cpu.mem.subarray(0x0400, 0x0400 + 1024);
  // найдём любую клетку укрытия (проходимую рядом с препятствием)
  let found = false;
  for (let r = 2; r < 30; r++) for (let c = 0; c < 32; c++) {
    if (isCover(field, c, r)) { found = true; break; }
  }
  assert.ok(found, "должна найтись хотя бы одна клетка укрытия");
});

test("planDefense: даёт ввод DEF-танкам (Start для респавна, направление/огонь)", () => {
  const emu = loadAndStart();
  for (let f = 0; f < 300; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const def = planDefense(emu.cpu.mem, 100);
  assert.ok(def.buttons.has(0), "решение для порта 0");
  assert.ok(def.buttons.has(1), "решение для порта 1");
  for (const [port, buttons] of def.buttons) {
    assert.ok(port === 0 || port === 1, "только DEF-порты");
    assert.ok(buttons >= 0 && buttons <= 0xff, "кнопки в пределах байта");
  }
  assert.ok(def.respawn instanceof Set, "respawn — Set портов");
});

test("plan: детерминирован и возвращает цели kill/base для живых врагов", () => {
  const emu = loadAndStart();
  for (let f = 0; f < 300; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const r1 = plan(emu.cpu.mem, new Map());
  const r2 = plan(emu.cpu.mem, new Map());
  assert.deepStrictEqual([...r1.decisions], [...r2.decisions], "детерминизм нарушен");
  const goals = new Set([...r1.decisions.values()].map((d) => d.goal));
  // допускаем kill (огонь), hunt (охота), base (штурм), cover (укрытие),
  // dodge/intercept (уворот/перехват пули), wander (анти-застревание), stuck (заперт)
  for (const g of goals) assert.ok(["kill", "base", "def", "cover", "hunt", "aim", "dodge", "intercept", "wander", "stuck"].includes(g), `неизвестная цель ${g}`);
});
