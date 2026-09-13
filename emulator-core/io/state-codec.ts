// state-codec.js — fast binary serialization of the deterministic core
// state. Replaces slow JSON (toJSON -> Array.from(mem) -> JSON.stringify)
// with a compact binary format: cpu.mem and other typed arrays are written as raw
// bytes, scalars — with a type tag.
//
// Format (little-endian), per module:
//   u16 count | for each field: u8 tag + value
//   tag: 0 = Uint8Array (u32 len + bytes)
//        1 = Array       (u32 len + f64*len)
//        2 = number      (f64)
//        3 = boolean     (u8)
//        4 = string      (u32 len + utf8)
//
// Relative path: ./emulator-core/io/state-codec.js

// Mapper fields are not declared in JSON_PROPERTIES (it has its own toJSON).
const MAPPER_FIELDS = [
  "joy1StrobeState",
  "joy2StrobeState",
  "joypadLastWrite",
  "joypadOutputBit0",
  "joypadLastWriteCycle",
];

// PPU fields we do NOT save: these are the output frame buffers of the current frame,
// they are completely recreated by rendering on the next stepFrame. Serializing them
// only bloats the snapshot (~245KB each) and does not affect determinism.
const PPU_SKIP = new Set(["buffer", "bgbuffer", "pixrendered"]);
function ppuProps(ppu: any): string[] {
  return ppu.constructor.JSON_PROPERTIES.filter((p: string) => !PPU_SKIP.has(p));
}

class Writer {
  buf: Uint8Array;
  dv: DataView;
  off: number;
  constructor(cap = 8 * 1024) {
    this.buf = new Uint8Array(cap);
    this.dv = new DataView(this.buf.buffer);
    this.off = 0;
  }
  _grow(n: number) {
    if (this.off + n > this.buf.length) {
      const nb = new Uint8Array(Math.max(this.buf.length * 2, this.off + n));
      nb.set(this.buf.subarray(0, this.off));
      this.buf = nb;
      this.dv = new DataView(this.buf.buffer);
    }
  }
  u8(v: number) { this._grow(1); this.buf[this.off++] = v; }
  u16(v: number) { this._grow(2); this.dv.setUint16(this.off, v, true); this.off += 2; }
  u32(v: number) { this._grow(4); this.dv.setUint32(this.off, v, true); this.off += 4; }
  f64(v: number) { this._grow(8); this.dv.setFloat64(this.off, v, true); this.off += 8; }
  bytes(arr: ArrayLike<number>) {
    this.u32(arr.length);
    this._grow(arr.length);
    this.buf.set(arr, this.off);
    this.off += arr.length;
  }
  result(): Uint8Array { return this.buf.slice(0, this.off); }
}

class Reader {
  buf: Uint8Array;
  dv: DataView;
  off: number;
  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.off = 0;
  }
  u8(): number { return this.buf[this.off++]; }
  u16(): number { const v = this.dv.getUint16(this.off, true); this.off += 2; return v; }
  u32(): number { const v = this.dv.getUint32(this.off, true); this.off += 4; return v; }
  f64(): number { const v = this.dv.getFloat64(this.off, true); this.off += 8; return v; }
  bytes(n: number): Uint8Array {
    const b = this.buf.slice(this.off, this.off + n);
    this.off += n;
    return b;
  }
}

function writeValue(w: Writer, v: any): void {
  if (v === null || v === undefined) {
    w.u8(5); // null
  } else if (ArrayBuffer.isView(v)) {
    w.u8(0);
    // IMPORTANT: we write the BYTE representation. For Uint16Array etc. `w.bytes(v)`
    // used element-wise `set` (the high byte was lost) — because of this, after
    // loadState tables like PPU vramMirrorTable (Uint16Array) broke.
    w.bytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  } else if (v instanceof Map) {
    w.u8(7); // Map
    w.u16(v.size);
    for (const [k, val] of v) {
      writeValue(w, k);
      writeValue(w, val);
    }
  } else if (Array.isArray(v)) {
    // numeric arrays — as before (compact); others — an object with indices
    if (v.every((x: any) => typeof x === "number")) {
      w.u8(1);
      w.u32(v.length);
      for (const x of v) w.f64(x);
    } else {
      w.u8(6);
      w.u16(v.length);
      for (let i = 0; i < v.length; i++) writeValue(w, v[i]);
    }
  } else if (typeof v === "number") {
    w.u8(2);
    w.f64(v);
  } else if (typeof v === "boolean") {
    w.u8(3);
    w.u8(v ? 1 : 0);
  } else if (typeof v === "string") {
    w.u8(4);
    const b = new TextEncoder().encode(v);
    w.bytes(b);
  } else if (typeof v === "object") {
    w.u8(8); // plain object (key/value)
    const keys = Object.keys(v);
    w.u16(keys.length);
    for (const k of keys) {
      writeValue(w, k);
      writeValue(w, v[k]);
    }
  } else {
    throw new Error("unsupported state type: " + typeof v);
  }
}

