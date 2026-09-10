// sim/cycle.js — АБСТРАГИРОВАННЫЙ ЦИКЛ ВЫПОЛНЕНИЯ ЭМУЛЯТОРА.
//
// Разбивает кадр на последовательность МИКРО-событий (процедур) в порядке, который
// в точности повторяет sub_C2E6_main_battle_script. Каждая процедура читает/пишет
// общее состояние (поле, танки, пули, счётчики, RNG) и эмитит события. Так связи
// между процедурами и состояниями воспроизводятся абстрактно, а цикл — идентично.
//
// Порядок кадра (из sub_C2E6):
//   ice_detection/ice_movement, tank_movement, (e1fa, e02e bullets_status),
//   HQ, invincibility, (e122,e162), enemy_spawn, bullets_movement,
//   bullet_vs_bullet, bullet_vs_tank, bonus, game_over, lives, ...
import { FIELD, isBrick, brickHit, cellPassable, DX, DY } from "../model/game-view.js";
import { canLead } from "./sim-model.js";

export const BULLET_SPEED = 2; // px/кадр (откалибровано)

// Таблица типов врагов по стадии (tbl_E4EC): 4 типа на стадию.
// 0x80=basic, 0xA0=power(быстр.пули), 0xC0=fast(быстрый), 0xE0=armor(броня).
export const STAGE_ENEMY_TYPES = {
  1: [0x80, 0xa0, 0xc0, 0xe0],
  2: [0xe0, 0xa0, 0xc0, 0x80],
  3: [0x80, 0xa0, 0xc0, 0xe0],
  4: [0xc0, 0xa0, 0x80, 0xe0],
  5: [0xc0, 0xe0, 0x80, 0xa0],
};

// Тайл льда (проходим, вызывает скольжение/нельзя поворачивать).
export const ICE_TILE = 0x2a;

// Порядок процедур кадра (главный боевой цикл).
export const FRAME_SCRIPT = [
  "ice_movement",      // sub_DB75
  "tank_movement",     // sub_DBF1 (движение/статусы танков)
  "bullets_status",    // sub_E02E (жизненный цикл пуль)
  "hq",                // sub_E2A9 (проверка базы)
  "enemy_spawn",       // sub_DB48 (спавн врагов)
  "bullets_movement",  // sub_E604 (движение пуль 2px/кадр)
  "bullet_vs_bullet",  // sub_E910 (столкновение пуль)
  "bullet_vs_tank",    // sub_E70C (попадание пули в танк)
  "bonus",             // sub_E972 (подбор приза)
  "enemy_death",       // респавн врага
  "player_death",      // жизни игрока / респавн
  "stage",             // победа/поражение
];

// Класс-исполнитель цикла: прогоняет FRAME_SCRIPT по общему состоянию.
export class CycleSim {
  constructor(state, rng = () => 0) {
    this.state = state;          // { field, tanks:[], bullets:[], counters:{}, rng }
    this.rng = rng;
    this.frame = 0;
    this.events = [];
  }
  _emit(e) { this.events.push(e); }

  step() {
    this.events = [];
    const st = this.state;
    for (const name of FRAME_SCRIPT) this[`proc_${name}`]?.(st);
    this.frame++;
    return this.events;
  }

  // --- tank_movement (sub_DBF1): субпиксельный темп + движение/статусы ---
  _moveGate(t) {
    if (t.team === "DEF" || t.type < 0x80) return this.frame % 4 !== 2;
    if ((t.type & 0xf0) === 0xa0) return true;
    return ((t.index ^ this.frame) & 1) !== 0;
  }
  proc_tank_movement(st) {
    for (const t of st.tanks) {
      if (!t.alive) continue;
      if (!this._moveGate(t)) continue;
      const nx = t.x + DX[t.dir], ny = t.y + DY[t.dir];
      const n = canLead(t.x, t.y, t.dir, st.field) ? { x: nx, y: ny } : null;
      if (n && !this._tankBlocked(st, n, t)) { t.x = n.x; t.y = n.y; this._emit({ op: "move_tank", tank: t.index, x: t.x, y: t.y }); }
      else if (t.type >= 0x80 && (this.rng() & 3) === 0) { t.dir = (t.dir + 2) % 4; this._emit({ op: "block_turn", tank: t.index, dir: t.dir }); }
    }
  }
  // Танк-в-танк: нельзя встать на другого живого танка (корпус 13x13).
  _tankBlocked(st, pos, self) {
    for (const o of st.tanks) {
      if (o === self || !o.alive) continue;
      if (Math.abs(pos.x - o.x) < 13 && Math.abs(pos.y - o.y) < 13) return true;
    }
    return false;
  }

