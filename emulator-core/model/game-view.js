// game-view.js — ЕДИНЫЙ слой доступа к состоянию боя и общие примитивы для всех ИИ.
//
// A. GameState/readState: чистая модель боя (танки, пули, призы, орёл, поле) +
//    хелперы (passable/brick/lineClear/dist/dirTo/cellOf) вместо разрозненных
//    функций и сырых адресов RAM.
// B. buildState: декларативный построитель состояния для тестов (без магии адресов).
// C. wrap: живой адаптер поверх PvPNes (GameState из RAM эмулятора + настройка ИИ).
// D. runBrain: единая точка запуска любого ИИ-движка (унификация сигнатур).
//
// Все движки (tactical/scan/lookahead) и тесты используют этот слой.

import { RAM } from "../rom-contract.js";

export const FIELD = 32;
export const TILE = 8;
export const DEF_END = 2; // первые 2 танка — защитники

// Направления (0=Up,1=Left,2=Down,3=Right — как в ASM)
export const DX = [0, -1, 0, 1];
export const DY = [-1, 0, 1, 0];
export const DIR_BTN = [0x10, 0x40, 0x20, 0x80];

// --- примитивы тайлов ---
export function inBounds(c, r) { return c >= 0 && r >= 0 && c < FIELD && r < FIELD; }
export function cellIdx(c, r) { return r * FIELD + c; }
export function tankPassable(v) { return v === 0x00 || (v >= 0x20 && v < 0x80); }
// Разрушаемые кирпичи в runtime-буфере коллизий ($0400): 0x01-0x0F — все комбинации квадрантов
// кирпича (0x0f целый, 0x0c/0x03/0x0a/0x05 — половины, 0x1/0x2/0x4/0x8 и их комбинации — мелкие),
// плюс 0x13/0x14 (варианты стадий). Сталь 0x10/0x11 — НЕ разрушается (блокирует пули), это не кирпич.
export function isBrick(v) { return (v >= 0x01 && v <= 0x0f) || v === 0x13 || v === 0x14; }
export function blocksBullet(v) { return v !== 0 && !(v >= 0x20 && v < 0x80) && !isBrick(v); }
export function isEagleTile(v) { return v >= 0xc8 && v <= 0xcb; }
export function dist(a, b) { return Math.abs(a.col - b.col) + Math.abs(a.row - b.row); }

// Прочность кирпича: сколько выстрелов нужно для разрушения (для «бить слабые стены»).
// 0x0f — целый (2), повреждённые 0x0c/0x03/0x13/0x14 — ещё 1.
export function brickHealth(v) { return v === 0x0f ? 2 : isBrick(v) ? 1 : 0; }

// Кирпич = 4 квадранта (биты): bit0=TL(1), bit1=TR(2), bit2=BL(4), bit3=BR(8).
// Пуля убирает ПОЛОВИНУ, обращённую к ней (по направлению), а если она уже пуста —
// продолжает и убирает дальнюю; если обе пусты — пуля проходит насквозь.
const BRICK_HALF = {
  0: { near: 0x0c, far: 0x03 }, // пуля вверх (из-под низа): ближняя=низ, дальняя=верх
  2: { near: 0x03, far: 0x0c }, // пуля вниз (сверху): ближняя=верх, дальняя=низ
  3: { near: 0x05, far: 0x0a }, // пуля вправо (слева): ближняя=лево, дальняя=право
  1: { near: 0x0a, far: 0x05 }, // пуля влево (справа): ближняя=право, дальняя=лево
};
export function brickHit(tile, dir) {
  const h = BRICK_HALF[dir] ?? { near: 0, far: 0 };
  if (tile & h.near) return { next: tile & ~h.near, pass: false };
  if (tile & h.far) return { next: tile & ~h.far, pass: false };
  return { next: tile, pass: true }; // весь кирпич пуст — пуля проходит
}

// Класс скорости врага по типу (приближённо): 0x80=обычный, 0xA0=быстр.пули,
// 0xC0=быстрый танк, 0xE0=бронированный. Игроки (type<0x80) — 1.0.
export function enemySpeedClass(type) {
  if (type < 0x80) return 1.0;
  const base = type & 0xf0;
  if (base === 0xc0) return 1.6;
  if (base === 0xe0) return 0.8;
  return 1.0;
}
export function dirTo(a, b) {
  if (a.row === b.row && a.col !== b.col) return b.col > a.col ? 3 : 1;
  if (a.col === b.col && a.row !== b.row) return b.row > a.row ? 2 : 0;
  return null;
}
export function cellOf(x, y) { return { col: Math.floor(x / TILE), row: Math.floor(y / TILE) }; }

