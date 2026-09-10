// prepare.mjs — идемпотентная подготовка рабочего дерева к сборке/тестам.
//
//  1. vendor/jsnes (git-сабмодуль, неизменный апстрим) -> emulator-core/src (генерируемая копия).
//  2. rom/original/_battle_city.nes -> frontend/public/rom/battle_city.nes (оригинал для dev/build).
//  3. rom/original + набор патчей "pvp" -> rom/disasm/_battle_city.nes (эталон для тестов).
//
// Безопасно запускать параллельно: копии атомарны, повторные запуски пропускаются.
// jsnes НЕ редактируется. Оригинальный ROM в репозиторий не входит (авторские права):
// положите его в rom/original/_battle_city.nes (sha1 941ad7ca…).
//
// Относительный путь: ./scripts/prepare.mjs
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, renameSync, readdirSync, statSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { applyPatchSet } from "../emulator-core/patching/apply.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const JSNES_SRC = join(root, "vendor", "jsnes", "src");
const CORE_SRC = join(root, "emulator-core", "src");
const CORE_STAMP = join(root, "emulator-core", ".jsnes-stamp");
const CORE_LOCK = join(root, "emulator-core", ".jsnes-lock");
const ORIG = join(root, "rom", "original", "_battle_city.nes");
const PATCHED = join(root, "rom", "disasm", "_battle_city.nes");
const FRONT_ROM = join(root, "frontend", "public", "rom", "battle_city.nes");
const ORIG_SHA1 = "941ad7ca825e3f86407472113aad00520cb45783";
const PRG_FNV = "94cb0636";

function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else out.push(relative(base, p));
  }
  return out.sort();
}

function stampOf(dir) {
  const h = createHash("sha1");
  for (const rel of walk(dir)) h.update(rel).update(readFileSync(join(dir, rel)));
  return h.digest("hex");
}

function sleepMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20); } catch { /* fallback */ }
  }
}

function copyJsnes() {
  if (!existsSync(join(JSNES_SRC, "nes.js"))) {
    console.error("[prepare] vendor/jsnes не найден. Выполните: git submodule update --init --recursive");
    process.exit(1);
  }
  const stamp = stampOf(JSNES_SRC);
  const upToDate = () =>
    existsSync(join(CORE_SRC, "nes.js")) && existsSync(CORE_STAMP) && readFileSync(CORE_STAMP, "utf8") === stamp;
  if (upToDate()) return;

  // Замок: при параллельном запуске (несколько сьютов) копирует только один процесс,
  // остальные ждут готовности, чтобы не читать полу-скопированный src.
  let locked = false;
  try {
    writeFileSync(CORE_LOCK, String(process.pid), { flag: "wx" });
    locked = true;
  } catch {
    for (let i = 0; i < 250 && !upToDate(); i++) sleepMs(20);
    return;
  }
  try {
    const tmp = CORE_SRC + ".tmp-" + process.pid;
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true });
    for (const rel of walk(JSNES_SRC)) {
      const dst = join(tmp, rel);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, readFileSync(join(JSNES_SRC, rel)));
    }
    rmSync(CORE_SRC, { recursive: true, force: true });
    renameSync(tmp, CORE_SRC);
    writeFileSync(CORE_STAMP, stamp);
    console.log("[prepare] emulator-core/src <- vendor/jsnes/src (jsnes неизменен)");
  } finally {
    if (locked) rmSync(CORE_LOCK, { force: true });
  }
}

function requireOriginal() {
  if (!existsSync(ORIG)) {
    console.error(
      `[prepare] Не найден оригинальный ROM: ${ORIG}\n` +
        `          Положите Battle City (Japan) со sha1 ${ORIG_SHA1}.\n` +
        `          Шаги с ROM пропущены.`,
    );
    return false;
  }
  return true;
}

function copyFrontRom() {
  mkdirSync(dirname(FRONT_ROM), { recursive: true });
  if (existsSync(FRONT_ROM) && readFileSync(FRONT_ROM).equals(readFileSync(ORIG))) return;
  writeFileSync(FRONT_ROM, readFileSync(ORIG));
  console.log("[prepare] frontend/public/rom/battle_city.nes <- оригинал");
}

function buildPatchedRom() {
  const data = readFileSync(ORIG);
  const prg = data.subarray(16, 16 + 0x4000);
  const fake = { valid: true, mapperType: 0, romCount: 1, rom: [Uint8Array.from(prg)] };
  const report = applyPatchSet(fake, "pvp");
  if (report.fingerprint !== PRG_FNV) {
    console.error(`[prepare] неожиданный отпечаток пропатченного PRG: ${report.fingerprint}`);
    process.exit(1);
  }
  const chr = data.subarray(16 + 0x4000);
  const out = new Uint8Array(16 + 0x4000 + chr.length);
  out.set(data.subarray(0, 16), 0);
  out.set(fake.rom[0], 16);
  out.set(chr, 16 + 0x4000);
  const tmp = PATCHED + ".tmp-" + process.pid;
  mkdirSync(dirname(PATCHED), { recursive: true });
  writeFileSync(tmp, out);
  renameSync(tmp, PATCHED);
  console.log(`[prepare] ${PATCHED} <- оригинал + патчи pvp (fingerprint ${report.fingerprint})`);
}

copyJsnes();
if (requireOriginal()) {
  copyFrontRom();
  buildPatchedRom();
}
