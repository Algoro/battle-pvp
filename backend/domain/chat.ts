// chat.ts — lobby chat: a global channel + one channel per lobby (domain).
// Storage is an in-memory ring buffer; long-term history is delegated to the
// ChatRepository port (see backend/ports.ts). Rate limiting and sanitization are domain rules.
//
// Relative path: ./backend/domain/chat.ts
import { systemClock, type Clock } from "./clock.ts";
import type { ChatMessage, ChatRepository } from "../ports.ts";

export const DEFAULT_MAX_HISTORY = 100;
export const MAX_TEXT_LEN = 200;
export const DEFAULT_RATE_COUNT = 5;
export const DEFAULT_RATE_WINDOW_MS = 5000;

export interface ChatManagerOptions {
  maxHistory?: number;
  rateCount?: number;
  rateWindowMs?: number;
  repository?: ChatRepository | null;
  clock?: Clock;
}

export interface ChatSendInput {
  playerId: string;
  name?: string | null;
  text: unknown;
  ts?: number;
}

export class ChatManager {
  maxHistory: number;
  rateCount: number;
  rateWindowMs: number;
  repository: ChatRepository | null;
  clock: Clock;
  history: Map<string, ChatMessage[]>; // key -> [msg]
  rate: Map<string, number[]>; // playerId -> [ts]

  constructor({
    maxHistory = DEFAULT_MAX_HISTORY,
    rateCount = DEFAULT_RATE_COUNT,
    rateWindowMs = DEFAULT_RATE_WINDOW_MS,
    repository = null,
    clock = systemClock,
  }: ChatManagerOptions = {}) {
    this.maxHistory = maxHistory;
    this.rateCount = rateCount;
    this.rateWindowMs = rateWindowMs;
    this.repository = repository;
    this.clock = clock;
    this.history = new Map();
    this.rate = new Map();
  }

  _key(scope: string, id: string | null): string {
    return scope === "global" ? "global" : `${scope}:${id}`;
  }

  sanitize(text: unknown): string {
    return String(text ?? "")
      .replace(/[\u0000-\u001f\u007f]/g, "") // control characters
      .slice(0, MAX_TEXT_LEN)
      .trim();
  }

  // Whether another message from the player is allowed (sliding window).
  allow(playerId: string, now: number = this.clock.now()): boolean {
    const arr = (this.rate.get(playerId) || []).filter((t) => now - t < this.rateWindowMs);
    if (arr.length >= this.rateCount) {
      this.rate.set(playerId, arr);
      return false;
    }
    arr.push(now);
    this.rate.set(playerId, arr);
    return true;
  }

  // Send a message. Returns { message } or { error }.
  send(
    scope: string,
    id: string | null,
    { playerId, name, text, ts = this.clock.now() }: ChatSendInput,
  ): { message: ChatMessage } | { error: string } {
    const clean = this.sanitize(text);
    if (!clean) return { error: "empty" };
    if (!this.allow(playerId, ts)) return { error: "rate-limit" };
    const message: ChatMessage = {
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
    if (this.repository) {
      try {
        this.repository.insert(message);
      } catch {
        /* persistence is not critical */
      }
    }
    return { message };
  }

  getHistory(scope: string, id: string | null): ChatMessage[] {
    const mem = this.history.get(this._key(scope, id)) || [];
    if (!this.repository) return [...mem];
    let persisted: ChatMessage[] = [];
    try {
      persisted = this.repository.list(scope, scope === "global" ? null : id, this.maxHistory);
    } catch {
      /* ignore */
    }
    const seen = new Set<string>();
    const out: ChatMessage[] = [];
    for (const m of [...persisted, ...mem]) {
      const k = `${m.ts}|${m.from}|${m.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(m);
    }
    return out.slice(-this.maxHistory);
  }

  clear(id: string): void {
    this.history.delete(`lobby:${id}`);
  }
}

export default ChatManager;
