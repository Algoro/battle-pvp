// PvPNes — deterministic PvP core on top of the jsnes fork.
//
// Extensions over the original:
//  1. Software multiplexer of virtual joystick ports (up to 8 logical).
//     Port 0,1 -> hardware $4016/$4017 (DEF command);
//     Port 2..7 -> the reserved RAM area ram_net_* (ATT command, networked tanks).
//  2. Deterministic save/load state (Uint8Array) — includes the full RAM image
//     (RNG register $0F, $10), APU phases, PPU scanline, controller state.
//  3. stepFrame / saveState / loadState / getFrameHash.
//  4. No Date.now/performance.now/Math.random inside the game loop (determinism).
//
// Input format stepFrame(inputs): inputs = [{port, buttons}, ...],
//   where buttons is a bit mask like con_btn in the ROM:
//   A=$01 B=$02 Select=$04 Start=$08 Up=$10 Down=$20 Left=$40 Right=$80.
import * as nesModule from "./src/nes.js";
import ROM from "./src/rom.js";
import BattleCityPPU from "./ppu-ext.ts";
import BattleCityPAPU from "./papu-ext.ts";
import { applyPatchSet } from "./patching/apply.ts";
import { canonicalFeatures, resolveFeatureRuntimes } from "./patching/registry.ts";
import { effectiveFeatureOptions } from "../shared/features.ts";
import type { FeatureContext, KernelApi } from "./patching/runtime.ts";
import { encodeState, decodeState } from "./io/state-codec.ts";
import { readStage, readStageBlocks, readBlockTiles, readBlockAttribute, STAGE_COUNT, normalizeStage } from "./io/stage-data.ts";
import { stepTank, runtimePassable, DX as TANK_DX, DY as TANK_DY } from "./io/tank-driver.ts";
import { plan, planDefense, resetDefState } from "./ai/tactical-ai.ts";
import { scanPlan } from "./ai/scan-ai.ts";
import { lookaheadPlan } from "./ai/lookahead-ai.ts";
import { strategyDefense } from "./ai/defender-strategy.ts";
import { attackerPlan } from "./ai/attacker-strategy.ts";
import { RAM, ROM as ROM_ADDR, BTN } from "./rom-contract.ts";
import { DIR_BTN, movingFlag, standingFlag, isTankAlive, isTankActive, tankPassable, isBrick, TANK_RESPAWN_FLAG, BULLET, NUM_PLAYERS, DEF_PORTS } from "./domain.ts";
import { createStartup, assertRomContract } from "./startup.ts";
import { Tracer } from "./io/trace.ts";
export { BTN };

// src/nes.d.ts declares only the named export NES, while the runtime module
// src/nes.js provides default. We take default through the namespace object so as
// not to change the import runtime semantics.
const NESBase: any = (nesModule as any).default;

// Direction button by dir index (0=Up,1=Left,2=Down,3=Right) — like con_btn.
// DEF tank spawn positions (player1, player2) — like tbl_E47A/E47C.
const PLAYER_SPAWN_X = [0x58, 0x98];
const PLAYER_SPAWN_Y = [0xd8, 0xd8];

// Attacker AI modes controlled by the JS brain (the rest — ASM or "off").
const ATT_AI_MODES = new Set(["js", "plan", "scan", "lookahead", "strategy-att"]);

export { NUM_PLAYERS, DEF_PORTS };


// Sentinel bullet status for HUMAN tanks to block the ASM RNG fire
// (sub_E162 -> sub_E08C checks "is the bullet slot free?": if status != 0 — it doesn't fire).
// The value 0x01 is safe: in sub_E02E the dispatcher `(status>>3)&0xFE = 0` -> RTS (no-op),
// sub_E604/sub_E910/sub_E70C handle only `(status&0xf0)==0x40`, i.e. the marker is not
// moved, collided, or rendered as a bullet. When A is pressed (RAM.NET_FIRE) the slot
// is freed so the ASM fires by the button.
const HUMAN_BULLET_BUSY = BULLET.BUSY;

// Explosion/beam animation tiles — see features/railgun.ts (shared effect module).

// Strict step of the human tank. ASM (`sub_DC97`) checks only 2 CORNERS of the front
// edge (±8 from the center along the perpendicular) — so when the tank center is NOT on a tile
// boundary (x%8!=0 / y%8!=0), a brick directly ahead at the center is not checked and the tank
// penetrates it. We add a 3rd point — the center of the front edge — so the human
// tank does not drive into walls.
function stepTankStrict(field: any, pos: any, dir: number): any {
  const dx = TANK_DX[dir], dy = TANK_DY[dir];
  const cx = pos.x + dx, cy = pos.y + dy;
  const clamp = (v: number, c: number) => (v >= c ? v - 1 : v);
  const px = clamp(cx + dx * 8, cx);
  const py = clamp(cy + dy * 8, cy);
  const tc = Math.floor(px / 8), tr = Math.floor(py / 8);
  if (tc < 0 || tc >= 32 || tr < 0 || tr >= 32) return null;
  if (!runtimePassable(field[tr * 32 + tc])) return null;
  return stepTank(pos, dir, field, runtimePassable);
}

