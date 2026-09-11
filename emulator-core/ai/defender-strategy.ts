// defender-strategy.js — новый стратегический ИИ защитников (DEF, танки 0,1).
//
// Реализация дизайна `battle_city_defender_ai_full_design.md` на базе стратегического
// слоя (perception.js + pathfind.js) и read-модели game-view. Отличается от
// planDefense (tactical-ai.js) тем, что решения принимаются utility-функциями с
// состояниями конечного автомата (FSM) и гистерезисом, а навигация идёт по
// взвешенному A* (tileCost: brick=3, tree=1.2, ice=1.5, steel/water=∞).
//
// Интерфейс — как у planDefense (чтобы встроиться в pvp.js/brain-runner/ai-eval):
//   strategyDefense(mem, frame, state) -> { buttons: Map<port,кнопки>, respawn }
//   state — персистентный Map (гистерезис/FSM/память направления), продолжаемый между кадрами.
//
// Реактивный слой (прерывает FSM): COUNTER_SHOT, HULL_BLOCK (упрощённо — блокировка
// коридора корпусом при нуле боезапаса). Затем utility-выбор между:
//   DEFEND_BASE > HUNT_BLINKING_TANK > INTERCEPT > RUSH_BONUS > RETREAT > COLLECT_BONUS > PATROL.

import { readState, DEF_END, DX, DY, inBounds, cellIdx, isBrick, tankPassable,
  dist, lineClear } from "../model/game-view.ts";
import { perceive } from "../model/perception.ts";
import { pathCost } from "../model/pathfind.ts";
import { steerTo, nearestCover as nearestCoverShared } from "../model/steer.ts";

const BTN_A = 0x01;
import { DIR_BTN, isTankActive } from "../domain.ts";
import { RAM } from "../rom-contract.ts";

// --- параметры (дизайн §2.2, §3, §8) — настраиваемый CFG для оптимизации весов/констант ---
// Дефолт = лучший по перебору ПОСЛЕ интеграции fine-grid (scripts/strategy-sweep.csv, «после»):
// `react_high` — 93 убийств, 9/10 HQ цел. Именованные пресеты см. в PRESETS ниже.
export const DEFAULT_CFG = {
  hysteresis: 0.35,        // умеренно-быстрая смена действий (лучший баланс на fine-grid)
  decoyRadius: 10,         // анти-декой: радиус «угрозы базе» для разрешения перехвата
  baseThreatRadius: 8,     // враг в этом радиусе от базы = база под угрозой (DEFEND_BASE)
  retreatFire: 2,          // >=2 входящих пули по нам и нет укрытия → RETREAT
  dodgeRadius: 6,          // радиус реального уворота от пули (клеток)
  maxLeash: 9,             // максимальный радиус охоты от базы (иначе база оголяется)
  holdFrames: 24,          // гистерезис направления (не «дрожать» BFS-шагами)
  noProgressFrames: 40,    // анти-застревание: сколько кадров без прогресса → обход
  detourFrames: 26,        // длительность обхода при застревании
  maxRetry: 40,            // лимит выбора якорной клетки

  // веса scoring цели (bestTarget)
  wThreat: 10,             // коэффициент угрозы базе
  wFlash: 5,               // бонус за мигающего врага (1 хит = бонус)
  wTankDist: 0.4,          // штраф за дальность до цели
  wBaseDist: 0.25,         // штраф за дальность цели от базы
  // веса utility действий
  wEngageBase: 0.05,       // штраф за удаление от базы (ENGAGE)
  wRisk: 0.8,              // штраф за входящие пули (ENGAGE)

  // THREAT-GATED сбор призов (обход «чёрной дыры»): собирать призы/гранаты, когда БЕЗОПАСНО,
  // не оголяя базу. Принят по итогам субагентов (agent2): bh 84/8 vs balanced 82/8 на 1-10.
  threatGatedBonus: true,   // флаг: применять threat-gate к сбору призов (включён по умолчанию)
  bonusThreatRadius: 8,     // враг в этом радиусе от базы И с LOS на базу → «опасное окно», приз не берём
  pickupLeash: 20,          // не уходить за призом дальше этого радиуса от базы (привязка)
  wBonusValue: 2.5,         // вес ценности приза в proximity+value: value/(d+1)
  guardRadius: 9,           // партнёр-защитник должен быть в этом радиусе от базы, чтобы мы могли уйти за призом
  minBonusValue: 80,        // минимальная ценность приза, ради которого стоит уходить от базы
  maxEnemiesBonus: 3,       // макс. число живых врагов на поле, при котором ещё можно уйти за призом
  wBonusPath: 0.2,          // штраф за стоимость пути к призу (снижен при безопасном рейде)
  wBonusBase: 0.0,          // штраф за удаление от базы (BONUS) (снижен при безопасном рейде)
  wRetreatIn: 2,           // штраф/вес входящих пуль (RETREAT)
  wRetreatCover: 0.3,      // вес близости укрытия (RETREAT)
  retreatHelmet: 0.5,      // снижение желания отступить при каске
  // веса угрозы базе (threatToBase, дизайн §2.2)
  threat: { speed: 0.30, los: 0.30, dist: 0.25, power: 0.10, path: 0.05 },
};

