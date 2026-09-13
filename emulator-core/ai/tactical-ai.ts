// tactical-ai.js — tactical brain of the attacking team (ATT, tanks 2..7).
//
// A self-contained, deterministic module: it builds a battle model (all tanks, obstacle
// types, the eagle, threats), predicts opponent movement, and for each
// AI-controlled attacking tank returns a decision {dir, fire}.
// Movement/collision/spawn is executed by the ASM body (via NET_DIR/NET_FIRE).
//
// Key properties:
//  - INDIVIDUAL BEHAVIOR: each tank has its own independent decision priority —
//    no team planning and no shared roles. Each one hunts, seeks cover,
//    and assaults the base at its own discretion.
//  - AGGRESSIVE HUNTING: the attacker fires at an enemy along any convenient line of fire
//    (even across the whole screen), predicting its movement (velocity vector).
//  - COVER: under threat the tank retreats to cover (a cell next to an obstacle)
//    if there is no return line of fire.
//  - Goals: capture the base AND destroy opponents.
//  - Behavior is the same regardless of the player's team (it controls ATT tanks
//    that have no network input and are not human).
//  - Minimal fallbacks: one decision path per tank.
// Relative path: ./emulator-core/ai/tactical-ai.js
import { FIELD, DEF_END, DX, DY, inBounds, cellIdx, tankPassable,
  blocksBullet, cellPassable, dist, dirTo, readState,
  lineClear, prizeValue, PRIZE_VALUE } from "../model/game-view.ts";
import { nearestCover as steerNearestCover } from "../model/steer.ts";
import { bfsDirection } from "../model/pathfind.ts";
import { DIR_BTN, isTankActive } from "../domain.ts";
import { RAM } from "../rom-contract.ts";
export { lineClear, prizeValue, PRIZE_VALUE };
export { bfsDirection };

const LEAD = 2; // lead (cells) for firing at a moving target
const PURSUIT_RANGE = 14; // pursuit radius for DEF tanks (cells)
const DODGE_RADIUS = 6; // radius (cells) at which the tank actually dodges a bullet
const INTERCEPT_MIN = 4; // min distance (cells) for intercepting a bullet with a shot — otherwise we dodge at point-blank
const PRIZE_RANGE = 8; // radius (cells) at which the defender goes to collect a prize

// Maximum range of a "safe" shot (cells): the bullet must hit a
// solid tile (brick/steel/eagle/enemy) within this radius. Otherwise in the simulator the bullet
// flies off-screen and is NOT deactivated → the tank's bullet slot stays occupied FOREVER and the tank
// can no longer shoot. So we fire only at a target whose shot is guaranteed
// to hit a solid tile (or at a close target).
// Tank is active on the field. Differs from game-view.aliveFlag (0x90-0xd0): the simulator and
// emulator also consider flag 0x80 alive/moving (pause/turn between steps,
// see movementRange in sim/battle.js). Otherwise the DEF AI does not "see" enemies in state 0x80.
function onField(t: any) {
  if (!t || t.x >= 255) return false;
  return isTankActive(t.flag);
}


// Cover: a passable cell next to an obstacle.
export function isCover(field: any, c: any, r: any) {
  if (!cellPassable(field, c, r)) return false;
  for (let d = 0; d < 4; d++) {
    const nc = c + DX[d], nr = r + DY[d];
    if (inBounds(nc, nr) && !tankPassable(field[cellIdx(nc, nr)])) return true;
  }
  return false;
}

export function findEagle(field: any) {
  let minR = 32, minC = 16;
  for (let r = 15; r < 31; r++) {
    for (let c = 0; c < FIELD; c++) {
      const v = field[r * FIELD + c];
      if (v >= 0xc8 && v <= 0xcb && r < minR) { minR = r; minC = c; }
    }
  }
  return minR === 32 ? { col: 15, row: 26 } : { col: minC, row: minR };
}

// readBattlefield/readPrizes/readBullets delegate to the unified game-view layer (GameState).
export function readBattlefield(mem: any) { return readState(mem); }

export function readPrizes(mem: any) { return (readState(mem) as any).prizes; }
export function readBullets(mem: any) { return (readState(mem) as any).bullets; }

