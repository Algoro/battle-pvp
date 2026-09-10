// frame.js — компактный бинарный формат сетевых пакетов (не JSON).
//
// Все пакеты начинаются с байта-тега (type), что делает маршрутизацию однозначной
// (раньше hash/прочие пакеты могли быть ошибочно декодированы как frame).
//
// Разметка (little-endian):
//   INPUT (1)   : uint32 frame, uint8 count, repeat{ uint8 port, uint8 buttons }
//   BATCH (2)   : uint32 headFrame, uint8 frames, repeat{ uint32 frame, uint8 count, repeat{port,buttons} }
//                 — избыточная отправка последних N кадров (redundancy против потерь);
//                 headFrame = следующий кадр отправителя (для догона после resync).
//   HASH  (3)   : uint32 frame, uint32 hash
//   PING  (4)   : uint32 seq, uint32 t (ms sender)
//   PONG  (5)   : uint32 seq, uint32 t (эхо)
//   SNAPREQ (6) : uint32 frame
//   SNAP  (7)   : uint32 frame, uint32 hash, uint16 seq, uint16 total, ...bytes
//
// Относительный путь: ./netcode/protocol/frame.js
export const PROTOCOL_VERSION = 2;

export const PKT = {
  INPUT: 1,
  BATCH: 2,
  HASH: 3,
  PING: 4,
  PONG: 5,
  SNAP_REQ: 6,
  SNAP: 7,
};

const INPUT_HEADER = 6; // type + uint32 + count
const BATCH_HEADER = 6; // type + uint32 headFrame + count
const HASH_BYTES = 9; // type + uint32 + uint32
const PING_BYTES = 9; // type + uint32 + uint32
const SNAP_REQ_BYTES = 5; // type + uint32
const SNAP_HEADER = 13; // type + uint32 + uint32 + uint16 + uint16
export const SNAP_CHUNK_BYTES = 16 * 1024; // размер данных в одном chunk снапшота

function writeInputEntries(buf, off, inputs) {
  buf[off++] = inputs.length & 0xff;
  for (const inp of inputs) {
    buf[off++] = inp.port & 0xff;
    buf[off++] = inp.buttons & 0xff;
  }
  return off;
}

// --- INPUT (одиночный кадр) ---
export function encodeFrame(frame, inputs) {
  const n = inputs.length;
  const buf = new Uint8Array(INPUT_HEADER + 2 * n);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.INPUT;
  dv.setUint32(1, frame, true);
  writeInputEntries(buf, 5, inputs);
  return buf;
}

export function decodeFrame(buf) {
  if (!buf || buf.length < INPUT_HEADER || buf[0] !== PKT.INPUT) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const frame = dv.getUint32(1, true);
  const n = buf[5];
  if (INPUT_HEADER + 2 * n > buf.length) return null;
  const inputs = [];
  for (let i = 0; i < n; i++) {
    inputs.push({ port: buf[6 + 2 * i], buttons: buf[7 + 2 * i] });
  }
  return { frame, inputs };
}

// --- BATCH (избыточная отправка последних N кадров) ---
// entries: [{ frame, inputs: [{port,buttons}] }, ...]; headFrame — следующий кадр отправителя.
export function encodeFrameBatch(entries, headFrame = 0) {
  let size = BATCH_HEADER;
  for (const e of entries) size += 5 + 2 * e.inputs.length;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.BATCH;
  dv.setUint32(1, headFrame >>> 0, true);
  buf[5] = entries.length & 0xff;
  let off = BATCH_HEADER;
  for (const e of entries) {
    dv.setUint32(off, e.frame, true);
    off += 4;
    off = writeInputEntries(buf, off, e.inputs);
  }
  return buf;
}

export function decodeFrameBatch(buf) {
  if (!buf || buf.length < BATCH_HEADER || buf[0] !== PKT.BATCH) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headFrame = dv.getUint32(1, true);
  const count = buf[5];
  let off = BATCH_HEADER;
  const frames = [];
  for (let i = 0; i < count; i++) {
    if (off + 5 > buf.length) return null;
    const frame = dv.getUint32(off, true);
    off += 4;
    const n = buf[off++];
    if (off + 2 * n > buf.length) return null;
    const inputs = [];
    for (let j = 0; j < n; j++) {
      inputs.push({ port: buf[off++], buttons: buf[off++] });
    }
    frames.push({ frame, inputs });
  }
  return { frames, headFrame };
}