// Is a SPECIFIC pixel sub-cell solid (accounting for brick quadrants).
// A brick 0x01..0x0F encodes occupied quadrants: bit0=TL, bit1=TR, bit2=BL, bit3=BR.
function solidPixel(mem: any, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > 255 || y > 255) return true;
  const c = x >> 3, r = y >> 3;
  const v = mem[RAM.FIELD + r * 32 + c];
  if (tankPassable(v)) return false;
  if (isBrick(v)) {
    const bit = 2 * ((y & 4) ? 1 : 0) + ((x & 4) ? 1 : 0);
    return (v & (1 << bit)) !== 0;
  }
  return true; // steel / water
}

function fnv1a32(buf: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0; // 32-bit multiply (no precision loss)
  }
  return h;
}

class PvPNes extends NESBase {
  declare _audioSuppressed: boolean;
  declare _startup: any;
  declare prevButtons: Uint8Array;
  declare humanTanks: Set<number>;
  declare humanDefTanks: Set<number>;
  declare _tacticalState: Map<any, any>;
  declare _playerHumanTanks: Set<number>;
  declare _frame: number;
  declare _jsPrev: any[];
  declare _lastPlayerDir: any;
  declare _bulletBefore: any;
  declare _playerFire: any;
  declare _jsDir: any[];
  declare _frameHash: string;
  declare _runtimes: { id: string; runtime: any; ctx: FeatureContext }[];
  declare _featureOrders: Record<string, unknown[]>;
  declare _featureStatus: Record<string, Record<string, any>>;
  declare _kernelApi: KernelApi;
  declare _attAI: string;
  declare _defMode: string;
  declare _aiEvery: number;
  declare _aiDecisions: any;
  declare _rngInjection: any;
  declare _rngIdx: number;
  declare _features: string[];
  declare _defAI: string;
  declare _defState: Map<any, any>;
  declare tracer: any;
  declare _pcHooks: any;
  declare rom: any;
  declare romData: any;
  declare patching: any;

  constructor(opts: any = {}) {
    // Sound is off by default (headless/determinism). Enabled by the options
    // sampleRate (e.g. 48000) + onAudioSample. Audio does not affect getFrameHash.
    super({ emulateSound: false, sampleRate: 0, onAudioSample: null, ...opts });
    // Audio gate: during rollback/resync, frame replay must not re-
    // emit samples (otherwise duplicates/clicks). Controlled from RollbackSession.
    this._audioSuppressed = false;
    const rawAudio = this.opts.onAudioSample;
    this.opts.onAudioSample = rawAudio
      ? (l: number, r: number) => { if (!this._audioSuppressed) rawAudio(l, r); }
      : rawAudio;
    const rawGroup = this.opts.onAudioSampleGroup;
    this.opts.onAudioSampleGroup = rawGroup
      ? (g: string, l: number, r: number) => { if (!this._audioSuppressed) rawGroup(g, l, r); }
      : rawGroup;
    // Declarative startup options (stage/stars) — see startup.js
    this._startup = createStartup(this);
    this.prevButtons = new Uint8Array(NUM_PLAYERS);
    this.humanTanks = new Set(); // human-controlled tanks (AI disabled, JS moves them)
    this.humanDefTanks = new Set(); // DEF tanks for a living player (AI does not play them)
    this._tacticalState = new Map(); // tactical AI state (roles+speeds) between frames
    this._playerHumanTanks = new Set(); // tanks for a LIVING player (setHumanTank) — must not be touched on AI switch
    this._frame = 0; // frame counter (for the respawn/AI rhythm)
    this._jsPrev = []; // previous position of the human tank in the frame
    this._lastPlayerDir = {}; // last player input direction per tank (for holding without AI turning)
    this._bulletBefore = {}; // human tank bullet state before the frame (suppress RNG fire)
    this._playerFire = {}; // whether the player pressed A this frame
    this._jsDir = []; // human tank input direction in the frame
    this._frameHash = "00000000";
    const self: any = this;
    this._runtimes = []; // JS runtimes of active features (features/*), collected in loadROM
    this._kernelApi = {
      get mem() { return self.cpu.mem; },
      get ppuNameTable() { return self.ppu.nameTable; },
      get ppuSpriteMem() { return self.ppu.spriteMem; },
      get ppuVram() { return self.ppu.vramMem; },
      get ppuBuffer() { return self.ppu.buffer; },
      get ppuSpritePalette() { return self.ppu.sprPalette; },
      get playerFire() { return self._playerFire; },
      hasFeature: (id: string) => self.hasFeature(id),
      setAudioSuppressed: (v: boolean) => self.setAudioSuppressed(v),
    } as KernelApi;
    // Attacker AI mode (ATT 2..7): "lookahead" — future prediction (A+D,
    // default), "scan" — full scan, "js" — tactical,
    // "asm" — native ASM AI (JS does not write RAM.NET_DIR/RAM.NET_FIRE for attackers).
    this._attAI = opts?.attAI ?? "lookahead"; // "js"|"plan"=tactical plan, "scan", "lookahead", "asm"=native
    // Defender mode (DEF 0,1): "active" — full AI (default),
    // "stationary" — fire only, "none" — no control.
    this._defMode = opts?.defMode ?? "active";
    // aiEvery: call the attacker brain once every N frames (decision cache) — speeds up
    // headless tests; 1 = every frame (exact behavior).
    this._aiEvery = Math.max(1, opts?.aiEvery ?? 1);
    this._aiDecisions = null;
    // Predictable RNG injection: replaces sub_D44D (generates a random number)
    // with a fixed value/sequence so the emulator and simulator
    // match. value: a number (fixed) or an array (cycle). null — disabled.
    this._rngInjection = null;
    this._rngIdx = 0;
    // Enabled optional features (canonicalized list). See patching/registry.js.
    this._features = canonicalFeatures(opts?.features || []);
    // Defender brain: "plan" — planDefense (default), "scan" / "lookahead" —
    // the same engines as the attackers, but with the role "def".
    this._defAI = opts?.defAI ?? "plan";
    this._defState = new Map();
    // The AI trace is moved to a separate class (io/trace.js).
    this.tracer = new Tracer(opts?.traceCap ?? 500);
  }

