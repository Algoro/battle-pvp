// extract-patches.mjs — верификация/инспекция in-memory патчей ROM.
//
// Использование:
//   node scripts/extract-patches.mjs           # diff оригинал vs собранный ROM
//   node scripts/extract-patches.mjs --check   # применить набор 'pvp' к оригиналу
//                                              # и сверить с собранным ROM (exit 1 при расхождении)
//
// Относительный путь: ./scripts/extract-patches.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import ROM from "../emulator-core/src/rom.js";
import { applyPatchSet } from "../emulator-core/patching/apply.js";
import { RomImage } from "../emulator-core/patching/rom-image.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const ORIG = join(root, "rom", "original", "_battle_city.nes");
const PATCHED = join(root, "rom", "disasm", "_battle_city.nes");

function diffRegions(a, b) {
  const out = [];
  let cur = null;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (!cur) cur = { start: i, end: i };
      else cur.end = i;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function main() {
  const orig = readFileSync(ORIG);
  const patched = readFileSync(PATCHED);
  const check = process.argv.includes("--check");

  if (check) {
    const rom = new ROM(null);
    rom.load(orig);
    const report = applyPatchSet(rom, "pvp");
    let diffs = 0;
    for (let bank = 0; bank < rom.romCount; bank++) {
      for (let i = 0; i < 16384; i++) {
        if (rom.rom[bank][i] !== patched[16 + bank * 16384 + i]) diffs++;
      }
    }
    console.log(`set=${report.setId} fingerprint=${report.fingerprint} applied=${report.applied.length} routines=${report.routines.length}`);
    console.log(diffs === 0 ? "OK: in-memory патч побайтово воспроизводит собранный ROM" : `FAIL: расхождений ${diffs}`);
    process.exit(diffs === 0 ? 0 : 1);
  }

  const regions = diffRegions(orig, patched);
  console.log(`Оригинал: ${ORIG}`);
  console.log(`Собрано:  ${PATCHED}`);
  console.log(`Отличий: ${regions.reduce((n, r) => n + (r.end - r.start + 1), 0)} байт в ${regions.length} регионах\n`);
  for (const r of regions) {
    const fileOff = r.start;
    const region = fileOff < 16 ? "HEADER" : fileOff < 16 + 0x4000 ? "PRG" : "CHR";
    const cpu = region === "PRG" ? 0xc000 + ((fileOff - 16) & 0x3fff) : null;
    const ob = Array.from(orig.subarray(r.start, r.end + 1)).map((x) => x.toString(16).padStart(2, "0")).join(" ");
    const pb = Array.from(patched.subarray(r.start, r.end + 1)).map((x) => x.toString(16).padStart(2, "0")).join(" ");
    console.log(`file 0x${r.start.toString(16)}-0x${r.end.toString(16)} ${region}${cpu !== null ? ` CPU $${cpu.toString(16).toUpperCase()}` : ""} (${r.end - r.start + 1}b)`);
    console.log(`  orig: ${ob}`);
    console.log(`  pat : ${pb}`);
  }
}

main();
