// local.js — in-process транспорт для тестов/эмуляции сети.
// Поддерживает задержку (в кадрах), джиттер и потери пакетов, с детерминированным PRNG.
//
// Модель времени: тест после каждого advanceFrame() вызывает flush() на обоих
// концах, доставляя сообщения, срок которых наступил на текущем «кадре».
//
// Относительный путь: ./netcode/transport/local.js

// Детерминированный LCG (чтобы тесты с задержкой/потерями были воспроизводимы).
export function makeRng(seed = 0x12345678) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000; // [0,1)
  };
}

export class LocalEndpoint {
  constructor(peer, { delay = 0, loss = 0, jitter = 0, rng = makeRng() } = {}) {
    this.peer = peer;
    this.delay = delay; // кадров
    this.loss = loss; // 0..1
    this.jitter = jitter; // кадров (+-)
    this.rng = rng;
    this.frame = 0;
    this.queue = new Map(); // frame -> [buf]
    this.cb = null;
    this.closeCb = null;
    this.closed = false;
    this.sent = 0;
    this.delivered = 0;
    this.dropped = 0;
  }

  onMessage(cb) {
    this.cb = cb;
  }

  onClose(cb) {
    this.closeCb = cb;
    if (this.closed) cb();
  }

  isOpen() {
    return !this.closed;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (this.closeCb) this.closeCb();
  }

  enqueue(dueFrame, buf) {
    if (!this.queue.has(dueFrame)) this.queue.set(dueFrame, []);
    this.queue.get(dueFrame).push(buf);
  }

  // Отправка ставит сообщение в ОЧЕРЕДЬ СОПЕРНИКА (delivery на его кадре/часах).
  send(buf) {
    if (this.closed) return;
    this.sent++;
    if (this.loss > 0 && this.rng() < this.loss) {
      this.dropped++;
      return;
    }
    const j = this.jitter > 0 ? Math.floor(this.rng() * (2 * this.jitter + 1)) - this.jitter : 0;
    const due = this.peer.frame + Math.max(0, this.delay + j);
    this.peer.enqueue(due, buf);
  }

  // Доставляет сообщения, срок которых наступил на текущем кадре, и инкрементит кадр.
  flush() {
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
  static pair(optsA = {}, optsB = {}, sharedRng = makeRng()) {
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
