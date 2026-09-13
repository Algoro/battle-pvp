// scan-ai.js — AI with a full scan of the game situation.
//
// Each step (frame) for each AI tank the brain scans the WHOLE map:
//   - field (tiles, passability, bricks for line-of-fire),
//   - bullets (position, direction, owner) and their trajectories,
//   - prizes (position, type),
//   - eagle (attackers' goal) and defenders (targets/threats),
//   - movement directions of opponents (velocity vector).
// Based on this a situation model is built and the MOST ADVANTAGEOUS step is chosen from
// all possible ones: cost to reach the goal (BFS field) + safety from bullets +
// smoothness (direction inertia). The tank always moves or shoots (it does not
// freeze or get stuck), and it can stand still only to shoot through a brick.
//
// Architecture (pure functions, easy to test):
//   scanPlan(mem, prev) -> { decisions: Map<idx,{dir,fire,goal}>, state }
//     - readBattlefield / readBullets / readPrizes — scanning the state;
//     - threatSet()            — cells that enemy bullets are flying into;
//     - costToGoal()           — BFS distance field to the goal;
//     - bestStep()             — choosing the direction (goal+safety+smoothness);
//     - bestShoot() / chooseGoal() — choosing the shot and the target;
//     - decideAttacker()       — final decision for one tank.
import { readState, DX, DY, FIELD, inBounds, cellIdx, tankPassable, isBrick,
  blocksBullet, cellPassable, dist, dirTo, lineClear } from "../model/game-view.ts";
import { costField, UNREACHABLE } from "../model/pathfind.ts";
import { trajectoryCells } from "../model/perception.ts";
import { RAM } from "../rom-contract.ts";

// --- parameters ---
const INTERCEPT_MIN = 2;   // min distance for intercepting a bullet with a shot
const DODGE_RADIUS = 6;    // real dodge radius from a bullet
const SPAWN_ROWS = 6;      // top spawn rows: there we don't dodge
const PURSUIT_RANGE = 14;  // hunt radius for a defender
const PRIZE_RANGE = 9;     // radius at which we go for a prize
const BASE_COMMIT_RANGE = 11; // near the base — always head to it (final dash)
const GUARD_PRIZE_REACH = 12; // defender: radius for collecting a valuable prize
const KILL_ZONE = 6;       // crossfire: radius around the base for focus-fire
const DEFEND_RADIUS = 15;  // defender: return to the base if there is a threat and we are not far
const GUARD_HUNT_RANGE = 10; // with many enemies the defender chases only nearby ones
// UNREACHABLE and costField — from the shared pathfind.js layer.

const THREAT_PENALTY = 6;  // penalty for a cell under an enemy bullet

// Is the cell passable for a tank step (movement OR line-of-fire through a brick).
function stepPassable(f: any, c: any, r: any) {
  return inBounds(c, r) && (tankPassable(f[cellIdx(c, r)]) || isBrick(f[cellIdx(c, r)]));
}

// Will the bullet hit the cell (stopping at an obstacle/border).
function bulletPathHits(field: any, bullet: any, cell: any, steps = 20) {
  const dx = DX[bullet.dir], dy = DY[bullet.dir];
  let c = bullet.cell.col, r = bullet.cell.row;
  for (let i = 0; i < steps; i++) {
    c += dx; r += dy;
    if (c === cell.col && r === cell.row) return true;
    if (c < 0 || c >= FIELD || r < 0 || r >= FIELD) return false;
    if (blocksBullet(field[cellIdx(c, r)])) return false;
  }
  return false;
}

// Cells that enemy bullets will pass through in the coming frames (for dodging).
// Delegates to the shared layer (trajectoryCells, 14 steps).
function threatSet(bf: any) {
  const set = new Set();
  for (const b of bf.bullets) {
    if (b.team !== "DEF") continue;
    for (const c of trajectoryCells(bf.field, b, 0, 14)) set.add(cellIdx(c.col, c.row));
  }
  return set;
}

// BFS cost field for reaching the goal — moved to the shared pathfind.js layer (`costField`).
// (Movement = 1, brick "punch-through" = max(1, durability).) See costField.

