// jsnes-pristine.test.js — инвариант неизменности: emulator-core/src побайтово
// совпадает с vendor/jsnes/src (upstream). Любая правка эмулятора падает здесь.
// Запуск: node --test tests/jsnes-pristine.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const VENDOR = join(root, "vendor", "jsnes", "src");
const FORK = join(root, "emulator-core", "src");

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out;
}

test("jsnes неизменен: emulator-core/src == vendor/jsnes/src", () => {
  const vendor = walk(VENDOR).sort();
  const fork = walk(FORK).sort();
  assert.deepStrictEqual(fork, vendor, "состав файлов emulator-core/src отличается от upstream");
  for (const rel of vendor) {
    const a = readFileSync(join(VENDOR, rel));
    const b = readFileSync(join(FORK, rel));
    assert.ok(a.equals(b), `файл эмулятора изменён: ${rel}`);
  }
});

test("jsnes неизменен: нет правок вне emulator-core/src (browser/index на месте)", () => {
  assert.ok(existsSync(join(FORK, "browser", "index.js")), "upstream browser/ должен присутствовать");
  assert.ok(existsSync(join(FORK, "index.js")), "upstream index.js должен присутствовать");
});
