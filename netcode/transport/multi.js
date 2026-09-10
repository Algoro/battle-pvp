// multi.js — мультиплекс N транспортов в один логический (для 2v2 / N игроков).
//
// Вещание: send() уходит во ВСЕ транспорты; входящие сообщения объединяются в один
// поток onMessage. Порты танков уникальны по клиентам, поэтому ввод из разных
// транспортов не конфликтует; hash-пакеты всех пиров должны совпадать.
//
// Контракт совместим с RollbackSession: { send, onMessage, onClose?, isOpen? }.
//
// Относительный путь: ./netcode/transport/multi.js
export class MultiTransport {
  /**
   * @param {Array<{send:Function,onMessage:Function,onClose?:Function,isOpen?:Function,close?:Function}>} transports
   */
  constructor(transports = []) {
    this.transports = [];
    this.cb = null;
    this.closeCb = null;
    this._wrappers = new Map(); // transport -> handler
    for (const t of transports) this.addTransport(t);
  }

  addTransport(t) {
    if (!t || this._wrappers.has(t)) return;
    const handler = (buf) => { if (this.cb) this.cb(buf); };
    t.onMessage(handler);
    this._wrappers.set(t, handler);
    t._multiCloseHandler = () => {
      this.transports = this.transports.filter((x) => x !== t);
      if (this.closeCb) this.closeCb(t);
    };
    if (typeof t.onClose === "function") t.onClose(t._multiCloseHandler);
    this.transports.push(t);
  }

  removeTransport(t) {
    if (!this._wrappers.has(t)) return;
    if (typeof t.close === "function") t.close();
    this._wrappers.delete(t);
    this.transports = this.transports.filter((x) => x !== t);
  }

  onMessage(cb) { this.cb = cb; }

  // Вызывается, когда любой из транспортов закрывается (для реконнекта).
  onClose(cb) { this.closeCb = cb; }

  send(buf) {
    for (const t of this.transports) t.send(buf);
  }

  isOpen() {
    return this.transports.some((t) => (typeof t.isOpen === "function" ? t.isOpen() : true));
  }

  close() {
    for (const t of [...this.transports]) this.removeTransport(t);
  }
}

export default MultiTransport;