  // ROM loading as an extension (we don't touch jsnes.loadROM): load the ORIGINAL,
  // apply the patch set to the in-memory PRG image BEFORE createMapper(), then assemble
  // the system. Only the in-memory image is patched; the file/emulator are unchanged.
  loadROM(data: any): void {
    this.rom = new ROM(this);
    this.rom.load(data);
    if (this.opts.patchSet && !assertRomContract(this.rom)) {
      // Warning: the image does not match the expected Battle City contract.
      if (typeof console !== "undefined") console.warn("[PvPNes] ROM не соответствует rom-contract");
    }
    this.patching = null;
    if (this.opts.patchSet) {
      const spec =
        this.opts.patchSet && typeof this.opts.patchSet === "object" && this.opts.patchSet.base !== undefined
          ? this.opts.patchSet
          : { base: this.opts.patchSet, features: this.opts.features || [] };
      this.patching = applyPatchSet(this.rom, spec);
      this._features = this.patching.features || this._features;
    }
    this.reset();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
    this._buildRuntimes();
  }

  // Collect the JS runtimes of active features (deterministic order) and initialize them.
  _buildRuntimes(): void {
    this._featureOrders = {};
    this._featureStatus = {};
    this._runtimes = resolveFeatureRuntimes(this._features).map(({ id, runtime }) => {
      const featureOptions = (this.opts?.featureOptions ?? {})[id] as Record<string, string | number | boolean> | undefined;
      const ctx: FeatureContext = {
        kernel: this._kernelApi,
        frame: this._frame,
        state: {},
        startOptions: this.opts,
        options: effectiveFeatureOptions(id, featureOptions),
        id,
        orders: (this._featureOrders[id] = []),
        status: (this._featureStatus[id] = {}),
      };
      runtime.init?.(ctx);
      return { id, runtime, ctx };
    });
  }

  // Call the hook on all runtimes in a deterministic order.
  _runRuntimes(hook: "preFrame" | "postFrame" | "render" | "beforeSaveState" | "afterSaveState" | "onLoadState"): void {
    for (const r of this._runtimes) {
      const fn = r.runtime?.[hook];
      if (typeof fn === "function") {
        r.ctx.frame = this._frame;
        fn(r.ctx);
      }
    }
  }

  // After the standard reset() (jsnes creates a new PPU) we install our PPU subclass
  // with the 8x16 sprite fix and headless mode. The other components are upstream.
  reset() {
    super.reset();
    this.ppu = new BattleCityPPU(this);
    this.papu = new BattleCityPAPU(this);
    this._startup?.reinstall();
  }

  /** Whether an optional feature is enabled. */
  hasFeature(id: string): boolean {
    return this._features.includes(id);
  }

  /** The canonical list of enabled features. */
  getFeatures(): string[] {
    return [...this._features];
  }

  // Audio gate: true — onAudioSample is not called (replay during rollback/resync).
  setAudioSuppressed(v: any): void {
    this._audioSuppressed = !!v;
  }

  getAudioSuppressed() {
    return this._audioSuppressed;
  }

  // Set the match's starting stage (1..35). The stage is injected once — at the entry of
  // sub_F000_draw_stage, before data selection (see _installStartStageHook).
  setStartStage(stage: number): any {
    this._startup.setStage(normalizeStage(stage));
    return this;
  }

  // Starting number of stars (tank upgrade) for the DEF team, 0..3.
  // Written to ram_tank_upgrade (port 0 -> $0101, port 1 -> $0102) at match start.
  setStartStars(stars: number): any {
    this._startup.setStars(stars);
    return this;
  }

  // Starting super-weapon "pistol" for DEF (analog of the 4th star). See startup.js.
  // No-op if the "pistol" feature is not enabled.
  setStartPistol(on: boolean): any {
    if (this.hasFeature("pistol")) this._startup.setPistol(on);
    return this;
  }