function encodeProps(w: Writer, obj: any, props: string[]): void {
  w.u16(props.length);
  for (const p of props) writeValue(w, obj[p]);
}

function readValue(r: Reader): any {
  const t = r.u8();
  if (t === 0) return r.bytes(r.u32()); // Uint8Array
  if (t === 1) {
    const n = r.u32();
    const a = new Array(n);
    for (let i = 0; i < n; i++) a[i] = r.f64();
    return a;
  }
  if (t === 2) return r.f64();
  if (t === 3) return r.u8() !== 0;
  if (t === 4) return new TextDecoder().decode(r.bytes(r.u32()));
  if (t === 5) return null;
  if (t === 6) {
    const n = r.u16();
    const obj = new Array(n);
    for (let i = 0; i < n; i++) obj[i] = readValue(r); // non-numeric array -> array of values
    return obj;
  }
  if (t === 7) {
    const n = r.u16();
    const m = new Map();
    for (let i = 0; i < n; i++) m.set(readValue(r), readValue(r));
    return m;
  }
  if (t === 8) {
    const n = r.u16();
    const obj: any = {};
    for (let i = 0; i < n; i++) {
      const k = readValue(r);
      obj[k] = readValue(r);
    }
    return obj;
  }
  throw new Error("bad state tag: " + t);
}

function decodeProps(r: Reader, obj: any, props: string[]): void {
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const p = props[i];
    const v = readValue(r);
    const cur = obj[p];
    // keep a reference to the typed array (in place) and copy BY BYTES (for Uint16Array
    // etc. element-wise `set` would corrupt the data — see writeValue).
    if (ArrayBuffer.isView(cur) && ArrayBuffer.isView(v)) {
      const dst = new Uint8Array(cur.buffer, cur.byteOffset, cur.byteLength);
      const src = v instanceof Uint8Array ? v : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
      dst.set(src.subarray(0, dst.length));
    } else obj[p] = v;
  }
}

// ---- API ----

export function encodeState(emu: any): Uint8Array {
  const w = new Writer();
  encodeProps(w, emu.cpu, emu.cpu.constructor.JSON_PROPERTIES);
  encodeProps(w, emu.ppu, ppuProps(emu.ppu));
  encodeProps(w, emu.papu, emu.papu.constructor.JSON_PROPERTIES);
  encodeProps(w, emu.mmap, MAPPER_FIELDS);
  encodeProps(w, emu.controllers[1], emu.controllers[1].constructor.JSON_PROPERTIES);
  encodeProps(w, emu.controllers[2], emu.controllers[2].constructor.JSON_PROPERTIES);
  encodeProps(w, emu, ["prevButtons", "_frame", "_tacticalState", "_defState", "_jsPrev", "_jsDir", "_lastPlayerDir"]);
  // The PPU renders BG from nameTable[] (tile/attrib), NOT from vramMem directly. These objects
  // are not part of JSON_PROPERTIES — we serialize them explicitly, otherwise after loadState (rollback)
  // the render stays stale: destroyed bricks "hang" on screen even though the collision data is empty.
  const nts = emu.ppu.nameTable;
  w.u16(nts.length);
  for (const nt of nts) {
    writeValue(w, nt.tile);
    writeValue(w, nt.attrib);
  }
  return w.result();
}

export function decodeState(emu: any, bytes: Uint8Array): void {
  const r = new Reader(bytes);
  decodeProps(r, emu.cpu, emu.cpu.constructor.JSON_PROPERTIES);
  decodeProps(r, emu.ppu, ppuProps(emu.ppu));
  decodeProps(r, emu.papu, emu.papu.constructor.JSON_PROPERTIES);
  decodeProps(r, emu.mmap, MAPPER_FIELDS);
  decodeProps(r, emu.controllers[1], emu.controllers[1].constructor.JSON_PROPERTIES);
  decodeProps(r, emu.controllers[2], emu.controllers[2].constructor.JSON_PROPERTIES);
  decodeProps(r, emu, ["prevButtons", "_frame", "_tacticalState", "_defState", "_jsPrev", "_jsDir", "_lastPlayerDir"]);
  // Restore nameTable IN PLACE (the render holds references to these objects/arrays).
  const n = r.u16();
  for (let i = 0; i < n; i++) {
    const tile = readValue(r);
    const attrib = readValue(r);
    const nt = emu.ppu.nameTable[i];
    if (!nt) continue;
    if (ArrayBuffer.isView(nt.tile) && ArrayBuffer.isView(tile)) nt.tile.set(tile);
    else nt.tile = tile;
    if (ArrayBuffer.isView(nt.attrib) && ArrayBuffer.isView(attrib)) nt.attrib.set(attrib);
    else nt.attrib = attrib;
  }
}

export default { encodeState, decodeState };
