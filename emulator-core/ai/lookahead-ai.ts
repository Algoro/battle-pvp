// lookahead-ai.js — variant A+D AI: Model-Predictive Control with future
// prediction (lookahead) and spatio-temporal planning.
//
// For each tank we enumerate possible actions (movement direction + fire)
// and over a horizon of H frames SIMULATE the future: tank movement, trajectories of all
// enemy bullets (exactly, 2px/frame — calibrated against the game), our own bullet (intercept,
// hit on a tank/brick). Each action gets a numeric utility:
//   - survival: penalty for an enemy bullet hitting the tank,
//   - progress to the base: shorter distance to the eagle = better,
//   - fire efficiency: + for intercepting a bullet / a kill / breaking a brick.
// We choose the action with the MAXIMUM utility — the "most advantageous step available".
//
// Architecture (pure functions):
//   lookaheadPlan(mem, prev) -> { decisions, state }
//     - simulateAction() — lightweight model of the future over H frames;
//     - utility() — action evaluation;
//     - decideTank() — choosing the best action.
import { readState, DX, DY, inBounds, cellIdx, tankPassable, isBrick, blocksBullet, brickHealth } from "../model/game-view.ts";
import { costField, UNREACHABLE } from "../model/pathfind.ts";
import { RAM } from "../rom-contract.ts";
// --- model parameters ---
const BULLET_SPEED = 2;   // px/frame (calibrated against the game)
const HORIZON = 8;        // prediction depth (frames)
const HIT_RADIUS = 9;     // px — radius of a bullet hitting a tank
const HIT_PENALTY = 110;  // penalty for a bullet hitting the tank (lower — more aggressive)
const INTERCEPT_REWARD = 80; // + for intercepting an enemy bullet
const KILL_REWARD = 200;  // + for killing a defender (aggression)
const BREAK_REWARD = 45;  // + for breaking a brick
const BASE_WEIGHT = 1.5;  // weight of progress to the base
const KILL_ZONE = 6;      // crossfire: radius around the base for focus-fire
// UNREACHABLE — from the shared pathfind.js layer.
const THREAT_PENALTY = 6;
const NO_PROGRESS_FRAMES = 20;
const DETOUR_FRAMES = 24;

// --- map primitives ---
function pxPassable(field: any, px: any, py: any) {
  const c = Math.floor(px / 8), r = Math.floor(py / 8);
  return inBounds(c, r) && tankPassable(field[cellIdx(c, r)]);
}
function manhattan(a: any, b: any) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

// Should the attacker fire at a defender (line of fire, brick is punched through).
function fireTarget(field: any, tank: any, enemy: any) {
  if (tank.y === enemy.y && tank.x !== enemy.x) return enemy.x > tank.x ? 3 : 1;
  if (tank.x === enemy.x && tank.y !== enemy.y) return enemy.y > tank.y ? 2 : 0;
  return null;
}

// Will the bullet hit the cell (for an intercept), stopping at an obstacle.
function bulletWillPass(field: any, bullet: any, cell: any, steps = 14) {
  let c = bullet.cell.col, r = bullet.cell.row;
  const dx = DX[bullet.dir], dy = DY[bullet.dir];
  for (let i = 0; i < steps; i++) {
    c += dx; r += dy;
    if (c === cell.col && r === cell.row) return true;
    if (!inBounds(c, r)) return false;
    if (blocksBullet(field[cellIdx(c, r)])) return false;
  }
  return false;
}

// BFS cost field to the goal — moved to the shared pathfind.js layer (`costField`).

// Best direction to the goal (minimum cost + bullet penalty), with inertia.
function bestStep(bf: any, cell: any, goalCell: any, cost: any, threatSet_: any, prevDir: any) {
  const field = bf.field;
  const heur = (nc: any, nr: any) => Math.abs(nc - goalCell.col) + Math.abs(nr - goalCell.row);
  let best = null, bestScore = Infinity;
  for (let d = 0; d < 4; d++) {
    const nc = cell.col + DX[d], nr = cell.row + DY[d];
    if (!(inBounds(nc, nr) && (tankPassable(field[cellIdx(nc, nr)]) || isBrick(field[cellIdx(nc, nr)])))) continue;
    const idx = cellIdx(nc, nr);
    const c = cost[idx] === UNREACHABLE ? heur(nc, nr) + 1000 : cost[idx];
    const score = c + (threatSet_.has(idx) ? THREAT_PENALTY : 0);
    if (score < bestScore) { bestScore = score; best = d; }
  }
  if (best === null) return null;
  if (prevDir !== null) {
    const nc = cell.col + DX[prevDir], nr = cell.row + DY[prevDir];
    if (inBounds(nc, nr) && (tankPassable(field[cellIdx(nc, nr)]) || isBrick(field[cellIdx(nc, nr)]))) {
      const idx = cellIdx(nc, nr);
      const c = cost[idx] === UNREACHABLE ? heur(nc, nr) + 1000 : cost[idx];
      if (c + (threatSet_.has(idx) ? THREAT_PENALTY : 0) <= bestScore + 1) return prevDir;
    }
  }
  return best;
}

