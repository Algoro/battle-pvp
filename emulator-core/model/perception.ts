// perception.js — strategic layer: building a complete battle picture for defender/attacker AI
// from GameState (the game-view read model).
//
// Unlike the scattered local helpers of scan/lookahead, Perception is a
// single, consistent snapshot:
//   - classification of enemies by type (basic/fast/power/armor) + speed/armor/flash,
//   - ThreatToBase estimation (design §2.2),
//   - spawn queue (flashing 4/11/18),
//   - bullet model (speed, trajectory, intercept point),
//   - player state (level/lives/helmet/stun/ice),
//   - tile classification and route costs (delegates to game-view/pathfind).
//
// A pure layer: perceive(state) -> Perception. Does not mutate the state.

import { DX, DY, inBounds, cellIdx, blocksBullet, bulletSpeed, hitsLeft, dist,
  lineClear, cellOf, enemySpeedClass } from "./game-view.ts";
import { pathCost } from "./pathfind.ts";
import { RAM } from "../rom-contract.ts";

// --- threat estimation parameters (design §2.2) ---
export const THREAT_WEIGHTS = { speed: 0.30, los: 0.30, dist: 0.25, power: 0.10, path: 0.05 };
export const DEFAULT_THREAT_WEIGHTS = THREAT_WEIGHTS;

const SPEED_FACTOR: Record<string, number> = { basic: 0.4, power: 0.5, fast: 1.0, armor: 0.3 };
const POWER_FACTOR: Record<string, number> = { basic: 0.5, power: 1.0, fast: 0.7, armor: 0.6 };

// Flashing (bonus) enemies appear on the 4th, 11th, and 18th spawn of the level.
export const BLINK_SPAWN_INDICES = [4, 11, 18];
export function isBlinkSpawn(index: number) { return BLINK_SPAWN_INDICES.includes(index); }

// Enemy type class by the high 4 bits of the type (0x80 basic, 0xA0 power, 0xC0 fast, 0xE0 armor).
export function enemyClass(type: number) {
  if (type < 0x80) return "basic";
  switch (type & 0xf0) {
    case 0xc0: return "fast";
    case 0xa0: return "power";
    case 0xe0: return "armor";
    default: return "basic";
  }
}

// Cell wrapper for convenient pathfind calls (position {col,row}).
function cell(t: any) { return { col: t.col, row: t.row }; }

// Predicate "is there a line of fire" (brick is punched through) between two cells.
export function fireLine(field: any, a: any, b: any) { return lineClear(field, a, b); }

export class Perception {
  state: any;
  field: any;
  enemies: any;
  defenders: any;
  bullets: any;
  base: any;
  spawn: any;
  _index: any;
  threatWeights: any;
  selfTeam: any;
  oppTeam: any;
  opponents: any;
  allies: any;
  constructor(state: any) {
    this.state = state;
    this.field = state.field;
    this.enemies = [];      // classified ATT enemies
    this.defenders = [];    // DEF defender state
    this.bullets = [];      // bullet model
    this.base = null;       // { col, row, fortified }
    this.spawn = null;      // { enemiesLeft, spawnTimer, spawned, nextBlink }
    this._index = new Map();
  }

  // Enemy classification with base threat estimation.
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

  // Bullet model: speed by owner, past/future trajectory cells.
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

  // Defender (player) state.
  _defenders() {
    const eagle = this.base;
    return this.state.defenders.map((d: any, i: number) => {
      const pos = d.tank.cell;
      return {
        index: i, tank: d.tank,
        level: d.level, lives: d.lives,
        helmet: d.tank.helmet, stunned: d.tank.stunned, onIce: d.tank.onIce,
        cell: { col: pos.col, row: pos.row },
        bulletSpeed: bulletSpeed(d.tank.type),
        busy: (this.state.mem[RAM.BULLET_STATUS + i] & 0xf0) === 0x40,
        distToEagle: eagle ? dist(pos, { col: eagle.col, row: eagle.row }) : Infinity,
        hasLosToEagle: eagle ? lineClear(this.field, pos, { col: eagle.col, row: eagle.row }) : false,
      };
    });
  }

  // Auxiliary queries.
  tileType(c: number, r: number) { return this.state.tileType(c, r); }
  costAt(c: number, r: number) { return this.state.tileCost(c, r); }
  passable(c: number, r: number) { return this.state.passable(c, r); }
  // Is there a line of fire from `from` to `to`.
  lineClear(a: any, b: any) { return lineClear(this.field, a, b); }
  // Bullet intersection point with the target (for leading/counter shot), or null.
  intercept(shotFrom: any, bullet: any) {
    for (const cc of bullet.cells) {
      if (this.lineClear(shotFrom, cc)) return cc;
    }
    return null;
  }
  // Incoming OPPONENT bullets (oppTeam) that will hit the cell (for dodging/danger).
  danger(cell: any) {
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

// Base threat estimation (design §2.2): greater = more dangerous.
// e: { cls, dBase, losBase, pathCost, type }.
// weights (optional): { speed, los, dist, power, path } — component weights.
export function threatToBase(e: any, weights: any = THREAT_WEIGHTS) {
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

// Predicted enemy cell after 1 step (by facing direction), if it is fast.
export function predictedCell(field: any, t: any) {
  if (!t.inField || !(t.speedClass > 1.3)) return cell(t);
  const nc = t.cell.col + DX[t.dir], nr = t.cell.row + DY[t.dir];
  if (!inBounds(nc, nr)) return cell(t);
  return { col: nc, row: nr };
}

// Cells the bullet will pass through (including the start) until it hits an obstacle/border.
// steps — tracing depth (default 30).
export function trajectoryCells(field: any, bullet: any, speed: number, steps = 30) {
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

// Main entry point: perceive(state, opts) -> Perception.
// opts: { role: "def"|"att", threat: {speed,los,dist,power,path} }.
//   - role: which team to build the snapshot for (default "def"). Affects
//     selfTeam/oppTeam/opponents/allies: for "att" opponents = DEF tanks, allies = ATT.
//   - enemies/defenders — backward compatibility (def): enemies=ATT, defenders=DEF.
export function perceive(state: any, opts: any = {}) {
  const p = new Perception(state);
  p.threatWeights = opts.threat ?? THREAT_WEIGHTS;
  // base (eagle)
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
  // role-aware (additive): selfTeam/oppTeam/opponents/allies
  const role = opts.role ?? "def";
  p.selfTeam = role === "att" ? "ATT" : "DEF";
  p.oppTeam = role === "att" ? "DEF" : "ATT";
  p.opponents = role === "att" ? p.defenders : p.enemies;
  p.allies = role === "att" ? p.enemies : p.defenders;
  return p;
}
