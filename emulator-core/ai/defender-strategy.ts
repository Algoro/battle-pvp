// defender-strategy.js — new strategic AI for defenders (DEF, tanks 0,1).
//
// Implementation of the `battle_city_defender_ai_full_design.md` design on top of the strategic
// layer (perception.js + pathfind.js) and the game-view read model. It differs from
// planDefense (tactical-ai.js) in that decisions are made by utility functions with
// finite state machine (FSM) states and hysteresis, while navigation follows a
// weighted A* (tileCost: brick=3, tree=1.2, ice=1.5, steel/water=∞).
//
// Interface — same as planDefense (so it plugs into pvp.js/brain-runner/ai-eval):
//   strategyDefense(mem, frame, state) -> { buttons: Map<port,buttons>, respawn }
//   state — a persistent Map (hysteresis/FSM/direction memory) continued between frames.
//
// Reactive layer (interrupts the FSM): COUNTER_SHOT, HULL_BLOCK (simplified — blocking a
// corridor with the hull when out of ammo). Then a utility choice between:
//   DEFEND_BASE > HUNT_BLINKING_TANK > INTERCEPT > RUSH_BONUS > RETREAT > COLLECT_BONUS > PATROL.

import { readState, DEF_END, DX, DY, inBounds, cellIdx, isBrick, tankPassable,
  dist, lineClear } from "../model/game-view.ts";
import { perceive } from "../model/perception.ts";
import { pathCost } from "../model/pathfind.ts";
import { steerTo, nearestCover as nearestCoverShared } from "../model/steer.ts";

const BTN_A = 0x01;
import { DIR_BTN, isTankActive } from "../domain.ts";
import { RAM } from "../rom-contract.ts";

// --- parameters (design §2.2, §3, §8) — tunable CFG for optimizing weights/constants ---
// Default = best from the sweep AFTER fine-grid integration (scripts/strategy-sweep.csv, "after"):
// `react_high` — 93 kills, 9/10 HQ intact. See named presets in PRESETS below.
export const DEFAULT_CFG = {
  hysteresis: 0.35,        // moderately fast action switching (best balance on fine-grid)
  decoyRadius: 10,         // anti-decoy: "base threat" radius for allowing an intercept
  baseThreatRadius: 8,     // enemy within this radius of the base = base under threat (DEFEND_BASE)
  retreatFire: 2,          // >=2 incoming bullets at us and no cover → RETREAT
  dodgeRadius: 6,          // real dodge radius from a bullet (tiles)
  maxLeash: 9,             // max hunt radius from the base (otherwise the base is left exposed)
  holdFrames: 24,          // direction hysteresis (don't "jitter" with BFS steps)
  noProgressFrames: 40,    // anti-stuck: how many frames without progress → detour
  detourFrames: 26,        // detour duration when stuck
  maxRetry: 40,            // limit on choosing an anchor cell

  // target scoring weights (bestTarget)
  wThreat: 10,             // base threat coefficient
  wFlash: 5,               // bonus for a flashing enemy (1 hit = bonus)
  wTankDist: 0.4,          // penalty for distance to the target
  wBaseDist: 0.25,         // penalty for the target's distance from the base
  // action utility weights
  wEngageBase: 0.05,       // penalty for moving away from the base (ENGAGE)
  wRisk: 0.8,              // penalty for incoming bullets (ENGAGE)

  // THREAT-GATED prize collection (avoids the "black hole"): collect prizes/grenades when SAFE,
  // without exposing the base. Adopted from subagent results (agent2): bh 84/8 vs balanced 82/8 on 1-10.
  threatGatedBonus: true,   // flag: apply threat-gate to prize collection (enabled by default)
  bonusThreatRadius: 8,     // enemy within this radius of the base AND with LOS to the base → "danger window", don't take the prize
  pickupLeash: 20,          // don't go for a prize farther than this radius from the base (tether)
  wBonusValue: 2.5,         // weight of prize value in proximity+value: value/(d+1)
  guardRadius: 9,           // the partner defender must be within this radius of the base for us to leave for a prize
  minBonusValue: 80,        // minimum prize value worth leaving the base for
  maxEnemiesBonus: 3,       // max number of living enemies on the field at which we may still leave for a prize
  wBonusPath: 0.2,          // penalty for the path cost to the prize (reduced on a safe raid)
  wBonusBase: 0.0,          // penalty for moving away from the base (BONUS) (reduced on a safe raid)
  wRetreatIn: 2,           // penalty/weight of incoming bullets (RETREAT)
  wRetreatCover: 0.3,      // weight of cover proximity (RETREAT)
  retreatHelmet: 0.5,      // reduced desire to retreat while wearing a helmet
  // base threat weights (threatToBase, design §2.2)
  threat: { speed: 0.30, los: 0.30, dist: 0.25, power: 0.10, path: 0.05 },
};