// Enemy team for the role.
function enemyTeamOf(role: any) { return role === "att" ? "DEF" : "ATT"; }
// Progress goal in pixels: attacker — the eagle; defender — active base guard:
// we stay in our half of the field, hunt nearby/flashing enemies (contact =
// kills), but return immediately to intercept when the base is threatened.
function goalPx(bf: any, tank: any, role: any, subRole: any) {
  if (role === "att") return { x: bf.eagle.col * 8 + 4, y: bf.eagle.row * 8 + 4 };
  const ex = bf.eagle.col * 8 + 4, ey = bf.eagle.row * 8 + 4;
  const side = tank.index === 0 ? -1 : 1; // tank 0 — left flank, tank 1 — right
  let flash = null, nearest = null, nd = Infinity, nearBase = null, nearBaseD = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "ATT" || !e.inField) continue;
    if (e.flashing && flash === null) flash = e;
    // enemy on our flank (our field column)
    const onSide = side < 0 ? e.x <= ex : e.x >= ex;
    const d = Math.abs(e.x - tank.x) + Math.abs(e.y - tank.y) + (onSide ? 0 : 60);
    if (d < nd) { nd = d; nearest = e; }
    const db = Math.abs(e.x - ex) + Math.abs(e.y - ey);
    if (db < nearBaseD) { nearBaseD = db; nearBase = e; }
  }
  // BASE THREAT: any enemy that has come right up to the base — intercept it.
  if (nearBase && nearBaseD <= 64) return { x: nearBase.x, y: nearBase.y };
  if (flash) return { x: flash.x, y: flash.y };
  // Active hunt: always head to the nearest enemy on our flank (contact = kills).
  if (nearest) return { x: nearest.x, y: nearest.y };
  // No enemies on the field — guard position at the base (our side).
  return { x: ex + side * 2 * 8, y: ey - 2 * 8 };
}

// Simulation of one action over H frames. Returns utility.
// dir: 0..3 or null (stand); fire: whether we shoot; fireDir: where the bullet aims.
function simulateAction(bf: any, tank: any, field: any, dir: any, fire: any, fireDir: any, ourBusy: any, role: any, subRole: any) {
  const enemy = enemyTeamOf(role);
  let tx = tank.x, ty = tank.y;
  let own: any = null; // our bullet {x,y,dir}
  if (fire && !ourBusy) own = { x: tx, y: ty, dir: fireDir };
  // enemy bullets (position copies)
  const ebs = bf.bullets.filter((b: any) => b.team === enemy).map((b: any) => ({ x: b.x, y: b.y, dir: b.dir, alive: true }));
  let score = 0;

  for (let t = 0; t < HORIZON; t++) {
    // enemy bullets move
    for (const b of ebs) if (b.alive) { b.x += DX[b.dir] * BULLET_SPEED; b.y += DY[b.dir] * BULLET_SPEED; }
    // tank movement (1px/frame)
    if (dir !== null) {
      const nx = tx + DX[dir], ny = ty + DY[dir];
      if (pxPassable(field, nx, ny)) { tx = nx; ty = ny; }
    }
    // our bullet
    if (own) {
      own.x += DX[own.dir] * BULLET_SPEED; own.y += DY[own.dir] * BULLET_SPEED;
      // intercept an enemy bullet
      for (const b of ebs) {
        if (!b.alive) continue;
        if (Math.abs(own.x - b.x) < 6 && Math.abs(own.y - b.y) < 6) {
          score += INTERCEPT_REWARD; b.alive = false; own = null; break;
        }
      }
      // hit on an enemy tank
      if (own) {
        for (const e of bf.tanks) {
          if (e.team !== enemy || !e.inField) continue;
          if (Math.abs(own.x - e.x) < 9 && Math.abs(own.y - e.y) < 9) { score += KILL_REWARD; own = null; break; }
        }
      }
      if (own) {
        const c = Math.floor(own.x / 8), r = Math.floor(own.y / 8);
        if (inBounds(c, r) && isBrick(field[cellIdx(c, r)])) {
          // brick is destroyed by the shot; a damaged one (1 shot) is more profitable than an intact one (2)
          score += brickHealth(field[cellIdx(c, r)]) === 1 ? BREAK_REWARD : BREAK_REWARD * 0.5;
          own = null;
        }
      }
    }
    // tank under an enemy bullet
    for (const b of ebs) {
      if (!b.alive) continue;
      if (Math.abs(tx - b.x) < HIT_RADIUS && Math.abs(ty - b.y) < HIT_RADIUS) score -= HIT_PENALTY;
    }
  }
  // progress to the goal (less — better): attacker to the eagle, defender to the base position
  const goal = goalPx(bf, tank, role, subRole);
  score -= BASE_WEIGHT * manhattan([tx, ty], [goal.x, goal.y]);
  return score;
}