// Проходимость клетки для танка по полю.
export function cellPassable(field, c, r) { return inBounds(c, r) && tankPassable(field[cellIdx(c, r)]); }

// --- классификация тайлов (значения из буфера коллизий $0400) ---
// 0x12 = вода (танк не проходит, пуля пролетает), 0x21 = лёд (танк скользит),
// 0x22 = деревья/кусты (скрывают, но проходимы), 0x10/0x11 = сталь.
export const WATER_TILE = 0x12;
export const ICE_TILE = 0x21;
export const TREE_TILE = 0x22;
export function isWater(v) { return v === WATER_TILE; }
export function isIce(v) { return v === ICE_TILE; }
export function isTree(v) { return v === TREE_TILE; }
export function isSteel(v) { return v === 0x10 || v === 0x11; }
export function isRoad(v) { return v >= 0x20 && v < 0x80 && v !== ICE_TILE && v !== TREE_TILE; }

// Семантический тип тайла (для стратегии): 'empty'|'brick'|'steel'|'water'|'tree'|'ice'|'road'.
export function tileType(v) {
  if (v === 0x00) return "empty";
  if (isBrick(v)) return "brick";
  if (isSteel(v)) return "steel";
  if (isWater(v)) return "water";
  if (isIce(v)) return "ice";
  if (isTree(v)) return "tree";
  if (isRoad(v)) return "road";
  return "unknown";
}

// Стоимость прохода для маршрутизации (дизайн защитного ИИ):
//   empty=1, road=1, brick=3 (простреливается), steel=∞, water=∞, tree=1.2, ice=1.5.
// Возвращает бесконечность для непроходимых тайлов.
export function tileCost(v) {
  switch (tileType(v)) {
    case "empty": case "road": return 1;
    case "brick": return 3;
    case "tree": return 1.2;
    case "ice": return 1.5;
    case "steel": case "water": return Infinity;
    default: return Infinity;
  }
}
export function tileCostAt(field, c, r) { return inBounds(c, r) ? tileCost(field[cellIdx(c, r)]) : Infinity; }

// На льду ли клетка (для скольжения/нестабильных манёвров).
export function onIceTile(field, c, r) { return inBounds(c, r) && isIce(field[cellIdx(c, r)]); }

// Скорость пули (px/кадр) по типу танка-стрелка. Обычные 2px; пули с property bit1
// (типы 0x20/0x40/0x60/0xC0) — 4px (ofs_E051: sub_E063 ×2).
export function bulletProperty(type) {
  const hi = type & 0xf0;
  if (hi === 0x60) return 3;
  if (hi === 0xc0 || hi === 0x20 || hi === 0x40) return 1;
  return 0;
}
export function bulletSpeed(type) { return (bulletProperty(type) & 0x01) ? 4 : 2; }

// Оставшиеся жизни игрока (0..): port 0 — $0051, port 1 — $0052.
export function playerLives(mem, port) { return mem[RAM.LIVES + port]; }
// Уровень апгрейда игрока (звёзды 0..3): $0101/$0102.
export function playerLevel(mem, port) { return mem[RAM.TANK_UPGRADE + port]; }

// Сколько попаданий выдерживает враг по типу. Мигающий (бонусный, bit2) — 1.
// Бронированный (0xE0..0xE7): (type & 3) — число брони, финальный выстрел добивает.
export function hitsLeft(type) {
  if (type & 0x04) return 1;
  if ((type & 0xf0) === 0xe0) return (type & 0x03) + 1;
  return 1;
}

// Линия огня: проходит, если между клетками нет непробиваемых препятствий (кирпич — ок).
export function lineClear(field, a, b) {
  const dc = Math.sign(b.col - a.col), dr = Math.sign(b.row - a.row);
  let c = a.col + dc, r = a.row + dr;
  while (c !== b.col || r !== b.row) {
    if (!inBounds(c, r) || blocksBullet(field[cellIdx(c, r)])) return false;
    c += dc; r += dr;
  }
  return true;
}

