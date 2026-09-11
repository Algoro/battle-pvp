// emulator.ts — драйвер ядра в браузере: загрузка ROM, шаг кадра, рендер в canvas.
// Импортирует детерминированное PvP-ядро (./emulator-core/pvp.js). Тип — any
// (JS-ядро без деклараций); API стабильно и покрыто тестами в emulator-core.
import PvPNes from "../../emulator-core/pvp.js";
import type { FrameInput } from "../ports";

// FrameInput — доменный тип ввода: единое определение в ports.ts, ре-экспорт для совместимости.
export type { FrameInput };

export const SCREEN_W = 256;
export const SCREEN_H = 240;

// Обёртка над PvPNes для браузера.
export class EmulatorDriver {
  nes: any;
  private ctx: CanvasRenderingContext2D | null = null;
  private raf = 0;
  private lastT = 0;
  private accum = 0;
  private running = false;
  private romBytes: Uint8Array | null = null;
  private aiConfig: any = { attAI: "lookahead", defAI: "plan", defMode: "active", patchSet: "pvp", sampleRate: 48000 };
  private audio: any = null; // AudioOutput (устанавливается из App)
  private startStage = 1; // стартовая стадия (1..35)
  private startStars = 0; // стартовые звёзды DEF (0..3)
  public onFrame?: (frame: number) => void;

  // Подключить аудио-вывод. Звук идёт из APU ядра; без него сэмплы отбрасываются.
  setAudio(audio: any) { this.audio = audio; return this; }

  // Стартовая стадия. Применяется при следующем reset()/loadROM.
  setStartStage(stage: number) {
    this.startStage = Math.max(1, Math.min(35, Math.floor(stage) || 1));
    this.nes?.setStartStage?.(this.startStage);
    return this;
  }

  // Стартовые звёзды команды DEF (0..3).
  setStartStars(stars: number) {
    this.startStars = Math.max(0, Math.min(3, Math.floor(stars) || 0));
    this.nes?.setStartStars?.(this.startStars);
    return this;
  }

  getStageCount(): number { return this.nes?.getStageCount?.() ?? 35; }
  getStage(stage: number): any { return this.nes?.getStage?.(stage) ?? null; }
  // Пиксели CHR-тайла ФОНА (64 значения 0..3). В Battle City BG pattern table — $1000
  // (вторая таблица, offset 256 в ptTile): там тайл 0 пустой, 0x0F.. — кирпич/сталь и т.п.
  getChrTilePixels(tileIndex: number): Uint8Array | null {
    const t = this.nes?.ppu?.ptTile?.[256 + (tileIndex & 0xff)];
    return t?.pix ?? null;
  }

  private coreConfig(): any {
    return {
      ...this.aiConfig,
      onAudioSampleGroup: (group: "music" | "sfx", l: number, r: number) => this.audio?.pushGroup(group, l, r),
    };
  }

  // Загружает ROM (Uint8Array или ArrayBuffer) и создаёт ядро.
  // Самые сильные ИИ из написанных (проверено emu-eval):
  //   атакующие — "lookahead" (MPC-предсказание, разрушает штаб быстрее всех);
  //   защитники — "plan" (planDefense, доживает до таймаута, штаб цел).
  // В соло за DEF игрок управляет танком 0 (setHumanDefTank), а танк 1 (союзник)
  // и атакующие рулятся этими ИИ.
  loadROM(data: ArrayBuffer | Uint8Array) {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.romBytes = bytes;
    this.nes = new PvPNes(this.coreConfig());
    this.nes.loadROM(bytes);
    this.nes.setStartStage(this.startStage);
    this.nes.setStartStars(this.startStars);
    return this;
  }

  // Пересоздать ядро (детерминированный «кадр 0») — для синхронного старта матча.
  // config фиксирует режимы ИИ; он должен быть ИДЕНТИЧЕН на обоих клиентах.
  reset(config: any = {}) {
    this.aiConfig = { ...this.aiConfig, ...config };
    if (!this.romBytes) return this;
    this.nes = new PvPNes(this.coreConfig());
    this.nes.loadROM(this.romBytes);
    this.nes.setStartStage(this.startStage);
    this.nes.setStartStars(this.startStars);
    return this;
  }

  attachCanvas(canvas: HTMLCanvasElement) {
    canvas.width = SCREEN_W;
    canvas.height = SCREEN_H;
    this.ctx = canvas.getContext("2d");
  }

  // Прогнать ровно один кадр с данными входами (детерминированно).
  step(inputs: FrameInput[]): string {
    const h = this.nes.stepFrame(inputs);
    this.render();
    return h;
  }

  // ---- контракт `game` для RollbackSession (без рендера: рисуем отдельно) ----
  stepFrame(inputs: FrameInput[]): string { return this.nes.stepFrame(inputs); }
  saveState(): Uint8Array { return this.nes.saveState(); }
  loadState(bytes: Uint8Array): void { this.nes.loadState(bytes); }
  draw(): void { this.render(); }

  // Отпечаток пропатченного картриджа (для netcode-handshake). null — если патч не применён.
  cartridgeFingerprint(): string | null {
    return this.nes?.patching?.fingerprint ?? null;
  }

  // 60fps-цикл (для локального соло-режима/предикции рендера).
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

  // Пометить танк как управляемый человеком: AI отключается, JS двигает по вводу.
  setHumanTank(tank: number) {
    this.nes.setHumanTank(tank);
  }

  // Пометить DEF-танк как танк живого игрока: защитный ИИ не управляет им.
  setHumanDefTank(tank: number) {
    this.nes.setHumanDefTank(tank);
  }

  // ---- переключение ИИ на лету + трейс (см. pvp.js) ----
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

  private render() {
    if (!this.ctx || !this.nes?.ppu?.buffer) return;
    const buf = this.nes.ppu.buffer as Uint32Array;
    const img = this.ctx.createImageData(SCREEN_W, SCREEN_H);
    const img32 = new Uint32Array(img.data.buffer);
    // Буфер ядра хранит цвет как 0x00BBGGRR (младший байт = R). Запись
    // `0xff000000 | buf[i]` даёт байты [R,G,B,A] в ImageData на little-endian.
    for (let i = 0; i < img32.length; i++) {
      img32[i] = 0xff000000 | buf[i];
    }
    this.ctx.putImageData(img, 0, 0);
  }
}

export default EmulatorDriver;
