// descriptor.js — валидация дескрипторов патчей и хелперы генерации байт.
//
// Байты в дескрипторе: Uint8Array | number[] | hex-строка | функция (resolve)=>Uint8Array
// (функция нужна для релокаций: JMP/JSR на символический адрес).
//
// Относительный путь: ./emulator-core/patching/descriptor.js
import { PatchError } from "./errors.js";

/** hex-строка ("4C 75 EF" / "4C75EF") -> Uint8Array */
export function hex(s) {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new PatchError("BAD_HEX", `нечётная hex-строка: ${s}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string") return hex(v);
  throw new PatchError("BAD_BYTES", `неподдерживаемый тип байт: ${typeof v}`);
}

/** 6502 JMP abs (0x4C) на символ + NOP-пады до длины len. */
export function jmp(symbol, len) {
  return (resolve) => {
    if (len < 3) throw new PatchError("BAD_JUMP", `jmp(${symbol}): len<3`);
    const a = resolve(symbol);
    const out = new Uint8Array(len).fill(0xea);
    out[0] = 0x4c;
    out[1] = a & 0xff;
    out[2] = (a >> 8) & 0xff;
    return out;
  };
}

/** 6502 JSR abs (0x20) на символ + NOP-пады до длины len. */
export function jsr(symbol, len) {
  return (resolve) => {
    if (len < 3) throw new PatchError("BAD_JUMP", `jsr(${symbol}): len<3`);
    const a = resolve(symbol);
    const out = new Uint8Array(len).fill(0xea);
    out[0] = 0x20;
    out[1] = a & 0xff;
    out[2] = (a >> 8) & 0xff;
    return out;
  };
}

/** Байты заданной длины (value заполнение). */
export function fill(len, value = 0xea) {
  return new Uint8Array(len).fill(value);
}

// --- Токены для релоцируемых рутин ---
// Массив токенов: number (литерал) | {op:...}. Позволяет операндам-адресам
// резолвиться линкером (символы/RAM/собственная рутина), а не быть зашитыми.
export function jmpT(symbol, delta = 0) { return { op: "jmp", symbol, delta }; }
export function jsrT(symbol, delta = 0) { return { op: "jsr", symbol, delta }; }
export function absT(symbol, delta = 0) { return { op: "abs", symbol, delta }; } // 2-байтный abs-операнд
export function selfJmpT(delta = 0) { return { op: "jmp", self: true, delta }; }
export function selfAbsT(delta = 0) { return { op: "abs", self: true, delta }; }

function tokenSize(t) {
  if (typeof t === "number") return 1;
  if (!t || typeof t !== "object") throw new PatchError("BAD_BYTES", `некорректный токен: ${t}`);
  if (t.op === "jmp" || t.op === "jsr") return 3;
  if (t.op === "abs") return 2;
  throw new PatchError("BAD_BYTES", `неизвестный токен: ${JSON.stringify(t)}`);
}

/** Длина байтов (Uint8Array | number[] | hex | токены) без резолва символов. */
export function byteLength(v) {
  if (v instanceof Uint8Array) return v.length;
  if (typeof v === "string") return hex(v).length;
  if (Array.isArray(v)) {
    // массив чисел -> байты; массив токенов -> сумма размеров
    if (v.every((x) => typeof x === "number")) return v.length;
    let n = 0;
    for (const t of v) n += tokenSize(t);
    return n;
  }
  throw new PatchError("BAD_BYTES", `неподдерживаемый тип байт: ${typeof v}`);
}

/** Скомпилировать токены в байты, резолвя символы линкером. */
export function compileTokens(tokens, resolve, selfAddr = 0) {
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


export function validateSet(set) {
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

/** Объединить наборы (base + модули) в один. Порядок routines/writes сохраняется. */
export function composeSets(...sets) {
  const out = { id: "composed", version: 1, symbols: {}, free: [], routines: [], writes: [] };
  for (const s of sets) {
    if (!s) continue;
    Object.assign(out.symbols, s.symbols || {});
    if (s.base) out.base = { ...(out.base || {}), ...s.base };
    if (s.free) out.free = out.free.concat(s.free);
    if (s.routines) out.routines = out.routines.concat(s.routines);
    if (s.writes) out.writes = out.writes.concat(s.writes);
    if (s.description) out.description = [out.description, s.description].filter(Boolean).join("; ");
  }
  // уникальные free-регионы
  out.free = out.free.filter((r, i) => out.free.findIndex((x) => x.start === r.start && x.end === r.end) === i);
  out.id = sets.map((s) => s && s.id).filter(Boolean).join("+") || "composed";
  return out;
}