// Ценность призов. id: 0=каска,1=часы,2=лопата,3=звезда,4=граната,5=жизнь.
export const PRIZE_VALUE = { 0: 95, 1: 70, 2: 50, 3: 85, 4: 100, 5: 60 };
export function prizeValue(id) { return PRIZE_VALUE[id] ?? 0; }

function aliveFlag(flag) { const hi = flag & 0xf0; return hi >= 0x90 && hi <= 0xd0; }

// ---------------------------------------------------------------------------
// A. GameState
// ---------------------------------------------------------------------------
export class GameState {
  constructor(mem) {
    this.mem = mem;
    this.field = mem.subarray(RAM.FIELD, RAM.FIELD + FIELD * FIELD);
    this._read();
  }
  _read() {
    const mem = this.mem;
    // Состояние уровня/эффектов (для стратегии и эксплуатации).
    this.enemiesLeft = mem[RAM.ENEMIES_LEFT];     // сколько врагов осталось до победы
    this.spawnTimer = mem[RAM.SPAWN_TIMER];      // таймер спавна врагов
    this.fortified = mem[RAM.FORTIFIED] > 0;   // лопата: база укреплена
    this.clockTimer = mem[RAM.CLOCK_TIMER];    // часы: враги заморожены (не стреляют)
    this.tanks = [];
    for (let t = 0; t < 8; t++) {
      const flag = mem[RAM.TANK_FLAG + t], x = mem[RAM.TANK_X + t], y = mem[RAM.TANK_Y + t];
      const type = mem[RAM.TANK_TYPE + t];
      const cell = cellOf(x, y);
      this.tanks.push({
        index: t, team: t < DEF_END ? "DEF" : "ATT", x, y, flag, type,
        dir: flag & 0x03,                          // направление взгляда (0..3)
        flashing: t >= DEF_END && (type & 0x04) !== 0,
        alive: aliveFlag(flag), inField: aliveFlag(flag) && x < 255,
        helmet: t < DEF_END && mem[RAM.HELMET + t] > 0,  // каска (неуязвимость, DEF)
        stunned: t < DEF_END && mem[RAM.STUN + t] > 0, // ошеломление (DEF)
        speedClass: enemySpeedClass(type),         // класс скорости врага
        hitsLeft: t >= DEF_END ? hitsLeft(type) : 1,
        bulletSpeed: bulletSpeed(type),            // скорость пули стрелка
        cell,
        onIce: t < DEF_END && isIce(this.field[cellIdx(cell.col, cell.row)]),
      });
    }
    // Стратегическое состояние защитников (уровень/жизни).
    this.defenders = [0, 1].map((p) => ({
      level: Math.min(3, playerLevel(mem, p)),
      lives: playerLives(mem, p),
      tank: this.tanks[p],
    }));
    this.bullets = [];
    for (let t = 0; t < 8; t++) {
      const status = mem[RAM.BULLET_STATUS + t];
      if ((status & 0xf0) === 0x40) {
        const x = mem[RAM.BULLET_X + t], y = mem[RAM.BULLET_Y + t];
        this.bullets.push({ owner: t, team: t < DEF_END ? "DEF" : "ATT", dir: status & 0x03, x, y, cell: cellOf(x, y) });
      }
    }
    this.prizes = [];
    const pid = mem[RAM.PRIZE_ID];
    if (pid !== 0xff) this.prizes.push({ id: pid, value: prizeValue(pid), x: mem[RAM.PRIZE_X], y: mem[RAM.PRIZE_Y], cell: cellOf(mem[RAM.PRIZE_X], mem[RAM.PRIZE_Y]) });
    this.eagle = this._findEagle();
  }
  _findEagle() {
    for (let r = 15; r < 30; r++) for (let c = 0; c < FIELD; c++) {
      if (isEagleTile(this.field[cellIdx(c, r)])) return { col: c, row: r };
    }
    return { col: 15, row: 26 };
  }
  // хелперы
  passable(c, r) { return inBounds(c, r) && tankPassable(this.field[cellIdx(c, r)]); }
  brick(c, r) { return inBounds(c, r) && isBrick(this.field[cellIdx(c, r)]); }
  brickHealth(c, r) { return inBounds(c, r) ? brickHealth(this.field[cellIdx(c, r)]) : 0; }
  stepPassable(c, r) { return inBounds(c, r) && (tankPassable(this.field[cellIdx(c, r)]) || isBrick(this.field[cellIdx(c, r)])); }
  lineClear(a, b) { return lineClear(this.field, a, b); }
  // классификация тайлов и стоимости (стратегический слой)
  tileType(c, r) { return inBounds(c, r) ? tileType(this.field[cellIdx(c, r)]) : "unknown"; }
  water(c, r) { return inBounds(c, r) && isWater(this.field[cellIdx(c, r)]); }
  tree(c, r) { return inBounds(c, r) && isTree(this.field[cellIdx(c, r)]); }
  ice(c, r) { return inBounds(c, r) && isIce(this.field[cellIdx(c, r)]); }
  tileCost(c, r) { return tileCostAt(this.field, c, r); }
  // Тестовый хук: штатно активирует бонус (как в PvPNes.spawnBonus).
  spawnBonus(id, x, y) { this.mem[RAM.PRIZE_X] = x; this.mem[RAM.PRIZE_Y] = y; this.mem[RAM.PRIZE_ID] = id; this.mem[RAM.BONUS_TIMER] = 0; }
  refresh() { this._read(); return this; }
}

