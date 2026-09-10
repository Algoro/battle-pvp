// field-driver.test.js — tank-driver на РЕАЛЬНОМ runtime-поле из игры (RAM $0400).
// Проверяет: проходимость, движение/блокировку структур на реальном поле.
// Запуск: node --test tests/field-driver.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes, { BTN } from "../../emulator-core/pvp.js";
import { canPlace, stepTank, runtimePassable, FIELD, TILE, TANK } from "../io/tank-driver.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

// Получает runtime-поле 32x32 (байты $0400-$07FF) во время игры.
function getField() {
  const emu = new PvPNes();
  emu.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    emu.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
    if (emu.cpu.mem[0x80] === 20) break;
  }
  for (let f = 0; f < 300; f++) emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
  return emu.cpu.mem.subarray(0x0400, 0x0400 + FIELD * FIELD);
}

test("runtime-поле: есть и проходимые, и блокирующие ячейки", () => {
  const field = getField();
  assert.strictEqual(field.length, FIELD * FIELD);
  const passable = [...field].filter((t) => runtimePassable(t)).length;
  const solid = [...field].filter((t) => !runtimePassable(t)).length;
  assert.ok(passable > 0, "нет проходимых ячеек (пути/вода)");
  assert.ok(solid > 0, "нет структур (стены/база)");
});

test("проходимая клетка: танк может стоять и двигаться", () => {
  const field = getField();
  // найдём проходимую клетку (8px), где танк 13px целиком встаёт
  let start = null;
  for (let y = TILE; y < FIELD * TILE - TANK && !start; y += TILE)
    for (let x = TILE; x < FIELD * TILE - TANK; x += TILE)
      if (canPlace(x, y, field, runtimePassable)) { start = { x, y }; break; }
  assert.ok(start, "не найдена проходимая клетка для танка");
  // сделает шаг хотя бы в одном направлении
  let moved = null;
  for (let d = 0; d < 4; d++) if (stepTank(start, d, field, runtimePassable)) { moved = d; break; }
  assert.ok(moved !== null, `танк не смог шагнуть ни в одну сторону на (${start.x},${start.y})`);
});

test("структура (стена) блокирует танк", () => {
  const field = getField();
  let solidCell = null;
  for (let r = 0; r < FIELD && !solidCell; r++)
    for (let c = 0; c < FIELD; c++)
      if (!runtimePassable(field[r * FIELD + c])) { solidCell = { x: c * TILE, y: r * TILE }; break; }
  assert.ok(solidCell, "нет структуры в поле");
  assert.strictEqual(canPlace(solidCell.x, solidCell.y, field, runtimePassable), false, "танк встал на структуру");
});
