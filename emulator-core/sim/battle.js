// sim/battle.js — ПОКАДРОВО-ВЕРНЫЙ порт вражеского боя (sub_C2E6_main_battle_script)
// для сверки симулятора с эмулятором. Целевой ROM: патченый PRNG (вариант B):
//   $0F = ($0F*7 + frm_cnt_hi + frm_cnt_lo) & 0xFF   (sub_D44D без page-zero-микса)
//
// ИНВАРИАНТ: этот порт обязан покадрово совпадать с эмулятором (враги + поле + RNG).
// Любой рефакторинг/изменение проверяется: `node --test emulator-core/tests/*.test.js`
// (100 тестов) + `node scripts/stage-verify.mjs 1..6` (все стадии 100%).
//
// Покрывает (вражеская сторона):
//   A) детерминированный PRNG (вариант B) — rngState
//   B) динамическое поле: bit7-маркеры танков (sub_E181/sub_E1FA) + разрушение кирпичей
//   C) полный цикл: движение (sub_DBF1), вражеский огонь (sub_E162), пули
//      (sub_E604/E910/E70C), спавн (sub_DB48/E363), смерть/респавн, призы (sub_E972).
import { FIELD, TILE, DX, DY, isBrick, readState } from "../model/game-view.js";
import { canLead } from "./sim-model.js";
import {
  DEFAULT_TYPE_VALUES, STAGE_TYPE_VALUES, STAGE_TYPE_COUNTS,
  ENEMY_SPAWN_X, ENEMY_SPAWN_Y, PLAYER_SPAWN_X, PLAYER_SPAWN_Y,
  BONUS_ID_TABLE, bonusPosFromRng, FORTIFY_CELLS, EAGLE_DESTROYED_TILES, ENEMY_ICON_ERASE_TILE,
} from "./tables.js";
import { RAM } from "./ram-addr.js";

// Движение-гейт врага (sub_DBF1 DC18-DC38): в какие кадры статус-обработчик идёт.
function enemyGate(flag, type, index, frmCntLo, clock) {
  const hi = flag & 0xf0;
  let reach = true;
  if (clock !== 0) {
    if ((flag & 0x80) !== 0 && hi < 0xe0) reach = false;
  }
  if (reach && (type & 0xf0) !== 0xa0) reach = ((index ^ frmCntLo) & 1) !== 0;
  return reach;
}

// Жив-движется ли танк (флаг 0x80-0xD0, не респавн/взрыв/мёртв).
function movementRange(flag) { const h = flag & 0xf0; return h >= 0x80 && h <= 0xd0; }

// Тайл льда (sub_E181: CMP #con_block_type + $21) — игрок на льду скользит.
const ICE_TILE = 0x21;

// Движение-гейт ИГРОКА (sub_DBF1 DC09-DC15): статус-обработчик на frmCntLo&3 != 2
// (0.75px/кадр: идёт на 0,1,3 mod 4, пропуск на 2).
function playerGate(frmCntLo) { return (frmCntLo & 3) !== 2; }

// Пули: фикс. 10 слотов (0-9), слот i соответствует танку i (sub_E604 индексирует 9..0).
function makeBullets(input = []) {
  const bullets = new Array(10).fill(null).map((_, s) => ({ slot: s, alive: false, x: 0, y: 0, dir: 0, owner: -1, team: "ATT", property: 0, synced: false, fresh: false, explode: 0 }));
  for (const b of input) {
    bullets[b.slot] = {
      slot: b.slot, alive: b.alive, x: b.x, y: b.y, dir: b.dir,
      owner: b.owner, team: b.team, property: b.property ?? 0,
      synced: b.synced ?? false, fresh: b.fresh ?? false, explode: b.explode ?? 0,
    };
  }
  return bullets;
}

// Нормализация входного состояния: заполнение дефолтов (инвариант: не меняет результат).
function normalizeState(state = {}) {
  const counters = state.counters ? { ...state.counters } : {};
  const stage = counters.stage ?? 1;
  return {
    field: state.field ?? new Uint8Array(FIELD * FIELD),
    tanks: state.tanks ?? [],
    bullets: makeBullets(state.bullets),
    counters,
    prize: state.prize ?? null,
    rngState: state.rngState ?? 0x11,
    frame: state.frame ?? 0,
    typeCnt: (state.typeCnt ?? (STAGE_TYPE_COUNTS[stage] || DEFAULT_TYPE_VALUES).slice()).slice(),
    p1: state.p1 ?? { x: 88, y: 216, alive: true },
    p2: state.p2 ?? { x: 152, y: 216, alive: false },
  };
}

/**
 * BattleSim — покадрово-верный порт вражеской стороны боя (см. инвариант в шапке).
 *
 * @param {object} state  начальное состояние (см. normalizeState):
 *   field: Uint8Array(1024) | tanks: [] | bullets: [] | counters: {} | prize | rngState | frame | typeCnt | p1 | p2
 * @param {object} opts   опции:
 *   seed: number        — переопределить начальное rngState (опционально)
 *   frame: number       — переопределить начальный frame (опционально)
 *   rngInjection: number|number[] — вернуть фикс. значение(я) вместо расчёта PRNG (не меняет $0F)
 *   onEvent: (e)=>void  — синхронный колбэк на каждое событие кадра
 */
export class BattleSim {
  constructor(state, opts = {}) {
    const s = normalizeState(state);
    this.opts = {
      onEvent: opts.onEvent ?? null,
      rngInjection: opts.rngInjection ?? null,
    };
    this.field = s.field;                 // Uint8Array 1024 (динамический, мутируется)
    this.tanks = s.tanks;                 // [{index,team,x,y,dir,flag,type,alive,helmet}]
    this.bullets = s.bullets;             // 10 слотов пуль
    this.c = s.counters;                  // счётчики/таймеры боя (мутируется)
    this.prize = s.prize;                 // {id,x,y} | null
    this.rngState = opts.seed ?? s.rngState; // ram_random ($0F)
    this.frame = opts.frame ?? s.frame;
    this.typeCnt = s.typeCnt;             // счётчики типов врагов стадии (sub_E42B)
    this.p1 = s.p1;
    this.p2 = s.p2;
    this.events = [];                     // события последнего step() (см. _emit)
    this._markOff = [];
    this._rngIdx = 0;                     // счётчик для rngInjection-массива
    this._rngLo = null;                   // в-кадровый $0B для фазы движения/огня
    // Внешний контроль ИИ (для прогона ИИ на симуляторе). Значение: функция (frame) => Map<idx,
    // {dir, fire}> | null, либо Map/объект {idx: {dir, fire}}. dir: 0-3, null=без ввода; fire: bool.
    // attControl — враги (2..7), defControl — игроки (0,1). null = родная флаг-машина/синк.
    this.attControl = null;
    this.defControl = null;
    this._prevDefFire = [false, false]; // фронт нажатия A для DEF (edge-trigger, как эмулятор)
    this.defSlotBusy = [false, false]; // занятие слота DEF-пули в эмуляторе на НАЧАЛО кадра (синк)
    this.plrFlags = [0, 0];            // ram_0103_plr_flags (лёд/слайд) для игроков 0,1
    this.defFrame = 0;                 // монотонный счётчик кадров PvP-слоя (pvp.js _frame) для ритма респавна
    this._pendingBonus = null;         // отложенный спавн приза (sub_E8BE, пересёк границу кадра)
  }