// bfsDirection was moved to the shared ../model/pathfind.js layer and re-exported above.
// Nearest cover — delegates to the shared steer.js layer (identical logic).
function nearestCover(field: any, from: any) { return steerNearestCover(field, from, null); }

// Predict the target position: current cell + velocity vector * lead.
function predictCell(cell: any, vel: any) {
  return {
    col: cell.col + vel.col * LEAD,
    row: cell.row + vel.row * LEAD,
  };
}

// Are they aligned (the tank can fire at the target): one row or column with a line of fire.
// Returns the fire direction (0..3) or null.
function fireDirection(field: any, from: any, to: any) {
  if (from.row === to.row) {
    const dir = to.col > from.col ? 3 : 1;
    if (lineClear(field, from, to)) return dir;
  }
  if (from.col === to.col) {
    const dir = to.row > from.row ? 2 : 0;
    if (lineClear(field, from, to)) return dir;
  }
  return null;
}

// Will the bullet hit the cell within the next `steps` steps. We follow the bullet's
// direction and stop when the bullet hits an obstacle (wall/steel) or
// leaves the field — a bullet does not fly through walls.
function bulletPathHits(field: any, bullet: any, cell: any, steps = 20) {
  const dx = DX[bullet.dir], dy = DY[bullet.dir];
  let c = bullet.cell.col, r = bullet.cell.row;
  for (let i = 0; i < steps; i++) {
    c += dx; r += dy;
    if (c === cell.col && r === cell.row) return true;
    if (c < 0 || c >= FIELD || r < 0 || r >= FIELD) return false;
    if (blocksBullet(field[cellIdx(c, r)])) return false; // bullet stopped
  }
  return false;
}

// Is the tank under threat (some DEF tank can shoot at it) and is there no return fire.
function threatFor(bf: any, tank: any) {
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    if (lineClear(bf.field, e.cell, tank.cell)) {
      const canReturn = lineClear(bf.field, tank.cell, e.cell);
      return { threat: e, canReturn };
    }
  }
  return null;
}

// Can a bullet from from to to hit a friendly (DEF) tank? We check only cells
// EXACTLY on the line of fire (the bullet is thin) between the shooter and the target — a neighboring tank next
// to the line does not block the shot (otherwise the two defenders at the base block each other).
function allyNearLine(bf: any, from: any, to: any, selfIndex: any) {
  if (from.row !== to.row && from.col !== to.col) return false; // not along a row/column
  const dc = Math.sign(to.col - from.col), dr = Math.sign(to.row - from.row);
  let c = from.col, r = from.row;
  for (;;) {
    c += dc; r += dr;
    if (c === to.col && r === to.row) break;
    for (const a of bf.tanks) {
      if (a.index === selfIndex || a.team !== "DEF" || !a.inField) continue;
      if (a.cell.col === c && a.cell.row === r) return true;
    }
  }
  return false;
}

