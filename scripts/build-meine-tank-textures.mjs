// build-meine-tank-textures.mjs — extract the curated `meine-tank` asset set from a
// Minecraft resource pack (zip). The full pack is never copied: only the textures
// listed in the driver manifest are written to `frontend/public/textures/meine-tank/`.
//
// Usage:
//   node scripts/build-meine-tank-textures.mjs [path/to/pack.zip] [outDir]
//
// Relative path: ./scripts/build-meine-tank-textures.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { MEINE_TANK_TEXTURES, LICENSE_FILE } from "../frontend/src/render/drivers/meine-tank/textures/manifest.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_OUT = join(ROOT, "frontend", "public", "textures", "meine-tank");

/** Minimal ZIP reader: central directory + local headers (stored / deflate). */
function readZip(buf) {
  const EOCD = 0x06054b50;
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 0xffff; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: end-of-central-directory not found");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`ZIP: bad central directory at ${p}`);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`ZIP: no entry «${name}»`);
      const lp = e.localOff;
      if (buf.readUInt32LE(lp) !== 0x04034b50) throw new Error(`ZIP: bad local header «${name}»`);
      const nameLen = buf.readUInt16LE(lp + 26);
      const extraLen = buf.readUInt16LE(lp + 28);
      const start = lp + 30 + nameLen + extraLen;
      const data = buf.subarray(start, start + e.compSize);
      return e.method === 0 ? Buffer.from(data) : inflateRawSync(data);
    },
  };
}

function findPack() {
  if (process.argv[2]) return resolve(process.argv[2]);
  const found = readdirSync(ROOT).find((f) => /^Faithful-.*\.zip$/i.test(f));
  return found ? join(ROOT, found) : null;
}

function main() {
  const packPath = findPack();
  if (!packPath || !existsSync(packPath)) {
    console.error("[meine-tank] resource pack zip not found. Pass it as the first argument.");
    process.exit(1);
  }

  const zip = readZip(readFileSync(packPath));
  const out = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUT;
  rmSync(out, { recursive: true, force: true });

  const manifest = [];
  let missing = 0;
  for (const asset of MEINE_TANK_TEXTURES) {
    const entry = `assets/minecraft/textures/${asset.path}`;
    if (!zip.has(entry)) {
      console.warn(`[meine-tank] MISSING in pack: ${entry} (${asset.name})`);
      missing++;
      continue;
    }
    const dest = join(out, asset.kind, `${asset.name}.png`);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, zip.read(entry));
    // Animated strips need their .mcmeta (frame timing) to be usable at runtime.
    const mcmeta = `${entry}.mcmeta`;
    if (asset.animated && zip.has(mcmeta)) writeFileSync(`${dest}.mcmeta`, zip.read(mcmeta));
    manifest.push({
      name: asset.name,
      kind: asset.kind,
      file: `${asset.kind}/${asset.name}.png`,
      animated: asset.animated ?? 1,
    });
  }

  if (zip.has("LICENSE.txt")) writeFileSync(join(out, LICENSE_FILE), zip.read("LICENSE.txt"));
  else console.warn("[meine-tank] LICENSE.txt not found in pack");

  writeFileSync(
    join(out, "MANIFEST.json"),
    JSON.stringify({ source: "Faithful-32x", textures: manifest }, null, 2) + "\n",
  );

  console.log(`[meine-tank] extracted ${manifest.length}/${MEINE_TANK_TEXTURES.length} textures -> ${out}`);
  if (missing) process.exitCode = 1;
}

main();