// Best direction to the goal: minimize cost + bullet penalty, with inertia.
function bestStep(bf: any, cell: any, goalCell: any, cost: any, threatSet_: any, prevDir: any) {
  const field = bf.field;
  const heur = (nc: any, nr: any) => Math.abs(nc - goalCell.col) + Math.abs(nr - goalCell.row);

  let best = null, bestScore = Infinity;
  for (let d = 0; d < 4; d++) {
    const nc = cell.col + DX[d], nr = cell.row + DY[d];
    if (!stepPassable(field, nc, nr)) continue; // either passable or a brick for line-of-fire
    const idx = cellIdx(nc, nr);
    const c = cost[idx] === UNREACHABLE ? heur(nc, nr) + 1000 : cost[idx];
    const threat = threatSet_.has(idx) ? THREAT_PENALTY : 0;
    const score = c + threat;
    if (score < bestScore) { bestScore = score; best = d; }
  }
  if (best === null) return null; // fully boxed in
  // smoothness: if the previous direction leads to the goal no worse and is safe — keep it
  if (prevDir !== null) {
    const nc = cell.col + DX[prevDir], nr = cell.row + DY[prevDir];
    if (stepPassable(field, nc, nr)) {
      const idx = cellIdx(nc, nr);
      const c = cost[idx] === UNREACHABLE ? heur(nc, nr) + 1000 : cost[idx];
      const threat = threatSet_.has(idx) ? THREAT_PENALTY : 0;
      if (c + threat <= bestScore + 1) return prevDir;
    }
  }
  return best;
}

// Enemy team for the role: the attacker hits DEF, the defender hits ATT.
function enemyTeamOf(role: any) { return role === "att" ? "DEF" : "ATT"; }

// Best target to shoot: an aligned enemy with a line of fire (brick — ok).
function bestShoot(bf: any, tank: any, role: any): any {
  const cell = tank.cell;
  const enemy = enemyTeamOf(role);
  let best = null, bestD = Infinity, bestFd = null;
  for (const e of bf.tanks) {
    if (e.team !== enemy || !e.inField) continue;
    if (cell.row === e.cell.row || cell.col === e.cell.col) {
      const fd = dirTo(cell, e.cell);
      if (fd !== null && lineClear(bf.field, cell, e.cell)) {
        const d = dist(cell, e.cell);
        if (d < bestD) { bestD = d; best = e; bestFd = fd; }
      }
    }
  }
  return best ? { dir: bestFd, enemy: best, d: bestD } : null;
}

// Best prize to collect: accounts for value (grenade/helmet — priority) and proximity.
function bestPrize(bf: any, cell: any, baseReach: any) {
  let best = null, bestScore = -Infinity;
  for (const p of bf.prizes) {
    const d = dist(cell, p.cell);
    const reach = baseReach * (p.value / 50);
    if (d <= reach) {
      const score = p.value - d * 3;
      if (score > bestScore) { bestScore = score; best = p; }
    }
  }
  return best;
}

// Movement goal choice for the ATTACKER: the base is the main priority. While far — it may
// hunt/collect a prize; NEAR the base — always to the eagle (final dash).
function chooseGoalAtt(bf: any, tank: any) {
  const cell = tank.cell;
  const distToBase = Math.abs(cell.col - bf.eagle.col) + Math.abs(cell.row - bf.eagle.row);
  const lane = ((tank.index % 3) + 2) % 3 - 1; // -1,0,+1
  if (distToBase <= BASE_COMMIT_RANGE) {
    return { cell: { col: bf.eagle.col + lane, row: bf.eagle.row }, kind: "base" };
  }
  let nearest = null, nd = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    const d = dist(cell, e.cell);
    if (d < nd) { nd = d; nearest = e; }
  }
  if (nearest && nd <= PURSUIT_RANGE) return { cell: nearest.cell, kind: "hunt" };
  const p = bestPrize(bf, cell, PRIZE_RANGE);
  if (p) return { cell: p.cell, kind: "prize" };
  return { cell: { col: bf.eagle.col + lane, row: bf.eagle.row }, kind: "base" };
}