// --- PER-TANK DECISION (individual, no shared roles) ---
// Each tank chooses the nearest target and its own assault line — without
// team planning. Priority: bullet intercept > dodge > cover > fire at
// the target > pursuit > base assault > anti-stuck. The tank almost always moves
// and stands still only when shooting through an obstacle.
export function decideTank(bf: any, tank: any, state: any, underThreat: any) {
  const cell = tank.cell;
  const ourBusy = (bf.mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  // In the top spawn rows the tank does not dodge/hide — otherwise it would get stuck at
  // the gate under fire. It must first descend into the field, then evade.
  const inSpawn = cell.row < 6;

  const incoming = bf.bullets
    .filter((b: any) => b.team === "DEF" && bulletPathHits(bf.field, b, cell))
    .sort((a: any, b: any) => dist(a.cell, cell) - dist(b.cell, cell));

  // 1. Intercept a bullet flying at us with our own shot (only if we can shoot,
  //    the bullet is still far enough and straight on the line). At point-blank we cannot intercept in time —
  //    there we dodge.
  if (!inSpawn && !ourBusy && incoming.length && dist(incoming[0].cell, cell) >= INTERCEPT_MIN) {
    const fd = dirTo(cell, incoming[0].cell);
    if (fd !== null && lineClear(bf.field, cell, incoming[0].cell)) {
      return { dir: fd, fire: true, goal: "intercept" };
    }
  }

  // 2. Dodge a bullet flying at us: move perpendicular to its course. Only
  //    if the bullet is already close — otherwise the tank endlessly evades and never attacks.
  const nearIncoming = incoming.filter((b: any) => dist(b.cell, cell) <= DODGE_RADIUS);
  if (!inSpawn && nearIncoming.length) {
    const b = nearIncoming[0];
    const perp = [(b.dir + 1) % 4, (b.dir + 3) % 4];
    for (const d of perp) {
      const nc = cell.col + DX[d], nr = cell.row + DY[d];
      if (cellPassable(bf.field, nc, nr)) return { dir: d, fire: false, goal: "dodge" };
    }
  }

  // 3. Cover: under threat and without return fire — retreat to cover.
  if (!inSpawn && underThreat && !underThreat.canReturn) {
    const cover = nearestCover(bf.field, cell);
    if (cover) {
      const dir = bfsDirection(bf.field, cell, cover);
      if (dir !== null) return { dir, fire: false, goal: "cover" };
    }
  }

  // 4. Aligned defender (line of fire; bricks are punched through): we fire and
  //    simultaneously close in; if there is an impassable obstacle ahead — we stand
  //    and shoot through it (the only case of a deliberate stop).
  let aligned: any = null, alignedDist = Infinity, alignedFd: any = null;
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    if ((cell.row === e.cell.row || cell.col === e.cell.col) && lineClear(bf.field, cell, e.cell)) {
      const fd = dirTo(cell, e.cell);
      const d = dist(cell, e.cell);
      if (d < alignedDist) { alignedDist = d; aligned = e; alignedFd = fd; }
    }
  }
  if (aligned) {
    // Fire and advance toward the target along the line of fire; if there is an impassable
    // obstacle ahead — stand and shoot through it. Active advance is more effective
    // than standing under return fire.
    const ncell = { col: cell.col + DX[alignedFd], row: cell.row + DY[alignedFd] };
    const move = cellPassable(bf.field, ncell.col, ncell.row) ? alignedFd : null;
    return { dir: move, fire: !ourBusy, goal: "kill" };
  }

  // 5. Pursuit: the nearest DEF tank within the hunt radius — move toward it.
  let pursuit = null, pursuitDist = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    const d = dist(cell, e.cell);
    if (d <= PURSUIT_RANGE && d < pursuitDist) { pursuitDist = d; pursuit = e; }
  }
  if (pursuit) {
    const predicted = predictCell(pursuit.cell, pursuit.vel ? pursuit.vel : { col: 0, row: 0 });
    const dir = bfsDirection(bf.field, cell, pursuit.cell) ?? bfsDirection(bf.field, cell, predicted);
    if (dir !== null) return { dir, fire: false, goal: "hunt" };
  }

  // 6. Base assault: each tank goes to its own lane in front of the eagle and fires in the corridor.
  const lane = ((tank.index % 3) + 2) % 3 - 1; // -1, 0, +1 by tank index
  // try several points in front of the eagle to find a reachable one
  for (const off of [lane, 0, 1, -1]) {
    const goal = { col: bf.eagle.col + off, row: bf.eagle.row };
    const dir = bfsDirection(bf.field, cell, goal);
    if (dir !== null) {
      const inCorridor = Math.abs(cell.col - bf.eagle.col) <= 1 && cell.row < bf.eagle.row;
      return { dir, fire: inCorridor && !ourBusy, goal: "base" };
    }
  }

  // 7. Anti-stuck: if the route is unreachable — move toward the base with a greedy step
  //    (rather than in any free direction), so as not to keep bumping into a wall in place.
  let best = null, bestDist = Infinity;
  for (let d = 0; d < 4; d++) {
    const nc = cell.col + DX[d], nr = cell.row + DY[d];
    if (!cellPassable(bf.field, nc, nr)) continue;
    const dd = Math.abs(nc - bf.eagle.col) + Math.abs(nr - bf.eagle.row);
    if (dd < bestDist) { bestDist = dd; best = d; }
  }
  if (best !== null) return { dir: best, fire: false, goal: "wander" };

  // Completely boxed in — stay and fire if we can.
  return { dir: null, fire: !ourBusy, goal: "stuck" };
}

