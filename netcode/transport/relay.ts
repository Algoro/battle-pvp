// relay.ts — relay transport (fallback for symmetric NAT).
// Routes frames through the backend relay (Agent-Backend, ./backend).
//
// The { send, onMessage } interface contract is preserved. The difference from WebRTC:
// bytes go not directly P2P, but through a server relay by room/match identifier.
//
// Relay WebSocket protocol (details in docs/netcode.md):
//   client -> server:  {type:"relay.data", matchId, to:peerId, data: base64}
//   server -> client:  {type:"relay.data", matchId, from:peerId, data: base64}
//
// Relative path: ./netcode/transport/relay.ts

// Minimal structural WebSocket type: fits both the browser WebSocket and ws-compatible ones.
export interface WebSocketLike {
  readonly readyState: number;
  addEventListener(type: string, cb: (ev: any) => void): void;
  removeEventListener(type: string, cb: (ev: any) => void): void;
  send(data: string): void;
}

export class RelayTransport {
  socket: WebSocketLike;
  matchId: string;
  peerId: string;
  cb: ((buf: Uint8Array) => void) | null = null;
  closeCb: (() => void) | null = null;
  private _closed = false;

  private _onMsg = (ev: { data: string }): void => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "relay.data" && msg.matchId === this.matchId && msg.from === this.peerId) {
      const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
      if (this.cb) this.cb(bytes);
    }
  };

  private _onClose = (): void => this._notifyClosed();

  /**
   * @param socket   connection to the relay
   * @param matchId  match identifier
   * @param peerId   target client identifier
   */
  constructor(socket: WebSocketLike, matchId: string, peerId: string) {
    this.socket = socket;
    this.matchId = matchId;
    this.peerId = peerId;
    this.socket.addEventListener("message", this._onMsg);
    this.socket.addEventListener("close", this._onClose);
    this.socket.addEventListener("error", this._onClose);
  }

  onMessage(cb: (buf: Uint8Array) => void): void {
    this.cb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
    if (this._closed) cb();
  }

  isOpen(): boolean {
    return !this._closed && this.socket?.readyState === 1; // WebSocket.OPEN
  }

  private _notifyClosed(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.closeCb) this.closeCb();
  }

  send(buf: Uint8Array): void {
    const data = btoa(String.fromCharCode(...buf));
    this.socket.send(
      JSON.stringify({ type: "relay.data", matchId: this.matchId, to: this.peerId, data }),
    );
  }

  close(): void {
    this.socket.removeEventListener("message", this._onMsg);
    this.socket.removeEventListener("close", this._onClose);
    this.socket.removeEventListener("error", this._onClose);
    this._notifyClosed();
  }
}

export default RelayTransport;