  // --- enemy death/respawn (sub_DE07): мёртвый враг респавнится через delay ---
  proc_enemy_death(st) {
    const c = st.counters;
    for (const t of st.tanks) {
      if (t.team !== "ATT") continue;
      if (!t.alive && c.count > 0) {
        t.respawn = (t.respawn || 0) - 1;
        if (t.respawn <= -20) { // после задержки взрыва
          t.alive = true; t.respawn = 0;
          t.x = [0x18, 0x78, 0xd8][c.posIndex]; t.y = 0x18;
          c.posIndex = (c.posIndex + 1) % 3;
          this._emit({ op: "enemy_respawned", tank: t.index, x: t.x, y: t.y });
        }
      }
    }
  }

  // --- Лёд: проходим, но нельзя поворачивать (скольжение) ---
  _onIce(st, t) { return st.field[(t.y >> 3) * FIELD + (t.x >> 3)] === ICE_TILE; }

  // --- 2-я пуля (прокачка): powered-танк может иметь 2 активные пули ---
  canFire(t) {
    const n = this.state.bullets.filter((b) => b.tank === t.index && b.alive).length;
    const max = (t.team === "DEF" && t.powered) ? 2 : 1;
    return n < max;
  }

  // --- Спавн приза из мигающего врага (при его гибели) ---
  _maybeSpawnPrize(st, killedIndex) {
    const t = st.tanks.find((x) => x.index === killedIndex);
    if (t && (t.type & 0x04) !== 0) { // flashing enemy
      const pid = [0, 1, 2, 3, 4, 5][this.rng() % 6];
      st.prize = { id: pid, x: t.x, y: t.y };
      this._emit({ op: "prize_spawned", id: pid, x: t.x, y: t.y });
    }
  }

  // --- bonus effects: приз, подобранный игроком ---
  applyPrize(id) {
    const st = this.state;
    this._emit({ op: "prize_effect", id });
    if (id === 4) { // граната: уничтожить всех врагов на экране
      for (const t of st.tanks) if (t.team === "ATT" && t.alive) { t.alive = false; this._emit({ op: "tank_destroyed", tank: t.index }); }
    } else if (id === 1) { // часы: заморозка врагов
      st.counters.clock = 60;
    } else if (id === 0) { // каска: неуязвимость игрока
      st.counters.helmet = 60;
    } else if (id === 3) { // звезда: прокачка (2-я пуля)
      for (const t of st.tanks) if (t.team === "DEF") t.powered = true;
    } else if (id === 5) { // жизнь
      st.counters.lives = (st.counters.lives || 0) + 1;
    }
  }

  // --- Смерть игрока: -1 жизнь, респавн при наличии жизней ---
  proc_player_death(st) {
    for (const t of st.tanks) {
      if (t.team !== "DEF" || t.alive) continue;
      st.counters.lives = (st.counters.lives || 3) - 1;
      if (st.counters.lives > 0) {
        t.alive = true; t.x = 0x58; t.y = 0xd8; t.dir = 0;
        this._emit({ op: "player_respawned", tank: t.index });
      }
    }
  }

  // --- bonus effects: приз, подобранный игроком ---
  applyPrize(id) {
    const st = this.state;
    this._emit({ op: "prize_effect", id });
    if (id === 4) { // граната: уничтожить всех врагов на экране
      for (const t of st.tanks) if (t.team === "ATT" && t.alive) { t.alive = false; this._emit({ op: "tank_destroyed", tank: t.index }); }
    } else if (id === 1) { // часы: заморозка врагов
      st.counters.clock = 60;
    } else if (id === 0) { // каска: неуязвимость игрока
      st.counters.helmet = 60;
    }
  }

  // --- stage clear / game over ---
  proc_stage(st) {
    const aliveEnemies = st.tanks.some((t) => t.team === "ATT" && t.alive);
    if (st.counters.count === 0 && !aliveEnemies) this._emit({ op: "stage_clear" });
    const alivePlayers = st.tanks.some((t) => t.team === "DEF" && t.alive);
    if (!alivePlayers && st.counters.lives <= 0) this._emit({ op: "game_over" });
  }