  // Player names above the tanks (player-names feature): port → name map. Updated
  // at match start; the runtime reads it every frame (does not affect hash/rollback).
  setPlayerNames(names: any): this {
    this.opts.names = names || {};
    return this;
  }

  // ---- generic feature channel (the core does not know specific features) ----
  // Command to a feature runtime: put it in its queue, processed in preFrame.
  featureCommand(id: string, order: unknown): this {
    (this._featureOrders[id] ??= []).push(order);
    return this;
  }

  // State snapshot the feature publishes for the UI (the feature object or null).
  getFeatureState(id: string): any {
    return this._featureStatus?.[id] ?? null;
  }


  getStageCount(): number {
    return STAGE_COUNT;
  }

  getStageBlocks(stage: number): any[] {
    return Array.from(readStageBlocks(this.rom, stage));
  }

  getStage(stage: number): any {
    return readStage(this.rom, stage);
  }

  // Stage block tiles/attribute by id — for previewing TD maps from shared data.
  getBlockTiles(blockId: number): number[] {
    return readBlockTiles(this.rom, blockId);
  }

  getBlockAttribute(blockId: number): number {
    return readBlockAttribute(this.rom, blockId);
  }

  // ---- input mux (edge detection for ports 2..7; ports 0,1 go through hardware) ----
  _setDefController(port: number, hold: number): void {
    const ctl = this.controllers[port + 1];
    for (let b = 0; b < 8; b++) {
      ctl.state[b] = (hold >> b) & 1 ? 0x41 : 0x40;
    }
  }

  _injectNet(port: number, hold: number, press: number): void {
    const idx = port - DEF_PORTS; // 0..5
    const mem = this.cpu.mem;
    const d = hold & (BTN.Right | BTN.Left | BTN.Down | BTN.Up);
    let dir = 0xff; // no press
    if (d) {
      if (hold & BTN.Up) dir = 0;
      else if (hold & BTN.Left) dir = 1;
      else if (hold & BTN.Down) dir = 2;
      else if (hold & BTN.Right) dir = 3;
    }
    mem[RAM.NET_DIR + idx] = dir;
    mem[RAM.NET_FIRE + idx] = (press & BTN.A) ? 1 : 0;
    mem[RAM.NET_RESPAWN + idx] = (press & BTN.Start) ? 1 : 0;
  }

  // ---- public API ----
  // inputs: [{port, buttons}, ...]. Runs one frame, returns the frame hash.
  stepFrame(inputs: any): string {
    this._frame++;
    const mem = this.cpu.mem;
    this._resetNetZone(mem);
    this._tickPrizeFreeze(mem);
    const received = new Set<number>(); // ports that received any input (incl. auto-start)
    const humanControlled = new Set<number>(); // ports with real control (direction/fire)
    this._playerFire = {};
    this._readInputs(inputs, received, humanControlled);
    this._applyAttAIDecisions(mem, received);
    this._applyDefAIDecisions(mem, humanControlled);
    this._applyHumanPreFrame(mem);
    this._runRuntimes("preFrame");
    this.frame();
    // Pause: we clear it if it was started by the DEF tank respawn Start (not the player),
    // and log the environment around the cause. All pause logic is in JS.
    this.handlePauseAfterFrame();
    this._applyHumanPostFrame(mem);
    this._runRuntimes("postFrame");
    this._runRuntimes("render");
    this._unstuckTanks(mem);
    this._frameHash = this.getFrameHash();
    // Kill detection by alive->dead transitions (for the trace with filters).
    this._detectDeaths();
    return this._frameHash;
  }

  // ==== AI trace (log of decisions/kills with frontend filters) ====
  _traceEvent(ev: any): void {
    this.tracer.event(this._frame, ev);
  }
  _isAlive(mem: any, t: number): boolean {
    return isTankAlive(mem[RAM.TANK_FLAG + t]);
  }
  // Human tank "active on field" (0x80..0xd0), including state 0x80..0x8f
  // (tracks spinning/turning) — otherwise JS drops the tank, and the enemy ASM AI jitters it
  // (track animation of a standing tank). A dead tank (0x00) or one in respawn (0xe0..0xff)
  // is not included.
  _humanTankActive(flag: number): boolean {
    return isTankActive(flag);
  }
  _detectDeaths() {
    this.tracer.detectDeaths(this._frame, this.cpu.mem);
  }

  // Respawn of dead DEF tanks (like in planDefense, directly, without Start) — extracted
  // so it also works in the "off" defender mode (otherwise the human/ally does not revive).
  _defRespawn(mem: any, def: any): void {
    for (let t = 0; t < DEF_PORTS; t++) {
      if (mem[RAM.TANK_FLAG + t] === 0 && this._frame % 30 === 0) {
        mem[RAM.TANK_TYPE + t] = 0; // type
        mem[RAM.TANK_X + t] = PLAYER_SPAWN_X[t]; // X
        mem[RAM.TANK_Y + t] = PLAYER_SPAWN_Y[t]; // Y
        mem[RAM.STUN + t] = 0; // stun
        mem[RAM.TANK_FLAG + t] = TANK_RESPAWN_FLAG; // respawn flag
        def.respawn.add(t);
      }
    }
  }

