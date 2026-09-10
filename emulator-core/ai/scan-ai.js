// scan-ai.js — ИИ с полным сканированием игровой ситуации.
//
// Каждый шаг (кадр) для каждого ИИ-танка мозг сканирует ВСЮ карту:
//   - поле (тайлы, проходимость, кирпичи для прострела),
//   - пули (позиция, направление, владелец) и их траектории,
//   - призы (позиция, тип),
//   - орёл (цель атакующих) и защитники (цели/угрозы),
//   - направления движения противников (вектор скорости).
// На основе этого строится модель ситуации и выбирается САМЫЙ ВЫГОДНЫЙ шаг из
// всех возможных: цена достижения цели (BFS-поле) + безопасность от пуль +
// плавность (инерция направления). Танк всегда двигается или стреляет (не
// замирает и не застревает), а стоять может только чтобы прострелить кирпич.
//
// Архитектура (чистые функции, легко тестировать):
//   scanPlan(mem, prev) -> { decisions: Map<idx,{dir,fire,goal}>, state }
//     - readBattlefield / readBullets / readPrizes — сканирование состояния;
//     - threatSet()            — клетки, куда летят вражеские пули;
//     - costToGoal()           — BFS-поле расстояний к цели;
//     - bestStep()             — выбор направления (цель+безопасность+плавность);
//     - bestShoot() / chooseGoal() — выбор стрельбы и цели;
//     - decideAttacker()       — финальное решение по одному танку.
import { readState, DX, DY, FIELD, inBounds, cellIdx, tankPassable, isBrick,
  blocksBullet, cellPassable, dist, dirTo, lineClear } from "../model/game-view.js";
import { costField, UNREACHABLE } from "../model/pathfind.js";
import { trajectoryCells } from "../model/perception.js";
import { RAM } from "../rom-contract.js";

// --- параметры ---
const INTERCEPT_MIN = 2;   // мин. дистанция для перехвата пули выстрелом
const DODGE_RADIUS = 6;    // радиус реального уворота от пули
const SPAWN_ROWS = 6;      // верхние ряды спавна: там не уворачиваемся
const PURSUIT_RANGE = 14;  // радиус охоты за защитником
const PRIZE_RANGE = 9;     // радиус, на котором идём за призом
const BASE_COMMIT_RANGE = 11; // рядом с базой — всегда идём к ней (финальный рывок)
const GUARD_PRIZE_REACH = 12; // защитник: радиус сбора ценного приза
const KILL_ZONE = 6;       // перекрёстный огонь: радиус вокруг базы для focus-fire
const DEFEND_RADIUS = 15;  // защитник: вернуться к базе, если угроза и мы недалеко
const GUARD_HUNT_RANGE = 10; // при многих врагах защитник гонится только за ближними
// UNREACHABLE и costField — из общего слоя pathfind.js.

const THREAT_PENALTY = 6;  // штраф за клетку под вражеской пулей

// Проходима ли клетка для шага танка (движение ИЛИ прострел кирпича).
function stepPassable(f, c, r) {
  return inBounds(c, r) && (tankPassable(f[cellIdx(c, r)]) || isBrick(f[cellIdx(c, r)]));
}

