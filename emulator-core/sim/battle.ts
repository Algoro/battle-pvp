// sim/battle.js — [TEST-ONLY, not runtime] Frame-accurate port of the enemy battle (sub_C2E6_main_battle_script)
// for verifying the simulator against the emulator. Target ROM: patched PRNG (variant B):
//   $0F = ($0F*7 + frm_cnt_hi + frm_cnt_lo) & 0xFF   (sub_D44D without page-zero mix)
//
// INVARIANT: this port must match the emulator frame by frame (enemies + field + RNG).
// Any refactoring/change is verified by: `node --test emulator-core/tests/*.test.js`
// (100 tests) + `node scripts/stage-verify.mjs 1..6` (all stages 100%).
//
// Covers (enemy side):
//   A) deterministic PRNG (variant B) — rngState
//   B) dynamic field: bit7 tank markers (sub_E181/sub_E1FA) + brick destruction
//   C) full cycle: movement (sub_DBF1), enemy fire (sub_E162), bullets
//      (sub_E604/E910/E70C), spawn (sub_DB48/E363), death/respawn, prizes (sub_E972).
import { FIELD, TILE, DX, DY, isBrick, readState } from "../model/game-view.ts";
import { movingFlag, standingFlag } from "../domain.ts";
import { canLead } from "./sim-model.ts";
import {
  DEFAULT_TYPE_VALUES, STAGE_TYPE_VALUES, STAGE_TYPE_COUNTS,
  ENEMY_SPAWN_X, ENEMY_SPAWN_Y, PLAYER_SPAWN_X, PLAYER_SPAWN_Y,
  BONUS_ID_TABLE, bonusPosFromRng, FORTIFY_CELLS, EAGLE_DESTROYED_TILES, ENEMY_ICON_ERASE_TILE,
} from "./tables.ts";
import { RAM } from "./ram-addr.ts";

// Enemy movement gate (sub_DBF1 DC18-DC38): on which frames the status handler runs.
function enemyGate(flag: number, type: number, index: number, frmCntLo: number, clock: number): boolean {
  const hi = flag & 0xf0;
  let reach = true;
  if (clock !== 0) {
    if ((flag & 0x80) !== 0 && hi < 0xe0) reach = false;
  }
  if (reach && (type & 0xf0) !== 0xa0) reach = ((index ^ frmCntLo) & 1) !== 0;
  return reach;
}

// Is the tank alive-moving (flag 0x80-0xD0, not respawn/explosion/dead).
function movementRange(flag: number): boolean { const h = flag & 0xf0; return h >= 0x80 && h <= 0xd0; }

// Ice tile (sub_E181: CMP #con_block_type + $21) — the player slides on ice.
const ICE_TILE = 0x21;

// PLAYER movement gate (sub_DBF1 DC09-DC15): status handler on frmCntLo&3 != 2
// (0.75px/frame: runs on 0,1,3 mod 4, skipped on 2).
function playerGate(frmCntLo: number): boolean { return (frmCntLo & 3) !== 2; }

