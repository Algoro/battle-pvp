// tactical-ai.js — тактический мозг атакующей команды (ATT, танки 2..7).
//
// Цельный, детерминированный модуль: строит модель боя (все танки, типы
// препятствий, орёл, угрозы), прогнозирует движение противников и для каждого
// атакующего танка, управляемого ИИ, возвращает решение {dir, fire}.
// Движение/коллизию/спавн исполняет тело ASM (через NET_DIR/NET_FIRE).
//
// Ключевые свойства:
//  - ИНДИВИДУАЛЬНОЕ ПОВЕДЕНИЕ: у каждого танка свой независимый приоритет решений —
//    никакого командного планирования и общих ролей. Каждый охотится, ищет укрытие
//    и штурмует базу по собственному усмотрению.
//  - АГРЕССИВНАЯ ОХОТА: атакующий при любой удобной линии огня бьёт по врагу
//    (даже через весь экран), предсказывая его движение (вектор скорости).
//  - УКРЫТИЯ: под угрозой танк отходит в укрытие (клетка рядом с препятствием),
//    если нет ответной линии огня.
//  - Цели: захват базы И уничтожение противников.
//  - Поведение одинаково независимо от команды игрока (рулит ATT-танками,
//    у которых нет сетевого ввода и которые не человеческие).
//  - Минимум фолбэков: один путь решения на танк.
// Относительный путь: ./emulator-core/ai/tactical-ai.js
import { FIELD, TILE, DEF_END, DX, DY, inBounds, cellIdx, tankPassable, isBrick,
  blocksBullet, cellPassable, dist, dirTo, cellOf, isEagleTile, readState,
  lineClear, prizeValue, PRIZE_VALUE } from "../model/game-view.js";
import { nearestCover as steerNearestCover } from "../model/steer.js";
import { bfsDirection } from "../model/pathfind.js";
export { lineClear, prizeValue, PRIZE_VALUE };
export { bfsDirection };

const OPP = [2, 3, 0, 1];

const ENEMY_START = 2;
const ENEMY_END = 8;

const LEAD = 2; // упреждение (клеток) для стрельбы по движущейся цели
const PURSUIT_RANGE = 14; // радиус преследования DEF-танков (клеток)
const DODGE_RADIUS = 6; // радиус (клеток), на котором танк реально уворачивается от пули
const INTERCEPT_MIN = 4; // мин. дистанция (клеток) для перехвата пули выстрелом — иначе в упор уворачиваемся
const PRIZE_RANGE = 8; // радиус (клеток), на котором защитник идёт собирать приз
const HUNT_GUARD_RANGE = 10; // при многих врагах защитник гонится только за ближними

// Максимальная дальность «безопасного» выстрела (клеток): пуля обязана упереться в
// сплошной тайл (кирпич/сталь/орла/врага) в этом радиусе. Иначе в симуляторе пуля
// улетает за экран и НЕ деактивируется → слот пули танка занят НАВСЕГДА и танк
// больше не может стрелять. Поэтому стреляем только по цели, чей выстрел гарантированно
// попадает в твёрдый тайл (или по ближней цели).
// Танк активен на поле. Отличается от game-view.aliveFlag (0x90-0xd0): симулятор и
// эмулятор считают живым/двигающимся также флаг 0x80 (пауза/поворот между шагами,
// см. movementRange в sim/battle.js). Иначе DEF-ИИ не «видит» врагов в состоянии 0x80.
function onField(t) {
  if (!t || t.x >= 255) return false;
  const hi = t.flag & 0xf0;
  return hi >= 0x80 && hi <= 0xd0;
}

function aliveFlag(flag) {
  const hi = flag & 0xf0;
  return hi >= 0x90 && hi <= 0xd0;
}
const toCell = cellOf;

// Укрытие: проходимая клетка рядом с препятствием.
export function isCover(field, c, r) {
  if (!cellPassable(field, c, r)) return false;
  for (let d = 0; d < 4; d++) {
    const nc = c + DX[d], nr = r + DY[d];
    if (inBounds(nc, nr) && !tankPassable(field[cellIdx(nc, nr)])) return true;
  }
  return false;
}

