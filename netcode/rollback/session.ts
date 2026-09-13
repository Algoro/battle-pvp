// session.ts — rollback session (GGPO-like) on top of a deterministic core.
//
// Principle:
//  1. On every frame we save saveState() into a ring buffer (the window = window frames).
//  2. The full frame input = my ports + (received/predicted remote input).
//     The default prediction is "repeat the last known remote input".
//  3. When a late remote input arrives for an already simulated frame — roll back
//     to that frame's state and replay forward with the correct inputs.
//  4. Desync detection: periodically send getFrameHash() of a frame; a mismatch is an event.
//  5. Latency: periodic ping/pong (the "latency" event).
//  6. Reconnection: rebindTransport() re-binds the session to a new transport.
//  7. Desync-recovery: a non-authoritative client requests a full snapshot from the authority
//     (the smaller playerId) and restores at its frame (the "resync" event).
//
// Relative path: ./netcode/rollback/session.ts
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
  type DecodedHashCheck,
  type DecodedPing,
  type DecodedPong,
  type DecodedSnapshotChunk,
  type InputEntry,
} from "../protocol/frame.ts";
import { systemClock } from "../ports.ts";
import type { Clock, GameCore, Input, Transport } from "../ports.ts";

export const HASH_INTERVAL = 30; // hash check every 30 frames
export const PING_INTERVAL = 60; // ping every 60 frames
export const PING_TIMEOUT = 600; // no pong — consider the peer unreachable (10 s)
export const DEFAULT_REDUNDANCY = 4; // how many of the latest frames to duplicate in each packet

export type SessionEvent = { type: string; [key: string]: any };
export type SessionEventHandler = (ev: SessionEvent) => void;

export interface RollbackSessionOptions {
  /** core: stepFrame(inputs), saveState(), loadState(), getFrameHash() */
  game: GameCore;
  /** { send(buf), onMessage(cb), onClose?(cb), isOpen?() } */
  transport: Transport | null;
  /** ports controlled by this client */
  myPorts: number[];
  /** the remote peer's ports */
  remotePorts: number[];
  onEvent?: SessionEventHandler;
  /** state window size (in frames) */
  window?: number;
  confirmDelay?: number;
  checkpointInterval?: number;
  /** my id (for determining authority) */
  playerId?: string | null;
  /** the remote peer's id */
  remotePeerId?: string | null;
  /** explicitly set authority (otherwise the smaller playerId) */
  authority?: boolean;
  /** enable desync-recovery (true by default) */
  recovery?: boolean;
  /** how many of the latest frames to duplicate in a packet */
  redundancy?: number;
  pingInterval?: number;
  pingTimeout?: number;
  clock?: Clock;
}

type SnapshotAssembly = {
  frame: number;
  total: number;
  chunks: (Uint8Array | undefined)[];
  got: number;
};

export class RollbackSession {
  game: GameCore;
  transport: Transport | null = null;
  myPorts: number[];
  remotePorts: number[];
  onEvent: SessionEventHandler;
  clock: Clock;
  window: number;
  confirmDelay: number;
  checkpointInterval: number;
  playerId: string | null;
  remotePeerId: string | null;
  recovery: boolean;
  redundancy: number;
  pingInterval: number;
  pingTimeout: number;

  currentFrame = 0;
  remoteHeadFrame = -1; // the remote peer's next frame (for catching up after resync)
  _needCatchUp = false;
  lastRemoteInput: Record<number, number> = {}; // port -> last buttons (for prediction)
  remoteInputs: Map<number, Input[]> = new Map(); // frame -> [inputs] (the remote peer's ports)
  remoteUsed: Map<number, Input[]> = new Map(); // frame -> [inputs], actually applied during simulation
  myInputsHistory: Map<number, Input[]> = new Map(); // frame -> inputs (my ports)
  states: Map<number, Uint8Array> = new Map(); // frame -> saveState() bytes
  hashHistory: Map<number, string> = new Map(); // frame -> getFrameHash()
  desyncCount = 0;
  rollbackCount = 0;
  skippedRollbacks = 0; // rollbacks skipped because the input matched the prediction
  lastUsed: Map<number, [number, number][]> = new Map(); // frame -> final inputs (for debugging)