  // Enable/disable trace collection (off by default — don't waste memory).
  // Zero out the ATT network RAM area (ports not transmitted = "no input").
  _resetNetZone(mem: any): void {
    for (let i = 0; i < 6; i++) {
      mem[RAM.NET_DIR + i] = 0xff;
      mem[RAM.NET_FIRE + i] = 0;
      mem[RAM.NET_RESPAWN + i] = 0;
    }
  }

  // Read the frame inputs into the controllers/network area, collect the received/humanControlled sets.
  _readInputs(inputs: any, received: Set<number>, humanControlled: Set<number>): void {
    if (!inputs) return;
    for (const { port, buttons } of inputs) {
      if (port < 0 || port >= NUM_PLAYERS) continue;
      received.add(port);
      if (buttons & (BTN.Up | BTN.Down | BTN.Left | BTN.Right | BTN.A)) humanControlled.add(port);
      const hold = buttons & 0xff;
      const press = hold & ~this.prevButtons[port];
      this.prevButtons[port] = hold;
      if (press & BTN.A) this._playerFire[port] = true; // fire edge (DEF and ATT)
      if (port < DEF_PORTS) this._setDefController(port, hold);
      else this._injectNet(port, hold, press);
    }
  }

  // Attacker brain: drives the enemies (ATT 2..7) without network/human input.
  // Writes RAM.NET_DIR/NET_FIRE; movement/collisions/spawn are executed by ASM.
  _applyAttAIDecisions(mem: any, received: Set<number>): void {
    if (!ATT_AI_MODES.has(this._attAI)) return;
    if (this._aiDecisions === null || this._frame % this._aiEvery === 0) {
      const brain = this._attAI === "scan" ? scanPlan
        : this._attAI === "lookahead" ? lookaheadPlan
        : this._attAI === "strategy-att" ? attackerPlan
        : plan;
      const tac = brain(mem, this._tacticalState);
      this._tacticalState = tac.state;
      this._aiDecisions = tac.decisions;
    }
    for (const [t, decision] of this._aiDecisions) {
      if (received.has(t) || this.humanTanks.has(t)) continue;
      this._traceEvent({ side: "att", tank: t, event: "decision", goal: decision.goal, dir: decision.dir, fire: !!decision.fire });
      if (decision.dir !== null) mem[RAM.NET_DIR + (t - DEF_PORTS)] = decision.dir;
      if (decision.fire) mem[RAM.NET_FIRE + (t - DEF_PORTS)] = 1;
    }
  }

  // Defensive AI of DEF tanks (plan/strategy/scan/lookahead/off) + DEF slot life.
  _applyDefAIDecisions(mem: any, humanControlled: Set<number>): void {
    const startedGame = mem[RAM.ENEMIES_LEFT] !== 0xff;
// Defensive AI: DEF tanks (0,1) actively defend the base when the player has no REAL control
// of them. Applied ONLY after the game starts — during the title/menu you must not
// overwrite the DEF controller (it is overwritten by Start, which starts the game).

let def;
if (this._defAI === "plan") {
  def = planDefense(mem, this._frame, this._defState);
} else if (this._defAI === "strategy") {
  def = strategyDefense(mem, this._frame, this._defState);
} else if (this._defAI === "off") {
  // Defender AI DISABLED: no movement, no fire (def.buttons empty). Respawn of dead
  // DEF tanks is preserved — otherwise the human/ally does not revive after death.
  def = { buttons: new Map(), respawn: new Set() };
  if (startedGame) this._defRespawn(mem, def);
} else {
  // scan/lookahead defenders: the same engines, role "def" (goal — the position at the base,
  // enemies — ATT). We convert the decisions into controller buttons.
  const brain = this._defAI === "scan" ? scanPlan : lookaheadPlan;
  const res = brain(mem, this._defState, "def");
  this._defState = res.state;
  def = { buttons: new Map(), respawn: new Set() };
  for (const [t, d] of res.decisions) {
    let b = 0;
    if (d.dir !== null) b |= DIR_BTN[d.dir];
    if (d.fire) b |= BTN.A;
    def.buttons.set(t, b);
  }
  // respawn of dead DEF tanks (like in planDefense, directly, without Start)
  if (startedGame) this._defRespawn(mem, def);
}
if (startedGame) {
  for (const [port, buttons] of def.buttons) {
    // Don't touch a tank a living player is assigned to (including when he
    // is idle) — the AI plays only for computer players.
    if (humanControlled.has(port) || this.humanDefTanks.has(port)) continue;
    // DEF freeze (enemy clock): don't control, release the controller.
    if (port < DEF_PORTS && this.hasFeature("enemy-prizes") && mem[RAM.PRIZE_FREEZE + port] > 0) { this._setDefController(port, 0); continue; }
    let b = buttons;
    // Defender modes for experiments (planDefense only):
    //  "active"     — full planDefense (patrol+fire),
    //  "stationary" — fire only, no movement (stay at the base),
    //  "none"       — no control (baseline "no defense").
    if (this._defMode === "stationary") b &= BTN.A | BTN.Start;
    if (this._defMode === "none") b = 0;
    let dir = null; for (let d = 0; d < 4; d++) if (b & DIR_BTN[d]) { dir = d; break; }
    this._traceEvent({ side: "def", tank: port, event: "decision", goal: "control", dir, fire: !!(b & BTN.A) });
    this._setDefController(port, b);
  }
}
// If the player does not control the DEF tanks, we give the DEF slots lives so they
// spawn and defend the base.
const playerOnDef = this.humanDefTanks.has(0) || this.humanDefTanks.has(1);
if (!playerOnDef) {
  for (let t = 0; t < 2; t++) {
    if (!this.humanTanks.has(t) && mem[RAM.LIVES + t] === 0) mem[RAM.LIVES + t] = 3;
  }
}
  }

