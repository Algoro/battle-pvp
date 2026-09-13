// multi.ts — multiplexes N transports into one logical transport (for 2v2 / N players).
//
// Broadcast: send() goes to ALL transports; incoming messages are merged into a single
// onMessage stream. Tank ports are unique per client, so input from different
// transports does not conflict; hash packets from all peers must match.
//
// The contract is compatible with RollbackSession: { send, onMessage, onClose?, isOpen? }.
//
// Relative path: ./netcode/transport/multi.ts
import type { Transport } from "../ports.ts";

export interface ManagedTransport extends Transport {
  close?(): void;
  _multiCloseHandler?: (t?: ManagedTransport) => void;
}

export class MultiTransport {
  transports: ManagedTransport[] = [];
  cb: ((buf: Uint8Array) => void) | null = null;
  closeCb: ((t?: ManagedTransport) => void) | null = null;
  _wrappers: Map<ManagedTransport, (buf: Uint8Array) => void> = new Map(); // transport -> handler

  constructor(transports: ManagedTransport[] = []) {
    for (const t of transports) this.addTransport(t);
  }

  addTransport(t: ManagedTransport): void {
    if (!t || this._wrappers.has(t)) return;
    const handler = (buf: Uint8Array): void => {
      if (this.cb) this.cb(buf);
    };
    t.onMessage(handler);
    this._wrappers.set(t, handler);
    t._multiCloseHandler = (): void => {
      this.transports = this.transports.filter((x) => x !== t);
      if (this.closeCb) this.closeCb(t);
    };
    if (typeof t.onClose === "function") t.onClose(t._multiCloseHandler);
    this.transports.push(t);
  }

  removeTransport(t: ManagedTransport): void {
    if (!this._wrappers.has(t)) return;
    if (typeof t.close === "function") t.close();
    this._wrappers.delete(t);
    this.transports = this.transports.filter((x) => x !== t);
  }

  onMessage(cb: (buf: Uint8Array) => void): void {
    this.cb = cb;
  }

  // Called when any of the transports closes (for reconnection).
  onClose(cb: (t?: ManagedTransport) => void): void {
    this.closeCb = cb;
  }

  send(buf: Uint8Array): void {
    for (const t of this.transports) t.send(buf);
  }

  isOpen(): boolean {
    return this.transports.some((t) => (typeof t.isOpen === "function" ? t.isOpen() : true));
  }

  close(): void {
    for (const t of [...this.transports]) this.removeTransport(t);
  }
}

export default MultiTransport;
