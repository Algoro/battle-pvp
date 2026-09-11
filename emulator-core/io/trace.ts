// trace.js — трейс решений/смертей ИИ (лог с ограничением по размеру).
// Вынесено из PvPNes (декомпозиция god-объекта): ядро только вызывает event/detectDeaths.
// Относительный путь: ./emulator-core/io/trace.js
import { RAM } from "../rom-contract.ts";
import { isTankAlive } from "../domain.ts";

export class Tracer {
  cap: number;
  items: any[];
  seq: number;
  enabled: boolean;
  prevAliveMask: number;
  constructor(cap = 500) {
    this.cap = Math.max(1, cap | 0);
    this.items = [];
    this.seq = 0;
    this.enabled = false;
    this.prevAliveMask = 0;
  }

  setEnabled(v: unknown): this { this.enabled = !!v; this.prevAliveMask = 0; return this; }
  setCap(n: number): this { this.cap = Math.max(1, n | 0); return this; }
  get(): any[] { return this.items.slice(); }
  clear(): this { this.items.length = 0; return this; }

  event(frame: number, ev: any): void {
    if (!this.enabled) return;
    this.items.push({ id: this.seq++, frame, ...ev });
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  // Детект смертей танков (флаг 0x90..0xd0 => живой) и запись событий.
  detectDeaths(frame: number, mem: any): void {
    if (!this.enabled) return;
    let now = 0;
    for (let t = 0; t < 8; t++) {
      const hi = mem[RAM.TANK_FLAG + t] & 0xf0;
      if (isTankAlive(hi)) now |= 1 << t;
    }
    const died = this.prevAliveMask & ~now;
    for (let t = 0; t < 8; t++) {
      if (died & (1 << t)) this.event(frame, { side: t < 2 ? "def" : "att", tank: t, event: "dead" });
    }
    this.prevAliveMask = now;
  }
}

export default Tracer;
