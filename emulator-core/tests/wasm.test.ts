// WASM hot-path: проверяем, что WASM-функция fnv1a32 даёт тот же результат,
// что и JS-реализация (детерминизм сохраняется при переносе в WASM).
// Запуск: node --test tests/wasm.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function jsFnv1a32(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

test("WASM fnv1a32 совпадает с JS fnv1a32 (перенос hot-path не ломает детерминизм)", async () => {
  const wasmPath = join(__dirname, "..", "wasm", "hash.wasm");
  const bytes = readFileSync(wasmPath);
  const mod = await WebAssembly.instantiate(bytes, {});
  const { fnv1a32: wasmFn, memory } = mod.instance.exports;
  assert.ok(wasmFn, "wasm fnv1a32 экспортирована");
  assert.ok(memory, "wasm memory экспортирована");

  // Для standalone-wasm передаём явный (ptr, len) в собственную память модуля.
  function wasmHash(buf) {
    const off = 0x1000; // область внутри wasm-памяти (ALLOW_MEMORY_GROWTH)
    const view = new Uint8Array(memory.buffer);
    for (let i = 0; i < buf.length; i++) view[off + i] = buf[i];
    return wasmFn(off, buf.length) >>> 0;
  }

  const cases = [
    new Uint8Array(0),
    new Uint8Array([1, 2, 3, 4, 255]),
    new Uint8Array(1024).map((_, i) => (i * 31) & 0xff),
  ];
  for (const buf of cases) {
    const jsH = jsFnv1a32(buf);
    const wasmH = wasmHash(buf);
    assert.strictEqual(wasmH, jsH, "несовпадение хэша на буфере len=" + buf.length);
  }

  // На реальном состоянии ядра (после игры).
  const rom = readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));
  const emu = new PvPNes();
  emu.loadROM(rom);
  for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
  const jsH = jsFnv1a32(emu.cpu.mem);
  const wasmH = wasmHash(emu.cpu.mem);
  assert.strictEqual(wasmH, jsH, "несовпадение хэша на живом состоянии");
  assert.strictEqual(emu.getFrameHash(), ("00000000" + jsH.toString(16)).slice(-8));
});
