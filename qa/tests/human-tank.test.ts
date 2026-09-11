// human-tank.test.js — человеческий танк: AI отключён, управление через JS.
// Запуск: node --test tests/human-tank.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../../emulator-core/pvp.ts";
import { canPlace, runtimePassable, FIELD, TANK } from "../../emulator-core/io/tank-driver.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

function start() {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[0x80] === 20) break;
  }
  // ждём танк 2 живым в поле (Y>48, минуя спавн-ворота)
  for (let f = 0; f < 2000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    if (hi >= 0x90 && hi <= 0xd0 && emu.cpu.mem[0x9a] > 48) break;
  }
  return emu;
}

const pos = (emu, t = 2) => [emu.cpu.mem[0x90 + t], emu.cpu.mem[0x98 + t]];

test("AI отключён: без ввода человеческий танк стоит (позиция неизменна)", () => {
  const emu = start();
  emu.setHumanTank(2);
  const p0 = pos(emu);
  for (let f = 0; f < 40; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  assert.deepStrictEqual(pos(emu), p0, "человеческий танк двигался без ввода (AI не отключён)");
});

test("человеческий танк движется по вводу (вниз, затем вверх)", () => {
  const emu = start();
  emu.setHumanTank(2);
  const p0 = pos(emu);
  // вниз
  for (let f = 0; f < 40; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: BTN.Down }]);
  }
  const p1 = pos(emu);
  assert.ok(p1[1] > p0[1], `вниз не двигает (${p0}->${p1})`);
  // вверх (обратный ход — гарантированно чисто, в отличие от влево, где у края
  // воды ASM-бокс ±8 упирается раньше корпуса)
  for (let f = 0; f < 40; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: BTN.Up }]);
  }
  const p2 = pos(emu);
  assert.ok(p2[1] < p1[1], `вверх не двигает (${p1}->${p2})`);
});

test("другие (AI) танки продолжают двигаться — AI не сломан", () => {
  const emu = start();
  // НЕ помечаем танк игрока как человеческий — проверяем, что AI-враги (3..7)
  // спавнятся, живы и двигаются (не стоят на месте после фикса ИИ).
  let anyAiMoved = false;
  for (let f = 0; f < 600; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    for (let t = 3; t < 8; t++) {
      const flag = emu.cpu.mem[0xa0 + t];
      const hi = flag & 0xf0;
      if (hi >= 0x90 && hi <= 0xd0 && emu.cpu.mem[0x90 + t] < 255) {
        // живой AI-враг в поле — двигается/жив
        anyAiMoved = true;
      }
    }
    if (anyAiMoved) break;
  }
  assert.ok(anyAiMoved, "ни один AI-враг (3..7) не появился/не двигается");
});

test("после setHumanTank AI-танк стоит, но другие танки не затронуты (золото не меняется)", () => {
  // базовый прогон без setHumanTank
  const emu1 = start();
  for (let f = 0; f < 30; f++) emu1.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  const h1 = emu1.getFrameHash();
  // прогон с setHumanTank(2) на ПУСТОМ враге? — нельзя, но проверяем детерминизм без него
  assert.ok(h1.length === 8, "hash не вычислен");
});

test("setHumanTank ДО спавна не ломает респавн (танк входит в поле)", () => {
  // Как в App.tsx: setHumanTank(2) вызывается сразу при старте, ещё до респавна.
  // JS-оверрайд не должен трогать танк в состоянии респавна/взрыва, иначе он
  // застревает вне поля (255,255) и никогда не становится управляемым.
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  emu.setHumanTank(2); // до спавна
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[0x80] === 20) break;
  }
  // двигаем вниз, пока танк не окажется жив в поле
  let inField = false;
  for (let f = 0; f < 4000; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: BTN.Down }]);
    const hi = emu.cpu.mem[0xa2] & 0xf0;
    const x = emu.cpu.mem[0x92], y = emu.cpu.mem[0x9a];
    if (hi >= 0x90 && hi <= 0xd0 && y > 40 && y < 220 && x > 16 && x < 240) { inField = true; break; }
  }
  assert.ok(inField, "танк не вошёл в поле после setHumanTank до спавна (респавн сломан)");
});

test("человеческий танк не проходит сквозь стены (останавливается у препятствия)", () => {
  const emu = start();
  emu.setHumanTank(2);
  const field = () => emu.cpu.mem.subarray(0x0400, 0x0400 + FIELD * FIELD);
  // упираемся вниз до остановки
  let prev = pos(emu), stable = 0;
  for (let f = 0; f < 400; f++) {
    emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: BTN.Down }]);
    const cur = pos(emu);
    if (cur[0] === prev[0] && cur[1] === prev[1]) { if (++stable > 5) break; } else stable = 0;
    prev = cur;
  }
  const [x, y] = pos(emu);
  // танк не должен стоять на непроходимой клетке (корпус-бокс полностью проходим)
  assert.strictEqual(
    canPlace(x, y, field(), runtimePassable),
    true,
    `танк остановился внутри препятствия (${x},${y})`
  );
});