// Choosing the raw direction/fire intent + applying edge logic to fire.
// In the simulator/emulator the player A button is edge-triggered: a shot happens ONLY
// on the rising edge (fire:true after fire:false) and when the bullet slot is free.
// Holding A continuously = ONE shot for the whole time. So "want to shoot"
// (wantFire) is translated into a real fire: a single rising-edge frame when the slot is free
// and we did not hold the button on the previous frame; otherwise — release (gives a new edge).
function resolveFire(st: any, wantFire: any, ourBusy: any) {
  const canFire = wantFire && !ourBusy;
  const fire = canFire && !st.prevFire;
  st.prevFire = canFire;
  return fire;
}

// Per-tank decision: enumerate actions, take the maximum utility.
function decideTank(bf: any, tank: any, mem: any, st: any, role: any, subRole: any) {
  const field = bf.field;
  const enemy = enemyTeamOf(role);
  const ourBusy = (mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const cell = { col: tank.cell.col, row: tank.cell.row };

  // 1. INTERCEPT: a bullet flying at us along the line, we can shoot — shoot at it.
  const incoming = bf.bullets.filter((b: any) => b.team === enemy && bulletWillPass(field, b, cell));
  if (incoming.length) {
    const p = incoming.sort((a: any, b: any) => Math.abs(a.x - tank.x) + Math.abs(a.y - tank.y) - (Math.abs(b.x - tank.x) + Math.abs(b.y - tank.y)))[0];
    const fd = fireTarget(field, tank, { x: p.x, y: p.y });
    if (fd !== null) return { dir: fd, fire: resolveFire(st, true, ourBusy), goal: "intercept" };
  }

  // 1b. FIRE AT AN ALIGNED ENEMY (def): any target in the row/column with a line of
  //     fire — shoot, regardless of distance (the bullet flies through bricks).
  if (role === "def") {
    let align = null, alignD = Infinity;
    for (const e of bf.tanks) {
      if (e.team !== "ATT" || !e.inField) continue;
      const fd = fireTarget(field, tank, e);
      if (fd === null) continue;
      const d = Math.abs(e.x - tank.x) + Math.abs(e.y - tank.y);
      if (d < alignD) { alignD = d; align = { e, fd }; }
    }
    if (align) return { dir: align.fd, fire: resolveFire(st, true, ourBusy), goal: "kill" };

    // DODGE: a bullet flying at us is close and straight on the line — step aside perpendicular.
    const nearB = bf.bullets.filter((b: any) => b.team === "ATT" && Math.abs(b.x - tank.x) < 60 && Math.abs(b.y - tank.y) < 60);
    let dodgeTo = null;
    for (const b of nearB) {
      const onAxis = tank.x === b.x || tank.y === b.y;
      if (!onAxis) continue;
      const distToUs = Math.abs(b.x - tank.x) + Math.abs(b.y - tank.y);
      if (distToUs > 40) continue;
      const perp = [(b.dir + 1) % 4, (b.dir + 3) % 4];
      for (const d of perp) {
        const nc = cell.col + DX[d], nr = cell.row + DY[d];
        if (inBounds(nc, nr) && tankPassable(field[cellIdx(nc, nr)])) { dodgeTo = d; break; }
      }
      if (dodgeTo !== null) break;
    }
    if (dodgeTo !== null) return { dir: dodgeTo, fire: false, goal: "dodge" };

    // 1c. CROSSFIRE (def): the most dangerous attacker at the base — a shared target.
    let focus = null, focusD = Infinity;
    for (const e of bf.tanks) {
      if (e.team !== "ATT" || !e.inField) continue;
      const dBase = Math.abs(e.cell.col - bf.eagle.col) + Math.abs(e.cell.row - bf.eagle.row);
      if (dBase <= KILL_ZONE && dBase < focusD) { focusD = dBase; focus = e; }
    }
    if (focus) {
      const fd = fireTarget(field, tank, focus);
      if (fd !== null) return { dir: fd, fire: resolveFire(st, true, ourBusy), goal: "focus" };
      const cost = costField(field, focus.cell);
      const d = bestStep(bf, cell, focus.cell, cost, bf.threatSet || new Set(), st.prevDir);
      if (d !== null) return { dir: d, fire: false, goal: "focus" };
    }
  }

  // 2. Action candidates and their utility (lookahead).
  const candidates = [];
  const dirs = [0, 1, 2, 3];
  for (const d of dirs) {
    const nc = tank.cell.col + DX[d], nr = tank.cell.row + DY[d];
    if (!inBounds(nc, nr)) continue;
    const pass = tankPassable(field[cellIdx(nc, nr)]);
    if (!pass && !isBrick(field[cellIdx(nc, nr)])) continue; // neither movement nor line-of-fire
    // movement + fire/no fire
    for (const fire of [false, true]) {
      const u = simulateAction(bf, tank, field, d, fire, d, ourBusy, role, subRole);
      candidates.push({ dir: d, fire, u, goal: pass ? "move" : "break" });
    }
  }
  // stand + fire/no fire
  for (const fire of [false, true]) {
    const u = simulateAction(bf, tank, field, null, fire, st.prevDir ?? 2, ourBusy, role, subRole);
    candidates.push({ dir: null, fire, u, goal: "stand" });
  }

  // 3. Best candidate (maximum utility), smoothness as a tie-breaker.
  let best = null, bestU = -Infinity;
  for (const c of candidates) {
    let u = c.u;
    if (best && c.u === bestU && c.dir === st.prevDir) u += 0.5; // prefer smoothness on a tie
    if (u > bestU) { bestU = u; best = c; }
  }
  if (best === null) return { dir: null, fire: resolveFire(st, false, ourBusy), goal: "stuck" };

  // ANTI-STUCK (defender only): the AI defender cannot see walls (the field in
  // toMem is empty), so heading straight for the target may run into a real wall and
  // stall. We track the DISTANCE to the target: if movement does not reduce it for
  // NO_PROGRESS_FRAMES frames — we start a PERSISTENT detour (move perpendicular to the
  // target for DETOUR_FRAMES frames) to go around the obstacle. We do NOT apply this
  // to the attacker (its navigation stays as-is so as not to strengthen the enemy).
  if (role === "def" && best.dir !== null) {
    const g = goalPx(bf, tank, role, subRole);
    const gd = Math.abs(tank.x - g.x) + Math.abs(tank.y - g.y);
    let moveDir = best.dir;
    if ((st.detourFrames || 0) > 0) {
      st.detourFrames--;
      moveDir = st.detourDir;
      st.noProg = 0;
    } else {
      const improving = st.prevGoalDist === undefined || gd < st.prevGoalDist;
      st.noProg = improving ? 0 : (st.noProg || 0) + 1;
      if ((st.noProg || 0) >= NO_PROGRESS_FRAMES) {
        for (const d of [2, 3, 1, 0]) {
          if (d === best.dir) continue;
          const nc = tank.cell.col + DX[d], nr = tank.cell.row + DY[d];
          if (!inBounds(nc, nr)) continue;
          const v = field[cellIdx(nc, nr)];
          if (tankPassable(v) || isBrick(v)) {
            st.detourDir = d; st.detourFrames = DETOUR_FRAMES; moveDir = d; st.noProg = 0;
            break;
          }
        }
      }
    }
    st.prevGoalDist = gd;
    best = { dir: moveDir, fire: best.fire, goal: best.goal };
  } else if (role === "def") {
    st.noProg = 0;
    st.detourFrames = 0;
  }
  st.prevX = tank.x; st.prevY = tank.y;
  const fire = resolveFire(st, best.fire, ourBusy);
  return { dir: best.dir, fire, goal: best.goal };
}

// --- MAIN FUNCTION ---
// role: "att" — attack, "def" — defend. Returns decisions for its own team.
export function lookaheadPlan(mem: any, prev: any, role = "att") {
  const bf: any = readState(mem);
  const ownTeam = role === "att" ? "ATT" : "DEF";
  const decisions = new Map();
  const state = new Map();
  for (const t of bf.tanks) {
    if (t.team !== ownTeam || !t.inField) continue;
    const st = (prev && prev.get(t.index)) || { prevDir: null };
    const subRole = role === "def" ? (t.index === 0 ? "guard" : "raider") : null;
    const decision = decideTank(bf, t, mem, st, role, subRole);
    decisions.set(t.index, decision);
    state.set(t.index, {
      prevDir: decision.dir ?? st.prevDir,
      prevFire: st.prevFire ?? false,
      prevX: st.prevX,
      prevY: st.prevY,
      noProg: st.noProg ?? 0,
      prevGoalDist: st.prevGoalDist,
      detourDir: st.detourDir ?? null,
      detourFrames: st.detourFrames ?? 0,
    });
  }
  return { decisions, state };
}
