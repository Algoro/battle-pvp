// linker.js — таблица символов, размещение рутин в свободной зоне и релокация.
//
// Рутины размещаются по явному `at` (детерминированная раскладка) либо first-fit в
// объявленных свободных диапазонах. Перед размещением проверяется, что байты в образе
// — «пусто» (по умолчанию 0xFF), т.е. мы не затираем настоящий код.
//
// Относительный путь: ./emulator-core/patching/linker.js
import { PatchError, PatchErrorCode } from "./errors.js";
import { byteLength, toBytes } from "./descriptor.js";

export class Linker {
  /**
   * @param {import("./rom-image.js").RomImage} image
   * @param {object} opts { symbols, free: [{start,end}] }
   */
  constructor(image, { symbols = {}, free = [] } = {}) {
    this.image = image;
    this.symbols = new Map(Object.entries(symbols));
    this.free = free.map((r) => ({ start: r.start, end: r.end }));
    this.used = []; // [{at, len, symbol}]
  }

  resolve(name) {
    if (!this.symbols.has(name)) {
      throw new PatchError(PatchErrorCode.UNKNOWN_SYMBOL, `неизвестный символ: ${name}`);
    }
    return this.symbols.get(name);
  }

  has(name) {
    return this.symbols.has(name);
  }

  /** Разместить рутины. Возвращает список размещений. */
  allocate(routines) {
    for (const r of routines) {
      const len = byteLength(r.bytes);
      let at = r.at;
      if (at === undefined) at = this._firstFit(len);
      this._claim(at, len, r.symbol, r.fill ?? 0xff);
      this.symbols.set(r.symbol, at);
      this.used.push({ at, len, symbol: r.symbol });
    }
    return this.used;
  }

  _firstFit(len) {
    for (const span of this.free) {
      let candidate = span.start;
      // поднимаем кандидата выше всех пересекающихся занятых диапазонов
      let moved = true;
      while (moved) {
        moved = false;
        for (const u of this.used) {
          if (candidate < u.at + u.len && u.at < candidate + len) {
            candidate = u.at + u.len;
            moved = true;
          }
        }
      }
      if (candidate + len - 1 <= span.end) return candidate;
    }
    throw new PatchError(PatchErrorCode.NO_SPACE, `нет свободного места под ${len} байт`);
  }

  _claim(at, len, symbol, fill) {
    if (at < 0x8000 || at + len - 1 > 0xffff) {
      throw new PatchError(PatchErrorCode.BAD_ROUTINE, `${symbol}: адрес вне PRG`);
    }
    if (this.used.some((u) => at < u.at + u.len && u.at < at + len)) {
      throw new PatchError(PatchErrorCode.OVERLAP, `${symbol}: пересечение с другой рутиной`);
    }
    let inFree = this.free.length === 0;
    for (const span of this.free) {
      if (at >= span.start && at + len - 1 <= span.end) inFree = true;
    }
    if (!inFree) throw new PatchError(PatchErrorCode.NO_SPACE, `${symbol}: адрес вне свободной зоны`);
    if (!this.image.isFill(at, len, fill)) {
      throw new PatchError(PatchErrorCode.OVERLAP, `${symbol}: зона не пустая (ожидался ${fill.toString(16)})`);
    }
  }

  /** Проверить, что байтовые записи-хуки не задевают размещённые рутины. */
  assertWritesDoNotClobber(writes) {
    for (const w of writes || []) {
      const len = toBytes(w.expect).length;
      for (const u of this.used) {
        if (w.at < u.at + u.len && u.at < w.at + len) {
          throw new PatchError(PatchErrorCode.OVERLAP, `${w.id || "write"} @$${w.at.toString(16)} задевает ${u.symbol}`);
        }
      }
    }
  }
}

export default Linker;
