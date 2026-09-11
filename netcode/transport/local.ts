// local.ts — in-process транспорт для тестов/эмуляции сети.
// Поддерживает задержку (в кадрах), джиттер и потери пакетов, с детерминированным PRNG.
//
// Модель времени: тест после каждого advanceFrame() вызывает flush() на обоих
// концах, доставляя сообщения, срок которых наступил на текущем «кадре».
//
// Относительный путь: ./netcode/transport/local.ts

export type Rng = () => number;

// Детерминированный LCG (чтобы тесты с задержкой/потерями были воспроизводимы).
export function makeRng(seed = 0x12345678): Rng {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000; // [0,1)
  };
}

export interface LocalEndpointOptions {
  delay?: number;
  loss?: number;
  jitter?: number;
  rng?: Rng;
}

export class LocalEndpoint {
  peer: LocalEndpoint | null;
  delay: number;
  loss: number;
  jitter: number;
  rng: Rng;
  frame = 0;
  queue: Map<number, Uint8Array[]> = new Map(); // frame -> [buf]
  cb: ((buf: Uint8Array) => void) | null = null;
  closeCb: (() => void) | null = null;
  closed = false;
  sent = 0;
  delivered = 0;
  dropped = 0;

  constructor(peer: LocalEndpoint | null, { delay = 0, loss = 0, jitter = 0, rng = makeRng() }: LocalEndpointOptions = {}) {
    this.peer = peer;
    this.delay = delay; // кадров
    this.loss = loss; // 0..1
    this.jitter = jitter; // кадров (+-)
    this.rng = rng;
  }

  onMessage(cb: (buf: Uint8Array) => void): void {
    this.cb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
    if (this.closed) cb();
  }

  isOpen(): boolean {
    return !this.closed;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.closeCb) this.closeCb();
  }

  enqueue(dueFrame: number, buf: Uint8Array): void {
    if (!this.queue.has(dueFrame)) this.queue.set(dueFrame, []);
    this.queue.get(dueFrame)!.push(buf);
  }

  // Отправка ставит сообщение в ОЧЕРЕДЬ СОПЕРНИКА (delivery на его кадре/часах).
  send(buf: Uint8Array): void {
    if (this.closed) return;
    this.sent++;
    if (this.loss > 0 && this.rng() < this.loss) {
      this.dropped++;
      return;
    }
    const j = this.jitter > 0 ? Math.floor(this.rng() * (2 * this.jitter + 1)) - this.jitter : 0;
    const due = this.peer!.frame + Math.max(0, this.delay + j);
    this.peer!.enqueue(due, buf);
  }

  // Доставляет сообщения, срок которых наступил на текущем кадре, и инкрементит кадр.
  flush(): void {
    const due = this.queue.get(this.frame);
    if (due && this.cb) {
      for (const b of due) {
        this.delivered++;
        this.cb(b);
      }
    }
    this.queue.delete(this.frame);
    this.frame++;
  }

  // Пара связанных endpoin'ов с независимыми (или общим) PRNG.
  static pair(
    optsA: Omit<LocalEndpointOptions, "rng"> = {},
    optsB: Omit<LocalEndpointOptions, "rng"> = {},
    sharedRng: Rng = makeRng(),
  ): { a: LocalEndpoint; b: LocalEndpoint } {
    // чтобы конфигурации A и B были независимы, дадим им разные потоки PRNG
    const rngA = sharedRng;
    const rngB = makeRng(0x9e3779b9);
    const a = new LocalEndpoint(null, { ...optsA, rng: rngA });
    const b = new LocalEndpoint(a, { ...optsB, rng: rngB });
    a.peer = b;
    return { a, b };
  }
}

export default LocalEndpoint;
