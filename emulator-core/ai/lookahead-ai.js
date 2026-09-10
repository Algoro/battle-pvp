// lookahead-ai.js — ИИ варианта A+D: Model-Predictive Control с предсказанием
// будущего (lookahead) и пространственно-временным планированием.
//
// Для каждого танка перебираем возможные действия (направление движения + огонь)
// и на горизонте H кадров СИМУЛИРУЕМ будущее: движение танка, траектории всех
// вражеских пуль (точно, 2px/кадр — откалибровано по игре), свою пулю (перехват,
// попадание в танк/кирпич). Каждое действие получает численную utility:
//   - выживание: штраф за попадание вражеской пули в танк,
//   - прогресс к базе: меньшее расстояние к орлу = лучше,
//   - эффективность огня: +за перехват пули / убийство / разрушение кирпича.
// Выбираем действие с МАКСИМАЛЬНОЙ utility — это «самый выгодный шаг из возможных».
//
// Архитектура (чистые функции):
//   lookaheadPlan(mem, prev) -> { decisions, state }
//     - simulateAction() — лёгкая модель будущего на H кадров;
//     - utility() — оценка действия;
//     - decideTank() — выбор лучшего действия.
import { readState, DX, DY, inBounds, cellIdx, tankPassable, isBrick, blocksBullet, brickHealth } from "../model/game-view.js";
import { costField, UNREACHABLE } from "../model/pathfind.js";
import { RAM } from "../rom-contract.js";
// --- параметры модели ---
const BULLET_SPEED = 2;   // px/кадр (откалибровано по игре)
const HORIZON = 8;        // глубина предсказания (кадров)
const HIT_RADIUS = 9;     // px — радиус попадания пули в танк
const HIT_PENALTY = 110;  // штраф за попадание в танк (меньше — агрессивнее)
const INTERCEPT_REWARD = 80; // + за перехват вражеской пули
const KILL_REWARD = 200;  // + за убийство защитника (агрессия)
const BREAK_REWARD = 45;  // + за разрушение кирпича
const BASE_WEIGHT = 1.5;  // вес прогресса к базе
const KILL_ZONE = 6;      // перекрёстный огонь: радиус вокруг базы для focus-fire
// UNREACHABLE — из общего слоя pathfind.js.
const THREAT_PENALTY = 6;
const NO_PROGRESS_FRAMES = 20;
const DETOUR_FRAMES = 24;

// --- примитивы карты ---
function pxPassable(field, px, py) {
  const c = Math.floor(px / 8), r = Math.floor(py / 8);
  return inBounds(c, r) && tankPassable(field[cellIdx(c, r)]);
}
function manhattan(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]); }

// Стоит ли атакующему стрелять по защитнику (линия огня, кирпич пробивается).
function fireTarget(field, tank, enemy) {
  if (tank.y === enemy.y && tank.x !== enemy.x) return enemy.x > tank.x ? 3 : 1;
  if (tank.x === enemy.x && tank.y !== enemy.y) return enemy.y > tank.y ? 2 : 0;
  return null;
}