let cfg = { ...DEFAULT_CFG };

// Named presets. Quick switching via setStrategyConfig.
// Default (DEFAULT_CFG) = THREAT-GATED prize collection (preset `bh`, 84/8 on 1-10 — subagent winner).
export const PRESETS = {
  // old default (before the "black hole" workaround): no threat-gate, 82/8 — reference for A/B
  balanced: { threatGatedBonus: false, wBonusPath: 0.5, wBonusBase: 0.1 },
  stable: { hysteresis: 0.5, holdFrames: 40, detourFrames: 40 },
  aggro: { maxLeash: 16, wThreat: 16, wTankDist: 0.1, wBaseDist: 0.0, wRisk: 0.2, retreatFire: 6 },
  los: { threat: { speed: 0.2, los: 0.5, dist: 0.2, power: 0.05, path: 0.05 } },
  greedy_bonus: { wBonusPath: 0.1, wBonusBase: 0.0, wFlash: 10 },
  // THREAT-GATED proximity+value prize collection (subagent agent2 winner, 84/8 vs 82/8).
  // Safe window = no enemy close to the base (bonusThreatRadius) with LOS to the base; we take a prize
  // only if it is within pickupLeash of the base and the field is not overrun by enemies. The base is not exposed.
  // Identical to the default (DEFAULT_CFG).
  bh: { threatGatedBonus: true, bonusThreatRadius: 8, pickupLeash: 20, maxEnemiesBonus: 3, minBonusValue: 80, wBonusValue: 2.5, wBonusPath: 0.2, wBonusBase: 0.0 },
};

// Override AI parameters (for optimization). A preset name (string) may be passed.
// Returns the current cfg.
export function setStrategyConfig(over: any = {}) {
  const o: any = typeof over === "string" ? ((PRESETS as any)[over] ?? {}) : over;
  cfg = { ...cfg, ...o };
  if (o.threat) cfg.threat = { ...DEFAULT_CFG.threat, ...o.threat };
  return cfg;
}
export function getStrategyConfig() { return cfg; }

const PLAYER_SPAWN_X = [0x58, 0x98];
const PLAYER_SPAWN_Y = [0xd8, 0xd8];

const dirToBtn = (d: any) => DIR_BTN[d];

// Whether the tank is fully alive/moving (wide range 0x80..0xd0, like the plan).
function onField(t: any) {
  if (!t || t.x >= 255) return false;
  return isTankActive(t.flag);
}

// Cells that enemy bullets will pass through in the coming frames (for dodging/avoid).
function enemyThreatCells(perc: any) {
  const set = new Set();
  for (const b of perc.bullets) {
    if (b.team !== "ATT") continue;
    for (const c of b.cells) set.add(cellIdx(c.col, c.row));
  }
  return set;
}

// Nearest cover (shared steer.js layer).
const nearestCover = nearestCoverShared;

// --- firing target (line of fire; brick is punched through) ---
function fireDir(bf: any, from: any, to: any) {
  if (from.row === to.row) return to.col > from.col ? 3 : 1;
  if (from.col === to.col) return to.row > from.row ? 2 : 0;
  return null;
}

// Navigation on the fine grid (shared steer.js layer): exact 16×16 hitbox + bypassing partially
// destroyed bricks; falls back to coarse with line-of-fire if allowBreak. Returns 0..3 or null.
function navigateFine(field: any, tank: any, goalCell: any, threatCells: any, allowBreak: any) {
  return steerTo(field, tank.x, tank.y, goalCell, { avoid: threatCells, allowBreak });
}

// Does a friendly defender block the line of fire from from to to (cells strictly on the line,
// except the shooter and the target). The bullet is thin — a neighboring tank next to the line does not interfere.
function allyBlockingLine(perc: any, from: any, to: any, selfIndex: any) {
  if (from.row !== to.row && from.col !== to.col) return false;
  const dc = Math.sign(to.col - from.col), dr = Math.sign(to.row - from.row);
  let c = from.col, r = from.row;
  for (;;) {
    c += dc; r += dr;
    if (c === to.col && r === to.row) break;
    for (const d of perc.defenders) {
      if (d.index === selfIndex || !d.tank.inField) continue;
      if (d.cell.col === c && d.cell.row === r) return true;
    }
  }
  return false;
}

