// meine-tank.test.ts — blocks, options, manifest and particle-sprite helpers of the
// `meine-tank` driver (no DOM / no three).
import { test } from "node:test";
import assert from "node:assert";
import { MEINE_TANK_TEXTURES, TEXTURE_BY_NAME } from "../src/render/drivers/meine-tank/textures/manifest.ts";
import { BLOCK, blockForTile, themeBlocks } from "../src/render/drivers/meine-tank/world/blocks.ts";
import { normalizeMtOptions, optionsFromPreset, faunaGroups } from "../src/render/drivers/meine-tank/options.ts";
import { particleSpriteRanges } from "../src/render/drivers/meine-tank/fx/sprites.ts";
import { valueNoise, fbm, ridge } from "../src/render/drivers/meine-tank/world/noise.ts";
import { pickBiome, surfaceFor, BIOMES } from "../src/render/drivers/meine-tank/world/biomes.ts";
import * as THREE from "three";
import { createMob } from "../src/render/drivers/meine-tank/models/mobs/geometry.ts";
import { MOB_GEOMETRY } from "../src/render/drivers/meine-tank/models/mobs/defs.ts";
import { normalTile } from "../src/render/drivers/meine-tank/textures/atlas.ts";
import { traceLavaRivers } from "../src/render/drivers/meine-tank/world/lava.ts";
import type { MtTheme } from "../src/render/drivers/meine-tank/options.ts";

test("meine-tank: манифест текстур без дублей", () => {
  assert.ok(MEINE_TANK_TEXTURES.length > 100);
  assert.strictEqual(TEXTURE_BY_NAME.size, MEINE_TANK_TEXTURES.length);
});

test("meine-tank: все текстуры блоков и тем объявлены в манифесте", () => {
  const names = new Set<string>();
  for (const def of Object.values(BLOCK)) {
    names.add(def.top);
    names.add(def.side);
    names.add(def.bottom);
  }
  for (const theme of ["classic", "desert", "wasteland"] as MtTheme[]) {
    const t = themeBlocks(theme);
    for (const n of [t.groundTop, t.groundSide, t.groundBottom, t.roadTop, t.roadSide, t.roadBottom]) names.add(n);
  }
  for (const n of names) {
    const asset = TEXTURE_BY_NAME.get(n);
    assert.ok(asset, `текстура «${n}» отсутствует в манифесте`);
    assert.strictEqual(asset.kind, "block");
  }
});

test("meine-tank: анимированные текстуры помечены и не попадают в статический атлас", () => {
  assert.strictEqual(TEXTURE_BY_NAME.get("water_still")?.animated, 32);
  assert.strictEqual(TEXTURE_BY_NAME.get("water_flow")?.animated, 32);
  assert.strictEqual(TEXTURE_BY_NAME.get("bricks")?.animated, undefined);
});

test("meine-tank: тайл -> блок (тема classic)", () => {
  assert.strictEqual(blockForTile(0), null);
  assert.strictEqual(blockForTile(0x0f)?.top, "bricks");
  assert.strictEqual(blockForTile(0x10)?.top, "iron_block");
  assert.strictEqual(blockForTile(0x12)?.pass, "water");
  assert.ok((blockForTile(0x12)?.h ?? 1) <= 0.1, "вода должна быть заподлицо");
  assert.ok((blockForTile(0x21)?.h ?? 1) <= 0.1, "лёд должен быть заподлицо");
  assert.strictEqual(blockForTile(0x21)?.top, "blue_ice");
  assert.strictEqual(blockForTile(0x22)?.top, "oak_leaves");
  assert.strictEqual(blockForTile(0x20)?.top, "dirt_path_top");
  assert.strictEqual(blockForTile(0xc8), null, "орёл — отдельной моделью");
  const dmg = blockForTile(0x03);
  assert.ok(dmg && dmg.h < 1 && dmg.top === "cracked_stone_bricks");
});

test("meine-tank: тема меняет землю и дорогу", () => {
  assert.strictEqual(blockForTile(0x20, "desert")?.top, "sandstone_top");
  assert.strictEqual(blockForTile(0x20, "wasteland")?.top, "gravel");
  assert.strictEqual(themeBlocks("desert").groundTop, "sand");
});

