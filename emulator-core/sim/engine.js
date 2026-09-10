// sim/engine.js — ПОКАДРОВО-ИДЕНТИЧНАЯ симуляция эмулятора на семантических событиях.
//
// Архитектура: движок за один кадр обрабатывает танки/пули/поле и ЭМИТИТ события,
// точно повторяющие логику эмулятора. ИИ и тесты подписываются на события вместо
// того, чтобы строить собственные модели. Это даёт детерминизм и соответствие
// эмулятору кадр за кадром.
//
// События (семантика):
//   { type:"tankMoved",       tank, x, y }
//   { type:"bulletFired",     tank, x, y, dir }
//   { type:"bulletMoved",     bullet, x, y }
//   { type:"bulletHitBrick",  bullet, col, row, tileBefore, tileAfter }
//   { type:"brickDestroyed",  col, row }
//   { type:"bulletHitTank",   bullet, target }
//   { type:"tankDestroyed",   tank }
//   { type:"bulletDestroyed", bullet }
//
// Детерминированная часть (без RNG врагов): движение танков по canLead,
// пули по 2px/кадр, разрушение кирпичей по brickHit. Вражеский ИИ/спавн/ГСЧ —
// подключается отдельным RNG-провайдером (см. README: патчим ГСЧ эмулятора).
import { FIELD, TILE, DX, DY, cellPassable, isBrick, brickHit } from "../model/game-view.js";
import { canLead } from "./sim-model.js";

export const BULLET_SPEED = 2; // px/кадр (откалибровано)

export class GameSim {
  // state: { field, tanks: Map<index,{x,y,dir,team,type}>, bullets: [...] }
  // rng: ()=>0..255 — провайдер ГСЧ (как инжектированный в эмулятор sub_D44D).
  constructor(state, rng = () => 0) {
    this.field = state.field;              // Uint8Array 1024 (копия)
    this.tanks = state.tanks ?? [];        // массив
    this.bullets = state.bullets ?? [];    // массив {tank, x, y, dir, team}
    this.events = [];
    this.rng = rng;                        // детерминированный ГСЧ (тот же, что в эмуляторе)
    this.frame = 0;                        // счётчик кадров (синхронизируется с эмулятором)
  }

  setRng(fn) { this.rng = fn; return this; }

  _emit(e) { this.events.push(e); }

  // --- Навигация врага (порт sub_DDA2 + tbl_E486) ---
  // Направление к цели (destX,destY) по таблице относительного положения.
  // Для ВРАГОВ всегда базовый индекс (idx 0..8); случайная таблица (+9) — только
  // для игроков (в ASM ветка loc_DDDB, для врага идёт bra_DDE4 — базовый индекс).
  _sign(v) { return v < 0 ? -1 : v > 0 ? 1 : 0; }
  _navigate(t, destX, destY) {
    const TBL = [0,0,0, 1,0,3, 2,2,2];
    const sx = this._sign(destX - t.x), sy = this._sign(destY - t.y);
    const idx = 3 * (sy + 1) + (sx + 1);
    return { dir: TBL[idx], flag: 0xa0 | TBL[idx] };
  }

  // --- Выбор флага следования (порт sub_DE72, оригинальный AI) ---
  // Возвращает follow-флаг: 0xB0=HQ, 0xC0=p2, 0xD0=p1, или null = оставить текущее
  // направление (ASM: sub_net_enemy_dir_store без сетевого ввода просто RTS).
  // Логика (DE75..DEA5):
  //   half   = interval>>2
  //   quarter= interval>>3
  //   if half  < frmCntHi -> follow HQ
  //   elif quarter < frmCntHi -> follow p1/p2 (по живости и чётности индекса)
  //   else -> keep current
  _pickFollowFlag(t, state) {
    const half = state.interval >> 2;
    if (half < state.frmCntHi) return 0xb0;              // follow HQ
    const quarter = state.interval >> 3;
    if (quarter < state.frmCntHi) {
      // DE8E: следовать за p2/p1
      if (!state.p1Alive) return 0xc0;                   // p1 мёртв -> follow p2
      if ((t.index & 1) === 0) return 0xd0;              // чётный индекс -> p1
      return state.p2Alive ? 0xc0 : 0xd0;                // нечётный: p2 жив? p2 : p1
    }
    return null;                                         // keep current direction
  }