// Best aligned target to fire at (line of fire, no friendly fire).
function bestAlignedFire(perc: any, tank: any): any {
  const cell = tank.cell;
  let best = null, bestD = Infinity, bestDir = null;
  for (const e of perc.enemies) {
    if (!e.tank.inField) continue;
    const fd = fireDir(perc.field, cell, e.cell);
    if (fd === null) continue;
    if (!lineClear(perc.field, cell, e.cell)) continue;
    if (allyBlockingLine(perc, cell, e.cell, tank.index)) continue;
    const d = dist(cell, e.cell);
    if (d < bestD) { bestD = d; best = e; bestDir = fd; }
  }
  return best ? { e: best, dir: bestDir, d: bestD } : null;
}

// --- FSM/utility state per tank ---
function tankState(state: any, t: any) {
  if (!state.has(t)) state.set(t, {
    fsm: "PATROL", prevDir: null, held: 0, prevFire: false,
    noProg: 0, prevGoalDist: undefined, detourDir: null, detourFrames: 0,
  });
  return state.get(t);
}

// Choose the best enemy to engage (target utility).
// Includes: base threat, proximity, flashing (1 hit = bonus), anti-decoy.
function bestTarget(perc: any, tank: any): any {
  let best = null, bestScore = -Infinity;
  const enemies = perc.enemies;
  for (const e of enemies) {
    if (!e.tank.inField) continue;
    // anti-decoy: allow the hunt if the enemy is close to the base OR there is no other with LOS to the base
    const dBase = e.distToBase;
    const otherLos = enemies.some((o: any) => o !== e && o.tank.inField && o.hasLosToBase);
    if (!(dBase < cfg.decoyRadius || !otherLos)) continue;
    const dTank = dist(tank.cell, e.cell);
    const score = e.threatToBase * cfg.wThreat
              + (e.flashing ? cfg.wFlash : 0)
              - dTank * cfg.wTankDist
              - dBase * cfg.wBaseDist;
    if (score > bestScore) { bestScore = score; best = { e, score }; }
  }
  return best;
}

// --- utility of individual actions ---
function uEngage(perc: any, tank: any, target: any) {
  // proximity to the base lowers the cost of a long-range intercept; risk — incoming bullets.
  const base = perc.base;
  const dBase = dist(tank.cell, { col: base.col, row: base.row });
  const risk = perc.bullets.filter((b: any) => b.team === "ATT"
    && dist(b.cell, tank.cell) <= cfg.dodgeRadius).length * cfg.wRisk;
  return target.score - dBase * cfg.wEngageBase - risk;
}
// "Safe window" for prize collection (agent2/bh): no enemy that is simultaneously close
// to the base (bonusThreatRadius) AND has LOS to the base. If such an enemy exists — the base corridor is
// under threat, so we don't take the prize.
function bonusSafeWindow(perc: any) {
  for (const e of perc.enemies) {
    if (!e.tank.inField) continue;
    if (e.distToBase <= cfg.bonusThreatRadius && e.hasLosToBase) return false;
  }
  return true;
}

function uRushBonus(perc: any, tank: any, prize: any) {
  const d = dist(tank.cell, prize.cell);
  const base = perc.base;
  const baseCell = { col: base.col, row: base.row };
  const dBase = dist(tank.cell, baseCell);
  const dPrizeBase = dist(prize.cell, baseCell);
  // hard-gate only for the bh preset (don't touch balanced)
  if (cfg.threatGatedBonus) {
    // tether: don't go for a prize farther than pickupLeash from the base
    if (dPrizeBase > cfg.pickupLeash) return -Infinity;
    // value: don't leave for a cheap prize
    if (prize.value < cfg.minBonusValue) return -Infinity;
    // safe window: no threat to the base corridor
    if (!bonusSafeWindow(perc)) return -Infinity;
    // enemy count: leave for a prize only when the field is relatively clear, otherwise
    // we get distracted from the fight and lose kills
    const aliveEnemies = perc.enemies.filter((e: any) => e.tank.inField).length;
    if (aliveEnemies > cfg.maxEnemiesBonus) return -Infinity;
  }
  const pathRisk = pathCost(perc.field, tank.cell, prize.cell, { allowBreak: true });
  if (!isFinite(pathRisk)) return -Infinity;
  const value = prize.value;
  const vd = cfg.threatGatedBonus
    ? value * cfg.wBonusValue / (d + 1)
    : value / (d + 1);
  return vd - pathRisk * cfg.wBonusPath - dBase * cfg.wBonusBase;
}
function uRetreat(perc: any, tank: any, incoming: any) {
  const cover = nearestCover(perc.field, tank.cell, null);
  const dCover = cover ? dist(tank.cell, cover) : 0;
  const ret = incoming.length * cfg.wRetreatIn - dCover * cfg.wRetreatCover;
  return tank.helmet ? ret * cfg.retreatHelmet : ret;
}