  // DEF freeze (`clock` effect, enemy-prizes feature): timer in RAM, decrement per frame.
  // Core cooperation: DEF control (human/AI) is suppressed while the timer > 0.
  _tickPrizeFreeze(mem: any): void {
    if (!this.hasFeature("enemy-prizes")) return; // feature disabled — don't touch RAM
    for (let t = 0; t < DEF_PORTS; t++) {
      const v = mem[RAM.PRIZE_FREEZE + t];
      if (v > 0) mem[RAM.PRIZE_FREEZE + t] = v - 1;
    }
  }

  // Human tanks: set the direction before the frame (so bullets fly correctly).
  _applyHumanPreFrame(mem: any): void {
// Human tanks: AI is disabled. JS sets the direction (before the frame so
// bullets fly correctly) and the position (after the frame — overriding ASM movement; when
// there is no input the tank is held in place and is NOT turned by AI).
// Applies ONLY to an ACTIVE living tank (flag 0x90-0xD0).
for (const t of this.humanTanks) {
  // DEF freeze (enemy clock): ignore input and hold the tank in place.
  if (t < DEF_PORTS && this.hasFeature("enemy-prizes") && mem[RAM.PRIZE_FREEZE + t] > 0) {
    this._setDefController(t, 0);
    this._jsPrev[t] = null;
    this._jsDir[t] = 0xff;
    this._playerFire[t] = false;
    continue;
  }
  const flagAddr = RAM.TANK_FLAG + t;
  const flag = mem[flagAddr];
  // 0x80..0xd0 (incl. 0x80..0x8f "tracks spinning"): we control the tank always,
  // so the enemy ASM AI doesn't jitter the animation of a standing human tank.
  const active = this._humanTankActive(flag);
  if (!active) { this._jsPrev[t] = null; continue; } // dead/respawn — don't touch
  const idx = t - DEF_PORTS;
  const dir = mem[RAM.NET_DIR + idx];
  this._jsPrev[t] = { x: mem[RAM.TANK_X + t], y: mem[RAM.TANK_Y + t] };
  this._jsDir[t] = dir;
  this._bulletBefore[t] = mem[RAM.BULLET_STATUS + t];
  // Block the ASM RNG fire for the human tank: sub_E162 in the "no RAM.NET_FIRE" branch
  // fires by RNG, and the bullet managed to collide with a brick BEFORE removal (bug:
  // a spontaneous point-blank shot destroyed the brick). We keep the slot occupied with the marker
  // until the player presses A; on A — we free it so the ASM fires by the button.
  const firing = mem[RAM.NET_FIRE + idx] === 1;
  if (firing) {
    if (mem[RAM.BULLET_STATUS + t] === HUMAN_BULLET_BUSY) mem[RAM.BULLET_STATUS + t] = 0;
  } else if (mem[RAM.BULLET_STATUS + t] === 0) {
    mem[RAM.BULLET_STATUS + t] = HUMAN_BULLET_BUSY;
  }
  if (dir !== 0xff) {
    mem[flagAddr] = movingFlag(dir);
    this._lastPlayerDir[t] = dir;
  } else if (this._lastPlayerDir[t] !== undefined) {
    // No input — keep the tank in state 0x80|dir (not the transitional 0x88..0x8f).
    // It does NOT spin the tracks (ofs_DC52 simply decrements the flag without EOR wheels),
    // unlike 0xa0 (ofs_DC7C -> movement -> EOR wheels). The sprite is the same
    // (the flag gives only the direction), but the tracks do not animate on a standing tank.
    mem[flagAddr] = standingFlag(this._lastPlayerDir[t]);
  }
}
  }

