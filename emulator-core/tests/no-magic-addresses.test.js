// no-magic-addresses.test.js — защита от возврата «магических» адресов RAM/ROM.
//
// Вне rom-contract.js / domain.js / startup.js (и вне test-only sim/tables) код не должен
// обращаться к известным адресам RAM/ROM напрямую — только через RAM.*/ROM.*/domain-хелперы.
// Тест сканирует исходники ядра/модели/ИИ и падает при появлении сырых адресов.
import { test } from "node:test";
import assert from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, ".."); // emulator-core

const SKIP_DIRS = ["src", "tests", "sim", `patching${sep}patches`];
const SKIP_FILES = new Set(["rom-contract.js", "domain.js", "startup.js", "fine-grid.js"]);

// Известные адреса-базы из rom-contract.js: запрещены как `mem[0x..]` и как сырые значения.
const ADDR = "(?:0?1db|0?1e1|0?1e7|0?1ed|101|102|85|80|a0|a8|cc|51|b8|c2|88|86|87|400|90|98|6f|89|0a|0b|0f|68|82|84|6d|62|d44d|d466|f000|f07a|dabb|dacb)";
const MEM_RE = new RegExp(`mem\\[0x${ADDR}\\b`);
const RAW_RE = new RegExp(`\\b0x(?:d44d|d466|f000|f07a|dabb|dacb|1db|1e1|1e7|1ed)\\b`);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (statSync(p).isDirectory()) {
      if (SKIP_DIRS.some((s) => rel === s || rel.startsWith(s + sep))) continue;
      out.push(...walk(p));
    } else if (name.endsWith(".js") && !SKIP_FILES.has(name)) {
      out.push(p);
    }
  }
  return out;
}

test("no-magic-addresses: RAM/ROM-адреса только через rom-contract/domain", () => {
  const offenders = [];
  for (const file of walk(ROOT)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.split("//")[0];
      if (MEM_RE.test(code) || RAW_RE.test(code)) {
        offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepStrictEqual(offenders, [], `Найдены сырые адреса:\n${offenders.join("\n")}`);
});