  // --- enemy_spawn (sub_DB48): спавн врагов ---
  proc_enemy_spawn(st) {
    const c = st.counters;
    if (c.timer > 0) { c.timer--; return; }
    if (c.count === 0) return;
    for (let idx = c.limit; idx >= 2; idx--) {
      const t = st.tanks.find((x) => x.index === idx);
      if (t && t.alive) continue;
      const SPX = [0x18, 0x78, 0xd8];
      const bonus = (c.count === 0x11 || c.count === 0x0a || c.count === 0x03);
      const tank = t || { index: idx, team: "ATT", dir: 2, x: 0, y: 0, alive: false };
      tank.x = SPX[c.posIndex]; tank.y = 0x18; tank.alive = true;
      // тип врага по стадии (sub_E3CB): из последовательности стадии
      const seq = STAGE_ENEMY_TYPES[c.stage] || [0x80, 0xa0, 0xc0, 0xe0];
      tank.type = (bonus ? 0x04 : 0) | seq[c.typeOffset % seq.length];
      c.typeOffset++;
      c.posIndex = (c.posIndex + 1) % 3;
      if (!st.tanks.includes(tank)) st.tanks.push(tank);
      c.count--; c.timer = c.interval;
      this._emit({ op: "enemy_spawned", tank: idx, x: tank.x, y: tank.y, type: tank.type });
      return;
    }
  }

  // --- bullets_movement (sub_E604): 2px/кадр, кирпичи через brickHit ---
  proc_bullets_movement(st) {
    for (const b of st.bullets) if (b.alive) this._moveBullet(st, b);
  }
  _moveBullet(st, b) {
    const nx = b.x + DX[b.dir] * BULLET_SPEED, ny = b.y + DY[b.dir] * BULLET_SPEED;
    const c = Math.floor(nx / 8), r = Math.floor(ny / 8);
    if (c < 0 || c >= FIELD || r < 0 || r >= FIELD) { b.alive = false; this._emit({ op: "bullet_remove", bullet: b.tank }); return; }
    const v = st.field[r * FIELD + c];
    if (isBrick(v)) {
      const h = brickHit(v, b.dir);
      st.field[r * FIELD + c] = h.next;
      this._emit({ op: "brick_hit", col: c, row: r, tileBefore: v, tileAfter: h.next });
      if (h.next === 0x00) this._emit({ op: "brick_destroyed", col: c, row: r });
      b.alive = false; this._emit({ op: "bullet_remove", bullet: b.tank });
      return;
    }
    if (!cellPassable(st.field, c, r)) { b.alive = false; this._emit({ op: "bullet_remove", bullet: b.tank }); return; }
    b.x = nx; b.y = ny; this._emit({ op: "bullet_move", bullet: b.tank, x: nx, y: ny });
  }

  // --- bullet_vs_bullet (sub_E910) ---
  proc_bullet_vs_bullet(st) {
    for (let i = 0; i < st.bullets.length; i++) for (let j = i + 1; j < st.bullets.length; j++) {
      const a = st.bullets[i], b = st.bullets[j];
      if (!a.alive || !b.alive || a.team === b.team) continue;
      if (Math.abs(a.x - b.x) < 6 && Math.abs(a.y - b.y) < 6) {
        a.alive = false; b.alive = false;
        this._emit({ op: "bullet_collide", a: a.tank, b: b.tank });
      }
    }
  }

  // --- bullet_vs_tank (sub_E70C): |dx|<10 && |dy|<10 ---
  proc_bullet_vs_tank(st) {
    for (const b of st.bullets) {
      if (!b.alive) continue;
      for (const t of st.tanks) {
        if (t.team === b.team || !t.alive) continue;
        if (Math.abs(b.x - t.x) < 10 && Math.abs(b.y - t.y) < 10) {
          b.alive = false; t.alive = false;
          this._emit({ op: "bullet_hit_tank", bullet: b.tank, target: t.index });
          this._emit({ op: "tank_destroyed", tank: t.index });
          if (t.team === "ATT") this._maybeSpawnPrize(st, t.index); // приз из мигающего врага
        }
      }
    }
  }

  // --- hq (sub_E2A9): проверка, жива ли база ---
  proc_hq(st) {
    // упрощённо: если орёл (0xC8..0xCB) не найден — база уничтожена
    for (let i = 0; i < st.field.length; i++) { const v = st.field[i]; if (v >= 0xc8 && v <= 0xcb) return; }
    this._emit({ op: "hq_destroyed" });
  }

  // --- bonus (sub_E972): подбор приза ---
  proc_bonus(st) {
    // приз подбирается игроком при близости (|dx|<0x0C && |dy|<0x0C)
    if (!st.prize) return;
    for (const t of st.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (Math.abs(t.x - st.prize.x) < 12 && Math.abs(t.y - st.prize.y) < 12) {
        this._emit({ op: "prize_collected", id: st.prize.id });
        st.prize = null;
        return;
      }
    }
  }

  // --- ice_movement (sub_DB75): заглушка (не влияет на коллизию) ---
  proc_ice_movement() {}

  // --- bullets_status (sub_E02E): заглушка (жизненный цикл пуль) ---
  proc_bullets_status() {}
}