  // After the frame: movement/holding of the human tank (override ASM).
  _applyHumanPostFrame(mem: any): void {
// after the frame: movement/holding of the human tank (JS), override ASM
for (const t of this.humanTanks) {
  const prev = this._jsPrev[t];
  if (!prev) continue;
  // If after the frame the tank is NOT active (dead/respawn) — we don't intervene.
  const flagNow = mem[RAM.TANK_FLAG + t];
  const activeNow = this._humanTankActive(flagNow);
  if (!activeNow) { this._jsPrev[t] = null; continue; }
  const dir = this._jsDir[t];
  const field = mem.subarray(RAM.FIELD, RAM.FIELD + 32 * 32);
  let next;
  if (dir !== 0xff) {
    next = stepTankStrict(field, prev, dir) ?? prev;
    mem[RAM.TANK_FLAG + t] = movingFlag(dir);
  } else {
    next = prev; // no input — hold the position (AI disabled)
    // Keep the last direction in state 0x80|dir (without track animation on a
    // standing tank), so ASM doesn't turn the tank or spin the tracks.
    const keep = this._lastPlayerDir[t];
    if (keep !== undefined) mem[RAM.TANK_FLAG + t] = standingFlag(keep);
  }
  mem[RAM.TANK_X + t] = next.x;
  mem[RAM.TANK_Y + t] = next.y;
  // Suppress the ASM's spontaneous (RNG) shot: if the player did not press A,
  // but the tank's bullet appeared on exactly this frame — remove it (the tank fires
  // only by the button). We don't touch our own shot (the player pressed A).
  const playerFired = !!this._playerFire[t];
  const appeared = this._bulletBefore[t] === 0 && mem[RAM.BULLET_STATUS + t] !== 0;
  if (!playerFired && appeared) {
    mem[RAM.BULLET_STATUS + t] = 0; // remove the bullet
    mem[0xba + t] = 0; // bullet pos_X
    mem[0xc4 + t] = 0; // bullet pos_Y
  }
}
  }

  // Anti-stuck in a wall (blind spot of the ASM 2-point collision).
  _unstuckTanks(mem: any): void {
// Anti-stuck in a wall (blind spot of the ASM 2-point collision: the center of the front
// edge is not checked). If the center of a living tank ends up in a solid sub-cell —
// we deterministically push it back along its facing direction. The same on both
// clients (reads RAM only), so it does not break synchronization.
for (let t = 0; t < NUM_PLAYERS; t++) {
  const flag = mem[RAM.TANK_FLAG + t];
  if (!isTankActive(flag)) continue; // only "on field"
  const dir = flag & 0x03;
  for (let it = 0; it < 4; it++) {
    const x = mem[RAM.TANK_X + t], y = mem[RAM.TANK_Y + t];
    if (!solidPixel(mem, x, y)) break;
    const nx = x - TANK_DX[dir], ny = y - TANK_DY[dir];
    if (nx < 0 || nx > 255 || ny < 0 || ny > 255) break;
    mem[RAM.TANK_X + t] = nx;
    mem[RAM.TANK_Y + t] = ny;
  }
}
  }
  setTraceEnabled(v: any): this { this.tracer.setEnabled(v); return this; }
  // Limit the number of stored events (ring shift, the earliest are evicted).
  setTraceCap(n: number): this { this.tracer.setCap(n); return this; }
  // Copy of the trace events (id, frame, side, tank, event, goal, dir, fire).
  getTrace() { return this.tracer.get(); }
  clearTrace() { this.tracer.clear(); return this; }
  // AI modes for switching on the fly. "off" — AI disabled (enemies frozen,
  // the ally defender stands; DEF respawn is preserved).
  getAttModes() { return ["plan", "scan", "lookahead", "strategy-att", "asm", "off"]; }
  getDefModes() { return ["plan", "scan", "lookahead", "strategy", "off"]; }
  getAttAI() { return this._attAI; }
  getDefAI() { return this._defAI; }
  // Switch ATTACKER AI on the fly. Resets the brain state (otherwise the new mode
  // starts with someone else's prev state and makes random decisions).
  setAttAI(mode: string): this {
    if (!this.getAttModes().includes(mode)) throw new Error(`Неизвестный режим атакующих: ${mode}`);
    // We control ONLY AI tanks (ATT 2..7), but do NOT touch a living player's tank
    // (_playerHumanTanks): otherwise a mode switch "de-humanizes" the player's tank, and the
    // attacker AI starts driving it (spontaneous shots/movement).
    for (let t = 2; t < 8; t++) {
      if (this._playerHumanTanks.has(t)) continue;
      this.humanTanks.delete(t); // remove the freeze from AI enemies
    }
    this._attAI = mode;
    this._aiDecisions = null;
    this._tacticalState = new Map();
    if (mode === "off") {
      // freeze the AI enemies (not the player's human tank)
      for (let t = 2; t < 8; t++) {
        if (this._playerHumanTanks.has(t)) continue;
        this.humanTanks.add(t);
      }
      this._traceEvent({ side: "game", event: "attAI", detail: "off" });
    } else {
      this._traceEvent({ side: "game", event: "attAI", detail: mode });
    }
    return this;
  }
  // Switch DEFENDER AI on the fly (resets the corresponding brain state).
  setDefAI(mode: string): this {
    if (!this.getDefModes().includes(mode)) throw new Error(`Неизвестный режим защитников: ${mode}`);
    this._defAI = mode;
    this._defState = new Map();
    if (mode === "plan") resetDefState(); // the plan works with modular defState
    this._traceEvent({ side: "game", event: "defAI", detail: mode });
    return this;
  }

  // Mark a tank as human-controlled: its AI is disabled; movement/direction
  // are set by JS from input. The other tanks and the base are unchanged.
  setHumanTank(tank: number): void {
    this.humanTanks.add(tank);
    this._playerHumanTanks.add(tank);
  }

