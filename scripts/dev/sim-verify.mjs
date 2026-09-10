// sim-verify.mjs — покадровая сверка JS-модели движения/коллизий (sim-model)
// с оригинальным эмулятором на маленьких тестовых уровнях.
// Для каждого сценария: инжектим поле, гоняем врага через NET_DIR в направлении dir,
// снимаем фактический путь танка и сравниваем с traceMovement().
//
// Запуск: node scripts/sim-verify.mjs
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { traceMovement, canLead } from "../emulator-core/sim/sim-model.js";
import { TILE } from "../emulator-core/model/game-view.js";

const ROM = new URL("../rom/disasm/_battle_city.nes", import.meta.url).pathname;
const W = 0x11; // стена
const B = 0x0f; // кирпич
const E = 0x00; // пусто

// Строим поле 32x32 из массива строк: '#' стена, 'B' кирпич, '.' пусто.
function makeField(rows) {
  const f = new Uint8Array(32 * 32);
  for (let r = 0; r < 32; r++) for (let c = 0; c < 32; c++) {
    const ch = r < rows.length && c < rows[r].length ? rows[r][c] : ".";
    f[r * 32 + c] = ch === "#" ? W : ch === "B" ? B : E;
  }
  return f;
}

function startEmu(field) {
  const e = new PvPNes({ attAI: "asm", defAI: "none", noRender: true });
  e.loadROM(readFileSync(ROM));
  for (let i = 0; i < 60; i++) e.stepFrame([{ port: 0, buttons: 0 }]);
  for (let a = 0; a < 12; a++) {
    e.stepFrame([{ port: 0, buttons: BTN.Start }]);
    for (let i = 0; i < 30; i++) e.stepFrame([{ port: 0, buttons: 0 }]);
    if (e.cpu.mem[0x80] === 20) break;
  }
  e.cpu.mem.set(field, 0x400);
  // убиваем все танки, кроме тестового (2), чтобы не мешали/не респавнились
  for (let t = 0; t < 8; t++) if (t !== 2) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
  return e;
}

// Прогон в эмуляторе: танк-враг (2) из (sx,sy) движется в dir через ПОРТ 2 (сетевой
// ввод, ASM следует направлению; на блоке враг может повернуть, поэтому меряем МАКС
// продвижение по dir до поворота).
function emuPath(field, sx, sy, dir, frames = 2000) {
  const DIR_BTN = [0x10, 0x40, 0x20, 0x80]; // Up, Left, Down, Right
  const e = startEmu(field);
  e.cpu.mem[0x92] = sx; e.cpu.mem[0x9a] = sy; e.cpu.mem[0xa2] = 0xa0 | dir;
  e.cpu.mem[0xaa] = 0x80; // basic enemy
  const path = [];
  let lastMoved = 0;
  const start = { x: e.cpu.mem[0x92], y: e.cpu.mem[0x9a] };
  for (let f = 0; f < frames; f++) {
    const bx = e.cpu.mem[0x92], by = e.cpu.mem[0x9a];
    e.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: DIR_BTN[dir] }]);
    for (let t = 0; t < 8; t++) if (t !== 2) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
    const ax = e.cpu.mem[0x92], ay = e.cpu.mem[0x9a];
    if (ax !== bx || ay !== by) { path.push({ x: ax, y: ay }); lastMoved = f; }
    else if (f - lastMoved > 40) break;
  }
  return { path, start };
}

function runScenario(name, rows, sx, sy, dir) {
  const field = makeField(rows);
  const { path: actual, start } = emuPath(field, sx, sy, dir);
  const sim = traceMovement(start, dir, field);
  // МАКСИМАЛЬНОЕ продвижение по оси dir в эмуляторе (до блокировки), а не итоговое
  // (после блокировки танк может «гулять» вбок по своей AI-логике).
  const axis = dir === 2 || dir === 0 ? "y" : "x";
  const origin = dir === 2 || dir === 0 ? start.y : start.x;
  const sgn = (dir === 2 || dir === 3) ? 1 : -1;
  let aExtent = 0;
  for (const p of actual) { const d = (p[axis] - origin) * sgn; if (d > aExtent) aExtent = d; }
  const sExtent = (sim.final[axis] - origin) * sgn;
  const delta = Math.abs(aExtent - sExtent);
  const ok = delta <= 1;
  if (!ok) console.log(`    [старт=${JSON.stringify(start)} эмул.путь=${actual.length} точек: ${JSON.stringify(actual.slice(0,5))}]`);
  console.log(
    `${name}: эмулятор макс=${aExtent}px | модель=${sExtent}px | ${ok ? "OK" : "НЕ СОВПАЛО (delta=" + delta + ")"}`
  );
  return { name, ok };
}

// --- тестовые уровни (маленькие) ---
// Бордюр — стены по краям (иначе танк упрётся в край поля).
function bordered(inner) {
  const rows = Array.from({ length: 32 }, () => "#".repeat(32));
  for (let r = 1; r < 31; r++) {
    const line = inner[r - 1] ?? ".".repeat(30);
    rows[r] = "#" + line.padEnd(30, ".").slice(0, 30) + "#";
  }
  return rows;
}