// Reactive COUNTER_SHOT: a bullet flying at us on our axis and within reach.
function counterShot(perc: any, tank: any, ourBusy: any) {
  if (ourBusy) return null;
  const cell = tank.cell;
  let best = null, bestD = Infinity;
  for (const b of perc.bullets) {
    if (b.team !== "ATT") continue;
    const dc = b.cell.col - cell.col, dr = b.cell.row - cell.row;
    if (dc === 0 || dr === 0) {
      if (dc === 0 && (b.cell.row < cell.row || b.cell.row > cell.row)) {
        // in the same column
        if (cell.col === b.cell.col && lineClear(perc.field, cell, b.cell)) {
          const d = Math.abs(b.cell.row - cell.row);
          if (d < bestD && d >= 1) { bestD = d; best = { dir: b.cell.row < cell.row ? 0 : 2, d }; }
        }
      } else if (dr === 0 && (b.cell.col < cell.col || b.cell.col > cell.col)) {
        if (cell.row === b.cell.row && lineClear(perc.field, cell, b.cell)) {
          const d = Math.abs(b.cell.col - cell.col);
          if (d < bestD && d >= 1) { bestD = d; best = { dir: b.cell.col < cell.col ? 1 : 3, d }; }
        }
      }
    }
  }
  return best;
}

