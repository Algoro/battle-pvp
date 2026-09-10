// chat.js — чат лобби: глобальный канал + канал на каждое лобби.
// Хранение — кольцевой буфер в памяти (для MVP). Rate-limit и санитизация.
//
// Относительный путь: ./backend/lobby/chat.js

export const DEFAULT_MAX_HISTORY = 100;
export const MAX_TEXT_LEN = 200;
export const DEFAULT_RATE_COUNT = 5;
export const DEFAULT_RATE_WINDOW_MS = 5000;

export class ChatManager {
  constructor({
    maxHistory = DEFAULT_MAX_HISTORY,
    rateCount = DEFAULT_RATE_COUNT,
    rateWindowMs = DEFAULT_RATE_WINDOW_MS,
    store = null, // опционально: SQLite-персистентность истории
  } = {}) {
    this.maxHistory = maxHistory;
    this.rateCount = rateCount;
    this.rateWindowMs = rateWindowMs;
    this.store = store;
    this.history = new Map(); // key -> [msg]
    this.rate = new Map(); // playerId -> [ts]
  }

  _key(scope, id) { return scope === "global" ? "global" : `${scope}:${id}`; }

  sanitize(text) {
    return String(text ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "") // управляющие символы
      .slice(0, MAX_TEXT_LEN)
      .trim();
  }

  // Разрешён ли ещё один месседж от игрока (скользящее окно).
  allow(playerId, now = Date.now()) {
    const arr = (this.rate.get(playerId) || []).filter((t) => now - t < this.rateWindowMs);
    if (arr.length >= this.rateCount) { this.rate.set(playerId, arr); return false; }
    arr.push(now);
    this.rate.set(playerId, arr);
    return true;
  }

  // Отправить сообщение. Возвращает { message } или { error }.
  send(scope, id, { playerId, name, text, ts = Date.now() }) {
    const clean = this.sanitize(text);
    if (!clean) return { error: "empty" };
    if (!this.allow(playerId, ts)) return { error: "rate-limit" };
    const message = {
      scope,
      id: scope === "global" ? null : id,
      from: playerId,
      name: String(name ?? "Игрок").slice(0, 40),
      text: clean,
      ts,
    };
    const key = this._key(scope, id);
    const arr = this.history.get(key) || [];
    arr.push(message);
    while (arr.length > this.maxHistory) arr.shift();
    this.history.set(key, arr);
    if (this.store) {
      try { this.store.insertChat(message); } catch { /* персистентность не критична */ }
    }
    return { message };
  }

  getHistory(scope, id) {
    const mem = this.history.get(this._key(scope, id)) || [];
    if (!this.store) return [...mem];
    let persisted = [];
    try { persisted = this.store.listChat(scope, scope === "global" ? null : id, this.maxHistory); } catch { /* ignore */ }
    const seen = new Set();
    const out = [];
    for (const m of [...persisted, ...mem]) {
      const k = `${m.ts}|${m.from}|${m.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out.slice(-this.maxHistory);
  }

  clear(id) {
    this.history.delete(`lobby:${id}`);
  }
}

export default ChatManager;