const scenarios = [
  ["открытое поле: вниз", bordered(Array.from({ length: 30 }, () => ".".repeat(30))), 8 * 8, 8 * 8, 2],
  ["открытое поле: вправо", bordered(Array.from({ length: 30 }, () => ".".repeat(30))), 8 * 8, 8 * 8, 3],
  ["стена впереди: вниз", bordered([...Array.from({ length: 10 }, () => ".".repeat(30)), "##############################", ...Array.from({ length: 19 }, () => ".".repeat(30))]), 15 * 8, 8 * 8, 2],
  ["кирпич впереди: вниз", bordered([...Array.from({ length: 6 }, () => ".".repeat(30)), "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", ...Array.from({ length: 23 }, () => ".".repeat(30))]), 15 * 8, 8 * 8, 2],
  ["коридор: вправо", bordered([...Array.from({ length: 13 }, () => ".".repeat(30)), "##############################", ...Array.from({ length: 2 }, () => ".".repeat(30)), "##############################", ...Array.from({ length: 13 }, () => ".".repeat(30))]), 8 * 8, 15 * 8, 3],
  ["уступ (препятствие слева от пути): вниз", bordered([...Array.from({ length: 8 }, () => ".".repeat(30)), "################", ...Array.from({ length: 21 }, () => ".".repeat(30))]), 15 * 8, 8 * 8, 2],
  // скольжение вдоль стены: танк идёт вправо, стена НИЖЕ (не перекрывает переднюю кромку) — должен скользить свободно
  ["скольжение вдоль стены ниже: вправо", bordered([...Array.from({ length: 14 }, () => ".".repeat(30)), "##############################", ...Array.from({ length: 15 }, () => ".".repeat(30))]), 8 * 8, 12 * 8, 3],
  // тонкий проход: кирпич на пути, танк может пройти только через узкий проход вправо
  ["препятствие впереди с проходом: вправо", bordered([...Array.from({ length: 13 }, () => ".".repeat(30)), "#............................#", ...Array.from({ length: 16 }, () => ".".repeat(30))]), 4 * 8, 14 * 8, 3],
];

let fails = 0;
for (const [name, rows, sx, sy, dir] of scenarios) {
  const r = runScenario(name, rows, sx, sy, dir);
  if (!r.ok) fails++;
}
console.log(`\nДвижение/коллизии: ${scenarios.length - fails}/${scenarios.length} сценариев совпали с эмулятором`);

// --- Разрушение кирпича с 4 сторон: танк-игрок стреляет в кирпич, тайл идёт по
//     brickHit (убирает половину, обращённую к пуле). Сверяем с эмулятором.
import { brickHit } from "../emulator-core/model/game-view.js";
function verifyDestruction() {
  const sides = { 0: "снизу", 2: "сверху", 3: "слева", 1: "справа" };
  const tankPos = (dir) => dir === 0 ? { x: 68, y: 136 } : dir === 2 ? { x: 68, y: 72 } : dir === 3 ? { x: 40, y: 108 } : { x: 96, y: 108 };
  let all = true;
  for (const dir of [0, 2, 3, 1]) {
    const e = startEmu(makeField(bordered(Array.from({ length: 30 }, () => ".".repeat(30)))));
    e.cpu.mem[0x400 + 13 * 32 + 8] = 0x0f;
    for (let t = 1; t < 8; t++) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
    const p = tankPos(dir);
    e.cpu.mem[0x90] = p.x; e.cpu.mem[0x98] = p.y; e.cpu.mem[0xa0] = 0xa0 | dir;
    let lastT = 0x0f, seq = [0x0f];
    for (let f = 0; f < 60; f++) {
      const fire = e.cpu.mem[0xcc] === 0 ? BTN.A : 0;
      e.stepFrame([{ port: 0, buttons: fire }, { port: 1, buttons: 0 }]);
      for (let t = 1; t < 8; t++) { e.cpu.mem[0xa0 + t] = 0; e.cpu.mem[0x90 + t] = 255; e.cpu.mem[0x98 + t] = 255; }
      const tile = e.cpu.mem[0x400 + 13 * 32 + 8];
      if (tile !== lastT) { seq.push(tile); lastT = tile; if (tile === 0x00) break; }
    }
    // модель: brickHit от 0x0f дважды в том же направлении
    const pred = [0x0f]; let v = 0x0f;
    for (let i = 0; i < 4 && v !== 0x00; i++) { const r = brickHit(v, dir); v = r.next; pred.push(v); }
    const ok = JSON.stringify(seq) === JSON.stringify(pred);
    if (!ok) all = false;
    console.log(`Разрушение (${sides[dir]}): эмулятор=${seq.map((x) => "0x" + x.toString(16)).join("->")} | модель=${pred.map((x) => "0x" + x.toString(16)).join("->")} | ${ok ? "OK" : "НЕ СОВПАЛО"}`);
  }
  return all;
}
verifyDestruction();

