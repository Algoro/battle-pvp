// emulator.ts — game core driver in the browser: ROM loading, frame step, save/load.
// Drawing is managed by a separate render layer (see render/render-system.ts): the core only
// calls the installed frameRenderer. The core type is any (PvPNes without declarations).
import PvPNes from "@core/pvp.ts";
import type { FrameInput } from "../ports";

// FrameInput — domain input type: single definition in ports.ts, re-exported for compatibility.
export type { FrameInput };

// Wrapper over PvPNes for the browser.
export class EmulatorDriver {
  nes: any;
  private frameRenderer: (() => void) | null = null;
  private raf = 0;
  private lastT = 0;
  private accum = 0;
  private running = false;
  private romBytes: Uint8Array | null = null;
  private aiConfig: any = { attAI: "lookahead", defAI: "plan", defMode: "active", patchSet: "pvp", sampleRate: 48000 };
  private audio: any = null; // AudioOutput (installed from App)
  private startStage = 1; // starting stage (1..35)
  private startStars = 0; // starting DEF stars (0..3)
  private startPistol = false; // starting DEF super-weapon (equivalent to the 4th star)
  private patchFeatures: string[] = []; // enabled optional features (pistol, ...)
  private playerNames: Record<number, string> = {}; // port → name (player-names feature)
  private featureOptions: Record<string, Record<string, string | number | boolean>> = {}; // feature settings
  public onFrame?: (frame: number) => void;

  // Connect audio output. Sound comes from the core APU; without it samples are dropped.
  setAudio(audio: any) { this.audio = audio; return this; }

  // Connect the render layer: called on every step/draw (after the core update).
  // The core no longer draws itself — drawing is determined by the selected render driver.
  setFrameRenderer(fn: (() => void) | null) { this.frameRenderer = fn; return this; }

  // Starting stage. Applied on the next reset()/loadROM.
  setStartStage(stage: number) {
    this.startStage = Math.max(1, Math.min(35, Math.floor(stage) || 1));
    this.nes?.setStartStage?.(this.startStage);
    return this;
  }

  // Starting DEF team stars (0..3).
  setStartStars(stars: number) {
    this.startStars = Math.max(0, Math.min(3, Math.floor(stars) || 0));
    this.nes?.setStartStars?.(this.startStars);
    return this;
  }

  // Starting DEF "pistol" super-weapon (equivalent to the 4th star).
  setStartPistol(on: boolean) {
    this.startPistol = !!on;
    this.nes?.setStartPistol?.(this.startPistol);
    return this;
  }

  // Enabled optional features (canonicalized). Applied on the next reset()/loadROM.
  setPatchFeatures(features: string[]) {
    this.patchFeatures = [...new Set((features || []).map(String).filter(Boolean))].sort();
    return this;
  }

  getPatchFeatures(): string[] { return [...this.patchFeatures]; }

  // Feature settings (feature id → values) for runtimes; applied on the next loadROM/reset.
  setFeatureOptions(options: Record<string, Record<string, string | number | boolean>> | null | undefined) {
    this.featureOptions = JSON.parse(JSON.stringify(options || {}));
    return this;
  }

  getFeatureOptions(): Record<string, Record<string, string | number | boolean>> {
    return JSON.parse(JSON.stringify(this.featureOptions));
  }

  // Player names above tanks (player-names feature): port → name map.
  setPlayerNames(names: Record<number, string> | null | undefined) {
    this.playerNames = { ...(names || {}) };
    this.nes?.setPlayerNames?.(this.playerNames);
    return this;
  }

  // ---- generic feature channel (the core knows nothing about specific features) ----
  // Order to the feature runtime; processed by the core in preFrame.
  featureCommand(id: string, order: unknown) { this.nes?.featureCommand?.(id, order); return this; }
  // State snapshot that the feature publishes for the UI.
  getFeatureState(id: string): any { return this.nes?.getFeatureState?.(id) ?? null; }

  getStageCount(): number { return this.nes?.getStageCount?.() ?? 35; }
  getStage(stage: number): any { return this.nes?.getStage?.(stage) ?? null; }
  getBlockTiles(blockId: number): number[] { return this.nes?.getBlockTiles?.(blockId) ?? []; }
  getBlockAttribute(blockId: number): number { return this.nes?.getBlockAttribute?.(blockId) ?? 0; }
  // Pixels of the BACKGROUND CHR tile (64 values 0..3). In Battle City the BG pattern table is $1000
  // (the second table, offset 256 in ptTile): there tile 0 is empty, 0x0F.. — brick/steel etc.
  getChrTilePixels(tileIndex: number): Uint8Array | null {
    const t = this.nes?.ppu?.ptTile?.[256 + (tileIndex & 0xff)];
    return t?.pix ?? null;
  }