  // Следование: установить направление к точке (через sub_DDA2) и вернуть флаг A0|dir.
  _setFollow(t, destX, destY) {
    const nav = this._navigate(t, destX, destY);
    t.dir = nav.dir;
    return nav.flag;
  }

  // Субпиксельный гейт (sub_DBF1 DC18-DC38 для врагов): в каких кадрах статус-обработчик
  // врага вообще выполняется. clock — таймер заморозки (часы). При clock==0:
  //   type==0xA0 (power) — всегда; иначе только когда (index ^ frm_cnt_lo) & 1 != 0.
  _enemyGate(t, state) {
    const clock = state.clock ?? 0;
    const hi = t.flag & 0xf0;
    let reach = true;
    if (clock !== 0) {
      // DC1D/DC21/DC23: замороженный враг в состоянии движения (0x80-0xD0) не двигается;
      // взрыв (bit7=0) и респавн (>=0xE0) продолжают тикать.
      if ((t.flag & 0x80) !== 0 && hi < 0xe0) reach = false;
    }
    if (reach && (t.type & 0xf0) !== 0xa0) reach = ((t.index ^ state.frmCntLo) & 1) !== 0;
    return reach;
  }

  // --- Шаг врага: точный порт флаг-машины (sub_DBF1 -> sub_DC3D -> tbl_E498) ---
  // state: { frmCntLo, frmCntHi, interval, p1x,p1y,p2x,p2y,p1Alive,p2Alive, clock }
  stepEnemy(t, state) {
    if (t.team !== "ATT") return false;
    if (!this._enemyGate(t, state)) return false;         // статус-обработчик не выполняется
    const f = t.flag ?? 0xa0;
    const hi = f & 0xf0;

    // РЕСПАВН (0xF0, ofs_DE55): флаг растёт; при низком ниббле 0x0E -> 0xE0
    if (hi === 0xf0) {
      t.flag = f + 1;
      if ((t.flag & 0x0f) === 0x0e) t.flag = 0xe0;
      return false;
    }
    // E0 (ofs_DE64): при низком ниббле 0x0E -> sub_E3B8: для врага флаг = tbl_E47E[X] = 0xA2
    if (hi === 0xe0) {
      t.flag = f + 1;
      if ((t.flag & 0x0f) === 0x0e) {
        t.flag = 0xa2;                                    // tbl_E47E[2..7] = 0xA2 (вниз)
        this._emit({ op: "enemy_active", tank: t.index });
      }
      return false;
    }
    // ВЗРЫВ (0x10-0x70, ofs_DDEA): флаг — счётчик; низкий ниббл 0 -> -0x10, при 0 мёртв
    if (hi >= 0x10 && hi <= 0x70) {
      let flag = f - 1;
      t.flag = flag;
      if ((flag & 0x0f) !== 0) return false;
      let next = (flag - 0x10) & 0xff;
      if (next === 0) { t.alive = false; t.flag = 0; this._emit({ op: "tank_dead", tank: t.index }); return false; }
      next = next === 0x10 ? (next | 0x06) : (next | 0x03);
      t.flag = next;
      return false;
    }
    // follow-флаги (ofs_DD94/DD89/DD7E): задать направление, НЕ двигаться в этом кадре
    if (hi === 0xb0) { t.flag = this._setFollow(t, 0x78, 0xd8); return false; }  // HQ
    if (hi === 0xc0) { t.flag = this._setFollow(t, state.p2x, state.p2y); return false; } // p2
    if (hi === 0xd0) { t.flag = this._setFollow(t, state.p1x, state.p1y); return false; } // p1

    // 0x80 (ofs_DC52): короткая пауза (флаг -= 4), при (flag&0x0C)==0 -> 0xA0
    if (hi === 0x80) {
      t.flag = (f - 4) & 0xff;
      if ((t.flag & 0x0c) === 0) t.flag = 0xa0 | (t.flag & 3);
      return false;
    }
    // 0x90 (ofs_DD48): поворот — RNG выбирает влево/вправо или ретаргет
    if (hi === 0x90) {
      const d = f & 3;
      if ((this.rng() & 1) === 0) {                        // bra_DD6A: ретаргет
        const target = this._pickFollowFlag(t, state);
        if (target !== null) { t.flag = target; this._emit({ op: "enemy_retarget", tank: t.index, flag: target }); }
        return false;
      }
      if ((this.rng() & 1) === 0) t.flag = 0xa0 | ((d + 3) & 3); // bra_DD5E: влево (dir-1)
      else t.flag = 0xa0 | ((d + 1) & 3);                      // loc_DD63: вправо (dir+1)
      this._emit({ op: "enemy_turn", tank: t.index, flag: t.flag });
      return false;
    }
    // 0xA0 (ofs_DC7C): основное движение
    if (hi === 0xa0) {
      const dir = f & 3;
      t.dir = dir;
      // на пересечении и RNG&0x0F==0 -> sub_DE72 (ретаргет). В ASM это ВСЕГДА
      // заканчивается return без движения в этом кадре (DC93 JSR sub_DE72; DC96 RTS),
      // независимо от того, сменил ли sub_DE72 флаг или оставил текущее направление.
      if ((t.x & 7) === 0 && (t.y & 7) === 0 && (this.rng() & 0x0f) === 0) {
        const target = this._pickFollowFlag(t, state);
        if (target !== null) { t.flag = target; this._emit({ op: "enemy_retarget", tank: t.index, flag: target }); }
        return false;
      }
      // движение (loc_DC97): canLead -> сдвиг 1px, иначе блок (поворот/пауза)
      const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
      if (n) {
        t.x = n.x; t.y = n.y; t.dir = dir; t.flag = 0xa0 | dir;
        this._emit({ type: "tankMoved", tank: t.index, x: t.x, y: t.y });
        return true;
      }
      // блокировано (bra_DD11): враг
      if ((this.rng() & 3) === 0) {                            // bra_DD30: разворот
        const nd = (dir + 2) % 4;
        t.dir = nd;
        t.flag = ((t.x & 7) === 0 && (t.y & 7) === 0) ? (0x90 | nd) : (0xa0 | nd);
        this._emit({ op: "enemy_blocked_reverse", tank: t.index, flag: t.flag });
      } else {                                                 // bra_DD1E: пауза 0x88|dir
        t.flag = 0x88 | dir;
        this._emit({ op: "enemy_blocked_pause", tank: t.index, flag: t.flag });
      }
    }
    return false;
  }