// Попадёт ли пуля в клетку (для перехвата), с остановкой на препятствии.
function bulletWillPass(field, bullet, cell, steps = 14) {
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

// BFS-поле стоимости к цели — перенесено в общий слой pathfind.js (`costField`).

// Лучшее направление к цели (минимум стоимость + штраф за пули), с инерцией.
function bestStep(bf, cell, goalCell, cost, threatSet_, prevDir) {
  const field = bf.field;
  const heur = (nc, nr) => Math.abs(nc - goalCell.col) + Math.abs(nr - goalCell.row);
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

// Вражеская команда для роли.
function enemyTeamOf(role) { return role === "att" ? "DEF" : "ATT"; }
// Цель прогресса в пикселях: атакующий — орёл; защитник — активная охрана базы:
// держимся в своей половине поля, охотимся на ближних/мигающих врагов (контакт =
// убийства), но при угрозе базе немедленно возвращаемся на перехват.
function goalPx(bf, tank, role, subRole) {
  if (role === "att") return { x: bf.eagle.col * 8 + 4, y: bf.eagle.row * 8 + 4 };
  const ex = bf.eagle.col * 8 + 4, ey = bf.eagle.row * 8 + 4;
  const side = tank.index === 0 ? -1 : 1; // танк 0 — левый фланг, танк 1 — правый
  let flash = null, nearest = null, nd = Infinity, nearBase = null, nearBaseD = Infinity;
  for (const e of bf.tanks) {
    if (e.team !== "ATT" || !e.inField) continue;
    if (e.flashing && flash === null) flash = e;
    // враг на своём фланге (свой столбец поля)
    const onSide = side < 0 ? e.x <= ex : e.x >= ex;
    const d = Math.abs(e.x - tank.x) + Math.abs(e.y - tank.y) + (onSide ? 0 : 60);
    if (d < nd) { nd = d; nearest = e; }
    const db = Math.abs(e.x - ex) + Math.abs(e.y - ey);
    if (db < nearBaseD) { nearBaseD = db; nearBase = e; }
  }
  // УГРОЗА БАЗЕ: любой враг, подошедший к базе вплотную — перехватываем его.
  if (nearBase && nearBaseD <= 64) return { x: nearBase.x, y: nearBase.y };
  if (flash) return { x: flash.x, y: flash.y };
  // Активная охота: всегда идём на ближайшего врага своего фланга (контакт = убийства).
  if (nearest) return { x: nearest.x, y: nearest.y };
  // Нет врагов на поле — позиция охраны у базы (своя сторона).
  return { x: ex + side * 2 * 8, y: ey - 2 * 8 };
}

// Симуляция одного действия на H кадров. Возвращает utility.
// dir: 0..3 или null (стоять); fire: стреляем ли; fireDir: куда целится пуля.
function simulateAction(bf, tank, field, dir, fire, fireDir, ourBusy, role, subRole) {
  const enemy = enemyTeamOf(role);
  let tx = tank.x, ty = tank.y;
  let own = null; // своя пуля {x,y,dir}
  if (fire && !ourBusy) own = { x: tx, y: ty, dir: fireDir };
  // вражеские пули (копии позиций)
  const ebs = bf.bullets.filter((b) => b.team === enemy).map((b) => ({ x: b.x, y: b.y, dir: b.dir, alive: true }));
  let score = 0;

  for (let t = 0; t < HORIZON; t++) {
    // вражеские пули движутся
    for (const b of ebs) if (b.alive) { b.x += DX[b.dir] * BULLET_SPEED; b.y += DY[b.dir] * BULLET_SPEED; }
    // движение танка (1px/кадр)
    if (dir !== null) {
      const nx = tx + DX[dir], ny = ty + DY[dir];
      if (pxPassable(field, nx, ny)) { tx = nx; ty = ny; }
    }
    // своя пуля
    if (own) {
      own.x += DX[own.dir] * BULLET_SPEED; own.y += DY[own.dir] * BULLET_SPEED;
      // перехват вражеской пули
      for (const b of ebs) {
        if (!b.alive) continue;
        if (Math.abs(own.x - b.x) < 6 && Math.abs(own.y - b.y) < 6) {
          score += INTERCEPT_REWARD; b.alive = false; own = null; break;
        }
      }
      // попадание во вражеский танк
      if (own) {
        for (const e of bf.tanks) {
          if (e.team !== enemy || !e.inField) continue;
          if (Math.abs(own.x - e.x) < 9 && Math.abs(own.y - e.y) < 9) { score += KILL_REWARD; own = null; break; }
        }
      }
      if (own) {
        const c = Math.floor(own.x / 8), r = Math.floor(own.y / 8);
        if (inBounds(c, r) && isBrick(field[cellIdx(c, r)])) {
          // кирпич разрушается выстрелом; повреждённый (1 выстрел) — выгоднее, чем целый (2)
          score += brickHealth(field[cellIdx(c, r)]) === 1 ? BREAK_REWARD : BREAK_REWARD * 0.5;
          own = null;
        }
      }
    }
    // танк под вражеской пулёй
    for (const b of ebs) {
      if (!b.alive) continue;
      if (Math.abs(tx - b.x) < HIT_RADIUS && Math.abs(ty - b.y) < HIT_RADIUS) score -= HIT_PENALTY;
    }
  }
  // прогресс к цели (меньше — лучше): атакующий к орлу, защитник к позиции у базы
  const goal = goalPx(bf, tank, role, subRole);
  score -= BASE_WEIGHT * manhattan([tx, ty], [goal.x, goal.y]);
  return score;
}

// Выбор сырого направления/желания стрелять + применение edge-логики к огню.
// В симуляторе/эмуляторе кнопка A игрока edge-triggered: выстрел происходит ТОЛЬКО
// в момент нарастания фронта (fire:true после fire:false) и при свободном слоте пули.
// Непрерывное удержание A = ОДИН выстрел за всё время. Поэтому "хотим стрелять"
// (wantFire) транслируем в реальный fire: единичный кадр фронта, когда слот свободен
// и мы не держали кнопку в прошлом кадре; иначе — отпускаем (даёт новый фронт).
function resolveFire(st, wantFire, ourBusy) {
  const canFire = wantFire && !ourBusy;
  const fire = canFire && !st.prevFire;
  st.prevFire = canFire;
  return fire;
}

// Решение по одному танку: перебираем действия, берём максимум utility.
function decideTank(bf, tank, mem, st, role, subRole) {
  const field = bf.field;
  const enemy = enemyTeamOf(role);
  const ourBusy = (mem[RAM.BULLET_STATUS + tank.index] & 0xf0) === 0x40;
  const cell = { col: tank.cell.col, row: tank.cell.row };

  // 1. ПЕРЕХВАТ: летящая в нас пуля по линии, можем стрелять — стреляем в неё.
  const incoming = bf.bullets.filter((b) => b.team === enemy && bulletWillPass(field, b, cell));
  if (incoming.length) {
    const p = incoming.sort((a, b) => Math.abs(a.x - tank.x) + Math.abs(a.y - tank.y) - (Math.abs(b.x - tank.x) + Math.abs(b.y - tank.y)))[0];
    const fd = fireTarget(field, tank, { x: p.x, y: p.y });
    if (fd !== null) return { dir: fd, fire: resolveFire(st, true, ourBusy), goal: "intercept" };
  }

  // 1b. ОГОНЬ ПО ВЫРОВНЕННОМУ ВРАГУ (def): любая цель в строке/колонке с линией
  //     огня — стреляем, независимо от дистанции (пуля летит сквозь кирпичи).
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

    // УВОРОТ: летящая в нас пуля близко и прямо по линии — отходим перпендикулярно.
    const nearB = bf.bullets.filter((b) => b.team === "ATT" && Math.abs(b.x - tank.x) < 60 && Math.abs(b.y - tank.y) < 60);
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

    // 1c. ПЕРЕКРЁСТНЫЙ ОГОНЬ (def): самый опасный атакующий у базы — общая цель.
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

  // 2. Кандидаты действий и их utility (lookahead).
  const candidates = [];
  const dirs = [0, 1, 2, 3];
  for (const d of dirs) {
    const nc = tank.cell.col + DX[d], nr = tank.cell.row + DY[d];
    if (!inBounds(nc, nr)) continue;
    const pass = tankPassable(field[cellIdx(nc, nr)]);
    if (!pass && !isBrick(field[cellIdx(nc, nr)])) continue; // ни движение, ни прострел
    // движение + огонь/без
    for (const fire of [false, true]) {
      const u = simulateAction(bf, tank, field, d, fire, d, ourBusy, role, subRole);
      candidates.push({ dir: d, fire, u, goal: pass ? "move" : "break" });
    }
  }
  // стоять + огонь/без
  for (const fire of [false, true]) {
    const u = simulateAction(bf, tank, field, null, fire, st.prevDir ?? 2, ourBusy, role, subRole);
    candidates.push({ dir: null, fire, u, goal: "stand" });
  }

  // 3. Лучший кандидат (максимум utility), плавность как tie-breaker.
  let best = null, bestU = -Infinity;
  for (const c of candidates) {
    let u = c.u;
    if (best && c.u === bestU && c.dir === st.prevDir) u += 0.5; // предпочитаем плавность при равенстве
    if (u > bestU) { bestU = u; best = c; }
  }
  if (best === null) return { dir: null, fire: resolveFire(st, false, ourBusy), goal: "stuck" };

  // АНТИ-ЗАСТРЕВАНИЕ (только для защитника): ИИ-защитник не видит стен (поле в
  // toMem пустое), поэтому напрямую к цели может упереться в реальную стену и
  // топтаться. Отслеживаем РАССТОЯНИЕ до цели: если движение не уменьшает его
  // NO_PROGRESS_FRAMES кадров — начинаем УСТОЙЧИВЫЙ обход (едем перпендикулярно
  // цели DETOUR_FRAMES кадров), чтобы обогнуть препятствие. Атакующему это НЕ
  // применяем (его навигация остаётся исходной, чтобы не усиливать врага).
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

// --- ГЛАВНАЯ ФУНКЦИЯ ---
// role: "att" — атаковать, "def" — защищать. Возвращает решения для своей команды.
export function lookaheadPlan(mem, prev, role = "att") {
  const bf = readState(mem);
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