// Попадёт ли пуля в клетку (с остановкой на препятствии/границе).
function bulletPathHits(field, bullet, cell, steps = 20) {
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

// Клетки, которые в ближайшие кадры пройдут вражеские пули (для уворота).
// Делегирует в общий слой (trajectoryCells, 14 шагов).
function threatSet(bf) {
  const set = new Set();
  for (const b of bf.bullets) {
    if (b.team !== "DEF") continue;
    for (const c of trajectoryCells(bf.field, b, 0, 14)) set.add(cellIdx(c.col, c.row));
  }
  return set;
}

// BFS-поле стоимости достижения цели — перенесено в общий слой pathfind.js (`costField`).
// (Движение = 1, «прострел» кирпича = max(1, прочность).) См. costField.

// Лучшее направление к цели: минимизируем стоимость + штраф за пули, с инерцией.
function bestStep(bf, cell, goalCell, cost, threatSet_, prevDir) {
  const field = bf.field;
  const heur = (nc, nr) => Math.abs(nc - goalCell.col) + Math.abs(nr - goalCell.row);

  let best = null, bestScore = Infinity;
  for (let d = 0; d < 4; d++) {
    const nc = cell.col + DX[d], nr = cell.row + DY[d];
    if (!stepPassable(field, nc, nr)) continue; // либо проходимо, либо кирпич для прострела
    const idx = cellIdx(nc, nr);
    const c = cost[idx] === UNREACHABLE ? heur(nc, nr) + 1000 : cost[idx];
    const threat = threatSet_.has(idx) ? THREAT_PENALTY : 0;
    const score = c + threat;
    if (score < bestScore) { bestScore = score; best = d; }
  }
  if (best === null) return null; // полностью заперт
  // плавность: если предыдущее направление ведёт к цели не хуже и безопасно — держим
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

// Вражеская команда для роли: атакующий бьёт DEF, защитник бьёт ATT.
function enemyTeamOf(role) { return role === "att" ? "DEF" : "ATT"; }

// Лучшая цель для выстрела: выровненный враг с линией огня (кирпич — ок).
function bestShoot(bf, tank, role) {
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

// Лучший приз для сбора: учёт ценности (граната/каска — приоритет) и близости.
function bestPrize(bf, cell, baseReach) {
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

// Выбор цели движения АТАКУЮЩЕГО: база — главный приоритет. Пока далеко — можно
// охотиться/собирать приз; РЯДОМ с базой — всегда к орлу (финальный рывок).
function chooseGoalAtt(bf, tank) {
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

// Выбор цели движения ЗАЩИТНИКА — человеческая ОХОТА: бьём мигающего врага (приз),
// иначе ближайшего; к базе возвращаемся, только когда нет врагов. (Враг у базы уже
// обрабатывается focus-fire выше в decideTank.)
function chooseGoalDef(bf, tank, subRole) {
  const cell = tank.cell;
  let flash = null, nearest = null, nd = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "ATT" || !e.inField) continue;
    if (e.flashing && flash === null) flash = e;
    const d = dist(cell, e.cell);
    if (d < nd) { nd = d; nearest = e; }
  }
  if (flash) return { cell: leadCell(flash), kind: "hunt" };
  // D: много врагов — охраняем базу (гоняемся только за близкими), мало — финиш
  const manyLeft = bf.enemiesLeft > 10;
  const fewLeft = bf.enemiesLeft <= 3;
  if (nearest && (fewLeft || !manyLeft || dist(cell, nearest.cell) <= GUARD_HUNT_RANGE)) {
    return { cell: leadCell(nearest), kind: "hunt" };
  }
  // ценный приз (защитники — «игроки», призы им важны)
  const p = bestPrize(bf, cell, GUARD_PRIZE_REACH);
  if (p) return { cell: p.cell, kind: "prize" };
  const side = tank.index === 0 ? -1 : 1;
  let anchor = { col: bf.eagle.col + side * 2, row: bf.eagle.row - 2 };
  if (!tankPassable(bf.field[cellIdx(anchor.col, anchor.row)])) anchor = { col: bf.eagle.col + side, row: bf.eagle.row - 2 };
  return { cell: anchor, kind: "guard" };
}

// Упреждение по направлению/скорости врага (B): быстрый враг (speedClass>1) —
// целиться на клетку вперёд по его движению; медленный — в саму клетку.
function leadCell(e) {
  if (!e.inField || !(e.speedClass > 1.3)) return e.cell;
  return { col: e.cell.col + DX[e.dir], row: e.cell.row + DY[e.dir] };
}

// Решение по одному танку (атака или защита).
function decideTank(bf, tank, mem, st, role) {
  const field = bf.field;
  const cell = tank.cell;
  const enemy = enemyTeamOf(role);
  const ourBusy = (mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const incoming = bf.bullets
    .filter((b) => b.team === enemy && bulletPathHits(field, b, cell))
    .sort((a, b) => dist(a.cell, cell) - dist(b.cell, cell));

  // 1. ПЕРЕХВАТ: сбить летящую в нас пулю своим выстрелом.
  if (!ourBusy && incoming.length && dist(incoming[0].cell, cell) >= INTERCEPT_MIN) {
    const fd = dirTo(cell, incoming[0].cell);
    if (fd !== null && lineClear(field, cell, incoming[0].cell)) {
      return { dir: fd, fire: true, goal: "intercept" };
    }
  }

  // 1b. ПЕРЕКРЁСТНЫЙ ОГОНЬ (def): самый опасный атакующий у базы — общая цель обоих
  //     защитников. Реагируем, только если мы САМИ недалеко от базы; иначе бежим к
  //     базе по своей цели (иначе гард застревает у врага вдали от базы).
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

  // 2. СТРЕЛЬБА: выровненный враг в линии огня (в т.ч. через кирпич).
  const shoot = bestShoot(bf, tank, role);
  if (shoot && !ourBusy) {
    const nc = cell.col + DX[shoot.dir], nr = cell.row + DY[shoot.dir];
    const move = cellPassable(field, nc, nr) ? shoot.dir : null; // вперёд или стоим и бьём
    return { dir: move, fire: true, goal: "kill" };
  }

  // 3. УВОРОТ: близкая пуля — перпендикулярно (в спавне атакующий не уворачивается).
  const nearIncoming = incoming.filter((b) => dist(b.cell, cell) <= DODGE_RADIUS);
  if (nearIncoming.length && !tank.helmet && (role === "def" || cell.row >= SPAWN_ROWS)) {
    const b = nearIncoming[0];
    for (const d of [(b.dir + 1) % 4, (b.dir + 3) % 4]) {
      if (cellPassable(field, cell.col + DX[d], cell.row + DY[d])) {
        return { dir: d, fire: false, goal: "dodge" };
      }
    }
  }

  // 4. ДВИЖЕНИЕ к цели.
  const subRole = role === "def" ? (tank.index === 0 ? "guard" : "raider") : null;
  const goal = role === "att" ? chooseGoalAtt(bf, tank) : chooseGoalDef(bf, tank, subRole);
  // гард: уже на посту у базы и нет угрозы — держим позицию (не бродим); рейдер — всегда преследует
  if (role === "def" && subRole === "guard" && goal.kind === "guard" && dist(cell, goal.cell) <= 1) {
    return { dir: null, fire: false, goal: "guard" };
  }
  const cost = costField(field, goal.cell);
  const dir = bestStep(bf, cell, goal.cell, cost, bf.threatSet, st.prevDir);

  // 5. ПРОСТРЕЛ: шаг ведёт в кирпич и можем стрелять — бьём его.
  if (dir !== null) {
    const fwd = field[cellIdx(cell.col + DX[dir], cell.row + DY[dir])];
    if (isBrick(fwd) && !tankPassable(fwd)) {
      return { dir, fire: !ourBusy, goal: "break" };
    }
  }

  // 6. Заперт — жадный шаг к своей цели (не стоим).
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

// --- ГЛАВНАЯ ФУНКЦИЯ ---
// role: "att" — атаковать (враги DEF, цель база), "def" — защищать (враги ATT,
// цель база-позиция). Возвращает { decisions, state } для своей команды.
export function scanPlan(mem, prev, role = "att") {
  const bf = readState(mem);
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
