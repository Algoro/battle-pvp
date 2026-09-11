// netcode — экспорт модуля rollback netcode.
// Относительный путь: ./netcode/index.ts
export { RollbackSession, HASH_INTERVAL, PING_INTERVAL } from "./rollback/session.ts";
export type { RollbackSessionOptions, SessionEvent, SessionEventHandler } from "./rollback/session.ts";
export {
  PROTOCOL_VERSION,
  PKT,
  encodeFrame,
  decodeFrame,
  encodeFrameBatch,
  decodeFrameBatch,
  encodeHashCheck,
  decodeHashCheck,
  encodePing,
  encodePong,
  decodePing,
  decodePong,
  encodeSnapshotRequest,
  decodeSnapshotRequest,
  encodeSnapshotChunk,
  decodeSnapshotChunk,
  encodeSnapshot,
} from "./protocol/frame.ts";
export type {
  InputEntry,
  DecodedFrame,
  DecodedFrameBatch,
  DecodedHashCheck,
  DecodedPing,
  DecodedPong,
  DecodedSnapshotRequest,
  DecodedSnapshotChunk,
} from "./protocol/frame.ts";
export type { Input, Clock, GameCore, Transport, EventSink, Logger } from "./ports.ts";
export { LocalEndpoint, makeRng } from "./transport/local.ts";
export { WebRTCTransport } from "./transport/webrtc.ts";
export { RelayTransport } from "./transport/relay.ts";
export { MultiTransport } from "./transport/multi.ts";
