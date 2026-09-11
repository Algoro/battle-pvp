// rom-image.js — доступ к PRG-ROM как к редактируемому образу.
//
// Патчи применяются к nes.rom.rom[bank] ДО createMapper()/mmap.loadROM(), поэтому
// CPU получает уже пропатченные байты (mapper копирует PRG в cpu.mem).
//
// Отображение CPU-адрес <-> (банк, offset):
//   NROM-128 (1 банк): $8000-$FFFF -> банк 0, offset = addr & 0x3FFF
//   NROM-256 (2 банка): $8000-$BFFF -> банк 0, $C000-$FFFF -> банк 1
//
// Относительный путь: ./emulator-core/patching/rom-image.js

export function fnv1a32(bytes: any, seed = 0x811c9dc5): number {
  let h = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function toHex32(n: number): string {
  return ("00000000" + (n >>> 0).toString(16)).slice(-8);
}

export class RomImage {
  rom: any;

  /** @param {object} rom — загруженный экземпляр ROM (emulator-core/src/rom.js) */
  constructor(rom: any) {
    if (!rom || !rom.valid) throw new Error("RomImage: ROM не загружен");
    this.rom = rom;
  }

  get mapperType() {
    return this.rom.mapperType;
  }

  prgBankCount() {
    return this.rom.romCount;
  }

  get prgSize() {
    return this.rom.romCount * 16384;
  }

  /** CPU-адрес ($8000-$FFFF) -> { bank, offset } */
  map(addr: number): { bank: number; offset: number } {
    if (addr < 0x8000 || addr > 0xffff) {
      throw new RangeError(`RomImage: адрес вне PRG: $${addr.toString(16)}`);
    }
    const a = addr & 0x3fff;
    let bank = 0;
    if (this.rom.romCount > 1) bank = addr < 0xc000 ? 0 : 1;
    return { bank, offset: a };
  }

  read(addr: number): number {
    const { bank, offset } = this.map(addr);
    return this.rom.rom[bank][offset];
  }

  readBytes(addr: number, len: number): Uint8Array {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = this.read(addr + i);
    return out;
  }

  /** Записать байты по CPU-адресу (с проверкой границ банка). */
  writeBytes(addr: number, bytes: any): void {
    const { bank, offset } = this.map(addr);
    const prg = this.rom.rom[bank];
    if (offset + bytes.length > prg.length) {
      throw new RangeError("RomImage: запись выходит за границу PRG-банка");
    }
    prg.set(bytes, offset);
  }

  /** Совпадают ли байты образа с ожидаемыми. */
  verify(addr: number, expect: any): boolean {
    for (let i = 0; i < expect.length; i++) {
      if (this.read(addr + i) !== expect[i]) return false;
    }
    return true;
  }

  /** Заполнен ли диапазон заданным байтом (обычно 0xFF — «свободная» зона). */
  isFill(addr: number, len: number, value = 0xff): boolean {
    for (let i = 0; i < len; i++) if (this.read(addr + i) !== value) return false;
    return true;
  }

  /** Отпечаток всего PRG-ROM (для golden-тестов и handshake). */
  fingerprint(): string {
    let seed = 0x811c9dc5;
    for (let b = 0; b < this.rom.romCount; b++) seed = fnv1a32(this.rom.rom[b], seed);
    return toHex32(seed);
  }
}

export default RomImage;