  // Communication
  latency = 0; // ms
  pingSeq = 0;
  lastPongFrame = 0; // the frame on which pong was last updated
  peerUnresponsive = false;
  transportClosed = false;

  // Desync-recovery
  resyncing = false;
  _snap: SnapshotAssembly | null = null;
  _authority: boolean | undefined;
  _lastPingFrame = 0;

  constructor(opts: RollbackSessionOptions) {
    this.game = opts.game;
    this.myPorts = opts.myPorts;
    this.remotePorts = opts.remotePorts;
    this.onEvent = opts.onEvent || (() => {});
    this.clock = opts.clock || systemClock; // Clock port (deterministic time)
    this.window = opts.window || 120;
    this.confirmDelay = opts.confirmDelay || 20; // frames until "confirmation" (hash check)
    // Sparse state checkpoints: we do not save the full saveState() every frame,
    // but once per checkpointInterval. Rolling back to an intermediate frame = loading the nearest
    // checkpoint + re-simulation up to the target frame using the saved inputs (myInputsHistory
    // + remoteUsed). Saves memory (window×state -> window/interval) and saveState allocations.
    this.checkpointInterval = Math.max(1, opts.checkpointInterval || 8);
    this.playerId = opts.playerId ?? null;
    this.remotePeerId = opts.remotePeerId ?? null;
    this.recovery = opts.recovery !== false;
    this.redundancy = opts.redundancy ?? DEFAULT_REDUNDANCY;
    this.pingInterval = opts.pingInterval || PING_INTERVAL;
    this.pingTimeout = opts.pingTimeout || PING_TIMEOUT;
    this._authority = opts.authority;

    this._bindTransport(opts.transport);
  }

  _bindTransport(transport: Transport | null): void {
    this.transport = transport;
    if (!transport) return;
    transport.onMessage((buf) => this._onMessage(buf));
    if (typeof transport.onClose === "function") {
      transport.onClose(() => this._onTransportClosed());
    }
  }

  // The smaller playerId is the authority (its state is the source of truth during resync).
  isAuthority(): boolean {
    if (typeof this._authority === "boolean") return this._authority;
    if (this.playerId && this.remotePeerId) return this.playerId < this.remotePeerId;
    return true;
  }

  // Re-bind the session to a new transport (after reconnection).
  rebindTransport(transport: Transport): void {
    this._bindTransport(transport);
    this.transportClosed = false;
    this.peerUnresponsive = false;
    this.lastPongFrame = this.currentFrame;
    this.onEvent({ type: "transport-rebound" });
  }

  _onTransportClosed(): void {
    if (this.transportClosed) return;
    this.transportClosed = true;
    this.onEvent({ type: "transport-closed", frame: this.currentFrame });
  }

  _predictedRemote(): Input[] {
    const out: Input[] = [];
    for (const port of this.remotePorts) {
      out.push({ port, buttons: this.lastRemoteInput[port] ?? 0 });
    }
    return out;
  }

  // Save a state checkpoint BEFORE frame f (only at interval boundaries).
  _saveCheckpoint(f: number): void {
    if (f % this.checkpointInterval === 0) this.states.set(f, this.game.saveState());
  }

  // A single frame simulation step (no sending/events) — also used when catching up.
  _coreStep(myInputs: Input[]): string {
    const f = this.currentFrame;
    this._saveCheckpoint(f);
    const remote = this.remoteInputs.get(f) || this._predictedRemote();
    const full = [...myInputs, ...remote];
    this.lastUsed.set(f, full.map((x): [number, number] => [x.port, x.buttons]));
    this.remoteUsed.set(
      f,
      remote.map((x) => ({ port: x.port, buttons: x.buttons })),
    );
    this.myInputsHistory.set(f, myInputs);
    const h = this.game.stepFrame(full);
    this.hashHistory.set(f, h);
    this._prune(f);
    this.currentFrame++;
    return h;
  }

  // Monotonic 32-bit milliseconds from the Clock port (for RTT).
  _now32(): number {
    return this.clock.now() >>> 0;
  }