test("meine-tank: настройки — дефолты, нормализация, пресеты", () => {
  const d = normalizeMtOptions(null);
  assert.strictEqual(d.textureSize, 32);
  assert.strictEqual(d.fauna, "ambient");
  assert.strictEqual(d.faunaBees, true);
  assert.strictEqual(d.theme, "classic");
  assert.strictEqual(normalizeMtOptions({ fog: 9 }).fog, 1);
  assert.strictEqual(normalizeMtOptions({ textureSize: 16 }).textureSize, 16);
  assert.strictEqual(normalizeMtOptions({ fauna: "nope" }).fauna, "ambient");
  const perf = optionsFromPreset("performance");
  assert.strictEqual(perf.preset, "performance");
  assert.strictEqual(perf.particles, 0);
  assert.strictEqual(perf.faunaDensity, 0);
});

test("meine-tank: faunaGroups учитывает глобальный режим", () => {
  const on = normalizeMtOptions({ fauna: "lively" });
  assert.strictEqual(faunaGroups(on).bees, true);
  const off = normalizeMtOptions({ fauna: "off", faunaBees: true });
  assert.strictEqual(faunaGroups(off).bees, false);
  const noBats = normalizeMtOptions({ faunaBats: false });
  assert.strictEqual(faunaGroups(noBats).bats, false);
});

test("meine-tank: диапазоны кадров частиц", () => {
  const names = ["explosion_0", "explosion_1", "explosion_2", "big_smoke_0", "big_smoke_1", "flame", "flash"];
  const r = particleSpriteRanges(names);
  assert.deepStrictEqual(r.explosion, { start: 0, count: 3 });
  assert.deepStrictEqual(r.smoke, { start: 3, count: 2 });
  assert.deepStrictEqual(r.flame, { start: 5, count: 1 });
  assert.deepStrictEqual(r.flash, { start: 6, count: 1 });
});

test("meine-tank: шум детерминирован и в диапазоне [0,1]", () => {
  for (let i = 0; i < 50; i++) {
    const x = i * 0.37 - 5;
    const z = i * 0.91 + 2;
    assert.strictEqual(valueNoise(x, z, 7), valueNoise(x, z, 7));
    for (const v of [valueNoise(x, z, 7), fbm(x, z, 11, 4), ridge(x, z, 3, 3)]) {
      assert.ok(v >= 0 && v <= 1, `вне диапазона: ${v}`);
    }
  }
  assert.notStrictEqual(valueNoise(1.2, 3.4, 1), valueNoise(9.2, 3.4, 1));
});

test("meine-tank: выбор биома и снежные вершины", () => {
  assert.strictEqual(pickBiome("desert", 0.5, 0.5, 0).id, "desert");
  assert.strictEqual(pickBiome("mixed", 0.9, 0.9, 0.9).id, "volcanic", "вулкан побеждает");
  assert.strictEqual(pickBiome("mixed", 0.1, 0.5, 0).id, "snow");
  assert.strictEqual(pickBiome("mixed", 0.5, 0.9, 0).id, "forest");
  assert.strictEqual(pickBiome("mixed", 0.9, 0.1, 0).id, "desert");
  assert.strictEqual(surfaceFor(BIOMES.plains, 20).top, "stone");
  assert.strictEqual(surfaceFor(BIOMES.plains, 15).top, "snow");
});

