// ports.js — порты (интерфейсы) слоя netcode. Внутренний код зависит только от них,
// конкретные реализации (jsnes, WebRTC, WebSocket) подаются адаптерами извне.
//
// Типы описаны через JSDoc (проект на JS) и служат контрактом для адаптеров и тестов.
//
// @typedef {object} GameCore
// @property {(inputs: Array<{port:number,buttons:number}>)=>string} stepFrame
// @property {()=>Uint8Array} saveState
// @property {(bytes:Uint8Array)=>void} loadState
// @property {()=>string} getFrameHash
// @property {(v:boolean)=>void} [setAudioSuppressed]
//
// @typedef {object} Transport
// @property {(buf:Uint8Array)=>void} send
// @property {(cb:(buf:Uint8Array)=>void)=>void} onMessage
// @property {(cb:()=>void)=>void} [onClose]
// @property {()=>boolean} [isOpen]
//
// @typedef {object} Clock
// @property {()=>number} now
//
// @typedef {object} EventSink
// @property {(event:object)=>void} emit
//
// @typedef {object} Logger
// @property {(msg:string)=>void} warn
// @property {(msg:string)=>void} error

/** Системные часы (монотонные миллисекунды). Для тестов подменяются fake Clock. */
export const systemClock = {
  now() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  },
};

export default { systemClock };
