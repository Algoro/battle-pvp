// sim/engine.js — FRAME-IDENTICAL simulation of the emulator on semantic events.
//
// Architecture: in one frame the engine processes tanks/bullets/field and EMITS events
// that exactly repeat the emulator logic. AI and tests subscribe to the events instead of
// building their own models. This gives determinism and frame-by-frame correspondence
// with the emulator.
//
// Events (semantics):
//   { type:"tankMoved",       tank, x, y }
//   { type:"bulletFired",     tank, x, y, dir }
//   { type:"bulletMoved",     bullet, x, y }
//   { type:"bulletHitBrick",  bullet, col, row, tileBefore, tileAfter }
//   { type:"brickDestroyed",  col, row }
//   { type:"bulletHitTank",   bullet, target }
//   { type:"tankDestroyed",   tank }
//   { type:"bulletDestroyed", bullet }
//
// The deterministic part (without enemy RNG): tank movement via canLead,
// bullets at 2px/frame, brick destruction via brickHit. Enemy AI/spawn/RNG —
// is connected by a separate RNG provider (see README: we patch the emulator RNG).
import { FIELD, TILE, DX, DY, cellPassable, isBrick, brickHit } from "../model/game-view.ts";
import { canLead } from "./sim-model.ts";

export const BULLET_SPEED = 2; // px/frame (calibrated)

export class GameSim {
  declare field: any;
  declare tanks: any[];
  declare bullets: any[];
  declare events: any[];
  declare rng: () => number;
  declare frame: number;
  // state: { field, tanks: Map<index,{x,y,dir,team,type}>, bullets: [...] }
  // rng: ()=>0..255 — RNG provider (as injected into the emulator sub_D44D).
  constructor(state: any, rng: () => number = () => 0) {
    this.field = state.field;              // Uint8Array 1024 (copy)
    this.tanks = state.tanks ?? [];        // array
    this.bullets = state.bullets ?? [];    // array {tank, x, y, dir, team}
    this.events = [];
    this.rng = rng;                        // deterministic RNG (the same as in the emulator)
    this.frame = 0;                        // frame counter (synchronized with the emulator)
  }

  setRng(fn: () => number): this { this.rng = fn; return this; }

  _emit(e: any): void { this.events.push(e); }

  // --- Enemy navigation (port of sub_DDA2 + tbl_E486) ---
  // Direction to the target (destX,destY) via the relative-position table.
  // For ENEMIES always the base index (idx 0..8); the random table (+9) — only
  // for players (in ASM branch loc_DDDB; for an enemy bra_DDE4 goes to the base index).
  _sign(v: number): number { return v < 0 ? -1 : v > 0 ? 1 : 0; }
  _navigate(t: any, destX: number, destY: number) {
    const TBL = [0,0,0, 1,0,3, 2,2,2];
    const sx = this._sign(destX - t.x), sy = this._sign(destY - t.y);
    const idx = 3 * (sy + 1) + (sx + 1);
    return { dir: TBL[idx], flag: 0xa0 | TBL[idx] };
  }

  // --- Follow-flag choice (port of sub_DE72, original AI) ---
  // Returns the follow flag: 0xB0=HQ, 0xC0=p2, 0xD0=p1, or null = keep the current
  // direction (ASM: sub_net_enemy_dir_store without network input simply RTS).
  // Logic (DE75..DEA5):
  //   half   = interval>>2
  //   quarter= interval>>3
  //   if half  < frmCntHi -> follow HQ
  //   elif quarter < frmCntHi -> follow p1/p2 (by aliveness and index parity)
  //   else -> keep current
  _pickFollowFlag(t: any, state: any) {
    const half = state.interval >> 2;
    if (half < state.frmCntHi) return 0xb0;              // follow HQ
    const quarter = state.interval >> 3;
    if (quarter < state.frmCntHi) {
      // DE8E: follow p2/p1
      if (!state.p1Alive) return 0xc0;                   // p1 dead -> follow p2
      if ((t.index & 1) === 0) return 0xd0;              // even index -> p1
      return state.p2Alive ? 0xc0 : 0xd0;                // odd: p2 alive? p2 : p1
    }
    return null;                                         // keep current direction
  }