test("meine-tank: лава течёт вниз, у воды — обсидиан, рядом горят деревья", () => {
  const heightAt = (x: number, z: number): number => {
    const d = Math.hypot(x, z);
    // Cone plus a slope toward +x so the descent clearly reaches the water pit.
    let h = Math.max(0, 10 * (1 - d / 10)) - 0.45 * x;
    if (Math.abs(x - 8.5) < 1.5 && Math.abs(z) < 1.5) h = -2; // water pit
    return h;
  };
  const r = traceLavaRivers({
    volcanoes: [{ x: 0, z: 0, r: 10, peak: 10 }],
    heightAt,
    contains: (x, z) => Math.hypot(x, z) < 20,
    seed: 1,
    waterLevel: -1,
    branches: 4,
    maxSteps: 80,
  });
  assert.ok(r.lava.size > 0, "лава появилась");
  assert.ok(r.obsidian.size > 0, "лава у воды превратилась в обсидиан");
  assert.ok(r.burned.size > r.lava.size, "вокруг лавы отмечены горящие деревья");
  for (const k of r.lava) assert.ok(!r.obsidian.has(k), "лава и обсидиан не пересекаются");
  for (const k of r.obsidian) {
    const x = Math.floor(k / 65536) - 8192;
    const z = (k % 65536) - 8192;
    assert.ok(heightAt(x + 0.5, z + 0.5) < -1, "обсидиан образуется только на воде");
  }
});

test("meine-tank: normal-map из albedo (плоскость и склон)", () => {
  const w = 4;
  const h = 4;
  const flat = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let i = 0; i < flat.data.length; i += 4) {
    flat.data[i] = 120;
    flat.data[i + 1] = 120;
    flat.data[i + 2] = 120;
    flat.data[i + 3] = 255;
  }
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  normalTile(flat as unknown as ImageData, out as unknown as ImageData);
  const c = (2 * w + 2) * 4;
  assert.ok(
    Math.abs(out.data[c] - 128) <= 8 && Math.abs(out.data[c + 1] - 128) <= 8,
    "ровная поверхность → нормаль вверх",
  );
  assert.ok(out.data[c + 2] > 240, "z-компонента нормали почти 255");

  const sloped = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = (y * w + x) * 4;
      const v = 60 + x * 40;
      sloped.data[p] = v;
      sloped.data[p + 1] = v;
      sloped.data[p + 2] = v;
      sloped.data[p + 3] = 255;
    }
  }
  const out2 = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  normalTile(sloped as unknown as ImageData, out2 as unknown as ImageData);
  assert.notStrictEqual(out2.data[c], out.data[c], "склон меняет X-компоненту нормали");
});

test("meine-tank: модели мобов собираются и тело стоит на ногах", () => {
  const mat = new THREE.MeshBasicMaterial();
  for (const [species, geom] of Object.entries(MOB_GEOMETRY)) {
    const inst = createMob(geom, mat);
    inst.group.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(inst.group);
    assert.ok(Number.isFinite(box.min.y) && Number.isFinite(box.max.y), `${species}: пустой bounding box`);
    const size = new THREE.Vector3();
    box.getSize(size);
    const limit = species === "dragon" ? 16 : species === "bat" ? 3.5 : 2.4;
    assert.ok(
      size.x <= limit && size.y <= limit && size.z <= limit,
      `${species}: слишком крупная модель ${size.toArray()}`,
    );
    const flying =
      species === "bee" || species === "parrot" || species === "bat" || species === "allay" || species === "dragon";
    const minY = flying || species === "axolotl" ? -3 : -0.2;
    assert.ok(box.min.y > minY, `${species}: проваливается под землю (min.y=${box.min.y.toFixed(2)})`);
    if (!flying) assert.ok(box.max.y > 0.2, `${species}: модель пустая сверху`);
    inst.dispose();
  }

  // Quadrupeds: the rotated body must reach down to the legs (no floating torso).
  for (const species of ["cow", "pig"] as const) {
    const inst = createMob(MOB_GEOMETRY[species], mat);
    inst.group.updateMatrixWorld(true);
    const body = inst.bones.get("body");
    const leg = inst.bones.get("leg0");
    assert.ok(body && leg, `${species}: нет костей body/leg0`);
    const bodyBox = new THREE.Box3().setFromObject(body!);
    const legBox = new THREE.Box3().setFromObject(leg!);
    assert.ok(
      bodyBox.min.y <= legBox.max.y + 0.35 && bodyBox.min.y >= legBox.max.y - 0.6,
      `${species}: тело не стоит на ногах (body.y=${bodyBox.min.y.toFixed(2)}, legs.y=${legBox.max.y.toFixed(2)})`,
    );
    inst.dispose();
  }
});
