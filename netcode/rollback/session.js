// session.js — rollback-сессия (аналог GGPO) поверх детерминированного ядра.
//
// Принцип:
//  1. На каждом кадре сохраняем saveState() в ring-buffer (окно = window кадров).
//  2. Полный ввод кадра = мои порты + (полученный/предсказанный ввод соперника).
//     Предсказание по умолчанию — «повтор последнего известного ввода соперника».
//  3. Когда приходит поздний ввод соперника для уже симулированного кадра — откат
//     к состоянию этого кадра и переигровка вперёд с корректными входами.
//  4. Desync detection: периодически шлём getFrameHash() кадра; расхождение — событие.
//  5. Задержка: периодические ping/pong (событие "latency").
//  6. Реконнект: rebindTransport() перевешивает сессию на новый транспорт.
//  7. Desync-recovery: не-авторитетный клиент запрашивает полный снапшот у авторитета
//     (меньший playerId) и восстанавливается на его кадре (событие "resync").
//
// Относительный путь: ./netcode/rollback/session.js
import {
  encodeFrameBatch,
  decodeFrameBatch,
  decodeFrame,
  encodeHashCheck,
  decodeHashCheck,
  encodePing,
  encodePong,
  decodePing,
  decodePong,
  encodeSnapshotRequest,
  decodeSnapshotRequest,
  decodeSnapshotChunk,
  encodeSnapshot,
} from "../protocol/frame.js";

export const HASH_INTERVAL = 30; // сверка хэша каждые 30 кадров
export const PING_INTERVAL = 60; // ping каждые 60 кадров
export const PING_TIMEOUT = 600; // нет pong — считаем соперника недоступным (10 c)
export const DEFAULT_REDUNDANCY = 4; // сколько последних кадров дублировать в каждом пакете

// 32-битные монотонные миллисекунды для измерения RTT (Date.now() не влезает в uint32).
function now32() {
  const t = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  return t >>> 0;
}

export class RollbackSession {
  /**
   * @param {object} opts
   * @param {object} opts.game        — ядро: stepFrame(inputs), saveState(), loadState(), getFrameHash()
   * @param {object} opts.transport   — { send(buf), onMessage(cb), onClose?(cb), isOpen?() }
   * @param {number[]} opts.myPorts    — порты, которыми управляет этот клиент
   * @param {number[]} opts.remotePorts— порты соперника
   * @param {(ev: object)=>void} opts.onEvent
   * @param {number} opts.window       — размер окна состояний (кадров)
   * @param {string} [opts.playerId]       — мой id (для определения авторитета)
   * @param {string} [opts.remotePeerId]   — id соперника
   * @param {boolean} [opts.authority]     — явно задать авторитет (иначе меньший playerId)
   * @param {boolean} [opts.recovery]      — включить desync-recovery (по умолчанию true)
   * @param {number} [opts.redundancy]     — сколько последних кадров дублировать в пакете
   */
  constructor(opts) {
    this.game = opts.game;
    this.myPorts = opts.myPorts;
    this.remotePorts = opts.remotePorts;
    this.onEvent = opts.onEvent || (() => {});
    this.window = opts.window || 120;
    this.confirmDelay = opts.confirmDelay || 20; // кадров до «подтверждения» (сверка хэша)
    // Разреженные чекпоинты состояний: сохраняем полный saveState() не каждый кадр,
    // а раз в checkpointInterval. Откат к промежуточному кадру = загрузка ближайшего
    // чекпоинта + пере-симуляция до целевого кадра по сохранённым вводам (myInputsHistory
    // + remoteUsed). Экономит память (окно×state -> окно/интервал) и аллокации saveState.
    this.checkpointInterval = Math.max(1, opts.checkpointInterval || 8);
    this.playerId = opts.playerId ?? null;
    this.remotePeerId = opts.remotePeerId ?? null;
    this.recovery = opts.recovery !== false;
    this.redundancy = opts.redundancy ?? DEFAULT_REDUNDANCY;
    this.pingInterval = opts.pingInterval || PING_INTERVAL;
    this.pingTimeout = opts.pingTimeout || PING_TIMEOUT;

    this.currentFrame = 0;
    this.remoteHeadFrame = -1; // следующий кадр соперника (для догона после resync)
    this._needCatchUp = false;
    this.lastRemoteInput = {}; // port -> последние buttons (для предсказания)
    this.remoteInputs = new Map(); // frame -> [inputs] (порты соперника)
    this.remoteUsed = new Map(); // frame -> [inputs], реально применённые при симуляции
    this.myInputsHistory = new Map(); // frame -> inputs (мои порты)
    this.states = new Map(); // frame -> saveState() bytes
    this.hashHistory = new Map(); // frame -> getFrameHash()
    this.desyncCount = 0;
    this.rollbackCount = 0;
    this.skippedRollbacks = 0; // откаты, пропущенные т.к. ввод совпал с предсказанием
    this.lastUsed = new Map(); // frame -> [ [port,buttons], ... ] финальные входы (для отладки)

    // Связь
    this.latency = 0; // ms
    this.pingSeq = 0;
    this.lastPongFrame = 0; // на каком кадре обновлялся pong
    this.peerUnresponsive = false;
    this.transportClosed = false;

    // Desync-recovery
    this.resyncing = false;
    this._snap = null;
    this._authority = opts.authority;

    this._bindTransport(opts.transport);
  }