let cfg = { ...DEFAULT_CFG };

// Именованные пресеты. Быстрое переключение через setStrategyConfig.
// Дефолт (DEFAULT_CFG) = THREAT-GATED сбор призов (пресет `bh`, 84/8 на 1-10 — победитель субагентов).
export const PRESETS = {
  // старый дефолт (до обхода «чёрной дыры»): без threat-gate, 82/8 — эталон для A/B
  balanced: { threatGatedBonus: false, wBonusPath: 0.5, wBonusBase: 0.1 },
  stable: { hysteresis: 0.5, holdFrames: 40, detourFrames: 40 },
  aggro: { maxLeash: 16, wThreat: 16, wTankDist: 0.1, wBaseDist: 0.0, wRisk: 0.2, retreatFire: 6 },
  los: { threat: { speed: 0.2, los: 0.5, dist: 0.2, power: 0.05, path: 0.05 } },
  greedy_bonus: { wBonusPath: 0.1, wBonusBase: 0.0, wFlash: 10 },
  // THREAT-GATED proximity+value сбор призов (победитель субагента agent2, 84/8 vs 82/8).
  // Безопасное окно = нет врага близко к базе (bonusThreatRadius) с LOS на базу; приз берём
  // только если он в пределах pickupLeash от базы и поле не переполнено врагами. База не оголяется.
  // Тождественен дефолту (DEFAULT_CFG).
  bh: { threatGatedBonus: true, bonusThreatRadius: 8, pickupLeash: 20, maxEnemiesBonus: 3, minBonusValue: 80, wBonusValue: 2.5, wBonusPath: 0.2, wBonusBase: 0.0 },
};

// Переопределить параметры ИИ (для оптимизации). Можно передать имя пресета (строка).
// Возвращает текущий cfg.
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

// Полностью ли жив/двигается танк (широкий диапазон 0x80..0xd0, как план).
function onField(t: any) {
  if (!t || t.x >= 255) return false;
  return isTankActive(t.flag);
}

// Клетки, которые в ближайшие кадры пройдут вражеские пули (для уворота/avoid).
function enemyThreatCells(perc: any) {
  const set = new Set();
  for (const b of perc.bullets) {
    if (b.team !== "ATT") continue;
    for (const c of b.cells) set.add(cellIdx(c.col, c.row));
  }
  return set;
}

// Ближайшее укрытие (общий слой steer.js).
const nearestCover = nearestCoverShared;

// --- цель стрельбы (линия огня; кирпич пробивается) ---
function fireDir(bf: any, from: any, to: any) {
  if (from.row === to.row) return to.col > from.col ? 3 : 1;
  if (from.col === to.col) return to.row > from.row ? 2 : 0;
  return null;
}

// Навигация на мелкой сетке (общий слой steer.js): точный хитбокс 16×16 + обход частично
// разрушенных кирпичей; фолбэк на коарс с прострелом, если allowBreak. Возвращает 0..3 или null.
function navigateFine(field: any, tank: any, goalCell: any, threatCells: any, allowBreak: any) {
  return steerTo(field, tank.x, tank.y, goalCell, { avoid: threatCells, allowBreak });
}

// Блокирует ли союзник-защитник линию огня от from до to (клетки строго на линии,
// кроме стрелка и цели). Пуля тонкая — соседний танк рядом с линией не мешает.
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

// Лучшая выровненная цель для стрельбы (линия огня, без friendly fire).
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

// --- FSM/utility-состояние по танку ---
function tankState(state: any, t: any) {
  if (!state.has(t)) state.set(t, {
    fsm: "PATROL", prevDir: null, held: 0, prevFire: false,
    noProg: 0, prevGoalDist: undefined, detourDir: null, detourFrames: 0,
  });
  return state.get(t);
}