  // Following: set the direction toward the point (via sub_DDA2) and return flag A0|dir.
  _setFollow(t: any, destX: number, destY: number) {
    const nav = this._navigate(t, destX, destY);
    t.dir = nav.dir;
    return nav.flag;
  }

  // Subpixel gate (sub_DBF1 DC18-DC38 for enemies): on which frames the enemy
  // status handler runs at all. clock — freeze timer (clock). When clock==0:
  //   type==0xA0 (power) — always; otherwise only when (index ^ frm_cnt_lo) & 1 != 0.
  _enemyGate(t: any, state: any): boolean {
    const clock = state.clock ?? 0;
    const hi = t.flag & 0xf0;
    let reach = true;
    if (clock !== 0) {
      // DC1D/DC21/DC23: a frozen enemy in the moving state (0x80-0xD0) doesn't move;
      // explosion (bit7=0) and respawn (>=0xE0) keep ticking.
      if ((t.flag & 0x80) !== 0 && hi < 0xe0) reach = false;
    }
    if (reach && (t.type & 0xf0) !== 0xa0) reach = ((t.index ^ state.frmCntLo) & 1) !== 0;
    return reach;
  }

  // --- Enemy step: exact port of the flag machine (sub_DBF1 -> sub_DC3D -> tbl_E498) ---
  // state: { frmCntLo, frmCntHi, interval, p1x,p1y,p2x,p2y,p1Alive,p2Alive, clock }
  stepEnemy(t: any, state: any): boolean {
    if (t.team !== "ATT") return false;
    if (!this._enemyGate(t, state)) return false;         // status handler does not run
    const f = t.flag ?? 0xa0;
    const hi = f & 0xf0;

    // RESPAWN (0xF0, ofs_DE55): the flag grows; at low nibble 0x0E -> 0xE0
    if (hi === 0xf0) {
      t.flag = f + 1;
      if ((t.flag & 0x0f) === 0x0e) t.flag = 0xe0;
      return false;
    }
    // E0 (ofs_DE64): at low nibble 0x0E -> sub_E3B8: for an enemy the flag = tbl_E47E[X] = 0xA2
    if (hi === 0xe0) {
      t.flag = f + 1;
      if ((t.flag & 0x0f) === 0x0e) {
        t.flag = 0xa2;                                    // tbl_E47E[2..7] = 0xA2 (down)
        this._emit({ op: "enemy_active", tank: t.index });
      }
      return false;
    }
    // EXPLOSION (0x10-0x70, ofs_DDEA): the flag is a counter; low nibble 0 -> -0x10, at 0 dead
    if (hi >= 0x10 && hi <= 0x70) {
      const flag = f - 1;
      t.flag = flag;
      if ((flag & 0x0f) !== 0) return false;
      let next = (flag - 0x10) & 0xff;
      if (next === 0) { t.alive = false; t.flag = 0; this._emit({ op: "tank_dead", tank: t.index }); return false; }
      next = next === 0x10 ? (next | 0x06) : (next | 0x03);
      t.flag = next;
      return false;
    }
    // follow flags (ofs_DD94/DD89/DD7E): set the direction, do NOT move this frame
    if (hi === 0xb0) { t.flag = this._setFollow(t, 0x78, 0xd8); return false; }  // HQ
    if (hi === 0xc0) { t.flag = this._setFollow(t, state.p2x, state.p2y); return false; } // p2
    if (hi === 0xd0) { t.flag = this._setFollow(t, state.p1x, state.p1y); return false; } // p1

    // 0x80 (ofs_DC52): short pause (flag -= 4), at (flag&0x0C)==0 -> 0xA0
    if (hi === 0x80) {
      t.flag = (f - 4) & 0xff;
      if ((t.flag & 0x0c) === 0) t.flag = 0xa0 | (t.flag & 3);
      return false;
    }
    // 0x90 (ofs_DD48): turn — RNG chooses left/right or retarget
    if (hi === 0x90) {
      const d = f & 3;
      if ((this.rng() & 1) === 0) {                        // bra_DD6A: retarget
        const target = this._pickFollowFlag(t, state);
        if (target !== null) { t.flag = target; this._emit({ op: "enemy_retarget", tank: t.index, flag: target }); }
        return false;
      }
      if ((this.rng() & 1) === 0) t.flag = 0xa0 | ((d + 3) & 3); // bra_DD5E: left (dir-1)
      else t.flag = 0xa0 | ((d + 1) & 3);                      // loc_DD63: right (dir+1)
      this._emit({ op: "enemy_turn", tank: t.index, flag: t.flag });
      return false;
    }
    // 0xA0 (ofs_DC7C): main movement
    if (hi === 0xa0) {
      const dir = f & 3;
      t.dir = dir;
      // at an intersection and RNG&0x0F==0 -> sub_DE72 (retarget). In ASM this ALWAYS
      // ends with a return without moving this frame (DC93 JSR sub_DE72; DC96 RTS),
      // regardless of whether sub_DE72 changed the flag or kept the current direction.
      if ((t.x & 7) === 0 && (t.y & 7) === 0 && (this.rng() & 0x0f) === 0) {
        const target = this._pickFollowFlag(t, state);
        if (target !== null) { t.flag = target; this._emit({ op: "enemy_retarget", tank: t.index, flag: target }); }
        return false;
      }
      // movement (loc_DC97): canLead -> shift 1px, otherwise blocked (turn/pause)
      const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
      if (n) {
        t.x = n.x; t.y = n.y; t.dir = dir; t.flag = 0xa0 | dir;
        this._emit({ type: "tankMoved", tank: t.index, x: t.x, y: t.y });
        return true;
      }
      // blocked (bra_DD11): enemy
      if ((this.rng() & 3) === 0) {                            // bra_DD30: 180° turn
        const nd = (dir + 2) % 4;
        t.dir = nd;
        t.flag = ((t.x & 7) === 0 && (t.y & 7) === 0) ? (0x90 | nd) : (0xa0 | nd);
        this._emit({ op: "enemy_blocked_reverse", tank: t.index, flag: t.flag });
      } else {                                                 // bra_DD1E: pause 0x88|dir
        t.flag = 0x88 | dir;
        this._emit({ op: "enemy_blocked_pause", tank: t.index, flag: t.flag });
      }
    }
    return false;
  }