// --- MAIN FUNCTION ---
// prev: Map<tankIndex, {prevCell, vel}>. Returns
// { decisions: Map<tank,{dir,fire,goal}>, state: Map<tank,{prevCell,vel}> }.
export function plan(mem: any, prev: any) {
  const bf: any = readBattlefield(mem);

  // Update each target's movement speed (deterministically, from prev).
  for (const t of bf.tanks) {
    const st = prev ? prev.get(t.index) : undefined;
    if (st && st.prevCell && t.inField) {
      const vx = clamp(t.cell.col - st.prevCell.col), vy = clamp(t.cell.row - st.prevCell.row);
      t.vel = { col: vx, row: vy };
    } else {
      t.vel = { col: 0, row: 0 };
    }
  }

  const decisions = new Map();
  const state = new Map();

  for (const t of bf.tanks) {
    if (t.team !== "ATT" || !t.inField) continue;
    const underThreat = threatFor(bf, t);
    const prevState = prev ? prev.get(t.index) : undefined;
    const decision = decideTank(bf, t, prevState, underThreat);
    decisions.set(t.index, decision);
    state.set(t.index, { prevCell: { col: t.cell.col, row: t.cell.row }, vel: t.vel });
  }
  return { decisions, state };
}

function clamp(v: any) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

// --- DEFENSIVE AI (DEF, tanks 0,1) ---
// DEF tanks are active base defenders. Without their AI the attackers have no real
// opponents and the hunting algorithms are not exercised. Returns Map<port, buttons>
// (buttons for the DEF controller: direction + A + Start for respawn).
const BTN_A = 0x01;
const PRIZE_CHASE_THRESHOLD = 80; // valuable prizes (grenade/helmet/star) — top priority
const KILL_ZONE = 6; // crossfire: radius around the base where both hit the dangerous one

