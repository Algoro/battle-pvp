// perception.js — стратегический слой: построение полной картины боя для ИИ
// защитника/атакующего из GameState (read-модель game-view).
//
// В отличие от разрозненных локальных хелперов scan/lookahead, Perception — это
// единый, согласованный снимок:
//   - классификация врагов по типу (basic/fast/power/armor) + скорость/броня/флеш,
//   - оценка угрозы базе ThreatToBase (дизайн §2.2),
//   - очередь спавна (мигающие 4/11/18),
//   - модель пуль (скорость, траектория, точка перехвата),
//   - состояние игроков (уровень/жизни/каска/стан/лёд),
//   - классификация тайлов и стоимости маршрута (делегирует game-view/pathfind).
//
// Чистый слой: perceive(state) -> Perception. Не мутирует состояние.

import { FIELD, DX, DY, inBounds, cellIdx, tankPassable, isBrick, blocksBullet,
  isEagleTile, tileCost, tileType, bulletSpeed, hitsLeft, dirTo, dist, lineClear,
  cellOf, enemySpeedClass, isIce, onIceTile } from "./game-view.js";
import { aStar, pathDirection, pathCost } from "./pathfind.js";

// --- параметры оценки угрозы (дизайн §2.2) ---
export const THREAT_WEIGHTS = { speed: 0.30, los: 0.30, dist: 0.25, power: 0.10, path: 0.05 };
export const DEFAULT_THREAT_WEIGHTS = THREAT_WEIGHTS;

const SPEED_FACTOR = { basic: 0.4, power: 0.5, fast: 1.0, armor: 0.3 };
const POWER_FACTOR = { basic: 0.5, power: 1.0, fast: 0.7, armor: 0.6 };

// Мигающие (бонусные) враги появляются на 4-м, 11-м и 18-м спавне уровня.
export const BLINK_SPAWN_INDICES = [4, 11, 18];
export function isBlinkSpawn(index) { return BLINK_SPAWN_INDICES.includes(index); }

// Класс типа врага по старшим 4 битам типа (0x80 basic, 0xA0 power, 0xC0 fast, 0xE0 armor).
export function enemyClass(type) {
  if (type < 0x80) return "basic";
  switch (type & 0xf0) {
    case 0xc0: return "fast";
    case 0xa0: return "power";
    case 0xe0: return "armor";
    default: return "basic";
  }
}

// Обёртка клетки для удобных вызовов pathfind (позиция {col,row}).
function cell(t) { return { col: t.col, row: t.row }; }

// Предикат «есть линия огня» (кирпич пробивается) между двумя клетками.
export function fireLine(field, a, b) { return lineClear(field, a, b); }

export class Perception {
  constructor(state) {
    this.state = state;
    this.field = state.field;
    this.enemies = [];      // классифицированные враги ATT
    this.defenders = [];    // состояние защитников DEF
    this.bullets = [];      // модель пуль
    this.base = null;       // { col, row, fortified }
    this.spawn = null;      // { enemiesLeft, spawnTimer, spawned, nextBlink }
    this._index = new Map();
  }

  // Классификация врагов с оценкой угрозы базе.
  _enemies() {
    const base = this.base;
    const tw = this.threatWeights ?? THREAT_WEIGHTS;
    const out = [];
    for (const t of this.state.tanks) {
      if (t.team !== "ATT" || !t.inField) continue;
      const cls = enemyClass(t.type);
      const pos = t.cell;
      const dBase = base ? dist(pos, cell(base)) : Infinity;
      const losBase = base ? fireLine(this.field, pos, cell(base)) : false;
      const pathCost_ = base ? pathCost(this.field, pos, cell(base), { allowBreak: true }) : Infinity;
      out.push({
        tank: t, index: t.index, cls,
        speed: enemySpeedClass(t.type),
        flashing: t.flashing,
        hitsLeft: hitsLeft(t.type),
        bulletSpeed: bulletSpeed(t.type),
        cell: pos,
        distToBase: dBase,
        hasLosToBase: losBase,
        pathObstruction: pathCost_,
        threatToBase: threatToBase({ cls, dBase, losBase, pathCost: pathCost_, type: t.type }, tw),
        predicted: predictedCell(this.field, t),
      });
    }
    return out;
  }

  // Модель пуль: скорость по владельцу, пройденные/будущие клетки траектории.
  _bullets() {
    const out = [];
    for (const b of this.state.bullets) {
      const speed = bulletSpeed(this.state.tanks[b.owner].type);
      out.push({
        owner: b.owner, team: b.team, dir: b.dir, x: b.x, y: b.y,
        cell: cellOf(b.x, b.y), speed,
        cells: trajectoryCells(this.field, b, speed),
      });
    }
    return out;
  }