// Movement goal choice for the DEFENDER — human HUNT: we hit the flashing enemy (prize),
// otherwise the nearest one; we return to the base only when there are no enemies. (An enemy at the base is
// already handled by focus-fire above in decideTank.)
function chooseGoalDef(bf: any, tank: any, subRole: any) {
  const cell = tank.cell;
  let flash = null, nearest = null, nd = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "ATT" || !e.inField) continue;
    if (e.flashing && flash === null) flash = e;
    const d = dist(cell, e.cell);
    if (d < nd) { nd = d; nearest = e; }
  }
  if (flash) return { cell: leadCell(flash), kind: "hunt" };
  // D: many enemies — guard the base (we chase only nearby ones), few — finish
  const manyLeft = bf.enemiesLeft > 10;
  const fewLeft = bf.enemiesLeft <= 3;
  if (nearest && (fewLeft || !manyLeft || dist(cell, nearest.cell) <= GUARD_HUNT_RANGE)) {
    return { cell: leadCell(nearest), kind: "hunt" };
  }
  // valuable prize (defenders are "players", prizes matter to them)
  const p = bestPrize(bf, cell, GUARD_PRIZE_REACH);
  if (p) return { cell: p.cell, kind: "prize" };
  const side = tank.index === 0 ? -1 : 1;
  let anchor = { col: bf.eagle.col + side * 2, row: bf.eagle.row - 2 };
  if (!tankPassable(bf.field[cellIdx(anchor.col, anchor.row)])) anchor = { col: bf.eagle.col + side, row: bf.eagle.row - 2 };
  return { cell: anchor, kind: "guard" };
}

// Lead by the enemy's direction/speed (B): a fast enemy (speedClass>1) —
// aim at the cell ahead along its movement; a slow one — at its own cell.
function leadCell(e: any) {
  if (!e.inField || !(e.speedClass > 1.3)) return e.cell;
  return { col: e.cell.col + DX[e.dir], row: e.cell.row + DY[e.dir] };
}

