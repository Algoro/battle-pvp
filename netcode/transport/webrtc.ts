// webrtc.ts — транспорт на WebRTC DataChannel (основной, P2P).
// Конформно интерфейсу { send, onMessage }.
//
// Использование (в браузере/Node с WebRTC):
//   const dc = pc.createDataChannel("rollback");
//   const t = new WebRTCTransport(dc);
//   t.onMessage(cb); t.send(buf);
//
// Сопряжение каналов (signaling) выполняет Agent-Backend (см. ./backend/signaling).
//
// Относительный путь: ./netcode/transport/webrtc.ts

// Минимальный структурный тип RTCDataChannel (без зависимости от DOM lib).
export interface RTCDataChannelLike {
  binaryType: string;
  readonly readyState: string;
  addEventListener(type: string, cb: (ev: { data: any }) => void): void;
  removeEventListener(type: string, cb: (ev: { data: any }) => void): void;
  send(data: ArrayBufferLike): void;
  close(): void;
}

export class WebRTCTransport {
  channel: RTCDataChannelLike;
  cb: ((buf: Uint8Array) => void) | null = null;
  closeCb: (() => void) | null = null;
  private _closed = false;

  private _onMessage = (ev: { data: any }): void => {
    const buf =
      ev.data instanceof ArrayBuffer ? new Uint8Array(ev.data) : new Uint8Array(ev.data);
    if (this.cb) this.cb(buf);
  };

  private _onClose = (): void => this._notifyClosed();

  /**
   * @param channel  открытый DataChannel
   */
  constructor(channel: RTCDataChannelLike) {
    this.channel = channel;
    this.channel.addEventListener("message", this._onMessage);
    this.channel.addEventListener("close", this._onClose);
    this.channel.binaryType = "arraybuffer";
  }

  onMessage(cb: (buf: Uint8Array) => void): void {
    this.cb = cb;
  }

  onClose(cb: () => void): void {
    this.closeCb = cb;
    if (this._closed) cb();
  }

  isOpen(): boolean {
    return !this._closed && this.channel.readyState === "open";
  }

  private _notifyClosed(): void {
    if (this._closed) return;
    this._closed = true;
    if (this.closeCb) this.closeCb();
  }

  send(buf: Uint8Array): void {
    if (this.channel.readyState === "open") {
      // отправляем копию, т.к. Uint8Array может быть переиспользован
      this.channel.send(buf.slice().buffer);
    }
  }

  close(): void {
    this.channel.removeEventListener("message", this._onMessage);
    this.channel.removeEventListener("close", this._onClose);
    this._notifyClosed();
    this.channel.close();
  }
}

export default WebRTCTransport;