  _bindTransport(transport) {
    this.transport = transport;
    if (!transport) return;
    transport.onMessage((buf) => this._onMessage(buf));
    if (typeof transport.onClose === "function") {
      transport.onClose(() => this._onTransportClosed());
    }
  }

  // Меньший playerId — авторитет (его состояние источник истины при resync).
  isAuthority() {
    if (typeof this._authority === "boolean") return this._authority;
    if (this.playerId && this.remotePeerId) return this.playerId < this.remotePeerId;
    return true;
  }

  // Перевесить сессию на новый транспорт (после реконнекта).
  rebindTransport(transport) {
    this._bindTransport(transport);
    this.transportClosed = false;
    this.peerUnresponsive = false;
    this.lastPongFrame = this.currentFrame;
    this.onEvent({ type: "transport-rebound" });
  }

  _onTransportClosed() {
    if (this.transportClosed) return;
    this.transportClosed = true;
    this.onEvent({ type: "transport-closed", frame: this.currentFrame });
  }

  _predictedRemote() {
    const out = [];
    for (const port of this.remotePorts) {
      out.push({ port, buttons: this.lastRemoteInput[port] ?? 0 });
    }
    return out;
  }

  // Сохранить чекпоинт состояния ПЕРЕД кадром f (только на границах интервала).
  _saveCheckpoint(f) {
    if (f % this.checkpointInterval === 0) this.states.set(f, this.game.saveState());
  }

  // Один шаг симуляции кадра (без отправки/событий) — используется и при догоне.
  _coreStep(myInputs) {
    const f = this.currentFrame;
    this._saveCheckpoint(f);
    const remote = this.remoteInputs.get(f) || this._predictedRemote();
    const full = [...myInputs, ...remote];
    this.lastUsed.set(f, full.map((x) => [x.port, x.buttons]));
    this.remoteUsed.set(f, remote.map((x) => ({ port: x.port, buttons: x.buttons })));
    this.myInputsHistory.set(f, myInputs);
    const h = this.game.stepFrame(full);
    this.hashHistory.set(f, h);
    this._prune(f);
    this.currentFrame++;
    return h;
  }

  advanceFrame(myInputs) {
    // Догон после resync: доводим счётчик до кадра соперника (пропущенные кадры
    // симулируем с предсказанием; реальные вводы исправят их через rollback).
    if (this._needCatchUp && this.remoteHeadFrame > this.currentFrame) {
      let guard = 0;
      this.game.setAudioSuppressed?.(true);
      while (this.currentFrame < this.remoteHeadFrame && guard++ < 300) {
        this._coreStep(myInputs);
      }
      this.game.setAudioSuppressed?.(false);
      this._needCatchUp = false;
      this.onEvent({ type: "catch-up", frame: this.currentFrame });
    }

    const f = this.currentFrame;
    const h = this._coreStep(myInputs);

    // отправляем свой ввод сопернику — избыточно (последние N кадров),
    // чтобы потеря одиночного пакета не приводила к необратимому desync.
    this._sendInputBatch(f);

    // периодическая сверка хэша ТОЛЬКО подтверждённых кадров (в прошлом),
    // чтобы не ловить ложные desync от ещё не согласованных предсказаний
    const confirmed = f - this.confirmDelay;
    if (confirmed >= 0 && confirmed % HASH_INTERVAL === 0) {
      this.transport.send(encodeHashCheck(confirmed, this.hashHistory.get(confirmed)));
    }

    // ping (задержка) и детект «соперник молчит»
    if (f % this.pingInterval === 0) this._sendPing(f);
    if (f - this.lastPongFrame > this.pingTimeout && !this.peerUnresponsive) {
      this.peerUnresponsive = true;
      this.onEvent({ type: "peer-unresponsive", frame: f });
    }

    this.onEvent({ type: "frame", frame: f, hash: h });
    return h;
  }