  // --- Спавн врагов (порт sub_DB48 + sub_E363) ---
  // state: { timer, count, limit, interval, posIndex } — отражает RAM эмулятора.
  // Эмитит событие enemySpawned. Возвращает индекс заспавненного танка или -1.
  spawnEnemy(state) {
    if (state.timer > 0) { state.timer--; return -1; }      // таймер ещё тикает
    if (state.count === 0) return -1;                        // некого спавнить
    // ищем свободный вражеский слот (index = limit .. 2)
    for (let idx = state.limit; idx >= 2; idx--) {
      const t = this.tanks.find((x) => x.index === idx);
      const empty = !t || t.flag === 0;
      if (!empty) continue;
      // позиция по циклу спавна (0,1,2 -> left,center,right)
      const SPX = [0x18, 0x78, 0xd8], SPY = 0x18;
      const px = SPX[state.posIndex], py = SPY;
      state.posIndex = (state.posIndex + 1) % 3;             // INC spawn_pos_index, reset на 3
      // бонусный враг: 4-й(0x11), 11-й(0x0A), 18-й(0x03)
      const bonus = (state.count === 0x11 || state.count === 0x0a || state.count === 0x03);
      const tank = t || { index: idx, team: "ATT", type: 0x80, flag: 0 };
      tank.x = px; tank.y = py; tank.flag = 0xf0;             // respawn
      tank.dir = 2; tank.type = bonus ? 0x84 : (tank.type || 0x80); // bonus|0x04
      if (!this.tanks.includes(tank)) this.tanks.push(tank);
      state.count--;
      state.timer = state.interval;                           // reload timer
      this._emit({ type: "enemySpawned", tank: idx, x: px, y: py, type: tank.type });
      return idx;
    }
    return -1;
  }

  // Субпиксельный темп движения (sub_DBF1): в какие кадры танк реально двигается.
  //   игрок:     0.75 px/кадр (двигается кроме frame%4==2)
  //   power-враг: 1.0 px/кадр (тип & 0xF0 == 0xA0)
  //   обычный враг: 0.5 px/кадр (когда (index ^ frame) & 1 != 0)
  _moveGate(t) {
    if (t.team === "DEF" || t.type < 0x80) return this.frame % 4 !== 2;
    if ((t.type & 0xf0) === 0xa0) return true;
    return ((t.index ^ this.frame) & 1) !== 0;
  }