export function findEagle(field) {
  let minR = 32, minC = 16;
  for (let r = 15; r < 31; r++) {
    for (let c = 0; c < FIELD; c++) {
      const v = field[r * FIELD + c];
      if (v >= 0xc8 && v <= 0xcb && r < minR) { minR = r; minC = c; }
    }
  }
  return minR === 32 ? { col: 15, row: 26 } : { col: minC, row: minR };
}

// readBattlefield/readPrizes/readBullets делегируют в единый слой game-view (GameState).
export function readBattlefield(mem) { return readState(mem); }

export function readPrizes(mem) { return readState(mem).prizes; }
export function readBullets(mem) { return readState(mem).bullets; }

// bfsDirection перенесён в общий слой ../model/pathfind.js и ре-экспортируется выше.
// Ближайшее укрытие — делегирует в общий слой steer.js (идентичная логика).
function nearestCover(field, from) { return steerNearestCover(field, from, null); }

// Предсказание позиции цели: текущая клетка + вектор скорости * упреждение.
function predictCell(cell, vel) {
  return {
    col: cell.col + vel.col * LEAD,
    row: cell.row + vel.row * LEAD,
  };
}

// Выровнены ли (танк может стрелять по цели): одна строка или колонка с линией огня.
// Возвращает направление выстрела (0..3) или null.
function fireDirection(field, from, to) {
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

// Попадёт ли пуля в клетку в ближайшие `steps` шагов. Следим по направлению
// пули и останавливаемся, когда пуля упрётся в препятствие (стену/сталь) или
// выйдет за пределы поля — сквозь стены пуля не летит.
function bulletPathHits(field, bullet, cell, steps = 20) {
  const dx = DX[bullet.dir], dy = DY[bullet.dir];
  let c = bullet.cell.col, r = bullet.cell.row;
  for (let i = 0; i < steps; i++) {
    c += dx; r += dy;
    if (c === cell.col && r === cell.row) return true;
    if (c < 0 || c >= FIELD || r < 0 || r >= FIELD) return false;
    if (blocksBullet(field[cellIdx(c, r)])) return false; // пуля остановилась
  }
  return false;
}

// Под угрозой ли танк (какой-то DEF-танк может его обстрелять) и нет ли ответного огня.
function threatFor(bf, tank) {
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    if (lineClear(bf.field, e.cell, tank.cell)) {
      const canReturn = lineClear(bf.field, tank.cell, e.cell);
      return { threat: e, canReturn };
    }
  }
  return null;
}

