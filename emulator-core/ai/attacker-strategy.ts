// attacker-strategy.js — demonstration of reusing the high-level layer for the ATTACKER.
// Builds a decision on `perceive(state, {role:"att"})` (opponents = DEF, eagle = target) + shared
// steering (`steerTo`) + bullet danger (`danger`). Returns { dir, fire } for each
// ATT tank (like plan/scan/lookahead) so it can plug into runBrain/pvp.
//
// This does NOT replace plan/scan/lookahead, but shows the layer is general enough to
// build an attacker on it too. The logic is intentionally simple: hunt the nearest defender,
// dodge bullets, fire along the line.

import { readState, DX, DY, inBounds, dist, lineClear } from "../model/game-view.ts";
import { perceive } from "../model/perception.ts";
import { steerTo } from "../model/steer.ts";

// Target area for the attacker: the nearest living defender, otherwise the eagle.
function chooseTarget(perc: any, tank: any) {
  const opps = perc.opponents.filter((o: any) => o.tank.inField);
  let best = null, bestD = Infinity;
  for (const o of opps) {
    const d = dist(tank.cell, o.cell);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best ? best.cell : { col: perc.base.col, row: perc.base.row };
}

// Is the tank aligned with the target (line of fire, brick is punched through) → fire direction.
function fireDir(field: any, from: any, to: any) {
  if (from.row === to.row) { const d = to.col > from.col ? 3 : 1; return lineClear(field, from, to) ? d : null; }
  if (from.col === to.col) { const d = to.row > from.row ? 2 : 0; return lineClear(field, from, to) ? d : null; }
  return null;
}

export function attackerPlan(mem: any, prev: any = {}) {
  const bf: any = readState(mem);
  const perc: any = perceive(bf, { role: "att" });
  const decisions = new Map();

  for (const t of bf.tanks) {
    if (t.team !== "ATT" || !t.inField) continue;
    const goal = chooseTarget(perc, t);
    const fd = fireDir(perc.field, t.cell, goal);
    // cells under defender bullets — avoid
    const dangerSet = new Set();
    for (const d of perc.danger({ col: t.cell.col, row: t.cell.row })) for (const c of d.cells) dangerSet.add(c.col * 32 + c.row);
    // if the next step is dangerous — dodge, otherwise head to the target
    let dir = steerTo(perc.field, t.x, t.y, goal, { allowBreak: false, avoid: dangerSet });
    if (dir !== null) {
      const nc = t.cell.col + DX[dir], nr = t.cell.row + DY[dir];
      if (inBounds(nc, nr) && dangerSet.has(nc * 32 + nr)) dir = null; // step under a bullet — don't go
    }
    decisions.set(t.index, { dir, fire: fd !== null });
  }
  return { decisions, state: prev };
}