// Defender decision: GUARDS the base. t0 holds the base's left flank, t1 — the right.
// Key principles:
//  1) Don't run away from the base: the defender stays within GUARD_RADIUS of the base, and when
//     it goes outside it returns to the anchor (otherwise it exposes the base and chases an enemy).
//  2) Fire at the best aligned target (priority — base threat and a close enemy).
//  3) Intercept: meet an enemy entering the guard zone by moving into the line of fire.
function decideDefender(bf: any, tank: any, lastDir: any = null, role = "guard") {
  const cell = tank.cell;
  const base = { col: bf.eagle.col, row: bf.eagle.row };
  const enemies = bf.tanks.filter((e: any) => e.team === "ATT" && onField(e));
  const dBase = Math.abs(cell.col - base.col) + Math.abs(cell.row - base.row);
  const side = tank.index === 0 ? -1 : 1;
  const isGuard = role === "guard";
  // Many enemies on the field — defend more tightly at the base (don't go hunting, otherwise
  // the swarm breaks through); few enemies — go hunt and finish the remaining ones in the corners.
  const many = enemies.length >= 5;
  const leash = isGuard ? 5 : (many ? 7 : 8);
  const threatRadius = many ? 8 : KILL_ZONE;
  // base under direct threat? Then BOTH defenders abandon the hunt and defend the base.
  const baseThreat = enemies.some((e: any) => dist(e.cell, base) <= threatRadius);

  // DODGE (survivability): only if we are not targeted by an enemy we can kill,
  // and the bullet is really close. Helmet — ignore, keep pressing.
  const nearBullet = bf.bullets
    .filter((b: any) => b.team === "ATT" && bulletPathHits(bf.field, b, cell))
    .filter((b: any) => dist(b.cell, cell) <= DODGE_RADIUS)[0];
  if (nearBullet && !tank.helmet) {
    let alignedNow = false;
    for (const e of enemies) {
      if (fireDirection(bf.field, cell, e.cell) !== null) { alignedNow = true; break; }
    }
    if (!alignedNow) {
      for (const d of [(nearBullet.dir + 1) % 4, (nearBullet.dir + 3) % 4]) {
        if (cellPassable(bf.field, cell.col + DX[d], cell.row + DY[d])) {
          return { dir: d, fire: false };
        }
      }
    }
  }

  // --- 1. FIRE: hit the best aligned target (no friendly fire).
  // We fire at any aligned target. The FIRE_MAX gate (fire only at a
  // guaranteed stop) was a workaround for a simulator bug where an off-screen bullet was not
  // deactivated. Now the simulator counts bullets correctly (like the emulator: an off-screen bullet
  // wraps around and eventually hits something), so the gate is removed — it only
  // restricted fire on the emulator (fewer kills).
  let aligned = null, alignedScore = -Infinity;
  for (const e of enemies) {
    if (allyNearLine(bf, cell, e.cell, tank.index)) continue;
    const target = predictCell(e.cell, e.vel || { col: 0, row: 0 });
    const fd = fireDirection(bf.field, cell, target);
    const fdActual = fireDirection(bf.field, cell, e.cell);
    const useFd = fd ?? fdActual;
    if (useFd === null) continue;
    const dBase2 = dist(e.cell, base);
    const dSelf = dist(cell, e.cell);
    const score = 1000 - dBase2 * 2 - dSelf;
    if (score > alignedScore) { alignedScore = score; aligned = { e, fd: useFd }; }
  }
  if (aligned) {
    // advance along the line of fire toward the target, but not beyond the leash from the base
    const ncell = { col: cell.col + DX[aligned.fd], row: cell.row + DY[aligned.fd] };
    let move = null;
    if (cellPassable(bf.field, ncell.col, ncell.row) &&
        Math.abs(ncell.col - base.col) + Math.abs(ncell.row - base.row) <= leash) {
      move = aligned.fd;
    }
    return { dir: move, fire: true };
  }

  // --- 2. VALUABLE PRIZES (grenade/helmet/star) — only if the base is not under threat.
  if (bf.prizes.length) {
    let bestPrize = null, bestScore = -Infinity;
    for (const p of bf.prizes) {
      const d = dist(cell, p.cell);
      const reach = PRIZE_RANGE * (p.value / 50);
      if (d <= reach) {
        const score = p.value - d * 3;
        if (score > bestScore) { bestScore = score; bestPrize = p; }
      }
    }
    const baseThreat = enemies.some((e: any) => dist(e.cell, base) <= KILL_ZONE);
    if (bestPrize && !baseThreat && (bestPrize.value >= PRIZE_CHASE_THRESHOLD || bestScore > 20)) {
      const d = bfsDirection(bf.field, cell, bestPrize.cell);
      if (d !== null) return { dir: d, fire: false };
    }
  }

  // --- 3. BASE UNDER THREAT: both defenders abandon the hunt and meet the enemy
  // nearest the base, to shoot it point-blank BEFORE the eagle is destroyed.
  if (baseThreat) {
    let th = null, td = Infinity;
    for (const e of enemies) {
      const d = dist(e.cell, base);
      if (d < td) { td = d; th = e; }
    }
    if (th) {
      // if the enemy is not yet on target — move into the line of fire (at point-blank the shot is accurate)
      if (fireDirection(bf.field, cell, th.cell) === null) {
        const below = th.cell.row > cell.row; // enemy is below us
        const desired = below ? { col: cell.col, row: th.cell.row } : { col: th.cell.col, row: cell.row };
        let dir = bfsDirection(bf.field, cell, desired);
        if (dir === null) dir = bfsDirection(bf.field, cell, th.cell);
        if (dir !== null) return { dir, fire: false };
      }
      // otherwise (already on target) — branch 1 handles the fire; here we just stay
      // close to the threat
      if (dist(cell, th.cell) > 2) {
        const dir = bfsDirection(bf.field, cell, th.cell);
        if (dir !== null) return { dir, fire: false };
      }
    }
  }

  // --- 4. HUNT (only if the base is not under threat): go to the nearest enemy within
  // the leash radius, to shoot it point-blank BEFORE it approaches the base.
  if (!baseThreat && enemies.length) {
    let target = null, tScore = -Infinity;
    for (const e of enemies) {
      const dSelf = dist(cell, e.cell);
      const dBase2 = dist(e.cell, base);
      const score = 1000 - dSelf * 3 - dBase2;
      if (score > tScore) { tScore = score; target = e; }
    }
    if (target && dist(cell, target.cell) <= leash) {
      const dir = bfsDirection(bf.field, cell, target.cell);
      if (dir !== null) return { dir, fire: false };
    }
  }

  // --- 5. Return to the base if the defender has gone too far (defense is more important than hunting).
  if (dBase > leash) {
    const anchor = anchorSpot(bf, base, side);
    const dir = bfsDirection(bf.field, cell, anchor);
    if (dir !== null) return { dir, fire: false };
  }

  // --- 6. BASE: no threat — hold the anchor position at the base (left/right flank).
  const anchor = anchorSpot(bf, base, side);
  const dir = bfsDirection(bf.field, cell, anchor);
  if (dir !== null) return { dir, fire: false };

  // --- 7. PATROL: don't oscillate; keep the last direction if it is free.
  const prefer = [2, 3, 1, 0]; // Down, Right, Left, Up
  let patrol = null;
  if (lastDir !== null && cellPassable(bf.field, cell.col + DX[lastDir], cell.row + DY[lastDir])) {
    patrol = lastDir;
  }
  if (patrol === null) {
    for (const d of prefer) {
      if (cellPassable(bf.field, cell.col + DX[d], cell.row + DY[d])) { patrol = d; break; }
    }
  }
  if (patrol !== null) return { dir: patrol, fire: false };
  return { dir: null, fire: false };
}

