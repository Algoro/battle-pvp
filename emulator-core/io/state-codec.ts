// state-codec.js — быстрая бинарная сериализация детерминированного состояния
// ядра. Заменяет медленный JSON (toJSON -> Array.from(mem) -> JSON.stringify)
// на компактный бинарный формат: cpu.mem и прочие typed-массивы пишутся сырыми
// байтами, скаляры — с тегом типа.
//
// Формат (little-endian), для каждого модуля:
//   u16 count | для каждого поля: u8 tag + значение
//   tag: 0 = Uint8Array (u32 len + байты)
//        1 = Array       (u32 len + f64*len)
//        2 = number      (f64)
//        3 = boolean     (u8)
//        4 = string      (u32 len + utf8)
//
// Относительный путь: ./emulator-core/io/state-codec.js

// Поля маппера не объявлены в JSON_PROPERTIES (у него свой toJSON).
const MAPPER_FIELDS = [
  "joy1StrobeState",
  "joy2StrobeState",
  "joypadLastWrite",
  "joypadOutputBit0",
  "joypadLastWriteCycle",
];

// PPU-поля, которые НЕ сохраняем: это выходные кадровые буферы текущего кадра,
// они полностью пересоздаются рендером при следующем stepFrame. Их сериализация
// лишь раздувает снапшот (по ~245КБ каждый) и не влияет на детерминизм.
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
    // ВАЖНО: пишем БАЙТОВОЕ представление. Для Uint16Array и пр. `w.bytes(v)`
    // использовал поэлементный `set` (старший байт терялся) — из-за этого после
    // loadState ломались таблицы вроде PPU vramMirrorTable (Uint16Array).
    w.bytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
  } else if (v instanceof Map) {
    w.u8(7); // Map
    w.u16(v.size);
    for (const [k, val] of v) {
      writeValue(w, k);
      writeValue(w, val);
    }
  } else if (Array.isArray(v)) {
    // числовые массивы — как раньше (компактно); прочие — объект с индексами
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
    for (let i = 0; i < n; i++) obj[i] = readValue(r); // нечисловой массив -> массив значений
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
    // сохраняем ссылку на typed-массив (in-place) и копируем ПО БАЙТАМ (для Uint16Array
    // и пр. поэлементный `set` испортил бы данные — см. writeValue).
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
  // PPU рендерит BG из nameTable[] (tile/attrib), а НЕ из vramMem напрямую. Эти объекты
  // не входят в JSON_PROPERTIES — их сериализуем явно, иначе после loadState (rollback)
  // рендер остаётся старым: разрушенные кирпичи «висят» на экране, хотя коллизия пуста.
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
  // nameTable восстанавливаем IN PLACE (рендер держит ссылки на эти объекты/массивы).
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