// Может ли пуля от from до to задеть союзный (DEF) танк? Проверяем только клетки,
// РОВНО на линии огня (пуля тонкая) между стрелком и целью — соседний танк рядом
// с линией не блокирует выстрел (иначе два защитника у базы блокируют друг друга).
function allyNearLine(bf, from, to, selfIndex) {
  if (from.row !== to.row && from.col !== to.col) return false; // не по строке/колонке
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

// --- РЕШЕНИЕ ПО ОДНОМУ ТАНКУ (индивидуальное, без общих ролей) ---
// Каждый танк сам выбирает ближайшую цель и собственную линию штурма — без
// командного планирования. Приоритет: перехват пули > уворот > укрытие > огонь по
// цели > преследование > штурм базы > анти-застревание. Танк почти всегда движется
// и стоит на месте только когда стреляет через препятствие.
export function decideTank(bf, tank, state, underThreat) {
  const cell = tank.cell;
  const ourBusy = (bf.mem[0xcc + tank.index] & 0xf0) === 0x40;
  // В верхних спавн-рядах танк не уворачивается/не прячется — иначе застрянет у
  // ворот под обстрелом. Сначала надо спуститься в поле, потом уклоняться.
  const inSpawn = cell.row < 6;

  const incoming = bf.bullets
    .filter((b) => b.team === "DEF" && bulletPathHits(bf.field, b, cell))
    .sort((a, b) => dist(a.cell, cell) - dist(b.cell, cell));

  // 1. Перехват летящей в нас пули своим выстрелом (только если можем стрелять,
  //    пуля ещё достаточно далеко и прямо по линии). В упор перехватить не успеем —
  //    там уворачиваемся.
  if (!inSpawn && !ourBusy && incoming.length && dist(incoming[0].cell, cell) >= INTERCEPT_MIN) {
    const fd = dirTo(cell, incoming[0].cell);
    if (fd !== null && lineClear(bf.field, cell, incoming[0].cell)) {
      return { dir: fd, fire: true, goal: "intercept" };
    }
  }

  // 2. Уворот от летящей в нас пули: движение перпендикулярно её курсу. Только
  //    если пуля уже близко — иначе танк вечно уклоняется и не атакует.
  const nearIncoming = incoming.filter((b) => dist(b.cell, cell) <= DODGE_RADIUS);
  if (!inSpawn && nearIncoming.length) {
    const b = nearIncoming[0];
    const perp = [(b.dir + 1) % 4, (b.dir + 3) % 4];
    for (const d of perp) {
      const nc = cell.col + DX[d], nr = cell.row + DY[d];
      if (cellPassable(bf.field, nc, nr)) return { dir: d, fire: false, goal: "dodge" };
    }
  }

  // 3. Укрытие: под угрозой и без ответного огня — отойти в укрытие.
  if (!inSpawn && underThreat && !underThreat.canReturn) {
    const cover = nearestCover(bf.field, cell);
    if (cover) {
      const dir = bfsDirection(bf.field, cell, cover);
      if (dir !== null) return { dir, fire: false, goal: "cover" };
    }
  }

  // 4. Выровненный защитник (линия огня; кирпичи пробиваются): стреляем и
  //    одновременно подходим ближе; если впереди непроходимая преграда — стоим
  //    и простреливаем её (единственный случай намеренной остановки).
  let aligned = null, alignedDist = Infinity, alignedFd = null;
  for (const e of bf.tanks) {
    if (e.team !== "DEF" || !e.inField) continue;
    if ((cell.row === e.cell.row || cell.col === e.cell.col) && lineClear(bf.field, cell, e.cell)) {
      const fd = dirTo(cell, e.cell);
      const d = dist(cell, e.cell);
      if (d < alignedDist) { alignedDist = d; aligned = e; alignedFd = fd; }
    }
  }
  if (aligned) {
    // Стреляем и продвигаемся к цели вдоль линии огня; если впереди непроходимая
    // преграда — стоим и простреливаем её. Активное продвижение эффективнее,
    // чем стояние под ответным огнём.
    const ncell = { col: cell.col + DX[alignedFd], row: cell.row + DY[alignedFd] };
    const move = cellPassable(bf.field, ncell.col, ncell.row) ? alignedFd : null;
    return { dir: move, fire: !ourBusy, goal: "kill" };
  }

  // 5. Преследование: ближайший DEF-танк в радиусе охоты — двигаемся к нему.
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

  // 6. Штурм базы: каждый танк идёт на свою линию перед орлом, стреляет в коридоре.
  const lane = ((tank.index % 3) + 2) % 3 - 1; // -1, 0, +1 по индексу танка
  // пробуем несколько точек перед орлом, чтобы найти достижимую
  for (const off of [lane, 0, 1, -1]) {
    const goal = { col: bf.eagle.col + off, row: bf.eagle.row };
    const dir = bfsDirection(bf.field, cell, goal);
    if (dir !== null) {
      const inCorridor = Math.abs(cell.col - bf.eagle.col) <= 1 && cell.row < bf.eagle.row;
      return { dir, fire: inCorridor && !ourBusy, goal: "base" };
    }
  }

  // 7. Анти-застревание: если маршрут недостижим — жадным шагом движемся к базе
  //    (а не в любую свободную сторону), чтобы не упираться в стену на месте.
  let best = null, bestDist = Infinity;
  for (let d = 0; d < 4; d++) {
    const nc = cell.col + DX[d], nr = cell.row + DY[d];
    if (!cellPassable(bf.field, nc, nr)) continue;
    const dd = Math.abs(nc - bf.eagle.col) + Math.abs(nr - bf.eagle.row);
    if (dd < bestDist) { bestDist = dd; best = d; }
  }
  if (best !== null) return { dir: best, fire: false, goal: "wander" };

  // Полностью заперт — остаёмся и стреляем, если можем.
  return { dir: null, fire: !ourBusy, goal: "stuck" };
}

// --- ГЛАВНАЯ ФУНКЦИЯ ---
// prev: Map<tankIndex, {prevCell, vel}>. Возвращает
// { decisions: Map<tank,{dir,fire,goal}>, state: Map<tank,{prevCell,vel}> }.
export function plan(mem, prev) {
  const bf = readBattlefield(mem);

  // Обновляем скорость движения каждой цели (детерминированно, из prev).
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

function clamp(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }

// --- ЗАЩИТНЫЙ ИИ (DEF, танки 0,1) ---
// DEF-танки — активные защитники базы. Без их ИИ у атакующих нет реальных
// противников, и охотничьи алгоритмы не раскрываются. Возвращает Map<port, buttons>
// (кнопки для контроллера DEF: направление + A + Start для респавна).
const BTN_START = 0x08, BTN_A = 0x01;
const DIR_BTN = [0x10, 0x40, 0x20, 0x80]; // Up, Left, Down, Right
const PRIZE_CHASE_THRESHOLD = 80; // ценные призы (граната/каска/звезда) — высший приоритет
const GUARD_RADIUS = 5; // гард: радиус «угрозы базе» (перехват)
const KILL_ZONE = 6; // перекрёстный огонь: радиус вокруг базы, где оба бьют по опасному

// Решение защитника: ОХРАНЯЕТ базу. t0 держит левый фланг базы, t1 — правый.
// Ключевые принципы:
//  1) Не убегать от базы: защитник держится в GUARD_RADIUS вокруг базы, а при
//     выходе наружу возвращается к якорю (иначе оголяет базу и уходит за врагом).
//  2) Огонь по лучшей выровненной цели (приоритет — угрозе базе и близкому врагу).
//  3) Перехват: входящего в охранную зону врага встречаем, выходя в линию огня.
function decideDefender(bf, tank, lastDir = null, role = "guard") {
  const cell = tank.cell;
  const base = { col: bf.eagle.col, row: bf.eagle.row };
  const enemies = bf.tanks.filter((e) => e.team === "ATT" && onField(e));
  const dBase = Math.abs(cell.col - base.col) + Math.abs(cell.row - base.row);
  const side = tank.index === 0 ? -1 : 1;
  const isGuard = role === "guard";
  // Много врагов на поле — защищаемся плотнее у базы (не уходим в охоту, иначе
  // рой прорвётся); мало врагов — идём в охоту и добиваем оставшихся в углах.
  const many = enemies.length >= 5;
  const leash = isGuard ? 5 : (many ? 7 : 8);
  const threatRadius = many ? 8 : KILL_ZONE;
  // база под прямой угрозой? Тогда ОБА защитника бросают охоту и защищают базу.
  const baseThreat = enemies.some((e) => dist(e.cell, base) <= threatRadius);

  // УВОРОТ (живучесть): только если не на прицеле врага, которого можно застрелить,
  // и пуля реально близко. Каска — игнорируем, давим.
  const nearBullet = bf.bullets
    .filter((b) => b.team === "ATT" && bulletPathHits(bf.field, b, cell))
    .filter((b) => dist(b.cell, cell) <= DODGE_RADIUS)[0];
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

  // --- 1. ОГОНЬ: бьём по лучшей выровненной цели (без friendly fire).
  // Стреляем при любой выровненной цели. FIRE_MAX-гейт (стрелять только при
  // гарантированном стопе) был обходом бага симулятора, где пуля за экраном не
  // деактивировалась. Теперь симулятор считает пули верно (как эмулятор: пуля за
  // экраном оборачивается и в итоге упирается), поэтому гейт снят — он лишь
  // ограничивал стрельбу на эмуляторе (меньше убийств).
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
    // продвигаемся вдоль линии огня к цели, но не дальше leash от базы
    const ncell = { col: cell.col + DX[aligned.fd], row: cell.row + DY[aligned.fd] };
    let move = null;
    if (cellPassable(bf.field, ncell.col, ncell.row) &&
        Math.abs(ncell.col - base.col) + Math.abs(ncell.row - base.row) <= leash) {
      move = aligned.fd;
    }
    return { dir: move, fire: true };
  }

  // --- 2. ЦЕННЫЕ ПРИЗЫ (граната/каска/звезда) — только если база не под угрозой.
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
    const baseThreat = enemies.some((e) => dist(e.cell, base) <= KILL_ZONE);
    if (bestPrize && !baseThreat && (bestPrize.value >= PRIZE_CHASE_THRESHOLD || bestScore > 20)) {
      const d = bfsDirection(bf.field, cell, bestPrize.cell);
      if (d !== null) return { dir: d, fire: false };
    }
  }

  // --- 3. БАЗА ПОД УГРОЗОЙ: оба защитника бросают охоту и встречают врага,
  // ближайшего к базе, чтобы расстрелять его в упор ДО разрушения орла.
  if (baseThreat) {
    let th = null, td = Infinity;
    for (const e of enemies) {
      const d = dist(e.cell, base);
      if (d < td) { td = d; th = e; }
    }
    if (th) {
      // если враг ещё не на прицеле — выходим в линию огня (в упор стрельба точна)
      if (fireDirection(bf.field, cell, th.cell) === null) {
        const below = th.cell.row > cell.row; // враг ниже нас
        const desired = below ? { col: cell.col, row: th.cell.row } : { col: th.cell.col, row: cell.row };
        let dir = bfsDirection(bf.field, cell, desired);
        if (dir === null) dir = bfsDirection(bf.field, cell, th.cell);
        if (dir !== null) return { dir, fire: false };
      }
      // иначе (уже на прицеле) — огонь обработает ветка 1; здесь просто держимся
      // близко к угрозе
      if (dist(cell, th.cell) > 2) {
        const dir = bfsDirection(bf.field, cell, th.cell);
        if (dir !== null) return { dir, fire: false };
      }
    }
  }

  // --- 4. ОХОТА (только если база не под угрозой): идём к ближайшему врагу в
  // радиусе leash, чтобы расстрелять его в упор ДО подхода к базе.
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

  // --- 5. Возврат к базе, если защитник ушёл слишком далеко (оборона важнее охоты).
  if (dBase > leash) {
    const anchor = anchorSpot(bf, base, side);
    const dir = bfsDirection(bf.field, cell, anchor);
    if (dir !== null) return { dir, fire: false };
  }

  // --- 6. БАЗА: нет угрозы — держим якорную позицию у базы (левый/правый фланг).
  const anchor = anchorSpot(bf, base, side);
  const dir = bfsDirection(bf.field, cell, anchor);
  if (dir !== null) return { dir, fire: false };

  // --- 7. ПАТРУЛЬ: не осциллируем; держим последнее направление, если свободно.
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

// Якорная позиция защитника у базы: проходимая клетка на фланге (side) над базой.
// t0 — слева, t1 — справа. Ищет ближайшую проходимую клетку к желаемой.
function anchorSpot(bf, base, side) {
  const want = { col: base.col + side * 3, row: base.row - 3 };
  for (const [dc, dr] of [[0, 0], [0, 1], [0, 2], [side, 1], [side, 2], [-side, 1], [0, -1], [side, -1], [-side, 2], [2 * side, 1], [2 * side, 2]]) {
    const c = want.col + dc, r = want.row + dr;
    if (cellPassable(bf.field, c, r)) return { col: c, row: r };
  }
  // fallback: проходимая клетка рядом с базой
  for (const [dc, dr] of [[-1, 0], [1, 0], [0, 1], [-2, 0], [2, 0], [0, 2], [-1, 1], [1, 1]]) {
    const c = base.col + dc, r = base.row + dr;
    if (cellPassable(bf.field, c, r)) return { col: c, row: r };
  }
  return { col: base.col, row: base.row - 1 };
}

// planDefense(mem, frame): решения для AI-DEF-танков (порты 0,1).
// frame нужен для ритма респавна (Start edge каждые 30 кадров).
// state (необязательный Map) — персистентное состояние для сглаживания движения
// (инерция), чтобы защитник не «дрожал», переключая направление каждый кадр.
export function planDefense(mem, frame, state = defState) {
  const bf = readBattlefield(mem);
  const out = new Map();
  const respawn = new Set(); // DEF-слоты, респавненные напрямую (без Start)
  const started = mem[0x80] !== 0xff; // игра началась (enemies_left инициализирован)
  // Отслеживаем скорость врагов, чтобы защитник не стрелял «вслепую» по цели, уходящей
  // вбок (промах = пуля за экран = слот пули заблокирован НАВСЕГДА).
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
    // Респавн только полностью мёртвого танка (flag==0) и только в игре, чтобы не
    // ломать старт (во время меню танки в респавне 0xE6). БЕЗ Start: Start на порту
    // DEF тумблит паузу (ram_btn_press&Start), поэтому выставляем спавн напрямую,
    if (started && tank.flag === 0 && frame % 30 === 0) {
      mem[0xa8 + t] = 0; // ram_tank_type
      mem[0x90 + t] = PLAYER_SPAWN_X[t]; // ram_tank_pos_X
      mem[0x98 + t] = PLAYER_SPAWN_Y[t]; // ram_tank_pos_Y
      mem[0x6f + t] = 0; // ram_plr_stun_timer
      mem[0xa0 + t] = 0xf0; // ram_tank_flags = con_tank_flag_respawn
      respawn.add(t);
    } else if ((tank.flag & 0xf0) >= 0x80 && (tank.flag & 0xf0) <= 0xd0 && tank.x < 255) {
      // ВАЖНО: используем широкий диапазон «на поле» (0x80..0xd0), а не строгий
      // aliveFlag (0x90..0xd0). Флаг DEF-танка в норме гуляет по 0x80..0x8f (крутятся
      // гусеницы/поворот между шагами). Если брать только 0x90..0xd0 — защитник
      // периодически «выпадает» из-под контроля ИИ (не двигается и не стреляет,
      // пока флаг снова не вернётся в 0x90+) — вот почему он кажется «тупым»/замирает.
      const st = state.get(t) || { held: 0, prevDir: null };
      const role = t === 0 ? "guard" : "raider"; // танк 0 — гард, танк 1 — рейдер
      const d = decideDefender(bf, tank, st.prevDir, role);
      const dir = smoothDir(bf, tank, d.dir, st);
      // fire button — edge-triggered в симуляторе/эмуляторе: удерживать A нельзя,
      // иначе выстрел происходит только ОДИН раз. Pulse: A зажат только когда слот
      // пули танка свободен (иначе не перезаряжается). Когда слот освобождается и
      // цель всё ещё на прицеле — A снова зажат → edge → следующий выстрел.
      const busy = (bf.mem[0xcc + tank.index] & 0xf0) === 0x40;
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

// ГИСТЕРЕЗИС: не меняем направление каждый кадр (иначе танк «дрожит» на месте,
// чередуя клеточные шаги BFS). Новое направление принимаем, только если оно
// удерживается HOLD_FRAMES подряд ИЛИ текущее направление упёрлось в преграду.
// Мутирует st.held/ст.prevDir.
const HOLD_FRAMES = 14;
function smoothDir(bf, tank, dir, st) {
  if (dir === null) return null;
  if (st.prevDir === null || dir === st.prevDir) { st.held = 0; return dir; }
  // упёрлись в преграду по текущему направлению -> можно сменить сразу
  const fc = tank.cell.col + DX[st.prevDir], fr = tank.cell.row + DY[st.prevDir];
  if (!cellPassable(bf.field, fc, fr)) { st.held = 0; return dir; }
  // иначе держим текущее направление, пока новое не «настоится» HOLD_FRAMES раз
  st.held = (st.held || 0) + 1;
  return st.held >= HOLD_FRAMES ? dir : st.prevDir;
}
// Персистентное состояние DEF-ИИ (сглаживание направления) по умолчанию.
// Экспортируется, чтобы ai-eval/контрактный тест могли «прогреть» состояние ИИ сима
// историей эмулятора (иначе сим стартует «холодным» и принимает другие решения).
export const defState = new Map();

// Сброс состояния DEF-ИИ (planDefense). Нужен при переключении ИИ на лету (PvPNes.setDefAI):
// план по умолчанию работает с модульным defState, и при смене режима защитников старый
// накопленный _ev/сглаживание нужно очистить, иначе новый ИИ стартует с чужим состоянием.
export function resetDefState() {
  defState.clear();
}

// Позиции спавна игроков (tbl_E47A/E47C): player1 (88,216), player2 (152,216).
const PLAYER_SPAWN_X = [0x58, 0x98];
const PLAYER_SPAWN_Y = [0xd8, 0xd8];