  // Движение танка: 1px в dir, если кромка свободна и танк двигается в этом кадре.
  // Враг при блокировке может повернуть (sub_DC97 bra_DD30: если rng()&3==0 -> 180°).
  stepTank(t, dir) {
    if (!this._moveGate(t)) return false; // не ход танка в этом кадре (субпиксель)
    const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
    if (n) { t.x = n.x; t.y = n.y; t.dir = dir; this._emit({ type: "tankMoved", tank: t.index, x: t.x, y: t.y }); return true; }
    // блокировано
    if (t.type >= 0x80 && (this.rng() & 3) === 0) {
      const nd = (dir + 2) % 4; // 180° (EOR #$02)
      t.dir = nd;
      this._emit({ type: "tankBlocked", tank: t.index, newDir: nd });
    }
    return false;
  }

  // Выстрел танка: пуля появляется у ПЕРЕДНЕЙ кромки танка (offset 6px).
  fireTank(t, dir) {
    const ox = dir === 3 ? 8 : dir === 1 ? -8 : 0;
    const oy = dir === 2 ? 8 : dir === 0 ? -8 : 0;
    const px = t.x + ox, py = t.y + oy;
    const b = { tank: t.index, team: t.team, x: px, y: py, dir, alive: true };
    this.bullets.push(b);
    this._emit({ type: "bulletFired", tank: t.index, x: px, y: py, dir });
    return b;
  }

  // Один кадр: движем танки, движем пули, обрабатываем коллизии.
  step() {
    this.events = [];
    // 1) пули движутся и сталкиваются
    for (const b of this.bullets) if (b.alive) this._moveBullet(b);
    // 2) танки движутся (по заданному dir; враги — через ИИ/RNG)
    //    (здесь только движение, стрельба задаётся внешним кодом)
    this.frame++;
    return this.events;
  }

  _moveBullet(b) {
    const nx = b.x + DX[b.dir] * BULLET_SPEED;
    const ny = b.y + DY[b.dir] * BULLET_SPEED;
    const c = Math.floor(nx / TILE), r = Math.floor(ny / TILE);
    if (c < 0 || c >= FIELD || r < 0 || r >= FIELD) { this._killBullet(b); return; }
    const v = this.field[cellIdx(c, r)];
    if (isBrick(v)) {
      const h = brickHit(v, b.dir);
      this._emit({ type: "bulletHitBrick", bullet: b.tank, col: c, row: r, tileBefore: v, tileAfter: h.next });
      if (h.next === 0x00) this._emit({ type: "brickDestroyed", col: c, row: r });
      this.field[cellIdx(c, r)] = h.next;
      this._killBullet(b);
      return;
    }
    if (!cellPassable(this.field, c, r)) { this._killBullet(b); return; } // сталь/стена
    // пуля-в-пулю: если встречная пуля в той же клетке — обе уничтожаются
    for (const o of this.bullets) {
      if (o === b || !o.alive || o.team === b.team) continue;
      if (Math.abs(o.x - nx) < 6 && Math.abs(o.y - ny) < 6) {
        this._emit({ type: "bulletHitBullet", a: b.tank, b: o.tank });
        this._killBullet(o);
        this._killBullet(b);
        return;
      }
    }
    // попадание в танк (точный ASM-хитбокс sub_E70C: |dx|<10 && |dy|<10)
    for (const t of this.tanks) {
      if (t.team === b.team) continue;
      if (Math.abs(nx - t.x) < 10 && Math.abs(ny - t.y) < 10) {
        this._emit({ type: "bulletHitTank", bullet: b.tank, target: t.index });
        this._emit({ type: "tankDestroyed", tank: t.index });
        this._killBullet(b);
        return;
      }
    }
    b.x = nx; b.y = ny;
    this._emit({ type: "bulletMoved", bullet: b.tank, x: nx, y: ny });
  }

  _killBullet(b) { b.alive = false; this._emit({ type: "bulletDestroyed", bullet: b.tank }); }

  // Состояние поля (для сверки с эмулятором).
  fieldTile(col, row) { return this.field[cellIdx(col, row)]; }
}

function cellIdx(c, r) { return r * FIELD + c; }