  advanceFrame(myInputs: Input[]): string {
    // Catch-up after resync: advance the counter to the remote peer's frame (skipped frames
    // are simulated with prediction; real inputs will correct them via rollback).
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

    // send our input to the remote peer — redundantly (the last N frames),
    // so that the loss of a single packet does not cause an irreversible desync.
    this._sendInputBatch(f);

    // periodic hash check of ONLY confirmed frames (in the past),
    // so as not to catch false desyncs from not-yet-agreed predictions
    const confirmed = f - this.confirmDelay;
    if (confirmed >= 0 && confirmed % HASH_INTERVAL === 0) {
      this.transport!.send(
        encodeHashCheck(confirmed, this.hashHistory.get(confirmed) ?? "00000000"),
      );
    }

    // ping (latency) and detection of "the peer is silent"
    if (f % this.pingInterval === 0) this._sendPing(f);
    if (f - this.lastPongFrame > this.pingTimeout && !this.peerUnresponsive) {
      this.peerUnresponsive = true;
      this.onEvent({ type: "peer-unresponsive", frame: f });
    }

    this.onEvent({ type: "frame", frame: f, hash: h });
    return h;
  }

  _sendInputBatch(f: number): void {
    const from = Math.max(0, f - this.redundancy + 1);
    const entries: InputEntry[] = [];
    for (let k = from; k <= f; k++) {
      const inputs = this.myInputsHistory.get(k);
      if (inputs) entries.push({ frame: k, inputs });
    }
    if (entries.length) this.transport!.send(encodeFrameBatch(entries, f + 1));
  }

  _sendPing(f: number): void {
    const seq = this.pingSeq++;
    this.transport!.send(encodePing(seq, this._now32()));
    this._lastPingFrame = f;
  }

  _prune(f: number): void {
    const cutoff = f - this.window;
    for (const key of this.states.keys()) if (key < cutoff) this.states.delete(key);
    for (const key of this.remoteInputs.keys()) if (key < cutoff) this.remoteInputs.delete(key);
    for (const key of this.remoteUsed.keys()) if (key < cutoff) this.remoteUsed.delete(key);
    for (const key of this.myInputsHistory.keys()) if (key < cutoff) this.myInputsHistory.delete(key);
    for (const key of this.hashHistory.keys()) if (key < cutoff) this.hashHistory.delete(key);
  }