  private coreConfig(): any {
    return {
      ...this.aiConfig,
      features: this.patchFeatures,
      featureOptions: this.featureOptions,
      names: this.playerNames,
      onAudioSampleGroup: (group: "music" | "sfx", l: number, r: number) => this.audio?.pushGroup(group, l, r),
    };
  }

  // Loads the ROM (Uint8Array or ArrayBuffer) and creates the core.
  // The strongest AIs written (verified by emu-eval):
  //   attackers — "lookahead" (MPC prediction, destroys the HQ fastest);
  //   defenders — "plan" (planDefense, survives to the timeout, HQ intact).
  // In solo DEF the player controls tank 0 (setHumanDefTank), while tank 1 (the ally)
  // and the attackers are controlled by these AIs.
  loadROM(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.romBytes = bytes;
    this.nes = new PvPNes(this.coreConfig());
    this.nes.loadROM(bytes);
    this.nes.setStartStage(this.startStage);
    this.nes.setStartStars(this.startStars);
    this.nes.setStartPistol(this.startPistol);
    return this;
  }

  // Recreate the core (deterministic "frame 0") — for a synchronous match start.
  // config fixes the AI modes; it must be IDENTICAL on both clients.
  reset(config: any = {}) {
    this.aiConfig = { ...this.aiConfig, ...config };
    if (!this.romBytes) return this;
    this.nes = new PvPNes(this.coreConfig());
    this.nes.loadROM(this.romBytes);
    this.nes.setStartStage(this.startStage);
    this.nes.setStartStars(this.startStars);
    this.nes.setStartPistol(this.startPistol);
    return this;
  }

  // Run exactly one frame with the given inputs (deterministically).
  step(inputs: FrameInput[]): string {
    const h = this.nes.stepFrame(inputs);
    this.frameRenderer?.();
    return h;
  }

  // ---- `game` contract for RollbackSession (no rendering: we draw separately) ----
  stepFrame(inputs: FrameInput[]): string { return this.nes.stepFrame(inputs); }
  saveState(): Uint8Array { return this.nes.saveState(); }
  loadState(bytes: Uint8Array): void { this.nes.loadState(bytes); }
  draw(): void { this.frameRenderer?.(); }

  // Fingerprint of the patched cartridge (for the netcode handshake). null — if no patch is applied.
  cartridgeFingerprint(): string | null {
    return this.nes?.patching?.fingerprint ?? null;
  }

  // 60fps loop (for local solo mode/render prediction).
  start(inputsProvider: () => FrameInput[]) {
    if (this.running) return;
    this.running = true;
    this.lastT = performance.now();
    const tick = (t: number) => {
      const dt = t - this.lastT;
      this.lastT = t;
      this.accum += dt;
      const frameMs = 1000 / 60;
      while (this.accum >= frameMs) {
        this.step(inputsProvider());
        this.accum -= frameMs;
        this.onFrame?.(this.nes._frame);
      }
      if (this.running) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  getFrameHash(): string {
    return this.nes.getFrameHash();
  }

  // Mark a tank as human-controlled: the AI is disabled, JS drives it by input.
  setHumanTank(tank: number) {
    this.nes.setHumanTank(tank);
  }

  // Mark the DEF tank as a live player's tank: the defense AI does not control it.
  setHumanDefTank(tank: number) {
    this.nes.setHumanDefTank(tank);
  }

  // ---- switching AI on the fly + trace (see pvp.js) ----
  getAttModes(): string[] { return this.nes.getAttModes(); }
  getDefModes(): string[] { return this.nes.getDefModes(); }
  getAttAI(): string { return this.nes.getAttAI(); }
  getDefAI(): string { return this.nes.getDefAI(); }
  setAttAI(mode: string) { this.nes.setAttAI(mode); }
  setDefAI(mode: string) { this.nes.setDefAI(mode); }
  setTraceEnabled(v: boolean) { this.nes.setTraceEnabled(v); return this; }
  setTraceCap(n: number) { this.nes.setTraceCap(n); return this; }
  getTrace(): any[] { return this.nes.getTrace(); }
  clearTrace() { this.nes.clearTrace(); return this; }

  readMem(addr: number): number {
    return this.nes.readMem(addr);
  }
}

export default EmulatorDriver;