  // --- Enemy spawn (port of sub_DB48 + sub_E363) ---
  // state: { timer, count, limit, interval, posIndex } — reflects the emulator RAM.
  // Emits event enemySpawned. Returns the index of the spawned tank or -1.
  spawnEnemy(state: any): number {
    if (state.timer > 0) { state.timer--; return -1; }      // timer is still ticking
    if (state.count === 0) return -1;                        // nobody to spawn
    // look for a free enemy slot (index = limit .. 2)
    for (let idx = state.limit; idx >= 2; idx--) {
      const t = this.tanks.find((x) => x.index === idx);
      const empty = !t || t.flag === 0;
      if (!empty) continue;
      // position by the spawn cycle (0,1,2 -> left,center,right)
      const SPX = [0x18, 0x78, 0xd8], SPY = 0x18;
      const px = SPX[state.posIndex], py = SPY;
      state.posIndex = (state.posIndex + 1) % 3;             // INC spawn_pos_index, reset at 3
      // bonus enemy: 4th(0x11), 11th(0x0A), 18th(0x03)
      const bonus = (state.count === 0x11 || state.count === 0x0a || state.count === 0x03);
      const tank = t || { index: idx, team: "ATT", type: 0x80, flag: 0 };
      tank.x = px; tank.y = py; tank.flag = 0xf0;             // respawn
      tank.dir = 2; tank.type = bonus ? 0x84 : (tank.type || 0x80); // bonus|0x04
      if (!this.tanks.includes(tank)) this.tanks.push(tank);
      state.count--;
      state.timer = state.interval;                           // reload timer
      this._emit({ type: "enemySpawned", tank: idx, x: px, y: py, tankType: tank.type });
      return idx;
    }
    return -1;
  }