export function readState(mem) { return new GameState(mem); }

// ---------------------------------------------------------------------------
// B. buildState — декларативный построитель состояния для тестов.
//    field: массив строк, символы: '.' пусто, '#' стена/сталь, 'B' кирпич, 'E' орёл.
//    tanks: [{i, x, y, team?}] ; bullets: [{i, x, y, dir, team?}] ; prize: {id, x, y}.
// ---------------------------------------------------------------------------
const TILE_CODE = { ".": 0x00, "#": 0x11, B: 0x0f, W: 0x12, I: 0x21, T: 0x22 };
export function buildState({ field, tanks = [], bullets = [], prize = null, eagle = null } = {}) {
  const mem = new Uint8Array(0x10000);
  mem[RAM.ENEMIES_LEFT] = 20; // игра началась
  mem[0x7f] = 20; // счётчик спавна врагов (декрементится при спавне)
  if (field) {
    for (let r = 0; r < field.length; r++) {
      for (let c = 0; c < field[r].length; c++) {
        const ch = field[r][c];
        const tile = ch === "E" ? 0xc8 : (TILE_CODE[ch] ?? 0x00);
        mem[0x400 + r * 32 + c] = tile;
      }
    }
  }
  if (eagle) mem[0x400 + eagle.row * 32 + eagle.col] = 0xc8;
  if (prize) { mem[RAM.PRIZE_ID] = prize.id; mem[RAM.PRIZE_X] = prize.x; mem[RAM.PRIZE_Y] = prize.y; }
  else mem[RAM.PRIZE_ID] = 0xff;
  // танки
  for (const tk of tanks) {
    const i = tk.i, x = tk.x ?? 255, y = tk.y ?? 255;
    mem[0x90 + i] = x; mem[0x98 + i] = y; mem[0xa0 + i] = x === 255 ? 0 : 0xa0;
    if (tk.type !== undefined) mem[0xa8 + i] = tk.type;
  }
  // пули
  for (const bl of bullets) {
    mem[0xcc + bl.i] = bl.dir | 0x40; mem[0xb8 + bl.i] = bl.x; mem[0xc2 + bl.i] = bl.y;
  }
  return new GameState(mem);
}

// ---------------------------------------------------------------------------
// C. wrap — живой адаптер поверх эмулятора PvPNes.
// ---------------------------------------------------------------------------
export function wrap(emu) {
  return {
    emu,
    get state() { return new GameState(emu.cpu.mem); }, // свежий срез каждый доступ
    get tanks() { return this.state.tanks; },
    get bullets() { return this.state.bullets; },
    get prizes() { return this.state.prizes; },
    get eagle() { return this.state.eagle; },
    brain: {
      attacker(mode) { emu._attAI = mode; return this; },
      defender(mode) { emu._defAI = mode; return this; },
    },
    spawnPrize(id, x, y) { emu.spawnBonus(id, x, y); },
    frame(inputs) { return emu.stepFrame(inputs ?? [{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]); },
  };
}
