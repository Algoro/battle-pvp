// architecture.test.js — ПРАВИЛО ЗАВИСИМОСТЕЙ чистой архитектуры.
// Внутренние слои не должны знать о внешних: нарушения ломают CI.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function walk(dir, pred) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (["node_modules", "dist", "src", "test-results", ".git"].includes(name)) continue;
      out.push(...walk(p, pred));
    } else if (pred(p)) out.push(p);
  }
  return out;
}

function imports(file) {
  return [...readFileSync(file, "utf8").matchAll(/(?:^|\n)\s*(?:import|export)[^"']*from\s+["']([^"']+)["']/g)].map((m) => m[1]);
}

function offenders(files, forbidden, allow = []) {
  const bad = [];
  for (const f of files) {
    for (const spec of imports(f)) {
      if (forbidden.some((frag) => spec.includes(frag)) && !allow.some((frag) => spec.includes(frag))) {
        bad.push(`${relative(ROOT, f)}: import "${spec}"`);
      }
    }
  }
  return bad;
}

test("architecture: netcode не зависит от emulator-core/frontend/backend", () => {
  const files = walk(join(ROOT, "netcode"), (p) => p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.includes(`${sep}tests${sep}`));
  assert.deepStrictEqual(offenders(files, ["emulator-core", "frontend", "backend"]), []);
});

test("architecture: backend не зависит от emulator-core/frontend", () => {
  const files = walk(join(ROOT, "backend"), (p) => p.endsWith(".ts") && !p.endsWith(".d.ts") && !p.includes(`${sep}tests${sep}`));
  assert.deepStrictEqual(offenders(files, ["emulator-core", "frontend"]), []);
});

test("architecture: frontend не импортирует backend напрямую", () => {
  const files = walk(join(ROOT, "frontend", "src"), (p) => /\.(ts|tsx)$/.test(p));
  assert.deepStrictEqual(offenders(files, ["backend"]), []);
});

test("architecture: domain/rom-contract чисты (без внешних зависимостей)", () => {
  const contract = imports(join(ROOT, "emulator-core", "rom-contract.ts"));
  assert.deepStrictEqual(contract, [], "rom-contract.ts должен быть без импортов");
  const domain = imports(join(ROOT, "emulator-core", "domain.ts"));
  for (const spec of domain) {
    assert.ok(spec.includes("rom-contract"), `domain.ts может зависеть только от rom-contract, а не "${spec}"`);
  }
});

test("architecture: RollbackSession использует порт Clock, а не Date.now напрямую", () => {
  const src = readFileSync(join(ROOT, "netcode", "rollback", "session.ts"), "utf8");
  assert.ok(!/Date\.now\(\)|performance\.now/.test(src), "время должно браться из порта Clock");
});

// --- Backend: правило зависимостей слоёв (domain <- application <- adapters) ---

test("architecture: backend/domain чист — только внутренние относительные импорты", () => {
  const files = walk(join(ROOT, "backend", "domain"), (p) => p.endsWith(".ts"));
  const bad = [];
  for (const f of files) {
    for (const spec of imports(f)) {
      if (!spec.startsWith(".")) bad.push(`${relative(ROOT, f)}: import "${spec}"`);
    }
  }
  assert.deepStrictEqual(bad, [], "домен не должен зависеть от инфраструктуры/фреймворков");
});

test("architecture: backend/application зависит только от domain (без persistence/signaling/node)", () => {
  const files = walk(join(ROOT, "backend", "application"), (p) => p.endsWith(".ts"));
  assert.deepStrictEqual(offenders(files, ["../persistence", "../signaling", "node:"]), []);
});

// --- Frontend: rule dependencies (engine adapters <- application <- components) ---

test("architecture: frontend application не знает о netcode/backend/компонентах", () => {
  const files = walk(join(ROOT, "frontend", "src", "application"), (p) => /\.(ts|tsx)$/.test(p));
  assert.deepStrictEqual(offenders(files, ["netcode", "/components", "backend", "emulator-core"]), []);
});

test("architecture: frontend engine не зависит от application/components", () => {
  const files = walk(join(ROOT, "frontend", "src", "engine"), (p) => /\.(ts|tsx)$/.test(p));
  assert.deepStrictEqual(offenders(files, ["/application", "/components"]), []);
});

test("architecture: frontend components не зависят от netcode/emulator-core/application", () => {
  const files = walk(join(ROOT, "frontend", "src", "components"), (p) => /\.(ts|tsx)$/.test(p));
  assert.deepStrictEqual(offenders(files, ["netcode", "emulator-core", "/application", "backend"]), []);
});

test("architecture: порты самодостаточны (без импортов)", () => {
  assert.deepStrictEqual(imports(join(ROOT, "netcode", "ports.ts")), []);
  assert.deepStrictEqual(imports(join(ROOT, "frontend", "src", "ports.ts")), []);
});

test("architecture: исходники на TypeScript (нет .js вне jsnes src)", () => {
  const roots = ["netcode", "backend", "emulator-core", "qa", "frontend", "scripts"];
  const bad = [];
  for (const r of roots) {
    for (const f of walk(join(ROOT, r), (p) => p.endsWith(".js"))) {
      bad.push(relative(ROOT, f));
    }
  }
  assert.deepStrictEqual(bad, [], `Остались .js-исходники:\n${bad.join("\n")}`);
});

