// relay.js — relay-транспорт (fallback при симметричном NAT).
// Маршрутизирует фреймы через backend-релей (Agent-Backend, ./backend).
//
// Контракт интерфейса { send, onMessage } сохранён. Отличие от WebRTC:
// байты идут не напрямую P2P, а через сервер-релей по комнате/матч-идентификатору.
//
// WebSocket-протокол релея (детали — в docs/netcode.md):
//   client -> server:  {type:"relay.data", matchId, to:peerId, data: base64}
//   server -> client:  {type:"relay.data", matchId, from:peerId, data: base64}
//
// Относительный путь: ./netcode/transport/relay.js
export class RelayTransport {
  /**
   * @param {WebSocket} socket     — подключение к релею
   * @param {string} matchId       — идентификатор матча
   * @param {string} peerId        — идентификатор целевого клиента
   */
  constructor(socket, matchId, peerId) {
    this.socket = socket;
    this.matchId = matchId;
    this.peerId = peerId;
    this.cb = null;
    this.closeCb = null;
    this._closed = false;
    this._onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "relay.data" && msg.matchId === this.matchId && msg.from === this.peerId) {
        const bytes = Uint8Array.from(atob(msg.data), (c) => c.charCodeAt(0));
        if (this.cb) this.cb(bytes);
      }
    };
    this._onClose = () => this._notifyClosed();
    this.socket.addEventListener("message", this._onMsg);
    this.socket.addEventListener("close", this._onClose);
    this.socket.addEventListener("error", this._onClose);
  }

  onMessage(cb) {
    this.cb = cb;
  }

  onClose(cb) {
    this.closeCb = cb;
    if (this._closed) cb();
  }

  isOpen() {
    return !this._closed && this.socket?.readyState === 1; // WebSocket.OPEN
  }

  _notifyClosed() {
    if (this._closed) return;
    this._closed = true;
    if (this.closeCb) this.closeCb();
  }

  send(buf) {
    const data = btoa(String.fromCharCode(...buf));
    this.socket.send(
      JSON.stringify({ type: "relay.data", matchId: this.matchId, to: this.peerId, data }),
    );
  }

  close() {
    this.socket.removeEventListener("message", this._onMsg);
    this.socket.removeEventListener("close", this._onClose);
    this.socket.removeEventListener("error", this._onClose);
    this._notifyClosed();
  }
}

export default RelayTransport;
