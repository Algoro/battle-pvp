// descriptor.js — validation of patch descriptors and byte-generation helpers.
//
// Bytes in a descriptor: Uint8Array | number[] | hex string | function (resolve)=>Uint8Array
// (the function is needed for relocations: JMP/JSR to a symbolic address).
//
// Relative path: ./emulator-core/patching/descriptor.js
import { PatchError } from "./errors.ts";

/** hex string ("4C 75 EF" / "4C75EF") -> Uint8Array */
export function hex(s: string): Uint8Array {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new PatchError("BAD_HEX", `нечётная hex-строка: ${s}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function toBytes(v: any): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string") return hex(v);
  throw new PatchError("BAD_BYTES", `неподдерживаемый тип байт: ${typeof v}`);
}

/** 6502 JMP abs (0x4C) to a symbol + NOP pads up to length len. */
export function jmp(symbol: any, len: number) {
  return (resolve: (s: any) => number) => {
    if (len < 3) throw new PatchError("BAD_JUMP", `jmp(${symbol}): len<3`);
    const a = resolve(symbol);
    const out = new Uint8Array(len).fill(0xea);
    out[0] = 0x4c;
    out[1] = a & 0xff;
    out[2] = (a >> 8) & 0xff;
    return out;
  };
}

/** 6502 JSR abs (0x20) to a symbol + NOP pads up to length len. */
export function jsr(symbol: any, len: number) {
  return (resolve: (s: any) => number) => {
    if (len < 3) throw new PatchError("BAD_JUMP", `jsr(${symbol}): len<3`);
    const a = resolve(symbol);
    const out = new Uint8Array(len).fill(0xea);
    out[0] = 0x20;
    out[1] = a & 0xff;
    out[2] = (a >> 8) & 0xff;
    return out;
  };
}

/** Bytes of the given length (value fill). */
export function fill(len: number, value = 0xea): Uint8Array {
  return new Uint8Array(len).fill(value);
}

// --- Tokens for relocatable routines ---
// Array of tokens: number (literal) | {op:...}. Allows address operands
// to be resolved by the linker (symbols/RAM/own routine) instead of being hardcoded.
export function jmpT(symbol: any, delta = 0) { return { op: "jmp", symbol, delta }; }
export function jsrT(symbol: any, delta = 0) { return { op: "jsr", symbol, delta }; }
export function absT(symbol: any, delta = 0) { return { op: "abs", symbol, delta }; } // 2-byte abs operand
export function selfJmpT(delta = 0) { return { op: "jmp", self: true, delta }; }
export function selfAbsT(delta = 0) { return { op: "abs", self: true, delta }; }

function tokenSize(t: any): number {
  if (typeof t === "number") return 1;
  if (!t || typeof t !== "object") throw new PatchError("BAD_BYTES", `некорректный токен: ${t}`);
  if (t.op === "jmp" || t.op === "jsr") return 3;
  if (t.op === "abs") return 2;
  throw new PatchError("BAD_BYTES", `неизвестный токен: ${JSON.stringify(t)}`);
}

/** Byte length (Uint8Array | number[] | hex | tokens) without resolving symbols. */
export function byteLength(v: any): number {
  if (v instanceof Uint8Array) return v.length;
  if (typeof v === "string") return hex(v).length;
  if (Array.isArray(v)) {
    // array of numbers -> bytes; array of tokens -> sum of sizes
    if (v.every((x) => typeof x === "number")) return v.length;
    let n = 0;
    for (const t of v) n += tokenSize(t);
    return n;
  }
  throw new PatchError("BAD_BYTES", `неподдерживаемый тип байт: ${typeof v}`);
}

/** Compile tokens into bytes, resolving symbols with the linker. */
export function compileTokens(tokens: any[], resolve: (s: any) => number, selfAddr = 0): Uint8Array {
  const out = [];
  for (const t of tokens) {
    if (typeof t === "number") { out.push(t & 0xff); continue; }
    if (t.op === "jmp" || t.op === "jsr") {
      const a = (t.self ? selfAddr : resolve(t.symbol)) + (t.delta || 0);
      out.push(t.op === "jmp" ? 0x4c : 0x20, a & 0xff, (a >> 8) & 0xff);
      continue;
    }
    if (t.op === "abs") {
      const a = (t.self ? selfAddr : resolve(t.symbol)) + (t.delta || 0);
      out.push(a & 0xff, (a >> 8) & 0xff);
      continue;
    }
    throw new PatchError("BAD_BYTES", `неизвестный токен: ${JSON.stringify(t)}`);
  }
  return Uint8Array.from(out);
}


export function validateSet(set: any): any {
  if (!set || typeof set !== "object") throw new PatchError("BAD_SET", "набор патчей не задан");
  if (!set.id) throw new PatchError("BAD_SET", "у набора нет id");
  if (set.routines && !Array.isArray(set.routines)) throw new PatchError("BAD_SET", "routines не массив");
  if (set.writes && !Array.isArray(set.writes)) throw new PatchError("BAD_SET", "writes не массив");
  for (const w of set.writes || []) {
    if (typeof w.at !== "number") throw new PatchError("BAD_WRITE", `write без at (${set.id}/${w.id || "?"})`);
    if (w.expect === undefined) throw new PatchError("BAD_WRITE", `write без expect (${set.id}/${w.id || "?"})`);
  }
  for (const r of set.routines || []) {
    if (!r.symbol) throw new PatchError("BAD_ROUTINE", "routine без symbol");
    const len = byteLength(r.bytes);
    if (r.at !== undefined && r.at + len - 1 > 0xffff) throw new PatchError("BAD_ROUTINE", `${r.symbol}: адрес вне PRG`);
  }
  return set;
}

/** Merge sets (base + modules) into one. The order of routines/writes is preserved. */
export function composeSets(...sets: any[]): any {
  const out: any = { id: "composed", version: 1, symbols: {}, free: [], routines: [], writes: [] };
  for (const s of sets) {
    if (!s) continue;
    Object.assign(out.symbols, s.symbols || {});
    if (s.base) out.base = { ...(out.base || {}), ...s.base };
    if (s.free) out.free = out.free.concat(s.free);
    if (s.routines) out.routines = out.routines.concat(s.routines);
    if (s.writes) out.writes = out.writes.concat(s.writes);
    if (s.description) out.description = [out.description, s.description].filter(Boolean).join("; ");
  }
  // unique free regions
  out.free = out.free.filter((r: any, i: number) => out.free.findIndex((x: any) => x.start === r.start && x.end === r.end) === i);
  out.id = sets.map((s) => s && s.id).filter(Boolean).join("+") || "composed";
  return out;
}