// Выбор лучшего врага для задействования (utility цели).
// Включает: угрозу базе, близость, мигающего (1 хит = бонус), анти-декой.
function bestTarget(perc: any, tank: any): any {
  let best = null, bestScore = -Infinity;
  const enemies = perc.enemies;
  for (const e of enemies) {
    if (!e.tank.inField) continue;
    // анти-декой: разрешаем охоту, если враг близко к базе ИЛИ нет другого с LOS на базу
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

// --- utility отдельных действий ---
function uEngage(perc: any, tank: any, target: any) {
  // близость к базе снижает цену дальнего перехвата; риск — входящие пули.
  const base = perc.base;
  const dBase = dist(tank.cell, { col: base.col, row: base.row });
  const risk = perc.bullets.filter((b: any) => b.team === "ATT"
    && dist(b.cell, tank.cell) <= cfg.dodgeRadius).length * cfg.wRisk;
  return target.score - dBase * cfg.wEngageBase - risk;
}
// «Безопасное окно» для сбора приза (agent2/bh): нет врага, который одновременно близок
// к базе (bonusThreatRadius) И имеет LOS на базу. Если такой враг есть — коридор базы под
// угрозой, приз не берём.
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
  // hard-gate только для пресета bh (balanced не трогаем)
  if (cfg.threatGatedBonus) {
    // привязка: не уходим за призом дальше pickupLeash от базы
    if (dPrizeBase > cfg.pickupLeash) return -Infinity;
    // ценность: не уходим ради дешёвого приза
    if (prize.value < cfg.minBonusValue) return -Infinity;
    // безопасное окно: нет угрозы коридору базы
    if (!bonusSafeWindow(perc)) return -Infinity;
    // число врагов: уходим за призом, только когда поле относительно чистое, иначе
    // отвлекаемся от боя и теряем убийства
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

// Реактивный COUNTER_SHOT: летящая в нас пуля на нашей оси и в пределах досягаемости.
function counterShot(perc: any, tank: any, ourBusy: any) {
  if (ourBusy) return null;
  const cell = tank.cell;
  let best = null, bestD = Infinity;
  for (const b of perc.bullets) {
    if (b.team !== "ATT") continue;
    const dc = b.cell.col - cell.col, dr = b.cell.row - cell.row;
    if (dc === 0 || dr === 0) {
      if (dc === 0 && (b.cell.row < cell.row || b.cell.row > cell.row)) {
        // в той же колонке
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

// --- главная функция решения по одному танку ---
// Возвращает { dir, fire } (dir может быть null = стоять).
function decideTank(perc: any, tank: any, st: any, frame: any) {
  const field = perc.field;
  const cell = tank.cell;
  const base = perc.base;
  const baseCell = { col: base.col, row: base.row };
  const ourBusy = (perc.state.mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const threatCells = enemyThreatCells(perc);

  // --- 0. COUNTER_SHOT (реактивный, наивысший приоритет) ---
  const cs = counterShot(perc, tank, ourBusy);
  if (cs) {
    st.fsm = "COUNTER_SHOT";
    st.prevDir = cs.dir; st.held = 0;
    return { dir: cs.dir, fire: edgeFire(st, true, ourBusy) };
  }

  // --- 0b. ОГОНЬ по лучшей выровненной цели (линия огня, без friendly fire).
  // Стреляем по любой выровненной цели и одновременно подходим (в пределах leash
  // от базы). Дизайн: защитник активно отстреливает врагов, не ждёт их у базы.
  const aligned = bestAlignedFire(perc, tank);
  if (aligned) {
    st.fsm = "ENGAGE";
    const ncell = { col: cell.col + DX[aligned.dir], row: cell.row + DY[aligned.dir] };
    const move = (tankPassable(field[cellIdx(ncell.col, ncell.row)])
      && dist(ncell, baseCell) <= cfg.maxLeash) ? aligned.dir : null;
    st.prevDir = aligned.dir; st.held = 0;
    return { dir: move, fire: edgeFire(st, true, ourBusy) };
  }

  // --- входящие пули, летящие в нас ---
  const incoming = perc.bullets.filter((b: any) => b.team === "ATT"
    && dist(b.cell, cell) <= 12
    && (b.cell.col === cell.col || b.cell.row === cell.row));

  // --- 1. DEFEND_BASE: база под прямой угрозой → оба сходятся к ближайшему к базе врагу
  const target = bestTarget(perc, tank);
  const dBaseSelf = dist(cell, baseCell);

  // --- 2. выбор действия по utility с гистерезисом ---
  const actions = [];

  // DEFEND_BASE / INTERCEPT / HUNT_BLINK: цель
  if (target) actions.push({ id: "ENGAGE", u: uEngage(perc, tank, target) });

  // RUSH_BONUS / COLLECT_BONUS: приз
  const prize = perc.state.prizes[0];
  if (prize) actions.push({ id: "BONUS", u: uRushBonus(perc, tank, prize) });

  // RETREAT: входящие пули и нет укрытия / низкая безопасность
  if (incoming.length >= cfg.retreatFire && !tank.helmet) {
    actions.push({ id: "RETREAT", u: uRetreat(perc, tank, incoming) });
  }

  // PATROL: базовое удержание якоря у базы
  const anchor = anchorSpot(field, base, tank.index);
  const patrolU = dBaseSelf > cfg.maxLeash ? 3 - dBaseSelf * 0.2 : 1;
  actions.push({ id: "PATROL", u: patrolU });

  // --- выбор: argmax с гистерезисом (не переключаться, пока не вырастет на 15%) ---
  actions.sort((a, b) => b.u - a.u);
  const best = actions[0];
  const current = actions.find((a) => a.id === st.fsm);
  let action = best;
  if (current && st.fsm !== "PATROL" && st.fsm !== "ENGAGE") {
    // держим текущее, если оно всё ещё жизнеспособно и не сильно хуже лучшего
    if (current.u >= 0 && best.u - current.u < cfg.hysteresis * Math.max(1, current.u)) {
      action = current;
    }
  }

  // --- исполнение действия ---
  switch (action.id) {
    case "ENGAGE": {
      const e = target.e;
      st.fsm = "ENGAGE";
      const fd = fireDir(field, cell, e.cell);
      if (fd !== null && lineClear(field, cell, e.cell)) {
        // на прицеле → стреляем, продвигаясь по линии (если свободно и не уводит от базы)
        const ncell = { col: cell.col + DX[fd], row: cell.row + DY[fd] };
        const move = (tankPassable(field[cellIdx(ncell.col, ncell.row)])
          && dist(ncell, baseCell) <= cfg.maxLeash) ? fd : null;
        st.prevDir = fd; st.held = 0;
        return { dir: move, fire: edgeFire(st, true, ourBusy) };
      }
      // нет линии → перехват: A* к предсказанной клетке врага (с учётом реального хитбокса
      // и частично разрушенных кирпичей; избегание зон под пулями)
      const goal = e.predicted || e.cell;
      const d = navigateFine(field, tank, goal, threatCells, true);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      // если шаг ведёт в кирпич вплотную к цели — простреливаем его
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
      // у якоря — патрулируем (не стоим): ближайшая свободная клетка от базы, лёгкое смещение
      const atAnchor = dist(cell, anchor) <= 1;
      const goal = atAnchor ? { col: anchor.col, row: anchor.row + 1 } : anchor;
      const d = navigateFine(field, tank, goal, threatCells, false);
      const out = smoothAndDetour(st, tank, d, field, goal, baseCell);
      return { dir: out.dir, fire: edgeFire(st, false, ourBusy) };
    }
  }
}

// Edge-trigger огня: A удерживается только когда слот свободен; fire=true лишь на фронте.
function edgeFire(st: any, want: any, ourBusy: any) {
  const can = want && !ourBusy;
  const fire = can && !st.prevFire;
  st.prevFire = can;
  return fire;
}

// Гистерезис направления + анти-застревание (обход при отсутствии прогресса).
function smoothAndDetour(st: any, tank: any, dir: any, field: any, goal: any, baseCell: any) {
  // анти-застревание
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

  // гистерезис направления: держим prevDir, пока не настоится новое
  if (moveDir === null) return { dir: null };
  if (st.prevDir === null || moveDir === st.prevDir) { st.held = 0; st.prevDir = moveDir; return { dir: moveDir }; }
  const fc = tank.cell.col + DX[st.prevDir], fr = tank.cell.row + DY[st.prevDir];
  const blocked = !(inBounds(fc, fr) && (tankPassable(field[cellIdx(fc, fr)]) || isBrick(field[cellIdx(fc, fr)])));
  if (blocked) { st.held = 0; st.prevDir = moveDir; return { dir: moveDir }; }
  st.held = (st.held || 0) + 1;
  if (st.held >= cfg.holdFrames) { st.prevDir = moveDir; return { dir: moveDir }; }
  return { dir: st.prevDir };
}

// Якорная позиция защитника: левый (t0) / правый (t1) фланг у базы. Ищет ближайшую
// проходимую клетку к желаемой, с лимитом ретраев.
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
  // fallback: рядом с базой
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1], [0, -1], [-2, 0], [2, 0]]) {
    const c = base.col + dc, r = base.row + dr;
    if (inBounds(c, r) && tankPassable(field[cellIdx(c, r)])) return { col: c, row: r };
  }
  return { col: base.col, row: base.row - 1 };
}

// --- ГЛАВНАЯ ФУНКЦИЯ (интерфейс как у planDefense) ---
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
      // респавн мёртвого танка напрямую (без Start — иначе пауза)
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

// Сброс персистентного состояния (при переключении ИИ на лету).
export function resetStrategyDefense() {}