// Per-tank decision (attack or defense).
function decideTank(bf: any, tank: any, mem: any, st: any, role: any) {
  const field = bf.field;
  const cell = tank.cell;
  const enemy = enemyTeamOf(role);
  const ourBusy = (mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const incoming = bf.bullets
    .filter((b: any) => b.team === enemy && bulletPathHits(field, b, cell))
    .sort((a: any, b: any) => dist(a.cell, cell) - dist(b.cell, cell));

  // 1. INTERCEPT: shoot down a bullet flying at us with our shot.
  if (!ourBusy && incoming.length && dist(incoming[0].cell, cell) >= INTERCEPT_MIN) {
    const fd = dirTo(cell, incoming[0].cell);
    if (fd !== null && lineClear(field, cell, incoming[0].cell)) {
      return { dir: fd, fire: true, goal: "intercept" };
    }
  }

  // 1b. CROSSFIRE (def): the most dangerous attacker at the base — a shared target for both
  //     defenders. We react only if we OURSELVES are not far from the base; otherwise we run to the
  //     base on our own goal (otherwise the guard gets stuck at an enemy far from the base).
  if (role === "def") {
    let focus = null, focusD = Infinity;
    for (const e of bf.tanks) {
      if (e.team !== "ATT" || !e.inField) continue;
      const dBase = dist(e.cell, { col: bf.eagle.col, row: bf.eagle.row });
      if (dBase <= KILL_ZONE && dBase < focusD) { focusD = dBase; focus = e; }
    }
    if (focus) {
      const myD = dist(cell, { col: bf.eagle.col, row: bf.eagle.row });
      if (myD <= DEFEND_RADIUS) {
        const fd = dirTo(cell, focus.cell);
        if (fd !== null && !ourBusy && lineClear(field, cell, focus.cell)) {
          const nc = cell.col + DX[fd], nr = cell.row + DY[fd];
          const move = cellPassable(field, nc, nr) ? fd : null;
          return { dir: move, fire: true, goal: "focus" };
        }
        const cost = costField(field, focus.cell);
        const d = bestStep(bf, cell, focus.cell, cost, bf.threatSet, st.prevDir);
        if (d !== null) {
          const fwd = field[cellIdx(cell.col + DX[d], cell.row + DY[d])];
          if (isBrick(fwd) && !tankPassable(fwd)) return { dir: d, fire: !ourBusy, goal: "focus" };
          return { dir: d, fire: false, goal: "focus" };
        }
      }
    }
  }

  // 2. SHOOTING: an aligned enemy in the line of fire (including through a brick).
  const shoot = bestShoot(bf, tank, role);
  if (shoot && !ourBusy) {
    const nc = cell.col + DX[shoot.dir], nr = cell.row + DY[shoot.dir];
    const move = cellPassable(field, nc, nr) ? shoot.dir : null; // forward or stand and shoot
    return { dir: move, fire: true, goal: "kill" };
  }

  // 3. DODGE: a close bullet — perpendicular (at spawn the attacker does not dodge).
  const nearIncoming = incoming.filter((b: any) => dist(b.cell, cell) <= DODGE_RADIUS);
  if (nearIncoming.length && !tank.helmet && (role === "def" || cell.row >= SPAWN_ROWS)) {
    const b = nearIncoming[0];
    for (const d of [(b.dir + 1) % 4, (b.dir + 3) % 4]) {
      if (cellPassable(field, cell.col + DX[d], cell.row + DY[d])) {
        return { dir: d, fire: false, goal: "dodge" };
      }
    }
  }

  // 4. MOVEMENT to the goal.
  const subRole = role === "def" ? (tank.index === 0 ? "guard" : "raider") : null;
  const goal = role === "att" ? chooseGoalAtt(bf, tank) : chooseGoalDef(bf, tank, subRole);
  // guard: already at the post by the base and no threat — hold position (don't wander); raider — always pursues
  if (role === "def" && subRole === "guard" && goal.kind === "guard" && dist(cell, goal.cell) <= 1) {
    return { dir: null, fire: false, goal: "guard" };
  }
  const cost = costField(field, goal.cell);
  const dir = bestStep(bf, cell, goal.cell, cost, bf.threatSet, st.prevDir);

  // 5. LINE-OF-FIRE: the step leads into a brick and we can shoot — hit it.
  if (dir !== null) {
    const fwd = field[cellIdx(cell.col + DX[dir], cell.row + DY[dir])];
    if (isBrick(fwd) && !tankPassable(fwd)) {
      return { dir, fire: !ourBusy, goal: "break" };
    }
  }

  // 6. Boxed in — greedy step toward our own goal (don't stand).
  if (dir === null) {
    let best = null, bestH = Infinity;
    for (let d = 0; d < 4; d++) {
      const nc = cell.col + DX[d], nr = cell.row + DY[d];
      if (!cellPassable(field, nc, nr)) continue;
      const h = Math.abs(nc - goal.cell.col) + Math.abs(nr - goal.cell.row);
      if (h < bestH) { bestH = h; best = d; }
    }
    if (best !== null) return { dir: best, fire: false, goal: "wander" };
    return { dir: null, fire: !ourBusy, goal: "stuck" };
  }

  return { dir, fire: false, goal: goal.kind };
}

// --- MAIN FUNCTION ---
// role: "att" — attack (enemies DEF, goal the base), "def" — defend (enemies ATT,
// goal the base position). Returns { decisions, state } for its own team.
export function scanPlan(mem: any, prev: any, role = "att") {
  const bf: any = readState(mem);
  bf.threatSet = threatSet(bf);
  const ownTeam = role === "att" ? "ATT" : "DEF";
  const decisions = new Map();
  const state = new Map();
  for (const t of bf.tanks) {
    if (t.team !== ownTeam || !t.inField) continue;
    const st = (prev && prev.get(t.index)) || { prevDir: null };
    const decision = decideTank(bf, t, mem, st, role);
    decisions.set(t.index, decision);
    state.set(t.index, { prevDir: decision.dir });
  }
  return { decisions, state };
}