  _onMessage(buf: Uint8Array): void {
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

  _onRemoteInput(frame: number, inputs: Input[]): void {
    const known = this.remoteInputs.get(frame);
    // deduplication: redundant sending must not re-apply the same input
    const fresh: Input[] = [];
    for (const inp of inputs) {
      if (known && known.some((x) => x.port === inp.port)) continue;
      fresh.push(inp);
    }
    if (!fresh.length) return;
    for (const { port, buttons } of fresh) this.lastRemoteInput[port] = buttons;
    if (!known) this.remoteInputs.set(frame, []);
    this.remoteInputs.get(frame)!.push(...fresh);

    if (frame < this.currentFrame) {
      // A rollback is only needed if the arriving input DIFFERS from the predicted one
      // (otherwise re-simulation would produce the same state — we skip it: saves CPU and
      // fewer visual "jumps" of the remote tank).
      const used = this.remoteUsed.get(frame);
      if (used && this._remoteEqual(used, this.remoteInputs.get(frame)!)) {
        this.skippedRollbacks++;
        this.onEvent({ type: "rollback-skipped", frame });
        return;
      }
      this._rollback(frame);
    }
  }

  // Whether the previously applied input matches the current one (by ports and buttons).
  _remoteEqual(a: Input[], b: Input[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i].port !== b[i].port || a[i].buttons !== b[i].buttons) return false;
    }
    return true;
  }

  // Restore the state BEFORE frame frame from the nearest checkpoint + re-simulation.
  // Returns the state bytes or undefined if the checkpoint is outside the window.
  _materialize(frame: number): Uint8Array | undefined {
    if (this.states.has(frame)) return this.states.get(frame);
    let cp = -1;
    for (const k of this.states.keys()) if (k <= frame && k > cp) cp = k;
    if (cp < 0) return undefined;
    this.game.loadState(this.states.get(cp)!);
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

  _rollback(fromFrame: number): void {
    const target = this.currentFrame;
    // During rollback/replay we mute audio (otherwise samples are emitted again).
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

    // replay forward with buffered/predicted inputs.
    // IMPORTANT: checkpoints are re-saved at interval boundaries.
    while (this.currentFrame < target) {
      const f = this.currentFrame;
      this._saveCheckpoint(f);
      const mine = this.myInputsHistory.get(f) || [];
      const remote = this.remoteInputs.get(f) || this._predictedRemote();
      const full = [...mine, ...remote];
      this.lastUsed.set(f, full.map((x): [number, number] => [x.port, x.buttons]));
      this.remoteUsed.set(
        f,
        remote.map((x) => ({ port: x.port, buttons: x.buttons })),
      );
      const h = this.game.stepFrame(full);
      this.hashHistory.set(f, h);
      this.currentFrame++;
    }
    this.game.setAudioSuppressed?.(false);
  }

  _onHashCheck({ frame, hash }: DecodedHashCheck): void {
    // compare only if the frame is confirmed and on our side
    if (this.currentFrame - frame < this.confirmDelay) return;
    const local = this.hashHistory.get(frame);
    if (local === undefined) {
      this.onEvent({ type: "hash-unknown", frame });
      return;
    }
    if (local !== hash) {
      this.desyncCount++;
      this.onEvent({ type: "desync", frame, localHash: local, remoteHash: hash });
      // the non-authority requests a snapshot from the authority
      if (this.recovery && !this.isAuthority()) this._requestResync(frame);
    }
  }

  _onPing({ seq, t }: DecodedPing): void {
    this.transport!.send(encodePong(seq, t));
  }

  _onPong({ t }: DecodedPong): void {
    this.lastPongFrame = this.currentFrame;
    this.peerUnresponsive = false;
    const rtt = this._now32() - (t >>> 0);
    // guard against invalid/huge values
    if (rtt >= 0 && rtt < 60000) {
      this.latency = rtt;
      this.onEvent({ type: "latency", ms: rtt });
    }
  }

  // --- desync-recovery ---
  _requestResync(frame: number): void {
    if (this.resyncing) return;
    this.resyncing = true;
    this.onEvent({ type: "resync-request", frame });
    this.transport!.send(encodeSnapshotRequest(frame));
  }

  _onSnapshotRequest(_req?: { frame: number }): void {
    // only the authority responds
    if (!this.isAuthority()) return;
    const frame = this.currentFrame;
    const hash = this.hashHistory.get(frame - 1) || "00000000";
    const bytes = this.game.saveState();
    for (const pkt of encodeSnapshot(frame, hash, bytes)) this.transport!.send(pkt);
    this.onEvent({ type: "snapshot-sent", frame, bytes: bytes.length });
  }

  _onResume(): void {
    /* reserved: the server/peer may explicitly resume after resync */
  }

  _onSnapshotChunk(chunk: DecodedSnapshotChunk): void {
    if (!this.resyncing) return;
    if (!this._snap || this._snap.frame !== chunk.frame) {
      this._snap = {
        frame: chunk.frame,
        total: chunk.total,
        chunks: new Array(chunk.total),
        got: 0,
      };
    }
    const s = this._snap;
    if (chunk.seq < s.total && s.chunks[chunk.seq] === undefined) {
      s.chunks[chunk.seq] = chunk.data;
      s.got++;
    }
    if (s.got < s.total) return;
    // assembly
    let len = 0;
    for (const c of s.chunks) len += c!.length;
    const bytes = new Uint8Array(len);
    let off = 0;
    for (const c of s.chunks) {
      bytes.set(c!, off);
      off += c!.length;
    }
    this._applySnapshot(s.frame, bytes);
    this._snap = null;
    this.resyncing = false;
  }

  _applySnapshot(frame: number, bytes: Uint8Array): void {
    this.game.loadState(bytes);
    this.currentFrame = frame;
    // states/hashHistory are invalid after loading someone else's state — rebuild them.
    // We KEEP remoteInputs/myInputsHistory: these are authoritative inputs needed for catch-up.
    this.states.clear();
    this.hashHistory.clear();
    // seed checkpoint at the snapshot frame so that rollbacks right after resync do not "lose the window"
    this.states.set(frame, this.game.saveState());
    this._needCatchUp = true;
    this.onEvent({ type: "resync", frame, bytes: bytes.length });
  }

  getLatency(): number {
    return this.latency;
  }

  getInfo(): {
    latency: number;
    rollbacks: number;
    skippedRollbacks: number;
    desyncs: number;
    peerUnresponsive: boolean;
    resyncing: boolean;
    transportClosed: boolean;
    frame: number;
  } {
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
