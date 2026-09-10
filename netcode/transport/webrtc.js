// webrtc.js — транспорт на WebRTC DataChannel (основной, P2P).
// Конформно интерфейсу { send, onMessage }.
//
// Использование (в браузере/Node с WebRTC):
//   const dc = pc.createDataChannel("rollback");
//   const t = new WebRTCTransport(dc);
//   t.onMessage(cb); t.send(buf);
//
// Сопряжение каналов (signaling) выполняет Agent-Backend (см. ./backend/signaling).
//
// Относительный путь: ./netcode/transport/webrtc.js
export class WebRTCTransport {
  /**
   * @param {RTCDataChannel} channel  — открытый DataChannel
   */
  constructor(channel) {
    this.channel = channel;
    this.cb = null;
    this.closeCb = null;
    this._closed = false;
    this._onMessage = (ev) => {
      const buf = ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data);
      if (this.cb) this.cb(buf);
    };
    this._onClose = () => this._notifyClosed();
    this.channel.addEventListener("message", this._onMessage);
    this.channel.addEventListener("close", this._onClose);
    this.channel.binaryType = "arraybuffer";
  }

  onMessage(cb) {
    this.cb = cb;
  }

  onClose(cb) {
    this.closeCb = cb;
    if (this._closed) cb();
  }

  isOpen() {
    return !this._closed && this.channel.readyState === "open";
  }

  _notifyClosed() {
    if (this._closed) return;
    this._closed = true;
    if (this.closeCb) this.closeCb();
  }

  send(buf) {
    if (this.channel.readyState === "open") {
      // отправляем копию, т.к. Uint8Array может быть переиспользован
      this.channel.send(buf.slice().buffer);
    }
  }

  close() {
    this.channel.removeEventListener("message", this._onMessage);
    this.channel.removeEventListener("close", this._onClose);
    this._notifyClosed();
    this.channel.close();
  }
}

export default WebRTCTransport;