// --- main per-tank decision function ---
// Returns { dir, fire } (dir may be null = stand still).
function decideTank(perc: any, tank: any, st: any, frame: any) {
  const field = perc.field;
  const cell = tank.cell;
  const base = perc.base;
  const baseCell = { col: base.col, row: base.row };
  const ourBusy = (perc.state.mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const threatCells = enemyThreatCells(perc);

  // --- 0. COUNTER_SHOT (reactive, highest priority) ---
  const cs = counterShot(perc, tank, ourBusy);
  if (cs) {
    st.fsm = "COUNTER_SHOT";
    st.prevDir = cs.dir; st.held = 0;
    return { dir: cs.dir, fire: edgeFire(st, true, ourBusy) };
  }

  // --- 0b. FIRE at the best aligned target (line of fire, no friendly fire).
  // We fire at any aligned target while simultaneously closing in (within leash
  // of the base). Design: the defender actively shoots enemies rather than waiting for them at the base.
  const aligned = bestAlignedFire(perc, tank);
  if (aligned) {
    st.fsm = "ENGAGE";
    const ncell = { col: cell.col + DX[aligned.dir], row: cell.row + DY[aligned.dir] };
    const move = (tankPassable(field[cellIdx(ncell.col, ncell.row)])
      && dist(ncell, baseCell) <= cfg.maxLeash) ? aligned.dir : null;
    st.prevDir = aligned.dir; st.held = 0;
    return { dir: move, fire: edgeFire(st, true, ourBusy) };
  }

  // --- incoming bullets flying at us ---
  const incoming = perc.bullets.filter((b: any) => b.team === "ATT"
    && dist(b.cell, cell) <= 12
    && (b.cell.col === cell.col || b.cell.row === cell.row));

  // --- 1. DEFEND_BASE: base under direct threat → both converge on the enemy nearest the base
  const target = bestTarget(perc, tank);
  const dBaseSelf = dist(cell, baseCell);

  // --- 2. action selection by utility with hysteresis ---
  const actions = [];

  // DEFEND_BASE / INTERCEPT / HUNT_BLINK: target
  if (target) actions.push({ id: "ENGAGE", u: uEngage(perc, tank, target) });

  // RUSH_BONUS / COLLECT_BONUS: prize
  const prize = perc.state.prizes[0];
  if (prize) actions.push({ id: "BONUS", u: uRushBonus(perc, tank, prize) });

  // RETREAT: incoming bullets and no cover / low safety
  if (incoming.length >= cfg.retreatFire && !tank.helmet) {
    actions.push({ id: "RETREAT", u: uRetreat(perc, tank, incoming) });
  }

  // PATROL: basic holding of the anchor at the base
  const anchor = anchorSpot(field, base, tank.index);
  const patrolU = dBaseSelf > cfg.maxLeash ? 3 - dBaseSelf * 0.2 : 1;
  actions.push({ id: "PATROL", u: patrolU });

  // --- choice: argmax with hysteresis (don't switch until it grows by 15%) ---
  actions.sort((a, b) => b.u - a.u);
  const best = actions[0];
  const current = actions.find((a) => a.id === st.fsm);
  let action = best;
  if (current && st.fsm !== "PATROL" && st.fsm !== "ENGAGE") {
    // keep the current one if it is still viable and not much worse than the best
    if (current.u >= 0 && best.u - current.u < cfg.hysteresis * Math.max(1, current.u)) {
      action = current;
    }
  }

  // --- action execution ---
  switch (action.id) {
    case "ENGAGE": {
      const e = target.e;
      st.fsm = "ENGAGE";
      const fd = fireDir(field, cell, e.cell);
      if (fd !== null && lineClear(field, cell, e.cell)) {
        // on target → fire while advancing along the line (if clear and it doesn't lead away from the base)
        const ncell = { col: cell.col + DX[fd], row: cell.row + DY[fd] };
        const move = (tankPassable(field[cellIdx(ncell.col, ncell.row)])
          && dist(ncell, baseCell) <= cfg.maxLeash) ? fd : null;
        st.prevDir = fd; st.held = 0;
        return { dir: move, fire: edgeFire(st, true, ourBusy) };
      }
      // no line → intercept: A* to the enemy's predicted cell (accounting for the real hitbox
      // and partially destroyed bricks; avoiding zones under bullets)
      const goal = e.predicted || e.cell;
      const d = navigateFine(field, tank, goal, threatCells, true);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      // if the step leads into a brick right next to the target — shoot through it
      if (out.dir !== null) {
        const fwd = field[cellIdx(cell.col + DX[out.dir], cell.row + DY[out.dir])];
        if (isBrick(fwd) && !tankPassable(fwd)) return { dir: out.dir, fire: edgeFire(st, true, ourBusy) };
      }
      return { dir: out.dir, fire: edgeFire(st, false, ourBusy) };
    }

    case "BONUS": {
      st.fsm = "BONUS";
      const goal = { col: prize.cell.col, row: prize.cell.row };
      const d = navigateFine(field, tank, goal, threatCells, true);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      return { dir: out.dir, fire: edgeFire(st, false, ourBusy) };
    }

    case "RETREAT": {
      st.fsm = "RETREAT";
      const cover = nearestCover(field, cell, threatCells);
      const goal = cover || anchor;
      const d = navigateFine(field, tank, goal, threatCells, false);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      return { dir: out.dir, fire: edgeFire(st, false, ourBusy) };
    }

    default: { // PATROL
      st.fsm = "PATROL";
      // at the anchor — patrol (don't stand still): nearest free cell from the base, slight offset
      const atAnchor = dist(cell, anchor) <= 1;
      const goal = atAnchor ? { col: anchor.col, row: anchor.row + 1 } : anchor;
      const d = navigateFine(field, tank, goal, threatCells, false);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      return { dir: out.dir, fire: edgeFire(st, false, ourBusy) };
    }
  }
}

// Fire edge-trigger: A is held only while the slot is free; fire=true only on the rising edge.
function edgeFire(st: any, want: any, ourBusy: any) {
  const can = want && !ourBusy;
  const fire = can && !st.prevFire;
  st.prevFire = can;
  return fire;
}

// Direction hysteresis + anti-stuck (detour when there is no progress).
function smoothAndDetour(st: any, tank: any, dir: any, field: any, goal: any, baseCell: any) {
  // anti-stuck
  let moveDir = dir;
  const gd = dist(tank.cell, goal);
  if ((st.detourFrames || 0) > 0) {
    st.detourFrames--;
    moveDir = st.detourDir;
    st.noProg = 0;
  } else {
    const improving = st.prevGoalDist === undefined || gd < st.prevGoalDist;
    st.noProg = improving ? 0 : (st.noProg || 0) + 1;
    if ((st.noProg || 0) >= cfg.noProgressFrames) {
      for (const d of [2, 3, 1, 0]) {
        if (d === dir) continue;
        const nc = tank.cell.col + DX[d], nr = tank.cell.row + DY[d];
        if (!inBounds(nc, nr)) continue;
        const v = field[cellIdx(nc, nr)];
        if (tankPassable(v) || isBrick(v)) {
          st.detourDir = d; st.detourFrames = cfg.detourFrames; moveDir = d; st.noProg = 0;
          break;
        }
      }
    }
  }
  st.prevGoalDist = gd;

  // direction hysteresis: keep prevDir until a new one settles
  if (moveDir === null) return { dir: null };
  if (st.prevDir === null || moveDir === st.prevDir) { st.held = 0; st.prevDir = moveDir; return { dir: moveDir }; }
  const fc = tank.cell.col + DX[st.prevDir], fr = tank.cell.row + DY[st.prevDir];
  const blocked = !(inBounds(fc, fr) && (tankPassable(field[cellIdx(fc, fr)]) || isBrick(field[cellIdx(fc, fr)])));
  if (blocked) { st.held = 0; st.prevDir = moveDir; return { dir: moveDir }; }
  st.held = (st.held || 0) + 1;
  if (st.held >= cfg.holdFrames) { st.prevDir = moveDir; return { dir: moveDir }; }
  return { dir: st.prevDir };
}

// Defender anchor position: left (t0) / right (t1) flank at the base. Looks for the nearest
// passable cell to the desired one, with a retry limit.
function anchorSpot(field: any, base: any, index: any) {
  const side = index === 0 ? -1 : 1;
  const want = { col: base.col + side * 3, row: base.row - 3 };
  const offsets = [
    [0, 0], [0, 1], [0, 2], [side, 1], [side, 2], [-side, 1], [0, -1], [side, -1],
    [-side, 2], [2 * side, 1], [2 * side, 2], [0, 3], [side, 3], [-side, 3],
  ];
  let retries = 0;
  for (const [dc, dr] of offsets) {
    const c = want.col + dc, r = want.row + dr;
    if (!inBounds(c, r)) continue;
    if (tankPassable(field[cellIdx(c, r)])) return { col: c, row: r };
    if (++retries >= cfg.maxRetry) break;
  }
  // fallback: near the base
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1], [0, -1], [-2, 0], [2, 0]]) {
    const c = base.col + dc, r = base.row + dr;
    if (inBounds(c, r) && tankPassable(field[cellIdx(c, r)])) return { col: c, row: r };
  }
  return { col: base.col, row: base.row - 1 };
}

