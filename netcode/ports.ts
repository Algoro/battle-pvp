// ports.ts — порты (интерфейсы) слоя netcode. Внутренний код зависит только от них,
// конкретные реализации (jsnes, WebRTC, WebSocket) подаются адаптерами извне.
//
// Контракт для адаптеров и тестов. Модуль намеренно не импортирует ничего.

// Полный ввод кадра: логический порт танка и битовая маска кнопок.
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

/** Системные часы (монотонные миллисекунды). Для тестов подменяются fake Clock. */
export const systemClock: Clock = {
  now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  },
};

export default { systemClock };
