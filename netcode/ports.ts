// ports.ts — ports (interfaces) of the netcode layer. Internal code depends only on them;
// concrete implementations (jsnes, WebRTC, WebSocket) are supplied by external adapters.
//
// Contract for adapters and tests. The module intentionally imports nothing.

// Full frame input: the tank's logical port and the button bitmask.
export type Input = { port: number; buttons: number };

export interface GameCore {
  stepFrame(inputs: Input[]): string;
  saveState(): Uint8Array;
  loadState(bytes: Uint8Array): void;
  getFrameHash(): string;
  setAudioSuppressed?(value: boolean): void;
  setStartStage?(stage: number): void;
  setStartStars?(stars: number): void;
  cartridgeFingerprint?(): string | null;
}

export interface Transport {
  send(buf: Uint8Array): void;
  onMessage(cb: (buf: Uint8Array) => void): void;
  onClose?(cb: () => void): void;
  isOpen?(): boolean;
  close?(): void;
}

export interface Clock {
  now(): number;
}

export interface EventSink {
  emit(event: unknown): void;
}

export interface Logger {
  warn(msg: string): void;
  error(msg: string): void;
}

/** System clock (monotonic milliseconds). Replaced by a fake Clock in tests. */
export const systemClock: Clock = {
  now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  },
};

export default { systemClock };