  // Состояние защитников (игроков).
  _defenders() {
    const eagle = this.base;
    return this.state.defenders.map((d, i) => {
      const pos = d.tank.cell;
      return {
        index: i, tank: d.tank,
        level: d.level, lives: d.lives,
        helmet: d.tank.helmet, stunned: d.tank.stunned, onIce: d.tank.onIce,
        cell: { col: pos.col, row: pos.row },
        bulletSpeed: bulletSpeed(d.tank.type),
        busy: (this.state.mem[0xcc + i] & 0xf0) === 0x40,
        distToEagle: eagle ? dist(pos, { col: eagle.col, row: eagle.row }) : Infinity,
        hasLosToEagle: eagle ? lineClear(this.field, pos, { col: eagle.col, row: eagle.row }) : false,
      };
    });
  }

  // Вспомогательные запросы.
  tileType(c, r) { return this.state.tileType(c, r); }
  costAt(c, r) { return this.state.tileCost(c, r); }
  passable(c, r) { return this.state.passable(c, r); }
  // Есть ли линия огня от `from` к `to`.
  lineClear(a, b) { return lineClear(this.field, a, b); }
  // Точка пересечения пули с целью (для leading/counter shot), либо null.
  intercept(shotFrom, bullet) {
    for (const cc of bullet.cells) {
      if (this.lineClear(shotFrom, cc)) return cc;
    }
    return null;
  }
  // Входящие пули ПРОТИВНИКА (oppTeam), которые попадут в клетку (для уворота/опасности).
  danger(cell) {
    const out = [];
    for (const b of this.bullets) {
      if (b.team !== this.oppTeam) continue;
      if (b.cell.col === cell.col && b.cell.row === cell.row) { out.push(b); continue; }
      for (const c of b.cells) {
        if (c.col === cell.col && c.row === cell.row) { out.push(b); break; }
      }
    }
    return out;
  }
}

// Оценка угрозы базе (дизайн §2.2): больше = опаснее.
// e: { cls, dBase, losBase, pathCost, type }.
// weights (необязательно): { speed, los, dist, power, path } — веса компонент.
export function threatToBase(e, weights = THREAT_WEIGHTS) {
  if (e.dBase === Infinity) return 0;
  const speedF = SPEED_FACTOR[e.cls] ?? 0.4;
  const powerF = POWER_FACTOR[e.cls] ?? 0.5;
  const path = isFinite(e.pathCost) ? e.pathCost : 8;
  return weights.speed * speedF
       + weights.los * (e.losBase ? 1 : 0)
       + weights.dist * (1 / (e.dBase + 1))
       + weights.power * powerF
       + weights.path * (1 / path);
}

// Предсказанная клетка врага через 1 шаг (по направлению взгляда), если он быстрый.
export function predictedCell(field, t) {
  if (!t.inField || !(t.speedClass > 1.3)) return cell(t);
  const nc = t.cell.col + DX[t.dir], nr = t.cell.row + DY[t.dir];
  if (!inBounds(nc, nr)) return cell(t);
  return { col: nc, row: nr };
}

// Клетки, которые пройдёт пуля (включая старт), пока не упрётся в препятствие/границу.
// steps — глубина трассировки (по умолчанию 30).
export function trajectoryCells(field, bullet, speed, steps = 30) {
  const cells = [];
  let c = bullet.cell.col, r = bullet.cell.row;
  const dx = DX[bullet.dir], dy = DY[bullet.dir];
  for (let i = 0; i < steps; i++) {
    c += dx; r += dy;
    if (!inBounds(c, r)) break;
    if (blocksBullet(field[cellIdx(c, r)])) break;
    cells.push({ col: c, row: r });
  }
  return cells;
}

// Главная точка входа: perceive(state, opts) -> Perception.
// opts: { role: "def"|"att", threat: {speed,los,dist,power,path} }.
//   - role: для какой команды строим снимок (по умолчанию "def"). Влияет на
//     selfTeam/oppTeam/opponents/allies: для "att" противники = DEF-танки, союзники = ATT.
//   - enemies/defenders — обратная совместимость (def): enemies=ATT, defenders=DEF.
export function perceive(state, opts = {}) {
  const p = new Perception(state);
  p.threatWeights = opts.threat ?? THREAT_WEIGHTS;
  // база (орёл)
  const eagle = state.eagle;
  p.base = { col: eagle.col, row: eagle.row, fortified: state.fortified };
  p.enemies = p._enemies();
  p.defenders = p._defenders();
  p.bullets = p._bullets();
  const remaining = state.mem[0x7f] ?? 20;
  const spawnedCount = Math.max(0, 20 - remaining);
  const enemiesLeft = state.enemiesLeft ?? 20;
  const nextBlink = BLINK_SPAWN_INDICES.find((n) => n > spawnedCount) ?? null;
  p.spawn = {
    enemiesLeft,
    spawnTimer: state.spawnTimer ?? 0,
    remainingSpawns: remaining,
    spawned: spawnedCount,
    nextBlink,
  };
  // role-aware (аддитивно): selfTeam/oppTeam/opponents/allies
  const role = opts.role ?? "def";
  p.selfTeam = role === "att" ? "ATT" : "DEF";
  p.oppTeam = role === "att" ? "DEF" : "ATT";
  p.opponents = role === "att" ? p.defenders : p.enemies;
  p.allies = role === "att" ? p.enemies : p.defenders;
  return p;
}