  // Решение внешнего ИИ для танка idx (враг/игрок): {dir, fire} | null.
  _controlDecision(ctrl, idx) {
    if (!ctrl) return null;
    const d = typeof ctrl === "function" ? ctrl(this.frame) : ctrl;
    if (d instanceof Map) return d.get(idx) ?? null;
    return d[idx] ?? null;
  }

  // Продвинуть счётчик кадров на 1 как в эмуляторе (NMI-обработчик).
  //
  // ВАЖНО: ram_frm_cnt_hi ($0A) — это НЕ frame>>8. Он инкрементируется каждые 64 кадра
  // (когда $0B переходит 0x00/0x40/0x80/0xC0), а не каждые 256. Т.е. $0A = frame_count>>6,
  // $0B = frame_count&0xff. Порт PRNG (sub_D44D) использует $0A + $0B. Если просто
  // делать frame+1 (16-битный счётчик), то на $0B=0x40..0xC0 $0A не инкрементируется,
  // как в эмуляторе — и standalone RNG расходится (frame>>8 != $0A).
  //
  // Хранение: this.frame кодируется как ($0A<<8) | $0B, чтобы rng() мог читать
  // hi = frame>>8 = $0A и lo = frame&0xff = $0B без изменений (lockstep-совместимо).
  advanceFrame() {
    const lo = this.frame & 0xff;
    const newLo = (lo + 1) & 0xff;
    let hi = (this.frame >> 8) & 0xff;
    // $0A инкрементируется, когда $0B становится кратным 0x40 (0x00, 0x40, 0x80, 0xC0).
    if ((newLo & 0x3f) === 0) hi = (hi + 1) & 0xff;
    this.frame = (hi << 8) | newLo;
    return this.frame;
  }
  _netDir(t) { const d = this._controlDecision(this.attControl, t.index); return d && d.dir != null ? d.dir : null; }
  _netFire(i) { const d = this._controlDecision(this.attControl, i); return !!(d && d.fire); }
  _defDir(t) { const d = this._controlDecision(this.defControl, t.index); return d && d.dir != null ? d.dir : null; }
  _defFire(i) { const d = this._controlDecision(this.defControl, i); return !!(d && d.fire); }

  // --- A) детерминированный PRNG (вариант B: sub_D44D без page-zero-микса) ---
  // lo — в-кадровый $0B (ram_frm_cnt_lo). В эмуляторе игра СБРАСЫВАЕТ $0B в 0 в середине
  // кадра (sub_DE46 при гибели игрока): вызовы ДО сброса (движение/статус) используют
  // pre-reset значение, ПОСЛЕ (огонь/пули) — 0. Фаза движения — gateFrmLo, фаза огня —
  // frame & 0xff (задаётся в step() через this._rngLo).
  rng(ctx) {
    if (this.opts.rngInjection != null) {
      // Инжекция: возвращает значение, НЕ эволюционируя $0F (как setRngInjection в эмуляторе).
      const inj = this.opts.rngInjection;
      const v = Array.isArray(inj) ? inj[this._rngIdx++ % inj.length] : inj;
      if (this._trace) this._trace.push({ c: ctx ?? this._rngCtx, v });
      return v;
    }
    const lo = this._rngLo ?? (this.frame & 0xff);
    const hi = (this.frame >> 8) & 0xff;
    this.rngState = ((this.rngState * 7) + hi + lo) & 0xff;
    if (this._trace) this._trace.push({ c: ctx ?? this._rngCtx, v: this.rngState });
    return this.rngState;
  }

  _emit(e) { if (this.opts.onEvent) this.opts.onEvent(e); this.events.push(e); }

  // RAM-совместимый буфер эмулятора из семантического состояния симулятора.
  // Позволяет прогонять существующие ИИ (которые читают mem: GameState/readState и
  // прямые mem[...]) без изменений. Буфер кэшируется и перезаписывается каждым вызовом.
  // Строит RAM-буфер, который читает стек ИИ (read-set из ram-addr.js).
  //
  // СЕМАНТИКА: симулятор хранит состояние семантически (this.field, this.tanks,
  // this.bullets, this.c.*). ИИ-движки читают его через RAM-раскладку эмулятора
  // (см. ram-addr.js). Этот метод материализует RAM-буфер из семантического
  // состояния — то же, что эмулятор имеет в cpu.mem на границе кадра.
  //
  // Инвариант (контрактный тест verify-toMem): для каждого адреса read-set
  // toMem() обязан давать байт, ИДЕНТИЧНЫЙ эмуляторному cpu.mem в lockstep-прогоне.
  toMem() {
    if (!this._mem) this._mem = new Uint8Array(0x10000);
    const m = this._mem;
    m.fill(0);
    const R = RAM;

    // --- Поле: буфер тайлов 32x32 (read-set: GameState.field) ---
    // ВАЖНО: поле в toMem = то же, что читает ИИ; маркеры танков (bit7) здесь не
    // пишем — ИИ использует отдельные поля танков (TANK_X/Y/FLAG), а не маркеры.
    m.set(this.field, R.FIELD);

    // --- Состояние уровня / эффектов ---
    m[R.ENEMIES_LEFT] = this.c.enemiesLeft ?? 0;       // врагов осталось до победы
    m[R.SPAWN_TIMER] = this.c.spawnTimer ?? 0;         // таймер до спавна врага
    m[R.FORTIFIED] = (this.c.shovelTimer ?? 0) > 0 ? 1 : 0; // база укреплена лопатой
    m[R.CLOCK_TIMER] = this.c.clock ?? 0;              // часы: враги заморожены

    // --- Танки (0..7): x, y, флаг, тип; каска/стан — только защитники (0,1) ---
    for (let t = 0; t < 8; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank) continue;
      m[R.TANK_X + t] = tank.x;
      m[R.TANK_Y + t] = tank.y;
      m[R.TANK_FLAG + t] = tank.flag ?? 0;
      m[R.TANK_TYPE + t] = tank.type ?? 0;
      // helmet/stun читаются ИИ только для защитников (t<DEF_END). Запись для
      // t>=2 сдвинула бы адрес на позицию следующего танка/пули — ломала слой решений.
      if (t < 2) {
        m[R.HELMET + t] = tank.helmet ? 1 : 0;
        m[R.STUN + t] = tank.stun ?? 0;
      }
    }

    // --- Пули (0..7): статус, x, y ---
    for (let t = 0; t < 10; t++) {
      const b = this.bullets[t];
      if (!b || !b.alive) continue;
      m[R.BULLET_STATUS + t] = b.explode ? 0x33 : (0x40 | b.dir);
      m[R.BULLET_X + t] = b.x;
      m[R.BULLET_Y + t] = b.y;
    }

