// attacker-strategy.js — демонстрация переиспользования высокоуровневого слоя для АТАКУЮЩЕГО.
// Строит решение на `perceive(state, {role:"att"})` (противники = DEF, орёл = цель) + общем
// steering (`steerTo`) + опасности от пуль (`danger`). Возвращает { dir, fire } для каждого
// ATT-танка (как plan/scan/lookahead), чтобы встроиться в runBrain/pvp.
//
// Это НЕ заменяет plan/scan/lookahead, а показывает, что слой достаточно обобщён, чтобы
// на нём строить и атакующего. Логика намеренно простая: охотиться на ближайшего защитника,
// уворачиваться от пуль, стрелять по линии.

import { readState, DX, DY, inBounds, dist, lineClear } from "../model/game-view.js";
import { perceive } from "../model/perception.js";
import { steerTo } from "../model/steer.js";

// Область цели для атакующего: ближайший живой защитник, иначе орёл.
function chooseTarget(perc, tank) {
  const opps = perc.opponents.filter((o) => o.tank.inField);
  let best = null, bestD = Infinity;
  for (const o of opps) {
    const d = dist(tank.cell, o.cell);
    if (d < bestD) { bestD = d; best = o; }
  }
  return best ? best.cell : { col: perc.base.col, row: perc.base.row };
}

// Выровнен ли танк с целью (линия огня, кирпич пробивается) → направление выстрела.
function fireDir(field, from, to) {
  if (from.row === to.row) { const d = to.col > from.col ? 3 : 1; return lineClear(field, from, to) ? d : null; }
  if (from.col === to.col) { const d = to.row > from.row ? 2 : 0; return lineClear(field, from, to) ? d : null; }
  return null;
}

export function attackerPlan(mem, prev = {}) {
  const bf = readState(mem);
  const perc = perceive(bf, { role: "att" });
  const decisions = new Map();

  for (const t of bf.tanks) {
    if (t.team !== "ATT" || !t.inField) continue;
    const goal = chooseTarget(perc, t);
    const fd = fireDir(perc.field, t.cell, goal);
    // клетки под пулями защитников — избегаем
    const dangerSet = new Set();
    for (const d of perc.danger({ col: t.cell.col, row: t.cell.row })) for (const c of d.cells) dangerSet.add(c.col * 32 + c.row);
    // если следующий шаг опасен — уворачиваемся, иначе идём к цели
    let dir = steerTo(perc.field, t.x, t.y, goal, { allowBreak: false, avoid: dangerSet });
    if (dir !== null) {
      const nc = t.cell.col + DX[dir], nr = t.cell.row + DY[dir];
      if (inBounds(nc, nr) && dangerSet.has(nc * 32 + nr)) dir = null; // шаг под пулю — не идём
    }
    decisions.set(t.index, { dir, fire: fd !== null });
  }
  return { decisions, state: prev };
}