// --- HASH ---
export function encodeHashCheck(frame, hash) {
  const buf = new Uint8Array(HASH_BYTES);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.HASH;
  dv.setUint32(1, frame, true);
  dv.setUint32(5, parseInt(hash, 16) >>> 0, true);
  return buf;
}

export function decodeHashCheck(buf) {
  if (!buf || buf.length < HASH_BYTES || buf[0] !== PKT.HASH) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    frame: dv.getUint32(1, true),
    hash: ("00000000" + (dv.getUint32(5, true) >>> 0).toString(16)).slice(-8),
  };
}

// --- PING / PONG (измерение задержки) ---
export function encodePing(seq, t) {
  const buf = new Uint8Array(PING_BYTES);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.PING;
  dv.setUint32(1, seq >>> 0, true);
  dv.setUint32(5, t >>> 0, true);
  return buf;
}

export function encodePong(seq, t) {
  const buf = new Uint8Array(PING_BYTES);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.PONG;
  dv.setUint32(1, seq >>> 0, true);
  dv.setUint32(5, t >>> 0, true);
  return buf;
}

export function decodePing(buf) {
  if (!buf || buf.length < PING_BYTES || buf[0] !== PKT.PING) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { seq: dv.getUint32(1, true), t: dv.getUint32(5, true) };
}

export function decodePong(buf) {
  if (!buf || buf.length < PING_BYTES || buf[0] !== PKT.PONG) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { seq: dv.getUint32(1, true), t: dv.getUint32(5, true) };
}

// --- SNAPSHOT (desync-recovery) ---
export function encodeSnapshotRequest(frame) {
  const buf = new Uint8Array(SNAP_REQ_BYTES);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.SNAP_REQ;
  dv.setUint32(1, frame >>> 0, true);
  return buf;
}

export function decodeSnapshotRequest(buf) {
  if (!buf || buf.length < SNAP_REQ_BYTES || buf[0] !== PKT.SNAP_REQ) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return { frame: dv.getUint32(1, true) };
}

// frame — кадр, к которому относится состояние (следующий к симуляции);
// hash — хэш последнего симулированного кадра; data — кусок saveState().
export function encodeSnapshotChunk({ frame, hash, seq, total, data }) {
  const buf = new Uint8Array(SNAP_HEADER + data.length);
  const dv = new DataView(buf.buffer);
  buf[0] = PKT.SNAP;
  dv.setUint32(1, frame >>> 0, true);
  dv.setUint32(5, parseInt(hash, 16) >>> 0, true);
  dv.setUint16(9, seq & 0xffff, true);
  dv.setUint16(11, total & 0xffff, true);
  buf.set(data, SNAP_HEADER);
  return buf;
}

export function decodeSnapshotChunk(buf) {
  if (!buf || buf.length < SNAP_HEADER || buf[0] !== PKT.SNAP) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    frame: dv.getUint32(1, true),
    hash: ("00000000" + (dv.getUint32(5, true) >>> 0).toString(16)).slice(-8),
    seq: dv.getUint16(9, true),
    total: dv.getUint16(11, true),
    data: buf.subarray(SNAP_HEADER),
  };
}

// Разбивает бинарный снапшот на chunk-пакеты.
export function encodeSnapshot(frame, hash, bytes) {
  const total = Math.max(1, Math.ceil(bytes.length / SNAP_CHUNK_BYTES));
  const out = [];
  for (let i = 0; i < total; i++) {
    const start = i * SNAP_CHUNK_BYTES;
    out.push(
      encodeSnapshotChunk({
        frame,
        hash,
        seq: i,
        total,
        data: bytes.subarray(start, Math.min(bytes.length, start + SNAP_CHUNK_BYTES)),
      }),
    );
  }
  return out;
}

export default {
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
};