// Bullets: fixed 10 slots (0-9), slot i corresponds to tank i (sub_E604 indexes 9..0).
function makeBullets(input: any[] = []): any[] {
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

// Normalize the input state: fill defaults (invariant: does not change the result).
function normalizeState(state: any = {}): any {
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
 * BattleSim — frame-accurate port of the enemy side of the battle (see the invariant at the top).
 *
 * @param {object} state  initial state (see normalizeState):
 *   field: Uint8Array(1024) | tanks: [] | bullets: [] | counters: {} | prize | rngState | frame | typeCnt | p1 | p2
 * @param {object} opts   options:
 *   seed: number        — override the initial rngState (optional)
 *   frame: number       — override the initial frame (optional)
 *   rngInjection: number|number[] — return a fixed value(s) instead of computing the PRNG (doesn't change $0F)
 *   onEvent: (e)=>void  — synchronous callback for each frame event
 */
export class BattleSim {
  declare opts: any;
  declare field: any;
  declare tanks: any[];
  declare bullets: any[];
  declare c: any;
  declare prize: any;
  declare rngState: number;
  declare frame: number;
  declare typeCnt: number[];
  declare p1: any;
  declare p2: any;
  declare events: any[];
  declare _markOff: number[];
  declare _rngIdx: number;
  declare _rngLo: number | null;
  declare attControl: any;
  declare defControl: any;
  declare _prevDefFire: boolean[];
  declare defSlotBusy: boolean[];
  declare plrFlags: number[];
  declare defFrame: number;
  declare _pendingBonus: any;
  declare _trace: any;
  declare _rngCtx: any;
  declare _mem: Uint8Array | null;
  declare _rngPhase: any;
  declare _baseSaved: number[] | null;
  constructor(state: any, opts: any = {}) {
    const s = normalizeState(state);
    this.opts = {
      onEvent: opts.onEvent ?? null,
      rngInjection: opts.rngInjection ?? null,
    };
    this.field = s.field;                 // Uint8Array 1024 (dynamic, mutated)
    this.tanks = s.tanks;                 // [{index,team,x,y,dir,flag,type,alive,helmet}]
    this.bullets = s.bullets;             // 10 bullet slots
    this.c = s.counters;                  // battle counters/timers (mutated)
    this.prize = s.prize;                 // {id,x,y} | null
    this.rngState = opts.seed ?? s.rngState; // ram_random ($0F)
    this.frame = opts.frame ?? s.frame;
    this.typeCnt = s.typeCnt;             // enemy type counters for the stage (sub_E42B)
    this.p1 = s.p1;
    this.p2 = s.p2;
    this.events = [];                     // events of the last step() (see _emit)
    this._markOff = [];
    this._rngIdx = 0;                     // counter for the rngInjection array
    this._rngLo = null;                   // in-frame $0B for the movement/fire phase
    // External AI control (for running AI on the simulator). Value: function (frame) => Map<idx,
    // {dir, fire}> | null, or a Map/object {idx: {dir, fire}}. dir: 0-3, null=no input; fire: bool.
    // attControl — enemies (2..7), defControl — players (0,1). null = native flag machine/sync.
    this.attControl = null;
    this.defControl = null;
    this._prevDefFire = [false, false]; // A-press edge for DEF (edge-trigger, like the emulator)
    this.defSlotBusy = [false, false]; // DEF bullet slot occupancy in the emulator at frame START (sync)
    this.plrFlags = [0, 0];            // ram_0103_plr_flags (ice/slide) for players 0,1
    this.defFrame = 0;                 // monotonic PvP-layer frame counter (pvp.js _frame) for the respawn rhythm
    this._pendingBonus = null;         // deferred prize spawn (sub_E8BE, crossed a frame boundary)
  }

  // External AI decision for tank idx (enemy/player): {dir, fire} | null.
  _controlDecision(ctrl: any, idx: number) {
    if (!ctrl) return null;
    const d = typeof ctrl === "function" ? ctrl(this.frame) : ctrl;
    if (d instanceof Map) return d.get(idx) ?? null;
    return d[idx] ?? null;
  }

  // Advance the frame counter by 1 as in the emulator (NMI handler).
  //
  // IMPORTANT: ram_frm_cnt_hi ($0A) is NOT frame>>8. It is incremented every 64 frames
  // (when $0B crosses 0x00/0x40/0x80/0xC0), not every 256. I.e. $0A = frame_count>>6,
  // $0B = frame_count&0xff. The PRNG port (sub_D44D) uses $0A + $0B. If we simply
  // did frame+1 (a 16-bit counter), then at $0B=0x40..0xC0 $0A would not be incremented
  // as in the emulator — and the standalone RNG diverges (frame>>8 != $0A).
  //
  // Storage: this.frame is encoded as ($0A<<8) | $0B so rng() can read
  // hi = frame>>8 = $0A and lo = frame&0xff = $0B unchanged (lockstep-compatible).
  advanceFrame() {
    const lo = this.frame & 0xff;
    const newLo = (lo + 1) & 0xff;
    let hi = (this.frame >> 8) & 0xff;
    // $0A is incremented when $0B becomes a multiple of 0x40 (0x00, 0x40, 0x80, 0xC0).
    if ((newLo & 0x3f) === 0) hi = (hi + 1) & 0xff;
    this.frame = (hi << 8) | newLo;
    return this.frame;
  }
  _netDir(t: any) { const d = this._controlDecision(this.attControl, t.index); return d && d.dir != null ? d.dir : null; }
  _netFire(i: number) { const d = this._controlDecision(this.attControl, i); return !!(d && d.fire); }
  _defDir(t: any) { const d = this._controlDecision(this.defControl, t.index); return d && d.dir != null ? d.dir : null; }
  _defFire(i: number) { const d = this._controlDecision(this.defControl, i); return !!(d && d.fire); }

  // --- A) deterministic PRNG (variant B: sub_D44D without page-zero mix) ---
  // lo — in-frame $0B (ram_frm_cnt_lo). In the emulator the game RESETS $0B to 0 in the middle
  // of the frame (sub_DE46 on player death): calls BEFORE the reset (movement/status) use the
  // pre-reset value, AFTER (fire/bullets) — 0. Movement phase — gateFrmLo, fire phase —
  // frame & 0xff (set in step() via this._rngLo).
  rng(ctx?: any) {
    if (this.opts.rngInjection != null) {
      // Injection: returns the value WITHOUT evolving $0F (like setRngInjection in the emulator).
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

  _emit(e: any) { if (this.opts.onEvent) this.opts.onEvent(e); this.events.push(e); }

  // RAM-compatible emulator buffer from the simulator's semantic state.
  // Allows running existing AI (which reads mem: GameState/readState and
  // direct mem[...]) unchanged. The buffer is cached and overwritten on every call.
  // Builds the RAM buffer that the AI stack reads (the read-set from ram-addr.js).
  //
  // SEMANTICS: the simulator stores state semantically (this.field, this.tanks,
  // this.bullets, this.c.*). AI engines read it through the emulator's RAM layout
  // (see ram-addr.js). This method materializes the RAM buffer from the semantic
  // state — the same as the emulator has in cpu.mem at the frame boundary.
  //
  // Invariant (contract test verify-toMem): for every read-set address
  // toMem() must give a byte IDENTICAL to the emulator's cpu.mem in a lockstep run.
  toMem() {
    if (!this._mem) this._mem = new Uint8Array(0x10000);
    const m = this._mem;
    m.fill(0);
    const R = RAM;

    // --- Field: 32x32 tile buffer (read-set: GameState.field) ---
    // IMPORTANT: the field in toMem = the same as the AI reads; tank markers (bit7) are not
    // written here — the AI uses separate tank fields (TANK_X/Y/FLAG), not markers.
    m.set(this.field, R.FIELD);

    // --- Level / effect state ---
    m[R.ENEMIES_LEFT] = this.c.enemiesLeft ?? 0;       // enemies left until victory
    m[R.SPAWN_TIMER] = this.c.spawnTimer ?? 0;         // timer until the next enemy spawn
    m[R.FORTIFIED] = (this.c.shovelTimer ?? 0) > 0 ? 1 : 0; // base fortified by the shovel
    m[R.CLOCK_TIMER] = this.c.clock ?? 0;              // clock: enemies frozen

    // --- Tanks (0..7): x, y, flag, type; helmet/stun — only defenders (0,1) ---
    for (let t = 0; t < 8; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank) continue;
      m[R.TANK_X + t] = tank.x;
      m[R.TANK_Y + t] = tank.y;
      m[R.TANK_FLAG + t] = tank.flag ?? 0;
      m[R.TANK_TYPE + t] = tank.type ?? 0;
      // helmet/stun are read by the AI only for defenders (t<DEF_END). Writing them for
      // t>=2 would shift the address onto the next tank/bullet slot — breaking the decision layer.
      if (t < 2) {
        m[R.HELMET + t] = tank.helmet ? 1 : 0;
        m[R.STUN + t] = tank.stun ?? 0;
      }
    }

    // --- Bullets (0..7): status, x, y ---
    for (let t = 0; t < 10; t++) {
      const b = this.bullets[t];
      if (!b || !b.alive) continue;
      m[R.BULLET_STATUS + t] = b.explode ? 0x33 : (0x40 | b.dir);
      m[R.BULLET_X + t] = b.x;
      m[R.BULLET_Y + t] = b.y;
    }

    // --- Prize: id, x, y (0xff — no prize) ---
    if (this.prize) {
      m[R.PRIZE_ID] = this.prize.id;
      m[R.PRIZE_X] = this.prize.x;
      m[R.PRIZE_Y] = this.prize.y;
    } else {
      m[R.PRIZE_ID] = 0xff;
    }
    return m;
  }

  // GameState (the unified game-view layer) from the simulator semantics — for AI via readState.
  view() { return readState(this.toMem()); }

  // Immutable state snapshot for reading (AI/UI/harness), does not affect the simulator.
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
  // B) tank markers in the field (sub_E181 -> sub_E1FA)
  // =====================================================================
  // For a living tank compute the stage tile (top-left of the 2x2 block) and bit flags.
  _tankStagePos(t: any) {
    const y = t.y - 8, x = t.x - 8;
    const ty = Math.floor(y / TILE), tx = Math.floor(x / TILE);
    const off = ty * FIELD + tx;
    let hi = 0;
    if ((t.x & 7) === 0) hi |= 0x80;  // +0x20
    if ((t.y & 7) === 0) hi |= 0x40;  // +0x01
    return { off, hi };
  }
  _setMarker(t: any) {
    if (!movementRange(t.flag)) return;
    const p = this._tankStagePos(t);
    const f = this.field;
    f[p.off + 0x21] |= 0x80; this._markOff.push(p.off + 0x21);
    if (p.hi & 0x80) { f[p.off + 0x20] |= 0x80; this._markOff.push(p.off + 0x20); }
    if (p.hi & 0x40) { f[p.off + 0x01] |= 0x80; this._markOff.push(p.off + 0x01); }
  }
  // sub_E1FA clears the markers at the same position where sub_E181 set them (before movement).
  _clearMarkers() {
    for (const off of this._markOff) this.field[off] &= 0x7f;
    this._markOff = [];
  }

  // =====================================================================
  // Navigation (sub_DDA2, base table tbl_E486) and target choice (sub_DE72)
  // =====================================================================
  _navigateDir(t: any, destX: number, destY: number) {
    const TBL = [0,0,0, 1,0,3, 2,2,2];
    const sx = destX < t.x ? -1 : destX > t.x ? 1 : 0;
    const sy = destY < t.y ? -1 : destY > t.y ? 1 : 0;
    return TBL[3 * (sy + 1) + (sx + 1)];
  }
  _pickFollowFlag(t: any) {
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
  _setFollow(t: any, destX: number, destY: number) { t.dir = this._navigateDir(t, destX, destY); return 0xa0 | t.dir; }

  // =====================================================================
  // C0) ICE/PLAYER INPUT (DEF) — sub_DB75_ice_movement.
  // A separate phase BEFORE movement (sub_DBF1): by controller input it sets the flag
  // 0xa0|dir (movement) or 0x80-block (no input/stun/ice). Movement is performed by
  // sub_DC97 (in _tankStatus). Previously the input was nested in _tankStatus and didn't set
  // 0x80 when there was no input — a mismatch of the DEF tank flag with the emulator.
  // =====================================================================
  // sub_E181_ice_detection (players only): sets plrFlags bit7 on ice (0x21).
  _iceDetection() {
    for (let t = 0; t < 2; t++) {
      const tank = this.tanks.find((x) => x.index === t);
      if (!tank || (tank.flag & 0x80) === 0 || tank.flag >= 0xe0) continue;
      const onIce = this.field[Math.floor(tank.y / TILE) * FIELD + Math.floor(tank.x / TILE)] === ICE_TILE;
      this.plrFlags[t] = onIce ? (this.plrFlags[t] | 0x80) : (this.plrFlags[t] & ~0x80);
    }
  }
  // sub_DB75 bra_DBA6: no input/stun/ice -> 0x80-block (0x80|(flag&0x0f)|0x08).
  _setDefBlocked(t: any) { t.flag = 0x88 | (t.flag & 0x0f); }
  _defInput() {
    const gate = this.c.gateFrmLo ?? this.c.frmCntLo;
    if (!playerGate(gate)) return;
    for (let i = 1; i >= 0; i--) {
      const t = this.tanks.find((x) => x.index === i);
      if (!t || t.team !== "DEF") continue;
      const flag = t.flag;
      if ((flag & 0x80) === 0) continue;  // dead/exploding
      if (flag >= 0xe0) continue;         // respawn
      const dir = this._defDir(t);
      // stun (sub_DB75 DB8B-DB91): decrement + block
      if ((t.stun ?? 0) > 0) { t.stun--; this._setDefBlocked(t); continue; }
      // ice (sub_DB75 DB94-DBA6): on ice — slide, keep the movement direction
      if ((this.plrFlags[i] & 0x80) !== 0) {
        const curDir = flag & 3;
        t.flag = 0xa0 | curDir;
        continue;
      }
      // no input -> block (0x80)
      if (dir === null) { this._setDefBlocked(t); continue; }
      // perpendicular turn: align the axis to the 8px grid (sub_DBD5)
      const curDir = flag & 3;
      if (dir !== curDir && dir !== ((curDir + 2) & 3)) {
        const vertical = dir === 0 || dir === 2;
        if (vertical) t.x = (t.x + 4) & 0xf8; else t.y = (t.y + 4) & 0xf8;
      }
      t.flag = 0xa0 | dir;
    }
  }

  // =====================================================================
  // C) tank status machine (sub_DC3D -> tbl_E498)
  // =====================================================================
  _tankStatus(t: any) {
    const f = t.flag;
    const hi = f & 0xf0;
    // Direction source: enemies — attControl, players — defControl (PvP net/AI).
    const netDir = t.team === "ATT" ? this._netDir(t) : this._defDir(t);
    if (hi === 0xf0 || hi === 0xe0) return this._statusRespawn(t, f, hi);
    if (hi >= 0x10 && hi <= 0x70) return this._statusExplode(t, f);
    if (hi === 0xb0 || hi === 0xc0 || hi === 0xd0) return this._statusFollow(t, hi);
    // DEF without external control (defControl) — stands still (does not RNG-turn).
    if (t.team === "DEF" && netDir === null && (hi === 0x90 || hi === 0xa0)) return;
    if (hi === 0x80) return this._statusPause(t, f);
    if (hi === 0x90) return this._statusTurn(t, f, netDir);
    if (hi === 0xa0) return this._statusMove(t, f, netDir);
  }

  // Respawn F0/E0.
  _statusRespawn(t: any, f: number, hi: number) {
    if (hi === 0xf0) { t.flag = f + 1; if ((t.flag & 0x0f) === 0x0e) t.flag = 0xe0; return; }
    t.flag = f + 1;
    if ((t.flag & 0x0f) === 0x0e) {
      // sub_E3B8 + tbl_E47E: player up 0xa0 (+helmet), enemy down 0xa2 (+real type).
      if (t.team === "DEF") { t.flag = 0xa0; t.helmet = 3; }
      else { t.flag = 0xa2; t.type = this._pickType(t); }
    }
  }

  // Explosion 0x10-0x70.
  _statusExplode(t: any, f: number) {
    const flag = f - 1;
    t.flag = flag;
    if ((flag & 0x0f) !== 0) return;
    let next = (flag - 0x10) & 0xff;
    if (next === 0) {
      t.alive = false; t.flag = 0;
      if (t.team === "ATT") this._onEnemyDead(t); else this._onPlayerDead(t);
      return;
    }
    next = next === 0x10 ? (next | 0x06) : (next | 0x03);
    t.flag = next;
  }

  // follow flags (enemies only): set the direction, don't move.
  _statusFollow(t: any, hi: number) {
    if (hi === 0xb0) { t.flag = this._setFollow(t, 0x78, 0xd8); return; }
    if (hi === 0xc0) { t.flag = this._setFollow(t, this.p2.x, this.p2.y); return; }
    t.flag = this._setFollow(t, this.p1.x, this.p1.y);
  }

  // 0x80 pause (sub_DB75 could set 0x80 when there is no input).
  _statusPause(t: any, f: number) {
    // sub_DC52-DC68: on ice the player in the 0x80 state SLIDES — straight to loc_DC97.
    if (t.team === "DEF" && (this.plrFlags[t.index] & 0x80) !== 0) {
      const dir = f & 3;
      t.dir = dir;
      const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
      if (n) { t.x = n.x; t.y = n.y; }
      t.flag = movingFlag(dir);
      return;
    }
    t.flag = (f - 4) & 0xff;
    if ((t.flag & 0x0c) === 0) t.flag = movingFlag(t.flag & 3);
  }

  // 0x90 turn.
  _statusTurn(t: any, f: number, netDir: any) {
    if (t.team === "DEF") {
      if (netDir !== null) { t.dir = netDir; t.flag = movingFlag(netDir); }
      return;
    }
    const d = f & 3;
    // sub_E72 is called only when rng&1==0 (RNG is consumed always).
    if ((this.rng(`t90a${t.index}`) & 1) === 0) {
      if (netDir !== null) { t.dir = netDir; t.flag = movingFlag(netDir); return; } // sub_DE72_patched
      const target = this._pickFollowFlag(t);
      if (target !== null) t.flag = (t.flag & 3) | target; // sub_E420 keeps the direction
      return;
    }
    t.flag = movingFlag((this.rng(`t90b${t.index}`) & 1) === 0 ? ((d + 3) & 3) : ((d + 1) & 3));
  }

  // 0xA0 movement.
  _statusMove(t: any, f: number, netDir: any) {
    // DEF: the direction is set by _defInput (sub_DB75); here movement only (sub_DC97).
    if (t.team === "DEF") {
      const dir = f & 3;
      t.dir = dir;
      const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
      if (n) { t.x = n.x; t.y = n.y; t.flag = movingFlag(dir); this._emit({ op: "move", tank: t.index, x: t.x, y: t.y }); }
      else { t.flag = movingFlag(dir); } // blocked: the player holds the direction
      return;
    }
    const dir = f & 3;
    t.dir = dir;
    if ((t.x & 7) === 0 && (t.y & 7) === 0 && (this.rng(`tA0${t.index}`) & 0x0f) === 0) {
      if (netDir !== null) { t.dir = netDir; t.flag = movingFlag(netDir); return; }
      const target = this._pickFollowFlag(t);
      if (target !== null) t.flag = (t.flag & 3) | target; // sub_E420 keeps the direction
      return; // retarget without movement
    }
    const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
    if (n) { t.x = n.x; t.y = n.y; t.dir = dir; t.flag = movingFlag(dir); this._emit({ op: "move", tank: t.index, x: t.x, y: t.y }); return; }
    if ((this.rng(`blk${t.index}`) & 3) === 0) {
      const nd = (dir + 2) % 4; t.dir = nd;
      t.flag = ((t.x & 7) === 0 && (t.y & 7) === 0) ? (0x90 | nd) : movingFlag(nd);
    } else {
      t.flag = standingFlag(dir);
    }
  }

  // =====================================================================
  // C) enemy fire (sub_E162) + bullet creation (sub_E08C)
  // =====================================================================
  _fireEnemy(t: any) {
    const b = this.bullets[t.index];
    if (b.alive) return; // slot busy — a bullet already exists
    const dir = t.flag & 3;
    b.alive = true; b.owner = t.index; b.team = t.team; b.dir = dir;
    b.x = t.x + DX[dir] * 8; b.y = t.y + DY[dir] * 8;
    // sub_E08C: property 0 for types 0x00/0x80/0xA0/0xE0 (bullet collision gate),
    // property 1 for 0xC0/0x20/0x40, property 3 for 0x60.
    const tb = t.type & 0xf0;
    b.property = tb === 0xc0 ? 1 : (tb === 0x60 ? 3 : 0);
    // re-fire: reset the leftover explosion/sync from the bullet's previous life (otherwise
    // _moveBullets will skip the fresh bullet as "exploding" and it won't move).
    b.explode = 0; b.synced = false; b.fresh = true; // bullet created this frame
    this._emit({ op: "fire", tank: t.index, x: b.x, y: b.y, dir });
  }

  // Player (DEF) shot — the same sub_E08C, but slots 0,1 and the player type.
  _fireDef(t: any) {
    const b = this.bullets[t.index];
    if (b.alive) return; // slot busy
    const dir = t.flag & 3;
    b.alive = true; b.owner = t.index; b.team = "DEF"; b.dir = dir;
    b.x = t.x + DX[dir] * 8; b.y = t.y + DY[dir] * 8;
    const tb = (t.type ?? 0) & 0xf0;
    b.property = tb === 0xc0 ? 1 : (tb === 0x60 ? 3 : 0);
    b.explode = 0; b.synced = false; b.fresh = true;
    this._emit({ op: "def_fire", tank: t.index, x: b.x, y: b.y, dir });
  }

  // Player death: ROM (sub_DE07): lives--, if any remain — respawn, otherwise dead.
  // Lives/respawn of dead DEF tanks are managed by _defLifecycle (PvP layer pvp.js).
  _onPlayerDead(t: any) {
    const idx = t.index;
    this.c.lives = this.c.lives ?? [3, 3];
    this.c.lives[idx] = (this.c.lives[idx] ?? 3) - 1;
    // the emulator resets ram_plr_stun_timer on player death (sub_DE46) — otherwise
    // the stun survives death+respawn and blocks the reborn tank (st2 scan f1303).
    t.stun = 0;
    if (this.c.lives[idx] > 0) {
      t.alive = true; t.flag = 0xf0; // respawn (sub_E363_tank_spawn_handler)
      t.x = PLAYER_SPAWN_X[idx]; t.y = PLAYER_SPAWN_Y[idx];
      t.type = 0;
    } else {
      t.alive = false; t.flag = 0;
    }
    this._emit({ op: "player_dead", tank: idx, lives: this.c.lives[idx] });
  }

  // Sub-cell of the tile for a bullet position (sub_D725): 1,2,4,8 by (x&4, y&4).
  _bulletSub(bx: number, by: number) { return 1 << (((by & 4) ? 2 : 0) + ((bx & 4) ? 1 : 0)); }
  // Tile collision in the sub-cell (sub_D73C + sub_E69A): eagle/HQ (0xC8-0xCB) blocks
  // (sub_E69A: eagle check BEFORE CMP #$12); tiles >= 0x12 (road/ice) the bullet passes
  // (sub_E69A: CMP #$12; BCS); only < 0x12 blocks/destroys.
  _tileSolid(tile: number, bx: number, by: number) {
    if ((tile & 0xfc) === 0xc8) return true; // eagle/HQ
    return tile !== 0 && tile < 0x12 && (tile & (0xf0 | this._bulletSub(bx, by))) !== 0;
  }

  // =====================================================================
  // C) bullets: movement (sub_E604), bullet-vs-bullet (E910), bullet-vs-tank (E70C)
  // =====================================================================
  // Bullet collision gate (sub_E604): property-0 bullets are checked only on their "own" frames.
  _bulletGate(b: any) {
    const lo = this._rngLo ?? (this.frame & 0xff);
    return b.property === 0 && ((b.slot ^ lo) & 1) === 0;
  }
  // Bullet movement (sub_E604). Three policies:
  //   observed (synced) — a DEF bullet is synced to the emulator's end-of-frame position: collision only;
  //   fresh — the firing frame: does not move, but collision is checked;
  //   moving — normal step: movement + collision.
  _moveBullets() {
    for (const b of this.bullets) {
      if (!b.alive || b.explode) continue;
      const gated = this._bulletGate(b);
      if (b.synced) { this._collideBullet(b, gated); continue; }
      if (b.fresh) { b.fresh = false; this._collideBullet(b, gated); }
      else { this._moveBullet(b, gated); }
    }
  }
  _moveBullet(b: any, gated: boolean) {
    const speed = (b.property & 0x01) ? 4 : 2;
    b.x += DX[b.dir] * speed; b.y += DY[b.dir] * speed;
    // The emulator stores the bullet position in 8 bits (sub_E063: ADC/SBC) — off-screen a bullet
    // WRAPS (0-255) rather than deactivating. The simulator previously did not wrap and
    // considered a departed bullet "outside the field" (slot busy forever) — diverging from the emulator.
    b.x &= 0xff; b.y &= 0xff;
    this._collideBullet(b, gated);
  }
  _collideBullet(b: any, gated: boolean) {
    if (!gated && this._bulletCollide(b, b.x, b.y)) b.explode = 9;
  }
  _bulletExplodeTick() {
    for (const b of this.bullets) {
      if (!b.alive || !b.explode) continue;
      b.explode--;
      if (b.explode === 0) b.alive = false;
    }
  }
  // Bullet collision with a tile: exact port of sub_E604. The bullet is checked at 4 positions
  // along the perpendicular axis (offsets +4*c, -c, -5*c from the current one, where c is the collision
  // speed from tbl_EA4D/tbl_EA49). At each hit position sub_E69A/sub_D743 removes
  // ONE tile quadrant (tile & ~quadrant), or destroys it entirely when property bit1.
  // Checks 1a/3 are performed only if the previous one (1/2) hit a tile (ASM gate).
  _bulletCollide(b: any, x: number, y: number) {
    // sub_E604: ram_0055/0054 = |tbl_EA4D/tbl_EA49[dir]| (magnitude of the collision speed on the
    // perpendicular axis, always 1), the sign is set explicitly in the offsets +4/-1/-5.
    const mx = (b.dir === 0 || b.dir === 2) ? 1 : 0; // sweep over X (up/down)
    const my = (b.dir === 1 || b.dir === 3) ? 1 : 0; // sweep over Y (left/right)
    const hit1 = this._checkBulletPos(b, x, y);
    if (hit1) this._checkBulletPos(b, x + mx * 4, y + my * 4);
    const hit2 = this._checkBulletPos(b, x - mx, y - my);
    if (hit2) this._checkBulletPos(b, x - mx * 5, y - my * 5);
    return hit1 || hit2;
  }
  // Check bullet collision at one position (px,py); on a hit removes a quadrant.
  // Positions wrap in 8 bits, as in the emulator (sub_E604 uses ADC/SBC):
  // off-field bullets and perpendicular sweep positions read the wrapped tile.
  _checkBulletPos(b: any, px: number, py: number) {
    const x = px & 0xff, y = py & 0xff;
    const c = x >> 3, r = y >> 3;
    const v = this.field[r * FIELD + c];
    if (!this._tileSolid(v, x, y)) return false;
    if ((v & 0xfc) === 0xc8) { this._destroyHQ(); return true; }
    if (isBrick(v)) {
      // sub_E69A bra_E6EB: property bit1 -> full destruction; otherwise sub_D743 (quadrant).
      this.field[r * FIELD + c] = (b.property & 2) ? 0 : (v & ~this._bulletSub(x, y));
    }
    return true;
  }
  _bulletVsBullet() {
    const list = this.bullets.filter((b) => b.alive && !b.explode);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], bb = list[j];
      if (a.team === bb.team) continue;
      // sub_E910: two oncoming bullets mutually annihilate — both get status 0x00
      // (the slot is freed IMMEDIATELY, NOT explosion 0x33/9 frames). The previous explode=9 kept
      // the DEF bullet slot busy for 9 frames — re-fire was delayed by frames (ai-verify).
      if (Math.abs(a.x - bb.x) < 6 && Math.abs(a.y - bb.y) < 6) { a.alive = false; bb.alive = false; }
    }
  }
  // sub_E70C: bullet-vs-tank. Two passes, like in ASM:
  //  1) enemy bullets (slots 2-7) vs player tanks (0,1): helmet (helmet) extinguishes the bullet
  //     without damage; otherwise a player explosion 0x73 and reset of its type.
  //  2) player bullets (slots 0,1) vs enemies (2-7): bonus on hitting a flashing one (type&0x04),
  //     armor (type&0x03) -> DEC type (enemy alive), otherwise an enemy explosion 0x73.
  _bulletVsTank() {
    // pass 1: enemy bullets against DEF tanks
    // sub_E70C E721-E772: for each tank ALL bullets 7..2 are checked (no break) —
    // several enemy bullets hitting the same DEF tank in a frame all get a status.
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue;
      for (const b of this.bullets) {
        if (!b.alive || b.explode || b.team === "DEF") continue;
        if (Math.abs(b.x - t.x) < 10 && Math.abs(b.y - t.y) < 10) {
          if (t.helmet) { b.alive = false; continue; } // helmet -> bullet 0x00 (E757-E759)
          // without a helmet (E74E-E76A): bullet -> 0x33 (9 frames), tank -> 0x73
          b.explode = 9; t.flag = 0x73; t.type = 0; this._emit({ op: "player_hit", tank: t.index });
        }
      }
    }
    // pass 2: player bullets against enemies
    for (const b of this.bullets) {
      if (!b.alive || b.explode || b.team !== "DEF") continue;
      for (const t of this.tanks) {
        if (t.team !== "ATT" || !t.alive) continue;
        if (!movementRange(t.flag)) continue;
        if (Math.abs(b.x - t.x) < 10 && Math.abs(b.y - t.y) < 10) {
          b.explode = 9; // bullet into a 9-frame explosion (sub_E70C: bullet -> 0x33), not instantly
          this._hitEnemy(t);
          break;
        }
      }
    }
    // pass 3 (sub_E70C E843-E8B5): player bullets (slots 0,1) against the OTHER player's tank
    // (cross friendly-fire). The bullet always goes into a 0x33 explosion; a tank with a helmet
    // is unharmed (bullet -> 0x00); otherwise, if no stun is already active — stun 0xC8.
    for (let pi = 1; pi >= 0; pi--) {
      const tank = this.tanks.find((x) => x.index === pi);
      if (!tank || tank.team !== "DEF" || !tank.alive) continue;
      if (!movementRange(tank.flag)) continue;
      for (const b of this.bullets) {
        if (!b.alive || b.explode || b.team !== "DEF") continue;
        if (b.slot === pi) continue; // EOR player^bullet: only the other player's bullet
        if (Math.abs(b.x - tank.x) < 10 && Math.abs(b.y - tank.y) < 10) {
          b.explode = 9;             // bullet -> 0x33 (E88F)
          if (tank.helmet) { b.alive = false; break; } // helmet -> 0x00 (E898-E89A)
          if ((tank.stun ?? 0) === 0) tank.stun = 0xc8; // stun_timer (E8AA-E8AC)
          break;
        }
      }
    }
  }
  // Player bullet hitting an enemy (sub_E7AA..E7F2): bonus on hitting a flashing one,
  // armor (type&3) withstands several hits, a normal one goes into an explosion.
  _hitEnemy(t: any) {
    if ((t.type & 0x04) !== 0) {
      // flashing enemy -> a prize IMMEDIATELY on the hit (sub_E8BE). If _spawnBonus deferred it
      // (pathological retry of sub_E8BE, crossed a frame boundary) — the tank death is also
      // deferred until the retry completes (on the next frame), like in the emulator.
      if (this._spawnBonus(t)) return;
      if (t.type === 0xe4) t.type--;   // 0xE4 -> 0xE3 (clear the flash bit, sub_E7DA)
    }
    if ((t.type & 0x03) !== 0) { t.type--; this._emit({ op: "hit", tank: t.index }); }
    else { t.flag = 0x73; }            // normal: start of the explosion (con_tank_flag_explosion+3)
  }
  // HQ/eagle destruction (sub_CC08_draw_destroyed_eagle): a bullet hit the eagle (0xc8-0xcb).
  _destroyHQ() {
    for (const [row, col, tile] of EAGLE_DESTROYED_TILES) this.field[row * 32 + col] = tile;
    this.c.gameOver = 1;
    this._emit({ op: "hq_destroyed" });
  }
  _onEnemyDead(t: any) {
    this.c.enemiesLeft = (this.c.enemiesLeft || 0) - 1;
    this._emit({ op: "enemy_dead", tank: t.index });
  }
  // One "frame budget" of the sub_E8BE retry (the number of retries that fit in one emulator
  // NMI frame, ~48). After the budget is exhausted the emulator aborts the NMI and the frame advances.
  static BONUS_RETRY_PER_FRAME = 48;

  // Prize spawn (sub_E8BE): consumes RNG like the emulator.
  //
  // Pathological case: the prize always lands on a stationary DEF tank (e.g. (96,192)
  // on tank0 (88,191)) — sub_E8BE retries WITHOUT success. In the emulator this loop is not infinite,
  // but is cut off by NMI: each frame (~48 retries) advances ram_frm_cnt, and when $0A/$0B change
  // the deterministic PRNG breaks the "dead-end" position loop, after which the retry
  // finds a free cell. In this case the pass-2 CALL itself (and the tank death) moves to
  // the next frame (sub_C2E6 does not finish in the hit frame).
  //
  // Port: _spawnBonus performs up to BONUS_RETRY_PER_FRAME retries. If a cell is found —
  // spawns the prize and returns false (done). If the budget is exhausted without success —
  // defers: advances frame (breaks the RNG loop), sets _pendingBonus and returns
  // true. Completion (prize + enemy death) happens at the start of the next step().
  _spawnBonus(tank: any) {
    if (this._pendingBonus) throw new Error("_spawnBonus already pending"); // invariant
    if (this._tryBonusPlacement()) return false;
    this.advanceFrame();
    this._rngLo = this.frame & 0xff;
    this._pendingBonus = { tank };
    return true;
  }
  // Continue the deferred retry at the start of the next frame (the emulator resumes
  // sub_E8BE after NMI). Returns true if the prize is still not found (deferred again).
  _continuePendingBonus() {
    if (!this._pendingBonus) return;
    if (this._tryBonusPlacement()) {
      // prize found -> finish the deferred enemy death (sub_E7DA..E7F5)
      const { tank } = this._pendingBonus;
      this._pendingBonus = null;
      if (tank.type === 0xe4) tank.type--;
      if ((tank.type & 0x03) !== 0) { tank.type--; this._emit({ op: "hit", tank: tank.index }); }
      else { tank.flag = 0x73; }
    } else {
      // still on the tank -> advance the frame again and defer (emulator NMI cutoff)
      this.advanceFrame();
      this._rngLo = this.frame & 0xff;
    }
  }
  // Up to BONUS_RETRY_PER_FRAME prize-position retries. true — a cell was found and the prize was spawned.
  _tryBonusPlacement() {
    const TBL = BONUS_ID_TABLE; // tbl_E8FA
    for (let i = 0; i < BattleSim.BONUS_RETRY_PER_FRAME; i++) {
      let posX = this.rng() & 3;
      let posY = this.rng() & 3;
      posX = bonusPosFromRng(posX); // sub_E902: A=0->0x30,1->0x60,2->0x90,3->0xC0
      posY = bonusPosFromRng(posY);
      if (!this._bonusOnTank(posX, posY)) { // sub_E972: if on a player -> retry
        const id = TBL[this.rng() & 7];
        this.prize = { id, x: posX, y: posY };
        this._emit({ op: "bonus_spawn", id, x: posX, y: posY });
        return true;
      }
    }
    return false;
  }
  _bonusOnTank(x: number, y: number) {
    // sub_E972: players only (DEF 0,1) in the movement range (not explosion/respawn)
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue;
      if (Math.abs(t.x - x) < 0x0c && Math.abs(t.y - y) < 0x0c) return true;
    }
    return false;
  }

  // =====================================================================
  // C) enemy spawn (sub_DB48 + sub_E363) and type by stage (sub_E3CB)
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
      // sub_E363: INC spawn_pos_index (reset at 3->0) BEFORE use
      this.c.spawnPosIndex = (this.c.spawnPosIndex + 1) % 3;
      tank.x = ENEMY_SPAWN_X[this.c.spawnPosIndex]; tank.y = ENEMY_SPAWN_Y;
      tank.flag = 0xf0;                     // always 0xF0 (a bonus is marked by type 0x04)
      tank.type = bonus ? 0x04 : 0;          // sub_E363: type=0/0x04 during respawn
      if (!this.tanks.includes(tank)) this.tanks.push(tank);
      this.c.spawnCount--;
      this.c.spawnTimer = this.c.spawnInterval;
      // Erase the enemy icon in the field (sub_DB48 -> sub_C8B1_erase_enemy_icon):
      // icon position index = spawnCount (after decrement): col=(i&1)+29, row=(i>>1)+3,
      // writes the gray/steel tile 0x11 (tbl_D36B_tile___gray).
      this._eraseEnemyIcon(this.c.spawnCount);
      this._emit({ op: "spawn", tank: idx, x: tank.x, y: tank.y, type: tank.type });
      return;
    }
  }
  // sub_C894_calculate_enemy_icon_pos + tbl_D36B_tile___gray: erase enemy icon i.
  _eraseEnemyIcon(i: number) {
    const col = (i & 1) + 29;
    const row = (i >> 1) + 3;
    if (row >= 0 && row < 32 && col >= 0 && col < 32) this.field[row * 32 + col] = ENEMY_ICON_ERASE_TILE;
  }
  // Enemy type by the stage type counters (sub_E3CB): scans from type_offset the first
  // type with a nonzero remainder, decrements it, combines with the bonus bit 0x04 (type during
  // respawn). sub_E3CB: 0xE0 (armored) spawns with 3 armor -> 0xE3; type 0xE7
  // (armor+flash) becomes 0xE4. Called at E0->A2 (sub_E3B8).
  _pickType(t: any) {
    const o = this.c.typeOffset ?? 0;
    const bonus = (t.type & 0x04);
    const vals = STAGE_TYPE_VALUES[this.c.stage] || DEFAULT_TYPE_VALUES;
    for (let i = 0; i < 4; i++) {
      const idx = (o + i) % 4;
      if (this.typeCnt[idx] > 0) {
        this.typeCnt[idx]--;
        this.c.typeOffset = (o + i) % 4;
        let v = vals[idx];                     // tbl_E4EC: type value by stage
        if (v === 0xe0) v = 0xe3;              // sub_E3CB: 0xE0 -> ORA #$03 (armor)
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
  // C) prizes (sub_E972) — pickup + effect (simplified: not spawn from an enemy)
  // =====================================================================
  _bonus() {
    if (!this.prize) return;
    for (const t of this.tanks) {
      if (t.team !== "DEF" || !t.alive) continue;
      if (!movementRange(t.flag)) continue; // sub_E972: moving only (not explosion/respawn)
      if (Math.abs(t.x - this.prize.x) < 12 && Math.abs(t.y - this.prize.y) < 12) {
        this._applyPrize(this.prize.id);
        this.prize = null;
        return;
      }
    }
  }
  _applyPrize(id: number) {
    if (id === 4) { for (const t of this.tanks) if (t.team === "ATT" && t.alive && movementRange(t.flag)) { t.flag = 0x73; t.type = 0; } } // grenade (EA17)
    else if (id === 1) { this.c.clock = 0x0a; } // clock (E9F5): freeze, timer 0x0A
    else if (id === 2) { this._fortifyBase(); this.c.shovelTimer = 0x14; } // shovel (E9FB)
    this._emit({ op: "prize", id });
  }
  // Freeze timer (clock, sub_DBF1 DC00): decrement every 64 frames.
  _clockHandler() {
    if (!this.c.clock) return;
    if ((this.frame & 0x3f) === 0) { this.c.clock--; }
  }
  // Shovel/fortification: steel shield around the HQ (sub_CB9E_draw_protected_base).
  // Steel 0x10 on the FORTIFY_CELLS cells; the eagle C8-CB remains.
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
  // Shovel timer (sub_E2A9): decrement every 64 frames; on expiry restore the base.
  _shovelHandler() {
    if (!this.c.shovelTimer) return;
    if ((this.frame & 0x3f) === 0) {
      this.c.shovelTimer--;
      if (this.c.shovelTimer <= 0) { this._restoreBase(); this.c.shovelTimer = 0; }
    }
  }
  // Helmet timer (sub_E27C_players_invincibility_handler): decrement every 64
  // frames; at 0 the helmet goes out and the player tank is vulnerable. Previously helmet=3 was set
  // on respawn but never removed -> the DEF tank was immortal and did not enter the explosion state.
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
  // DEF tank lifecycle in the PvP layer (pvp.js), outside the ROM:
  //  1) lives are reset to 3 on depletion (mem[0x51+t]===0 -> 3);
  //  2) dead DEF tanks (flag 0) respawn every 30 frames (defFrame%30==0),
  //     resetting type/position/stun and setting the respawn flag 0xf0.
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
  // One frame (sub_C2E6 order, enemy side)
  // =====================================================================
  // Two-phase in-frame $0B for RNG (see rng()): the "move" phase uses the pre-reset
  // gateFrmLo (the emulator reads $0B in sub_DBF1 before the reset in sub_DE46), the "fire" phase — 0
  // (post-reset). Sets this._rngLo, which rng() uses as lo.
  _beginRngPhase(phase: any) {
    this._rngPhase = phase;
    this._rngLo = phase === "move" ? (this.c.gateFrmLo ?? this.c.frmCntLo) : (this.frame & 0xff);
  }

  // Tank movement: indices 7..0 (RNG order matters!).
  _tanksMovePhase(gateFrmLo: number, clock: number) {
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
  }

  // Fire phase: enemies (RNG or net-fire) and DEF by the A edge (edge-trigger).
  _firePhase() {
    for (let i = 7; i >= 2; i--) {
      const t = this.tanks.find((x) => x.index === i);
      if (!t || !movementRange(t.flag)) continue;
      if (this._netFire(i)) this._fireEnemy(t);
      else if (this.rng(`fire${i}`) === 0) this._fireEnemy(t);
    }
    for (let i = 1; i >= 0; i--) {
      const t = this.tanks.find((x) => x.index === i);
      if (!t || t.team !== "DEF" || !movementRange(t.flag)) continue;
      const fire = this._defFire(i);
      if (fire && !this._prevDefFire[i]) this._fireDef(t);
      this._prevDefFire[i] = fire;
    }
  }

  step() {
    this.events = [];
    this.c.frmCntLo = this.frame & 0xff;
    this.c.frmCntHi = (this.frame >> 8) & 0xff;
    const clock = this.c.clock || 0;
    // frmLo for the movement gate: when $0B is reset mid-frame the emulator managed to
    // read the old counter in sub_DBF1, while the RNG already used the reset one. This gives consistency.
    const gateFrmLo = this.c.gateFrmLo ?? this.c.frmCntLo;

    // movement phase: RNG reads pre-reset $0B (the emulator in sub_DBF1 before the reset in sub_DE46)
    this._beginRngPhase("move");

    // 0) continue the deferred prize retry (sub_E8BE, crossed a frame boundary):
    //    the emulator after NMI resumes the tail of pass-2 (prize + enemy death) BEFORE the new
    //    sub_C2E6 frame. It uses the new frame (NMI has already advanced $0A/$0B).
    this._continuePendingBonus();

    // 0) DEF tank lifecycle (pvp.js): reset lives and respawn the dead every 30 frames
    this._defLifecycle();

    // 1) tank markers (sub_E181) — by flag (movementRange inside _setMarker)
    for (const t of this.tanks) this._setMarker(t);

    // 1a) ice (sub_E181_ice_detection) and player input (sub_DB75) — BEFORE movement (sub_DBF1)
    this._iceDetection();
    this._defInput();

    // 2) tank movement (sub_DBF1): indices 7..0 (RNG order matters!)
    this._tanksMovePhase(gateFrmLo, clock);

    // 3) clear markers (sub_E1FA) — the same positions where they were set (before movement)
    this._clearMarkers();

    // bullet explosion (sub_E02E/sub_E076) — decrement BEFORE the fire phase (sub_E162): the slot frees
    // in time, otherwise re-fire is delayed by a frame (emulator: sub_E02E before sub_E162).
    this._bulletExplodeTick();

    // player helmet (sub_E27C) — decrement every 64 frames BEFORE the bullet-vs-tank check
    this._helmetHandler();

    // fire/bullet phase: if the game reset $0B to 0 (sub_DE46), the RNG reads 0.
    this._beginRngPhase("fire");

    // 4) fire (sub_E162 enemies, A button for DEF)
    if (clock === 0) this._firePhase();

    // 5) spawn (sub_DB48)
    this._spawnEnemy();

    // 6) bullets: movement, bullet-vs-bullet, bullet-vs-tank
    this._moveBullets();
    this._bulletVsBullet();
    this._bulletVsTank();

  // 7) prizes
  this._bonus();
  // shovel/fortification (sub_E2A9) — decrement the timer and restore the base
  this._shovelHandler();
  // clock/freeze (sub_DBF1 DC00) — decrement the timer every 64 frames
  this._clockHandler();

  return this.events;
  }
}