  _sendInputBatch(f) {
    const from = Math.max(0, f - this.redundancy + 1);
    const entries = [];
    for (let k = from; k <= f; k++) {
      const inputs = this.myInputsHistory.get(k);
      if (inputs) entries.push({ frame: k, inputs });
    }
    if (entries.length) this.transport.send(encodeFrameBatch(entries, f + 1));
  }

  _sendPing(f) {
    const seq = this.pingSeq++;
    this.transport.send(encodePing(seq, now32()));
    this._lastPingFrame = f;
  }

  _prune(f) {
    const cutoff = f - this.window;
    for (const key of this.states.keys()) if (key < cutoff) this.states.delete(key);
    for (const key of this.remoteInputs.keys()) if (key < cutoff) this.remoteInputs.delete(key);
    for (const key of this.remoteUsed.keys()) if (key < cutoff) this.remoteUsed.delete(key);
    for (const key of this.myInputsHistory.keys()) if (key < cutoff) this.myInputsHistory.delete(key);
    for (const key of this.hashHistory.keys()) if (key < cutoff) this.hashHistory.delete(key);
  }

  _onMessage(buf) {
    const batch = decodeFrameBatch(buf);
    if (batch) {
      if (typeof batch.headFrame === "number") this.remoteHeadFrame = batch.headFrame;
      for (const { frame, inputs } of batch.frames) this._onRemoteInput(frame, inputs);
      return;
    }
    const inp = decodeFrame(buf);
    if (inp) return this._onRemoteInput(inp.frame, inp.inputs);
    const hc = decodeHashCheck(buf);
    if (hc) return this._onHashCheck(hc);
    const ping = decodePing(buf);
    if (ping) return this._onPing(ping);
    const pong = decodePong(buf);
    if (pong) return this._onPong(pong);
    const req = decodeSnapshotRequest(buf);
    if (req) return this._onSnapshotRequest(req);
    const snap = decodeSnapshotChunk(buf);
    if (snap) return this._onSnapshotChunk(snap);
    this.onEvent({ type: "unknown-packet" });
  }

  _onRemoteInput(frame, inputs) {
    const known = this.remoteInputs.get(frame);
    // дедупликация: избыточная отправка не должна повторно применять тот же ввод
    const fresh = [];
    for (const inp of inputs) {
      if (known && known.some((x) => x.port === inp.port)) continue;
      fresh.push(inp);
    }
    if (!fresh.length) return;
    for (const { port, buttons } of fresh) this.lastRemoteInput[port] = buttons;
    if (!known) this.remoteInputs.set(frame, []);
    this.remoteInputs.get(frame).push(...fresh);

    if (frame < this.currentFrame) {
      // Откат нужен только если пришедший ввод ОТЛИЧАЕТСЯ от предсказанного
      // (иначе пере-симуляция даст то же состояние — пропускаем: экономия CPU и
      // меньше визуальных «прыжков» удалённого танка).
      const used = this.remoteUsed.get(frame);
      if (used && this._remoteEqual(used, this.remoteInputs.get(frame))) {
        this.skippedRollbacks++;
        this.onEvent({ type: "rollback-skipped", frame });
        return;
      }
      this._rollback(frame);
    }
  }