  // Mark a DEF tank (0..1) as a LIVING player's tank: the defensive AI does not control it
  // (even when the player is idle). The AI plays only for computer players.
  setHumanDefTank(tank: number): void {
    this.humanDefTanks.add(tank);
  }

  // Debug: call fn when PC == pc is reached (before executing the instruction at the address).
  setPcHook(pc: number, fn: any): this {
    this._pcHooks = this._pcHooks || new Map();
    this._pcHooks.set(pc, fn);
    const cpu = this.cpu;
    if (!cpu.__pcHookWrapped) {
      cpu.__pcHookWrapped = true;
      const orig = cpu.emulate.bind(cpu);
      cpu.emulate = () => {
        if (this._pcHooks && this._pcHooks.has(cpu.REG_PC)) this._pcHooks.get(cpu.REG_PC)(cpu);
        return orig();
      };
    }
    return this;
  }

  // Predictable RNG injection (for tests/verification against the simulator). value — a number
  // (always the same) or an array (cyclic sequence). Disables the emulator's native
  // RNG, making enemy decisions deterministic and comparable.
  setRngInjection(value: any): this {
    this._rngInjection = value;
    this._rngIdx = 0;
    const cpu = this.cpu;
    if (!cpu.__rngWrapped) {
      cpu.__rngWrapped = true;
      const orig = cpu.emulate.bind(cpu);
      cpu.emulate = () => {
        if (cpu.REG_PC === ROM_ADDR.RANDOM_FN) {
          const inj = this._rngInjection;
          if (inj !== null) {
            cpu.REG_ACC = Array.isArray(inj) ? inj[this._rngIdx++ % inj.length] : inj;
            cpu.REG_PC = ROM_ADDR.RANDOM_RET; // RTS: return from JSR sub_D44D with A = the injected value
          }
        }
        return orig();
      };
    }
    return this;
  }

  // TEST HOOK: activates a bonus in the game via the standard path (id, position x/y in px).
  // Sets ram_bonus_pos ($86/$87), ram_bonus_id ($88) and resets
  // ram_bonus_timer ($62)=0 — after that the game ITSELF handles the appearance and pickup
  // of the bonus (as with a standard spawn). id: 0=helmet,1=clock,2=shovel,3=star,4=grenade,5=life.
  spawnBonus(id: number, x: number, y: number): void {
    const mem = this.cpu.mem;
    mem[RAM.PRIZE_X] = x; mem[RAM.PRIZE_Y] = y; mem[RAM.PRIZE_ID] = id; mem[RAM.BONUS_TIMER] = 0;
  }

  // TEST HOOK: current bonus on the field? (true if there is an active prize)
  hasBonus() {
    const mem = this.cpu.mem;
    return mem[RAM.PRIZE_ID] !== 0xff && mem[RAM.PRIZE_X] !== 0;
  }

  // Full deterministic state as a compact binary Uint8Array.
  saveState() {
    // Derived visual changes (nametable overlay of nicknames) must not get
    // into the snapshot: the runtimes remove them before encoding and restore them after.
    this._runRuntimes("beforeSaveState");
    const bytes = encodeState(this);
    this._runRuntimes("afterSaveState");
    return bytes;
  }

  // Restore state from a binary snapshot (in-place, deterministically).
  loadState(bytes: any): void {
    decodeState(this, bytes);
    this._frameHash = this.getFrameHash();
    this._runRuntimes("onLoadState");
  }

  // Hash of the current state (FNV-1a over the full CPU space) — for verifying
  // desyncs and determinism. Includes the RNG register ($0F), since it is in RAM.
  getFrameHash() {
    return ("00000000" + fnv1a32(this.cpu.mem).toString(16)).slice(-8);
  }

  // Pause in JS. The pause (ram_pause_flag 0x6D) can be enabled by:
  //  1) the demo/title screen (sub_C3B5_demo_settings sets 1 after the game ends);
  //  2) a real DEF player pressed Start (a legitimate pause in gameplay).
  // DEF respawn no longer uses Start (direct flag 0xF0), so it does not
  // toggle the pause. We clear the pause when the game is NOT in active gameplay — this is purely
  // from RAM (deterministic and rollback-safe).
  handlePauseAfterFrame() {
    const mem = this.cpu.mem;
    if (mem[RAM.PAUSE] === 0) return;
    const stage = mem[RAM.STAGE];
    const started = mem[RAM.ENEMIES_LEFT] !== 0xff;
    const activeGameplay = started && stage >= 1 && stage <= 35;
    if (!activeGameplay) {
      mem[RAM.PAUSE] = 0; // outside gameplay (demo/title) — don't show "PAUSE"
    }
  }

  // Access to RAM (for tests/introspection).
  readMem(addr: number): any {
    return this.cpu.mem[addr & 0xffff];
  }
}

export { PvPNes };
export const NET_DIR = RAM.NET_DIR, NET_FIRE = RAM.NET_FIRE, NET_RESPAWN = RAM.NET_RESPAWN, NET_STATE = RAM.NET_STATE;
export default PvPNes;