// Defender anchor position at the base: a passable cell on the flank (side) above the base.
// t0 — left, t1 — right. Looks for the nearest passable cell to the desired one.
function anchorSpot(bf: any, base: any, side: any) {
  const want = { col: base.col + side * 3, row: base.row - 3 };
  for (const [dc, dr] of [[0, 0], [0, 1], [0, 2], [side, 1], [side, 2], [-side, 1], [0, -1], [side, -1], [-side, 2], [2 * side, 1], [2 * side, 2]]) {
    const c = want.col + dc, r = want.row + dr;
    if (cellPassable(bf.field, c, r)) return { col: c, row: r };
  }
  // fallback: a passable cell next to the base
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1], [-2, 0], [2, 0], [0, 2], [-1, 1], [1, 1]]) {
    const c = base.col + dc, r = base.row + dr;
    if (cellPassable(bf.field, c, r)) return { col: c, row: r };
  }
  return { col: base.col, row: base.row - 1 };
}

// planDefense(mem, frame): decisions for AI-DEF tanks (ports 0,1).
// frame is needed for the respawn rhythm (Start edge every 30 frames).
// state (optional Map) — persistent state for movement smoothing
// (inertia), so the defender does not "jitter" by switching direction every frame.
export function planDefense(mem: any, frame: any, state: any = defState) {
  const bf: any = readBattlefield(mem);
  const out = new Map();
  const respawn = new Set(); // DEF slots respawned directly (without Start)
  const started = mem[RAM.ENEMIES_LEFT] !== 0xff; // game has started (enemies_left initialized)
  // Track enemy velocity so the defender does not fire "blindly" at a target moving
  // sideways (a miss = off-screen bullet = the bullet slot is blocked FOREVER).
  const ev = state.get("_ev") || { pos: new Map(), vel: new Map() };
  for (const t of bf.tanks) {
    const onf = t.inField || ((t.flag & 0xf0) >= 0x80 && (t.flag & 0xf0) <= 0xd0 && t.x < 255);
    const p = ev.pos.get(t.index);
    if (p && onf) {
      t.vel = { col: clamp(t.cell.col - p.col), row: clamp(t.cell.row - p.row) };
    } else {
      t.vel = { col: 0, row: 0 };
    }
    if (onf) ev.pos.set(t.index, { col: t.cell.col, row: t.cell.row });
    else ev.pos.delete(t.index);
  }
  state.set("_ev", ev);
  for (let t = 0; t < DEF_END; t++) {
    const tank = bf.tanks[t];
    let buttons = 0;
    // Respawn only a fully dead tank (flag==0) and only in-game, so as not to
    // break the start (during the menu the tanks are in respawn 0xE6). WITHOUT Start: Start on the DEF
    // port toggles pause (ram_btn_press&Start), so we set the spawn directly,
    if (started && tank.flag === 0 && frame % 30 === 0) {
      mem[RAM.TANK_TYPE + t] = 0; // ram_tank_type
      mem[RAM.TANK_X + t] = PLAYER_SPAWN_X[t]; // ram_tank_pos_X
      mem[RAM.TANK_Y + t] = PLAYER_SPAWN_Y[t]; // ram_tank_pos_Y
      mem[RAM.STUN + t] = 0; // ram_plr_stun_timer
      mem[RAM.TANK_FLAG + t] = 0xf0; // ram_tank_flags = con_tank_flag_respawn
      respawn.add(t);
    } else if ((tank.flag & 0xf0) >= 0x80 && (tank.flag & 0xf0) <= 0xd0 && tank.x < 255) {
      // IMPORTANT: we use the wide "on field" range (0x80..0xd0), not the strict
      // aliveFlag (0x90..0xd0). The DEF tank flag normally ranges over 0x80..0x8f (tracks
      // spin/turn between steps). If we took only 0x90..0xd0 — the defender
      // periodically "drops out" of AI control (doesn't move or shoot
      // until the flag returns to 0x90+) — that's why it seems "dumb"/freezes.
      const st = state.get(t) || { held: 0, prevDir: null };
      const role = t === 0 ? "guard" : "raider"; // tank 0 — guard, tank 1 — raider
      const d = decideDefender(bf, tank, st.prevDir, role);
      const dir = smoothDir(bf, tank, d.dir, st);
      // fire button — edge-triggered in the simulator/emulator: A cannot be held,
      // otherwise the shot happens only ONCE. Pulse: A is held only while the tank's
      // bullet slot is free (otherwise it does not recharge). When the slot frees up and
      // the target is still on the line — A is held again → edge → the next shot.
      const busy = (bf.mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
      const fire = d.fire && !busy;
      state.set(t, { held: st.held, prevDir: dir, fire });
      if (dir !== null) buttons |= DIR_BTN[dir];
      if (fire) buttons |= BTN_A;
    } else {
      state.set(t, { held: 0, prevDir: null, fire: false });
    }
    out.set(t, buttons);
  }
  return { buttons: out, respawn };
}

// HYSTERESIS: don't change direction every frame (otherwise the tank "jitters" in place,
// alternating BFS cell steps). We accept a new direction only if it is
// held for HOLD_FRAMES in a row OR the current direction has hit an obstacle.
// Mutates st.held/st.prevDir.
const HOLD_FRAMES = 14;
function smoothDir(bf: any, tank: any, dir: any, st: any) {
  if (dir === null) return null;
  if (st.prevDir === null || dir === st.prevDir) { st.held = 0; return dir; }
  // hit an obstacle in the current direction -> can switch immediately
  const fc = tank.cell.col + DX[st.prevDir], fr = tank.cell.row + DY[st.prevDir];
  if (!cellPassable(bf.field, fc, fr)) { st.held = 0; return dir; }
  // otherwise keep the current direction until the new one "settles" HOLD_FRAMES times
  st.held = (st.held || 0) + 1;
  return st.held >= HOLD_FRAMES ? dir : st.prevDir;
}
// Persistent DEF AI state (direction smoothing) by default.
// Exported so ai-eval/contract tests can "warm up" the sim AI state
// with the emulator history (otherwise the sim starts "cold" and makes different decisions).
export const defState = new Map();

// Reset DEF AI state (planDefense). Needed when switching AI on the fly (PvPNes.setDefAI):
// the plan works with modular defState by default, and when the defender mode changes the old
// accumulated _ev/smoothing must be cleared, otherwise the new AI starts with someone else's state.
export function resetDefState() {
  defState.clear();
}

// Player spawn positions (tbl_E47A/E47C): player1 (88,216), player2 (152,216).
const PLAYER_SPAWN_X = [0x58, 0x98];
const PLAYER_SPAWN_Y = [0xd8, 0xd8];