  // Совпадает ли применённый ранее ввод с текущим (по портам и кнопкам).
  _remoteEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].port !== b[i].port || a[i].buttons !== b[i].buttons) return false;
    }
    return true;
  }

  // Восстановить состояние ПЕРЕД кадром frame из ближайшего чекпоинта + пере-симуляция.
  // Возвращает байты состояния или undefined, если чекпоинт за окном.
  _materialize(frame) {
    if (this.states.has(frame)) return this.states.get(frame);
    let cp = -1;
    for (const k of this.states.keys()) if (k <= frame && k > cp) cp = k;
    if (cp < 0) return undefined;
    this.game.loadState(this.states.get(cp));
    this.currentFrame = cp;
    while (this.currentFrame < frame) {
      const f = this.currentFrame;
      const mine = this.myInputsHistory.get(f) || [];
      const remote = this.remoteUsed.get(f) || this.remoteInputs.get(f) || this._predictedRemote();
      this.game.stepFrame([...mine, ...remote]);
      this.currentFrame++;
    }
    const st = this.game.saveState();
    if (frame % this.checkpointInterval === 0) this.states.set(frame, st);
    return st;
  }

  _rollback(fromFrame) {
    const target = this.currentFrame;
    // Во время отката/переигровки глушим аудио (иначе повторная эмиссия сэмплов).
    this.game.setAudioSuppressed?.(true);
    const st = this._materialize(fromFrame);
    if (st === undefined) {
      this.game.setAudioSuppressed?.(false);
      this.onEvent({ type: "rollback-window-exceeded", frame: fromFrame });
      return;
    }
    this.game.loadState(st);
    this.currentFrame = fromFrame;
    this.rollbackCount++;
    this.onEvent({ type: "rollback", fromFrame, toFrame: target });

    // переигровка вперёд с буферизованными/предсказанными входами.
    // ВАЖНО: чекпоинты пересохраняются на границах интервала.
    while (this.currentFrame < target) {
      const f = this.currentFrame;
      this._saveCheckpoint(f);
      const mine = this.myInputsHistory.get(f) || [];
      const remote = this.remoteInputs.get(f) || this._predictedRemote();
      const full = [...mine, ...remote];
      this.lastUsed.set(f, full.map((x) => [x.port, x.buttons]));
      this.remoteUsed.set(f, remote.map((x) => ({ port: x.port, buttons: x.buttons })));
      const h = this.game.stepFrame(full);
      this.hashHistory.set(f, h);
      this.currentFrame++;
    }
    this.game.setAudioSuppressed?.(false);
  }

  _onHashCheck({ frame, hash }) {
    // сравниваем только если кадр подтверждён и на нашей стороне
    if (this.currentFrame - frame < this.confirmDelay) return;
    const local = this.hashHistory.get(frame);
    if (local === undefined) {
      this.onEvent({ type: "hash-unknown", frame });
      return;
    }
    if (local !== hash) {
      this.desyncCount++;
      this.onEvent({ type: "desync", frame, localHash: local, remoteHash: hash });
      // не-авторитет запрашивает снапшот у авторитета
      if (this.recovery && !this.isAuthority()) this._requestResync(frame);
    }
  }

  _onPing({ seq, t }) {
    this.transport.send(encodePong(seq, t));
  }

  _onPong({ t }) {
    this.lastPongFrame = this.currentFrame;
    this.peerUnresponsive = false;
    const rtt = now32() - (t >>> 0);
    // защита от некорректных/огромных значений
    if (rtt >= 0 && rtt < 60000) {
      this.latency = rtt;
      this.onEvent({ type: "latency", ms: rtt });
    }
  }

  // --- desync-recovery ---
  _requestResync(frame) {
    if (this.resyncing) return;
    this.resyncing = true;
    this.onEvent({ type: "resync-request", frame });
    this.transport.send(encodeSnapshotRequest(frame));
  }

  _onSnapshotRequest() {
    // отвечает только авторитет
    if (!this.isAuthority()) return;
    const frame = this.currentFrame;
    const hash = this.hashHistory.get(frame - 1) || "00000000";
    const bytes = this.game.saveState();
    for (const pkt of encodeSnapshot(frame, hash, bytes)) this.transport.send(pkt);
    this.onEvent({ type: "snapshot-sent", frame, bytes: bytes.length });
  }

  _onResume() {
    /* зарезервировано: сервер/пир может явно снять паузу после resync */
  }

  _onSnapshotChunk(chunk) {
    if (!this.resyncing) return;
    if (!this._snap || this._snap.frame !== chunk.frame) {
      this._snap = { frame: chunk.frame, total: chunk.total, chunks: new Array(chunk.total), got: 0 };
    }
    const s = this._snap;
    if (chunk.seq < s.total && s.chunks[chunk.seq] === undefined) {
      s.chunks[chunk.seq] = chunk.data;
      s.got++;
    }
    if (s.got < s.total) return;
    // assembly
    let len = 0;
    for (const c of s.chunks) len += c.length;
    const bytes = new Uint8Array(len);
    let off = 0;
    for (const c of s.chunks) { bytes.set(c, off); off += c.length; }
    this._applySnapshot(s.frame, bytes);
    this._snap = null;
    this.resyncing = false;
  }

  _applySnapshot(frame, bytes) {
    this.game.loadState(bytes);
    this.currentFrame = frame;
    // states/hashHistory невалидны после загрузки чужого состояния — пересоберём.
    // remoteInputs/myInputsHistory СОХРАНЯЕМ: это авторитетные вводы, нужные для догона.
    this.states.clear();
    this.hashHistory.clear();
    // сид-чекпоинт на кадре снапшота, чтобы откаты сразу после resync не «теряли окно»
    this.states.set(frame, this.game.saveState());
    this._needCatchUp = true;
    this.onEvent({ type: "resync", frame, bytes: bytes.length });
  }

  getLatency() {
    return this.latency;
  }

  getInfo() {
    return {
      latency: this.latency,
      rollbacks: this.rollbackCount,
      skippedRollbacks: this.skippedRollbacks,
      desyncs: this.desyncCount,
      peerUnresponsive: this.peerUnresponsive,
      resyncing: this.resyncing,
      transportClosed: this.transportClosed,
      frame: this.currentFrame,
    };
  }
}

export default RollbackSession;