// --- MAIN FUNCTION (interface like planDefense) ---
export function strategyDefense(mem: any, frame: any, state: any = new Map()) {
  const bf: any = readState(mem);
  const perc = perceive(bf, { threat: cfg.threat });
  const out = new Map();
  const respawn = new Set();
  const started = mem[RAM.ENEMIES_LEFT] !== 0xff;

  for (let t = 0; t < DEF_END; t++) {
    const tank = bf.tanks[t];
    const st = tankState(state, t);
    let buttons = 0;

    if (started && tank.flag === 0 && frame % 30 === 0) {
      // respawn a dead tank directly (without Start — otherwise it pauses)
      mem[RAM.TANK_TYPE + t] = 0;
      mem[RAM.TANK_X + t] = PLAYER_SPAWN_X[t];
      mem[RAM.TANK_Y + t] = PLAYER_SPAWN_Y[t];
      mem[RAM.STUN + t] = 0;
      mem[RAM.TANK_FLAG + t] = 0xf0;
      respawn.add(t);
      st.fsm = "PATROL"; st.prevDir = null; st.prevGoalDist = undefined;
    } else if (onField(tank)) {
      const d = decideTank(perc, tank, st, frame);
      if (d.dir !== null) buttons |= dirToBtn(d.dir);
      if (d.fire) buttons |= BTN_A;
    } else {
      st.fsm = "PATROL"; st.prevDir = null; st.prevGoalDist = undefined;
    }
    out.set(t, buttons);
  }
  return { buttons: out, respawn };
}

// Reset persistent state (when switching AI on the fly).
export function resetStrategyDefense() {}