    // --- Приз: id, x, y (0xff — приза нет) ---
    if (this.prize) {
      m[R.PRIZE_ID] = this.prize.id;
      m[R.PRIZE_X] = this.prize.x;
      m[R.PRIZE_Y] = this.prize.y;
    } else {
      m[R.PRIZE_ID] = 0xff;
    }
    return m;
  }

  // GameState (единый слой game-view) из семантики симулятора — для ИИ через readState.
  view() { return readState(this.toMem()); }

  // Неизменяемый снапшот состояния для чтения (ИИ/UI/харнесс), не влияет на симулятор.
  snapshot() {
    return {
      frame: this.frame,
      rngState: this.rngState,
      field: this.field.slice(),
      tanks: this.tanks.map((t) => ({ ...t })),
      bullets: this.bullets.map((b) => ({ ...b })),
      prize: this.prize ? { ...this.prize } : null,
      enemiesLeft: this.c.enemiesLeft ?? 0,
      stage: this.c.stage ?? 1,
      clock: this.c.clock ?? 0,
      gameOver: this.c.gameOver ?? 0,
    };
  }

  // =====================================================================
  // B) маркеры танков в поле (sub_E181 -> sub_E1FA)
  // =====================================================================
  // Для живого танка вычислить stage-тайл (левый-верх 2x2 блока) и bit-флаги.
  _tankStagePos(t) {
    const y = t.y - 8, x = t.x - 8;
    const ty = Math.floor(y / TILE), tx = Math.floor(x / TILE);
    const off = ty * FIELD + tx;
    let hi = 0;
    if ((t.x & 7) === 0) hi |= 0x80;  // +0x20
    if ((t.y & 7) === 0) hi |= 0x40;  // +0x01
    return { off, hi };
  }
  _setMarker(t) {
    if (!movementRange(t.flag)) return;
    const p = this._tankStagePos(t);
    const f = this.field;
    f[p.off + 0x21] |= 0x80; this._markOff.push(p.off + 0x21);
    if (p.hi & 0x80) { f[p.off + 0x20] |= 0x80; this._markOff.push(p.off + 0x20); }
    if (p.hi & 0x40) { f[p.off + 0x01] |= 0x80; this._markOff.push(p.off + 0x01); }
  }
  // sub_E1FA снимает маркеры в той же позиции, где их поставил sub_E181 (до движения).
  _clearMarkers() {
    for (const off of this._markOff) this.field[off] &= 0x7f;
    this._markOff = [];
  }

  // =====================================================================
  // Навигация (sub_DDA2, базовая таблица tbl_E486) и выбор цели (sub_DE72)
  // =====================================================================
  _navigateDir(t, destX, destY) {
    const TBL = [0,0,0, 1,0,3, 2,2,2];
    const sx = destX < t.x ? -1 : destX > t.x ? 1 : 0;
    const sy = destY < t.y ? -1 : destY > t.y ? 1 : 0;
    return TBL[3 * (sy + 1) + (sx + 1)];
  }
  _pickFollowFlag(t) {
    const half = this.c.spawnInterval >> 2;
    if (half < this.c.frmCntHi) return 0xb0;
    const quarter = this.c.spawnInterval >> 3;
    if (quarter < this.c.frmCntHi) {
      if (!this.p1.alive) return 0xc0;
      if ((t.index & 1) === 0) return 0xd0;
      return this.p2.alive ? 0xc0 : 0xd0;
    }
    return null;
  }
  _setFollow(t, destX, destY) { t.dir = this._navigateDir(t, destX, destY); return 0xa0 | t.dir; }

  // =====================================================================
  // C0) ЛЁД/ВВОД ИГРОКА (DEF) — sub_DB75_ice_movement.
  // Отдельная фаза ДО движения (sub_DBF1): по вводу контроллера задаёт флаг
  // 0xa0|dir (движение) или 0x80-блок (нет ввода/стан/лёд). Движение выполняет
  // sub_DC97 (в _tankStatus). Раньше вход был вложен в _tankStatus и не ставил
  // 0x80 при отсутствии ввода — расхождение флага DEF-танка с эмулятором.
  // =====================================================================
  // sub_E181_ice_detection (только игроки): ставит plrFlags bit7 на льду (0x21).
  _iceDetection() {
    for (let t = 0; t < 2; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank || (tank.flag & 0x80) === 0 || tank.flag >= 0xe0) continue;
      const onIce = this.field[Math.floor(tank.y / TILE) * FIELD + Math.floor(tank.x / TILE)] === ICE_TILE;
      this.plrFlags[t] = onIce ? (this.plrFlags[t] | 0x80) : (this.plrFlags[t] & ~0x80);
    }
  }
  // sub_DB75 bra_DBA6: нет ввода/стан/лёд -> 0x80-блок (0x80|(flag&0x0f)|0x08).
  _setDefBlocked(t) { t.flag = 0x88 | (t.flag & 0x0f); }
  _defInput() {
    const gate = this.c.gateFrmLo ?? this.c.frmCntLo;
    if (!playerGate(gate)) return;
    for (let i = 1; i >= 0; i--) {
      const t = this.tanks.find((x) => x.index === i);
      if (!t || t.team !== "DEF") continue;
      const flag = t.flag;
      if ((flag & 0x80) === 0) continue;  // мёртв/взрыв
      if (flag >= 0xe0) continue;         // респавн
      const dir = this._defDir(t);
      // стан (sub_DB75 DB8B-DB91): декремент + блок
      if ((t.stun ?? 0) > 0) { t.stun--; this._setDefBlocked(t); continue; }
      // лёд (sub_DB75 DB94-DBA6): на льду — слайд, сохраняем направление движения
      if ((this.plrFlags[i] & 0x80) !== 0) {
        const curDir = flag & 3;
        t.flag = 0xa0 | curDir;
        continue;
      }
      // нет ввода -> блок (0x80)
      if (dir === null) { this._setDefBlocked(t); continue; }
      // перпендикулярный поворот: выровнять ось по 8px-сетке (sub_DBD5)
      const curDir = flag & 3;
      if (dir !== curDir && dir !== ((curDir + 2) & 3)) {
        const vertical = dir === 0 || dir === 2;
        if (vertical) t.x = (t.x + 4) & 0xf8; else t.y = (t.y + 4) & 0xf8;
      }
      t.flag = 0xa0 | dir;
    }
  }

  // =====================================================================
  // C) статус-машина танка (sub_DC3D -> tbl_E498)
  // =====================================================================
  _tankStatus(t) {
    const f = t.flag;
    const hi = f & 0xf0;
    // Источник направления: враги — attControl, игроки — defControl (PvP net/AI).
    const netDir = t.team === "ATT" ? this._netDir(t) : this._defDir(t);
    // респавн F0/E0
    if (hi === 0xf0) { t.flag = f + 1; if ((t.flag & 0x0f) === 0x0e) t.flag = 0xe0; return; }
    if (hi === 0xe0) {
      t.flag = f + 1;
      if ((t.flag & 0x0f) === 0x0e) {
        // sub_E3B8 + tbl_E47E: игрок вверх 0xa0 (+шлем), враг вниз 0xa2 (+реальный тип).
        if (t.team === "DEF") { t.flag = 0xa0; t.helmet = 3; }
        else { t.flag = 0xa2; t.type = this._pickType(t); }
      }
      return;
    }
    // взрыв 0x10-0x70
    if (hi >= 0x10 && hi <= 0x70) {
      let flag = f - 1; t.flag = flag;
      if ((flag & 0x0f) !== 0) return;
      let next = (flag - 0x10) & 0xff;
      if (next === 0) {
        t.alive = false; t.flag = 0;
        if (t.team === "ATT") this._onEnemyDead(t); else this._onPlayerDead(t);
        return;
      }
      next = next === 0x10 ? (next | 0x06) : (next | 0x03);
      t.flag = next;
      return;
    }
    // follow-флаги (только враги): задать направление, не двигаться
    if (hi === 0xb0) { t.flag = this._setFollow(t, 0x78, 0xd8); return; }
    if (hi === 0xc0) { t.flag = this._setFollow(t, this.p2.x, this.p2.y); return; }
    if (hi === 0xd0) { t.flag = this._setFollow(t, this.p1.x, this.p1.y); return; }
    // DEF без внешнего управления (defControl) — стоит на месте (не RNG-поворачивает).
    if (t.team === "DEF" && netDir === null && (hi === 0x90 || hi === 0xa0)) return;
    // 0x80 пауза (для игрока sub_DB75 мог поставить 0x80 при отсутствии ввода)
    if (hi === 0x80) {
      // sub_DC52-DC68: на льду (plr_flag bit7) игрок в 0x80-состоянии СКОЛЬЗИТ —
      // сразу в loc_DC97 (движение), без декремента флага.
      if (t.team === "DEF" && (this.plrFlags[t.index] & 0x80) !== 0) {
        const dir = f & 3;
        t.dir = dir;
        const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
        if (n) { t.x = n.x; t.y = n.y; }
        t.flag = 0xa0 | dir;
        return;
      }
      t.flag = (f - 4) & 0xff; if ((t.flag & 0x0c) === 0) t.flag = 0xa0 | (t.flag & 3); return;
    }
    // 0x90 поворот
    if (hi === 0x90) {
      // DEF (игрок): поворот только по вводу, RNG не тратим (управление ИИ/контроллером).
      if (t.team === "DEF") {
        if (netDir !== null) { t.dir = netDir; t.flag = 0xa0 | netDir; }
        return;
      }
      const d = f & 3;
      // суб-E72 вызывается только при rng&1==0 (RNG потребляется всегда).
      if ((this.rng(`t90a${t.index}`) & 1) === 0) {
        if (netDir !== null) { t.dir = netDir; t.flag = 0xa0 | netDir; return; } // sub_DE72_patched
        const target = this._pickFollowFlag(t);
        if (target !== null) t.flag = (t.flag & 3) | target; // sub_E420 сохраняет направление
        return;
      }
      t.flag = 0xa0 | (((this.rng(`t90b${t.index}`) & 1) === 0) ? ((d + 3) & 3) : ((d + 1) & 3));
      return;
    }
    // 0xA0 движение
    if (hi === 0xa0) {
      // DEF (игрок): направление уже задано _defInput (sub_DB75); здесь только движение
      // (sub_DC97). Без ввода _defInput ставит 0x80, поэтому сюда приходит 0xa0|dir.
      if (t.team === "DEF") {
        const dir = f & 3;
        t.dir = dir;
        const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
        if (n) { t.x = n.x; t.y = n.y; t.flag = 0xa0 | dir; this._emit({ op: "move", tank: t.index, x: t.x, y: t.y }); }
        else { t.flag = 0xa0 | dir; } // заблокирован: игрок держит направление (sub_DC97 bra_DD29)
        return;
      }
      let dir = f & 3;
      t.dir = dir;
      if ((t.x & 7) === 0 && (t.y & 7) === 0 && (this.rng(`tA0${t.index}`) & 0x0f) === 0) {
        // sub_DE72: net-управление (если ИИ держит направление) или follow/keep.
        if (netDir !== null) { t.dir = netDir; t.flag = 0xa0 | netDir; return; }
        const target = this._pickFollowFlag(t);
        if (target !== null) t.flag = (t.flag & 3) | target; // sub_E420 сохраняет направление
        return; // ретаргет без движения
      }
      const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
      if (n) { t.x = n.x; t.y = n.y; t.dir = dir; t.flag = 0xa0 | dir; this._emit({ op: "move", tank: t.index, x: t.x, y: t.y }); return; }
      if ((this.rng(`blk${t.index}`) & 3) === 0) {
        const nd = (dir + 2) % 4; t.dir = nd;
        t.flag = ((t.x & 7) === 0 && (t.y & 7) === 0) ? (0x90 | nd) : (0xa0 | nd);
      } else {
        t.flag = 0x88 | dir;
      }
    }
  }

  // =====================================================================
  // C) вражеский огонь (sub_E162) + создание пули (sub_E08C)
  // =====================================================================
  _fireEnemy(t) {
    const b = this.bullets[t.index];
    if (b.alive) return; // слот занят — пуля уже есть
    const dir = t.flag & 3;
    b.alive = true; b.owner = t.index; b.team = t.team; b.dir = dir;
    b.x = t.x + DX[dir] * 8; b.y = t.y + DY[dir] * 8;
    // sub_E08C: property 0 у типов 0x00/0x80/0xA0/0xE0 (гейт коллизии пули),
    // property 1 у 0xC0/0x20/0x40, property 3 у 0x60.
    const tb = t.type & 0xf0;
    b.property = tb === 0xc0 ? 1 : (tb === 0x60 ? 3 : 0);
    // пере-выстрел: сбросить остаточный взрыв/синк от прошлой жизни пули (иначе
    // _moveBullets пропустит свежую пулю как «взрывающуюся» и она не двинется).
    b.explode = 0; b.synced = false; b.fresh = true; // пуля создана в этом кадре
    this._emit({ op: "fire", tank: t.index, x: b.x, y: b.y, dir });
  }

  // Выстрел игрока (DEF) — тот же sub_E08C, но слот 0,1 и тип игрока.
  _fireDef(t) {
    const b = this.bullets[t.index];
    if (b.alive) return; // слот занят
    const dir = t.flag & 3;
    b.alive = true; b.owner = t.index; b.team = "DEF"; b.dir = dir;
    b.x = t.x + DX[dir] * 8; b.y = t.y + DY[dir] * 8;
    const tb = (t.type ?? 0) & 0xf0;
    b.property = tb === 0xc0 ? 1 : (tb === 0x60 ? 3 : 0);
    b.explode = 0; b.synced = false; b.fresh = true;
    this._emit({ op: "def_fire", tank: t.index, x: b.x, y: b.y, dir });
  }

  // Смерть игрока: ROM (sub_DE07): lives--, если остались — респавн, иначе мёртв.
  // Жизни/респавн мёртвых DEF-танков управляет _defLifecycle (PvP-слой pvp.js).
  _onPlayerDead(t) {
    const idx = t.index;
    this.c.lives = this.c.lives ?? [3, 3];
    this.c.lives[idx] = (this.c.lives[idx] ?? 3) - 1;
    // эмулятор сбрасывает ram_plr_stun_timer при смерти игрока (sub_DE46) — иначе
    // стан переживает смерть+респавн и блокирует переродившийся танк (st2 scan f1303).
    t.stun = 0;
    if (this.c.lives[idx] > 0) {
      t.alive = true; t.flag = 0xf0; // респавн (sub_E363_tank_spawn_handler)
      t.x = PLAYER_SPAWN_X[idx]; t.y = PLAYER_SPAWN_Y[idx];
      t.type = 0;
    } else {
      t.alive = false; t.flag = 0;
    }
    this._emit({ op: "player_dead", tank: idx, lives: this.c.lives[idx] });
  }

  // Суб-ячейка тайла для позиции пули (sub_D725): 1,2,4,8 по (x&4, y&4).
  _bulletSub(bx, by) { return 1 << (((by & 4) ? 2 : 0) + ((bx & 4) ? 1 : 0)); }
  // Коллизия тайла в суб-ячейке (sub_D73C + sub_E69A): орёл/штаб (0xC8-0xCB) блокирует
  // (sub_E69A: проверка орла ДО CMP #$12); тайлы >= 0x12 (дорога/лёд) пуля проходит
  // (sub_E69A: CMP #$12; BCS); блокирует/разрушает только < 0x12.
  _tileSolid(tile, bx, by) {
    if ((tile & 0xfc) === 0xc8) return true; // орёл/штаб
    return tile !== 0 && tile < 0x12 && (tile & (0xf0 | this._bulletSub(bx, by))) !== 0;
  }

  // =====================================================================
  // C) пули: движение (sub_E604), пуля-в-пулю (E910), пуля-в-танк (E70C)
  // =====================================================================
  // Гейт коллизии пули (sub_E604): property-0 пули проверяются только на «своих» кадрах.
  _bulletGate(b) {
    const lo = this._rngLo ?? (this.frame & 0xff);
    return b.property === 0 && ((b.slot ^ lo) & 1) === 0;
  }
  // Движение пуль (sub_E604). Три политики:
  //   observed (synced) — DEF-пуля синкается на позицию конца кадра эмулятора: только коллизия;
  //   fresh — кадр выстрела: не двигается, но коллизия проверяется;
  //   moving — обычный шаг: движение + коллизия.
  _moveBullets() {
    for (const b of this.bullets) {
      if (!b.alive || b.explode) continue;
      const gated = this._bulletGate(b);
      if (b.synced) { this._collideBullet(b, gated); continue; }
      if (b.fresh) { b.fresh = false; this._collideBullet(b, gated); }
      else { this._moveBullet(b, gated); }
    }
  }
  _moveBullet(b, gated) {
    const speed = (b.property & 0x01) ? 4 : 2;
    b.x += DX[b.dir] * speed; b.y += DY[b.dir] * speed;
    // Эмулятор хранит позицию пули в 8 битах (sub_E063: ADC/SBC) — за экраном пуля
    // ОБОРАЧИВАЕТСЯ (0-255), а не деактивируется. Симулятор раньше не оборачивал и
    // считал ушедшую пулю «вне поля» (слот занят навсегда) — расходилось с эмулятором.
    b.x &= 0xff; b.y &= 0xff;
    this._collideBullet(b, gated);
  }
  _collideBullet(b, gated) {
    if (!gated && this._bulletCollide(b, b.x, b.y)) b.explode = 9;
  }
  _bulletExplodeTick() {
    for (const b of this.bullets) {
      if (!b.alive || !b.explode) continue;
      b.explode--;
      if (b.explode === 0) b.alive = false;
    }
  }
  // Коллизия пули с тайлом: точный порт sub_E604. Пуля проверяется в 4 позициях
  // вдоль перпендикулярной оси (смещения +4*c, -c, -5*c от текущей, где c — скорость
  // коллизии из tbl_EA4D/tbl_EA49). В каждой задевшей позиции sub_E69A/sub_D743 снимает
  // ОДИН квадрант тайла (tile & ~quadrant), либо разрушает полностью при property bit1.
  // Проверки 1a/3 выполняются только если предыдущая (1/2) задела тайл (гейт в ASM).
  _bulletCollide(b, x, y) {
    // sub_E604: ram_0055/0054 = |tbl_EA4D/tbl_EA49[dir]| (магнитуда скорости коллизии на
    // перпендикулярной оси, всегда 1), знак задаётся явно в смещениях +4/-1/-5.
    const mx = (b.dir === 0 || b.dir === 2) ? 1 : 0; // sweep по X (up/down)
    const my = (b.dir === 1 || b.dir === 3) ? 1 : 0; // sweep по Y (left/right)
    const hit1 = this._checkBulletPos(b, x, y);
    if (hit1) this._checkBulletPos(b, x + mx * 4, y + my * 4);
    const hit2 = this._checkBulletPos(b, x - mx, y - my);
    if (hit2) this._checkBulletPos(b, x - mx * 5, y - my * 5);
    return hit1 || hit2;
  }
  // Проверка коллизии пули в одной позиции (px,py); при задеве снимает квадрант.
  // Позиции оборачиваются в 8 бит, как в эмуляторе (sub_E604 использует ADC/SBC):
  // вылетевшие за поле пули и перпендикулярные sweep-позиции читают обёрнутый тайл.
  _checkBulletPos(b, px, py) {
    const x = px & 0xff, y = py & 0xff;
    const c = x >> 3, r = y >> 3;
    const v = this.field[r * FIELD + c];
    if (!this._tileSolid(v, x, y)) return false;
    if ((v & 0xfc) === 0xc8) { this._destroyHQ(); return true; }
    if (isBrick(v)) {
      // sub_E69A bra_E6EB: property bit1 -> полное разрушение; иначе sub_D743 (квадрант).
      this.field[r * FIELD + c] = (b.property & 2) ? 0 : (v & ~this._bulletSub(x, y));
    }
    return true;
  }
  _bulletVsBullet() {
    const list = this.bullets.filter((b) => b.alive && !b.explode);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], bb = list[j];
      if (a.team === bb.team) continue;
      // sub_E910: две встречные пули взаимно уничтожаются — обе получают статус 0x00
      // (слот освобождается МГНОВЕННО, НЕ взрыв 0x33/9 кадров). Прежний explode=9 держал
      // слот DEF-пули занятым 9 кадров — пере-выстрел задерживался на кадры (ai-verify).
      if (Math.abs(a.x - bb.x) < 6 && Math.abs(a.y - bb.y) < 6) { a.alive = false; bb.alive = false; }
    }
  }
  // sub_E70C: пули-в-танки. Два прохода, как в ASM:
  //  1) вражеские пули (слоты 2-7) vs танки игрока (0,1): каска/шлем (helmet) гасит пулю
  //     без урона; иначе взрыв игрока 0x73 и сброс его типа.
  //  2) пули игрока (слоты 0,1) vs враги (2-7): бонус при ударе по мигающему (type&0x04),
  //     броня (type&0x03) -> DEC type (враг жив), иначе взрыв врага 0x73.
  _bulletVsTank() {
    // pass 1: вражеские пули против DEF-танков
    // sub_E70C E721-E772: для каждого танка проверяются ВСЕ пули 7..2 (без break) —
    // несколько вражеских пуль, попадающих в один DEF-танк за кадр, все получают статус.
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue;
      for (const b of this.bullets) {
        if (!b.alive || b.explode || b.team === "DEF") continue;
        if (Math.abs(b.x - t.x) < 10 && Math.abs(b.y - t.y) < 10) {
          if (t.helmet) { b.alive = false; continue; } // шлем -> пуля 0x00 (E757-E759)
          // без шлема (E74E-E76A): пуля -> 0x33 (9 кадров), танк -> 0x73
          b.explode = 9; t.flag = 0x73; t.type = 0; this._emit({ op: "player_hit", tank: t.index });
        }
      }
    }
    // pass 2: пули игрока против врагов
    for (const b of this.bullets) {
      if (!b.alive || b.explode || b.team !== "DEF") continue;
      for (const t of this.tanks) {
        if (t.team !== "ATT" || !t.alive) continue;
        if (!movementRange(t.flag)) continue;
        if (Math.abs(b.x - t.x) < 10 && Math.abs(b.y - t.y) < 10) {
          b.explode = 9; // пуля во взрыв 9 кадров (sub_E70C: bullet -> 0x33), не мгновенно
          this._hitEnemy(t);
          break;
        }
      }
    }
    // pass 3 (sub_E70C E843-E8B5): пули игрока (слоты 0,1) против танка ДРУГОГО игрока
    // (перекрёстный friendly-fire). Пуля всегда уходит во взрыв 0x33; танк со шлемом
    // невредим (пуля -> 0x00); иначе при отсутствии уже активного стана — стан 0xC8.
    for (let pi = 1; pi >= 0; pi--) {
      const tank = this.tanks.find((x) => x.index === pi);
      if (!tank || tank.team !== "DEF" || !tank.alive) continue;
      if (!movementRange(tank.flag)) continue;
      for (const b of this.bullets) {
        if (!b.alive || b.explode || b.team !== "DEF") continue;
        if (b.slot === pi) continue; // EOR player^bullet: только чужая пуля
        if (Math.abs(b.x - tank.x) < 10 && Math.abs(b.y - tank.y) < 10) {
          b.explode = 9;             // bullet -> 0x33 (E88F)
          if (tank.helmet) { b.alive = false; break; } // helmet -> 0x00 (E898-E89A)
          if ((tank.stun ?? 0) === 0) tank.stun = 0xc8; // stun_timer (E8AA-E8AC)
          break;
        }
      }
    }
  }
  // Попадание пули игрока во врага (sub_E7AA..E7F2): бонус на ударе по мигающему,
  // броня (type&3) держит несколько попаданий, обычный уходит во взрыв.
  _hitEnemy(t) {
    if ((t.type & 0x04) !== 0) {
      // мигающий враг -> приз СРАЗУ при ударе (sub_E8BE). Если _spawnBonus отложил
      // (патологический ретрай sub_E8BE, пересёк границу кадра) — смерть танка тоже
      // откладывается до завершения ретрая (в следующем кадре), как в эмуляторе.
      if (this._spawnBonus(t)) return;
      if (t.type === 0xe4) t.type--;   // 0xE4 -> 0xE3 (снять флеш-бит, sub_E7DA)
    }
    if ((t.type & 0x03) !== 0) { t.type--; this._emit({ op: "hit", tank: t.index }); }
    else { t.flag = 0x73; }            // обычный: начало взрыва (con_tank_flag_explosion+3)
  }
  // Уничтожение штаба/орла (sub_CC08_draw_destroyed_eagle): пуля попала в орла (0xc8-0xcb).
  _destroyHQ() {
    for (const [row, col, tile] of EAGLE_DESTROYED_TILES) this.field[row * 32 + col] = tile;
    this.c.gameOver = 1;
    this._emit({ op: "hq_destroyed" });
  }
  _onEnemyDead(t) {
    this.c.enemiesLeft = (this.c.enemiesLeft || 0) - 1;
    this._emit({ op: "enemy_dead", tank: t.index });
  }
  // Один «кадровый бюджет» ретрая sub_E8BE (число ретраев, помещающихся в один NMI-кадр
  // эмулятора, ~48). После исчерпания бюджет эмулятора обрывается NMI и кадр продвигается.
  static BONUS_RETRY_PER_FRAME = 48;

  // Спавн приза (sub_E8BE): потребляет RNG как эмулятор.
  //
  // Патологический случай: приз всегда попадает на неподвижный DEF-танк (напр. (96,192)
  // на tank0 (88,191)) — sub_E8BE ретраит БЕЗ успеха. В эмуляторе этот цикл не бесконечен,
  // а обрезается NMI: каждый кадр (~48 ретраев) продвигает ram_frm_cnt, и при изменении
  // $0A/$0B детерминированный PRNG ломает «тупиковый» цикл позиций, после чего ретрай
  // находит свободную клетку. При этом САМ ВЫЗОВ pass-2 (и смерть танка) переезжает на
  // следующий кадр (sub_C2E6 не завершается в кадре попадания).
  //
  // Порт: _spawnBonus выполняет до BONUS_RETRY_PER_FRAME ретраев. Если клетка найдена —
  // спавнит приз и возвращает false (завершено). Если бюджет исчерпан без успеха —
  // откладывает: продвигает frame (ломает RNG-цикл), ставит _pendingBonus и возвращает
  // true. Завершение (приз + смерть врага) происходит в начале следующего step().
  _spawnBonus(tank) {
    if (this._pendingBonus) throw new Error("_spawnBonus already pending"); // инвариант
    if (this._tryBonusPlacement()) return false;
    this.advanceFrame();
    this._rngLo = this.frame & 0xff;
    this._pendingBonus = { tank };
    return true;
  }
  // Продолжение отложенного ретрая в начале следующего кадра (эмулятор возобновляет
  // sub_E8BE после NMI). Возвращает true, если приз ещё не найден (снова отложено).
  _continuePendingBonus() {
    if (!this._pendingBonus) return;
    if (this._tryBonusPlacement()) {
      // приз найден -> завершаем отложенную смерть врага (sub_E7DA..E7F5)
      const { tank } = this._pendingBonus;
      this._pendingBonus = null;
      if (tank.type === 0xe4) tank.type--;
      if ((tank.type & 0x03) !== 0) { tank.type--; this._emit({ op: "hit", tank: tank.index }); }
      else { tank.flag = 0x73; }
    } else {
      // всё ещё на танке -> снова продвинуть кадр и отложить (эмулятор NMI-обрезка)
      this.advanceFrame();
      this._rngLo = this.frame & 0xff;
    }
  }
  // До BONUS_RETRY_PER_FRAME ретраев позиции приза. true — клетка найдена и приз заспавнен.
  _tryBonusPlacement() {
    const TBL = BONUS_ID_TABLE; // tbl_E8FA
    for (let i = 0; i < BattleSim.BONUS_RETRY_PER_FRAME; i++) {
      let posX = this.rng() & 3;
      let posY = this.rng() & 3;
      posX = bonusPosFromRng(posX); // sub_E902: A=0->0x30,1->0x60,2->0x90,3->0xC0
      posY = bonusPosFromRng(posY);
      if (!this._bonusOnTank(posX, posY)) { // sub_E972: если на игроке -> ретрай
        const id = TBL[this.rng() & 7];
        this.prize = { id, x: posX, y: posY };
        this._emit({ op: "bonus_spawn", id, x: posX, y: posY });
        return true;
      }
    }
    return false;
  }
  _bonusOnTank(x, y) {
    // sub_E972: только игроки (DEF 0,1) в диапазоне движения (не взрыв/респавн)
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue;
      if (Math.abs(t.x - x) < 0x0c && Math.abs(t.y - y) < 0x0c) return true;
    }
    return false;
  }

  // =====================================================================
  // C) спавн врага (sub_DB48 + sub_E363) и тип по стадии (sub_E3CB)
  // =====================================================================
  _spawnEnemy() {
    if (this.c.spawnTimer > 0) { this.c.spawnTimer--; return; }
    if (this.c.spawnCount === 0) return;
    for (let idx = (this.c.limit ?? 7); idx >= 2; idx--) {
      const t = this.tanks.find((x) => x.index === idx);
      if (t && t.flag !== 0) continue;
      const bonus = (this.c.spawnCount === 0x11 || this.c.spawnCount === 0x0a || this.c.spawnCount === 0x03);
      const tank = t || { index: idx, team: "ATT", dir: 2, x: 0, y: 0, flag: 0, type: 0x80 };
      tank.alive = true;
      // sub_E363: INC spawn_pos_index (сброс на 3->0) ПЕРЕД использованием
      this.c.spawnPosIndex = (this.c.spawnPosIndex + 1) % 3;
      tank.x = ENEMY_SPAWN_X[this.c.spawnPosIndex]; tank.y = ENEMY_SPAWN_Y;
      tank.flag = 0xf0;                     // всегда 0xF0 (бонус маркируется типом 0x04)
      tank.type = bonus ? 0x04 : 0;          // sub_E363: type=0/0x04 во время респавна
      if (!this.tanks.includes(tank)) this.tanks.push(tank);
      this.c.spawnCount--;
      this.c.spawnTimer = this.c.spawnInterval;
      // Стереть иконку врага в поле (sub_DB48 -> sub_C8B1_erase_enemy_icon):
      // позиция иконки index = spawnCount (после декремента): col=(i&1)+29, row=(i>>1)+3,
      // пишется серый/стальной тайл 0x11 (tbl_D36B_tile___gray).
      this._eraseEnemyIcon(this.c.spawnCount);
      this._emit({ op: "spawn", tank: idx, x: tank.x, y: tank.y, type: tank.type });
      return;
    }
  }
  // sub_C894_calculate_enemy_icon_pos + tbl_D36B_tile___gray: стереть иконку врага i.
  _eraseEnemyIcon(i) {
    const col = (i & 1) + 29;
    const row = (i >> 1) + 3;
    if (row >= 0 && row < 32 && col >= 0 && col < 32) this.field[row * 32 + col] = ENEMY_ICON_ERASE_TILE;
  }
  // Тип врага по счётчикам типов стадии (sub_E3CB): сканирует от type_offset первый
  // тип с ненулевым остатком, декрементит, комбинирует с бонус-битом 0x04 (type во время
  // респавна). sub_E3CB: 0xE0 (бронированный) спавнится с 3 броней -> 0xE3; тип 0xE7
  // (броня+флеш) превращается в 0xE4. Вызывается на E0->A2 (sub_E3B8).
  _pickType(t) {
    const o = this.c.typeOffset ?? 0;
    const bonus = (t.type & 0x04);
    const vals = STAGE_TYPE_VALUES[this.c.stage] || DEFAULT_TYPE_VALUES;
    for (let i = 0; i < 4; i++) {
      const idx = (o + i) % 4;
      if (this.typeCnt[idx] > 0) {
        this.typeCnt[idx]--;
        this.c.typeOffset = (o + i) % 4;
        let v = vals[idx];                     // tbl_E4EC: значение типа по стадии
        if (v === 0xe0) v = 0xe3;              // sub_E3CB: 0xE0 -> ORA #$03 (броня)
        let type = v | bonus;
        if (type === 0xe7) type = 0xe4;        // sub_E3CB: 0xE7 -> 0xE4
        return type;
      }
    }
    this.c.typeOffset = 0;
    let type = 0x80 | bonus;
    if (type === 0xe7) type = 0xe4;
    return type;
  }

  // =====================================================================
  // C) призы (sub_E972) — подбор + эффект (упрощённо: не спавн из врага)
  // =====================================================================
  _bonus() {
    if (!this.prize) return;
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue; // sub_E972: только в движении (не взрыв/респавн)
      if (Math.abs(t.x - this.prize.x) < 12 && Math.abs(t.y - this.prize.y) < 12) {
        this._applyPrize(this.prize.id);
        this.prize = null;
        return;
      }
    }
  }
  _applyPrize(id) {
    if (id === 4) { for (const t of this.tanks) if (t.team === "ATT" && t.alive && movementRange(t.flag)) { t.flag = 0x73; t.type = 0; } } // граната (EA17)
    else if (id === 1) { this.c.clock = 0x0a; } // часы (E9F5): заморозка, таймер 0x0A
    else if (id === 2) { this._fortifyBase(); this.c.shovelTimer = 0x14; } // лопата (E9FB)
    this._emit({ op: "prize", id });
  }
  // Таймер заморозки (часы, sub_DBF1 DC00): декремент каждые 64 кадра.
  _clockHandler() {
    if (!this.c.clock) return;
    if ((this.frame & 0x3f) === 0) { this.c.clock--; }
  }
  // Лопата/укрепление: стальной щит вокруг штаба (sub_CB9E_draw_protected_base).
  // Сталь 0x10 на клетках FORTIFY_CELLS; орёл C8-CB остаётся.
  _fortifyBase() {
    this._baseSaved = FORTIFY_CELLS.map(([r, c]) => this.field[r * FIELD + c]);
    for (const [r, c] of FORTIFY_CELLS) this.field[r * FIELD + c] = 0x10;
  }
  _restoreBase() {
    if (!this._baseSaved) return;
    for (let i = 0; i < FORTIFY_CELLS.length; i++) {
      const [r, c] = FORTIFY_CELLS[i];
      this.field[r * FIELD + c] = this._baseSaved[i];
    }
    this._baseSaved = null;
  }
  // Таймер лопаты (sub_E2A9): каждые 64 кадра декремент; по истечении вернуть базу.
  _shovelHandler() {
    if (!this.c.shovelTimer) return;
    if ((this.frame & 0x3f) === 0) {
      this.c.shovelTimer--;
      if (this.c.shovelTimer <= 0) { this._restoreBase(); this.c.shovelTimer = 0; }
    }
  }
  // Таймер каски/шлема (sub_E27C_players_invincibility_handler): декремент каждые 64
  // кадра; при 0 каска гаснет и танк игрока уязвим. Раньше helmet=3 ставился при
  // респавне, но никогда не снимался -> DEF-танк был бессмертным и не входил во взрыв.
  _helmetHandler() {
    for (let t = 0; t < 2; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank || !tank.helmet) continue;
      if ((this.frame & 0x3f) === 0) {
        tank.helmet--;
        if (tank.helmet < 0) tank.helmet = 0;
      }
    }
  }
  // Жизненный цикл DEF-танков в PvP-слое (pvp.js), вне ROM:
  //  1) жизни сбрасываются на 3 при исчерпании (mem[0x51+t]===0 -> 3);
  //  2) мёртвые DEF-танки (flag 0) респавнятся каждые 30 кадров (defFrame%30==0),
  //     сбрасывая тип/позицию/стан и ставя флаг респавна 0xf0.
  _defLifecycle() {
    const frame = this.defFrame ?? this.frame;
    for (let t = 0; t < 2; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank) continue;
      if (tank.flag !== 0) continue;
      if ((this.c.lives[t] ?? 3) === 0) this.c.lives[t] = 3;
      if (frame % 30 === 0) {
        tank.flag = 0xf0; tank.type = 0; tank.stun = 0; tank.alive = true;
        tank.x = PLAYER_SPAWN_X[t]; tank.y = PLAYER_SPAWN_Y[t];
        this._emit({ op: "player_respawn", tank: t });
      }
    }
  }

  // =====================================================================
  // Один кадр (порядок sub_C2E6, вражеская сторона)
  // =====================================================================
  // Двухфазный в-кадровый $0B для RNG (см. rng()): фаза "move" использует pre-reset
  // gateFrmLo (эмулятор читает $0B в sub_DBF1 до сброса в sub_DE46), фаза "fire" — 0
  // (post-reset). Задаёт this._rngLo, который rng() использует как lo.
  _beginRngPhase(phase) {
    this._rngPhase = phase;
    this._rngLo = phase === "move" ? (this.c.gateFrmLo ?? this.c.frmCntLo) : (this.frame & 0xff);
  }

  step() {
    this.events = [];
    this.c.frmCntLo = this.frame & 0xff;
    this.c.frmCntHi = (this.frame >> 8) & 0xff;
    const clock = this.c.clock || 0;
    // frmLo для гейта движения: при сбросе $0B в середине кадра эмулятор успел
    // прочитать старый счётчик в sub_DBF1, а RNG — уже сброшенный. Даёт согласованность.
    const gateFrmLo = this.c.gateFrmLo ?? this.c.frmCntLo;

    // фаза движения: RNG читает pre-reset $0B (эмулятор в sub_DBF1 до сброса в sub_DE46)
    this._beginRngPhase("move");

    // 0) продолжение отложенного ретрая приза (sub_E8BE, пересёк границу кадра):
    //    эмулятор после NMI возобновляет хвост pass-2 (приз + смерть врага) ДО нового
    //    кадра sub_C2E6. Использует новый frame (NMI уже продвинул $0A/$0B).
    this._continuePendingBonus();

    // 0) жизненный цикл DEF-танков (pvp.js): сброс жизней и респавн мёртвых каждые 30 кадров
    this._defLifecycle();

    // 1) маркеры танков (sub_E181) — по флагу (movementRange внутри _setMarker)
    for (const t of this.tanks) this._setMarker(t);

    // 1a) лёд (sub_E181_ice_detection) и ввод игрока (sub_DB75) — ДО движения (sub_DBF1)
    this._iceDetection();
    this._defInput();

    // 2) движение танков (sub_DBF1): индексы 7..0 (порядок RNG важен!)
    for (let idx = 7; idx >= 0; idx--) {
      const t = this.tanks.find((x) => x.index === idx);
      if (!t) continue;
      if (t.team === "ATT") {
        if (!enemyGate(t.flag, t.type, t.index, gateFrmLo, clock)) continue;
        this._tankStatus(t);
      } else if (t.team === "DEF") {
        if (!playerGate(gateFrmLo)) continue;
        this._tankStatus(t);
      }
    }

    // 3) маркеры снять (sub_E1FA) — те же позиции, где ставили (до движения)
    this._clearMarkers();

    // взрыв пули (sub_E02E/sub_E076) — декремент ДО фазы огня (sub_E162): слот освобождается
    // вовремя, иначе пере-выстрел задерживается на кадр (эмулятор: sub_E02E раньше sub_E162).
    this._bulletExplodeTick();

    // каска игрока (sub_E27C) — декремент каждые 64 кадра ДО проверки пуля-в-танк
    this._helmetHandler();

    // фаза огня/пуль: если игра сбросила $0B в 0 (sub_DE46), RNG читает 0.
    this._beginRngPhase("fire");

    // 4) вражеский огонь (sub_E162): индексы 7..2
    if (clock === 0) {
      for (let i = 7; i >= 2; i--) {
        const t = this.tanks.find((x) => x.index === i);
        if (!t || !movementRange(t.flag)) continue;
        // PvP net-огонь: если ИИ дал fire — стреляем (без RNG); иначе RNG-огонь (sub_E162).
        if (this._netFire(i)) this._fireEnemy(t);
        else if (this.rng(`fire${i}`) === 0) this._fireEnemy(t);
      }
      // огонь игроков (DEF): по фронту нажатия A (edge-trigger). Занятость слота
      // проверяет сам _fireDef (b.alive) — на момент фазы огня (после взрыва пули)
      // слот эмулятора уже мог освободиться (см. f2033 scan), defSlotBusy (пред-кадровый)
      // это блокировал бы неверно.
      for (let i = 1; i >= 0; i--) {
        const t = this.tanks.find((x) => x.index === i);
        if (!t || t.team !== "DEF" || !movementRange(t.flag)) continue;
        const fire = this._defFire(i);
        if (fire && !this._prevDefFire[i]) this._fireDef(t);
        this._prevDefFire[i] = fire;
      }
    }

    // 5) спавн (sub_DB48)
    this._spawnEnemy();

    // 6) пули: движение, пуля-в-пулю, пуля-в-танк
    this._moveBullets();
    this._bulletVsBullet();
    this._bulletVsTank();

  // 7) призы
  this._bonus();
  // лопата/укрепление (sub_E2A9) — декремент таймера и восстановление базы
  this._shovelHandler();
  // часы/заморозка (sub_DBF1 DC00) — декремент таймера каждые 64 кадра
  this._clockHandler();

  return this.events;
  }
}
