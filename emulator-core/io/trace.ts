// trace.js — trace of AI decisions/deaths (log with a size limit).
// Extracted from PvPNes (decomposing the god object): the core only calls event/detectDeaths.
// Relative path: ./emulator-core/io/trace.js
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

  // Detect tank deaths (flag 0x90..0xd0 => alive) and record events.
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