  // Subpixel movement rate (sub_DBF1): on which frames the tank actually moves.
  //   player:     0.75 px/frame (moves except frame%4==2)
  //   power enemy: 1.0 px/frame (type & 0xF0 == 0xA0)
  //   normal enemy: 0.5 px/frame (when (index ^ frame) & 1 != 0)
  _moveGate(t: any): boolean {
    if (t.team === "DEF" || t.type < 0x80) return this.frame % 4 !== 2;
    if ((t.type & 0xf0) === 0xa0) return true;
    return ((t.index ^ this.frame) & 1) !== 0;
  }

  // Tank movement: 1px in dir if the edge is free and the tank moves this frame.
  // A blocked enemy may turn (sub_DC97 bra_DD30: if rng()&3==0 -> 180°).
  stepTank(t: any, dir: number): boolean {
    if (!this._moveGate(t)) return false; // not a tank step this frame (subpixel)
    const n = canLead(t.x, t.y, dir, this.field) ? { x: t.x + DX[dir], y: t.y + DY[dir] } : null;
    if (n) { t.x = n.x; t.y = n.y; t.dir = dir; this._emit({ type: "tankMoved", tank: t.index, x: t.x, y: t.y }); return true; }
    // blocked
    if (t.type >= 0x80 && (this.rng() & 3) === 0) {
      const nd = (dir + 2) % 4; // 180° (EOR #$02)
      t.dir = nd;
      this._emit({ type: "tankBlocked", tank: t.index, newDir: nd });
    }
    return false;
  }

  // Tank shot: the bullet appears at the tank's FRONT edge (offset 6px).
  fireTank(t: any, dir: number) {
    const ox = dir === 3 ? 8 : dir === 1 ? -8 : 0;
    const oy = dir === 2 ? 8 : dir === 0 ? -8 : 0;
    const px = t.x + ox, py = t.y + oy;
    const b = { tank: t.index, team: t.team, x: px, y: py, dir, alive: true };
    this.bullets.push(b);
    this._emit({ type: "bulletFired", tank: t.index, x: px, y: py, dir });
    return b;
  }

  // One frame: move tanks, move bullets, handle collisions.
  step(): any[] {
    this.events = [];
    // 1) bullets move and collide
    for (const b of this.bullets) if (b.alive) this._moveBullet(b);
    // 2) tanks move (by the given dir; enemies — via AI/RNG)
    //    (here movement only, firing is set by external code)
    this.frame++;
    return this.events;
  }

  _moveBullet(b: any): void {
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
    if (!cellPassable(this.field, c, r)) { this._killBullet(b); return; } // steel/wall
    // bullet-vs-bullet: if an oncoming bullet is in the same cell — both are destroyed
    for (const o of this.bullets) {
      if (o === b || !o.alive || o.team === b.team) continue;
      if (Math.abs(o.x - nx) < 6 && Math.abs(o.y - ny) < 6) {
        this._emit({ type: "bulletHitBullet", a: b.tank, b: o.tank });
        this._killBullet(o);
        this._killBullet(b);
        return;
      }
    }
    // hit on a tank (exact ASM hitbox sub_E70C: |dx|<10 && |dy|<10)
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

  _killBullet(b: any): void { b.alive = false; this._emit({ type: "bulletDestroyed", bullet: b.tank }); }

  // Field state (for verification against the emulator).
  fieldTile(col: number, row: number): number { return this.field[cellIdx(col, row)]; }
}

function cellIdx(c: number, r: number): number { return r * FIELD + c; }
