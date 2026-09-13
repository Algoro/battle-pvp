// outer.ts — the world beyond the arena: a plateau border, hills, biomes, rivers,
// forests and volcanoes. Display-only and seeded; no effect on the game.
//
// Terrain is a heightmap meshed from per-cell quads (one texture tile per block),
// so it stays cheap while looking like Minecraft. Trees reuse instanced boxes and
// the same texture atlas.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/outer.ts
import * as THREE from "three";
import type { RenderBounds } from "../../../types.ts";
import type { Atlas } from "../textures/atlas.ts";
import type { MtMaterials } from "../materials.ts";
import { GRASS_TINT, FOLIAGE_TINT } from "./blocks.ts";
import { fbm, ridge } from "./noise.ts";
import { pickBiome, surfaceFor, type BiomePalette, type TreeSpec } from "./biomes.ts";
import { traceLavaRivers, mulberry, cellKey } from "./lava.ts";
import type { MtBiome, MtBorder, MtOuterWorld } from "../options.ts";

export interface OuterOptions {
  world: MtOuterWorld;
  border: MtBorder;
  biome: MtBiome;
  radius: number;
  rivers: boolean;
  trees: boolean;
  volcano: boolean;
}

export interface OuterWorld {
  group: THREE.Group;
  rebuild(bounds: RenderBounds, opts: OuterOptions, seed: number): void;
  /** Analytic terrain height at a world position (0 = arena level). */
  heightAt(x: number, z: number): number;
  biomeAt(x: number, z: number): BiomePalette;
  /** True outside the arena but inside the generated radius. */
  contains(x: number, z: number): boolean;
  /** Crater mouth positions of the generated volcanoes (world coords). */
  volcanoPoints(): { x: number; y: number; z: number }[];
  dispose(): void;
}

const WATER_LEVEL = -1;
const PLATEAU_BAND = 3;

// Charred stump left where trees met lava.
const BURNT_TREE: TreeSpec = { kind: "burnt", trunk: "basalt_side", leaves: "basalt_side", height: 3, crown: 0 };

interface Volcano {
  x: number;
  z: number;
  r: number;
  peak: number;
}

interface GeoStore {
  pos: number[];
  norm: number[];
  uv: number[];
  idx: number[];
}

function store(): GeoStore {
  return { pos: [], norm: [], uv: [], idx: [] };
}

function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

export function createOuterWorld(materials: MtMaterials, atlas: Atlas): OuterWorld {
  const group = new THREE.Group();
  const terrainMats = new Map<string, THREE.MeshStandardMaterial>();

  function terrainMaterial(name: string): THREE.MeshStandardMaterial {
    let m = terrainMats.get(name);
    if (m) return m;
    m = new THREE.MeshStandardMaterial({
      map: atlas.standalone(name),
      normalMap: atlas.standaloneNormal(name),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.95,
      metalness: 0,
    });
    if (name === "grass_block_top") m.color.setHex(GRASS_TINT);
    if (name.endsWith("_leaves")) {
      m.color.setHex(FOLIAGE_TINT);
      m.alphaTest = 0.5;
      m.side = THREE.DoubleSide;
    }
    terrainMats.set(name, m);
    return m;
  }

  let bounds: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };
  let opts: OuterOptions = {
    world: "off",
    border: "off",
    biome: "mixed",
    radius: 56,
    rivers: false,
    trees: false,
    volcano: false,
  };
  let seed = 1337;
  let volcanoes: Volcano[] = [];
  let volcanoTops: { x: number; y: number; z: number }[] = [];
  const heightCache = new Map<number, number>();

  function cacheKey(x: number, z: number): number {
    return (Math.round(x) + 8192) * 65536 + (Math.round(z) + 8192);
  }

  function heightAt(x: number, z: number): number {
    const key = cacheKey(x, z);
    const hit = heightCache.get(key);
    if (hit !== undefined) return hit;
    const cols = bounds.cols;
    const rows = bounds.rows;
    const dx = Math.max(0, -x, x - cols);
    const dz = Math.max(0, -z, z - rows);
    const dist = Math.hypot(dx, dz);

    let h = (fbm(x * 0.035, z * 0.035, seed, 5) - 0.5) * 12;
    h += Math.max(0, fbm(x * 0.014, z * 0.014, seed + 71, 4) - 0.56) * 34;
    if (opts.rivers) {
      const r = ridge(x * 0.022, z * 0.022, seed + 17, 3);
      if (r > 0.76) h = Math.min(h, WATER_LEVEL - 0.5 - (r - 0.76) * 12);
    }
    for (const v of volcanoes) {
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.r) {
        const crater = d < v.r * 0.16 ? -3 : 0;
        h = Math.max(h, v.peak * (1 - d / v.r) + crater + (fbm(x * 0.12, z * 0.12, seed + 5, 3) - 0.5) * 1.6);
      }
    }
    if (dist < PLATEAU_BAND) h = 0;
    else if (dist < PLATEAU_BAND * 2) h *= smoothstep((dist - PLATEAU_BAND) / PLATEAU_BAND);

    const edge = opts.radius;
    if (dist > edge - 12) h *= 1 - 0.9 * smoothstep((dist - (edge - 12)) / 12);
    if (heightCache.size > 80000) heightCache.clear();
    heightCache.set(key, h);
    return h;
  }

  function volcanoInfluence(x: number, z: number): number {
    let best = 0;
    for (const v of volcanoes) {
      const d = Math.hypot(x - v.x, z - v.z);
      if (d < v.r) best = Math.max(best, 1 - d / v.r);
    }
    return best;
  }

  function biomeAt(x: number, z: number): BiomePalette {
    if (volcanoInfluence(x, z) > 0.25) return pickBiome("volcanic", 0, 0, 1);
    const temp = fbm(x * 0.008, z * 0.008, seed + 211, 3);
    const humid = fbm(x * 0.011, z * 0.011, seed + 313, 3);
    const volcanic = fbm(x * 0.006, z * 0.006, seed + 419, 2);
    return pickBiome(opts.biome, temp, humid, volcanic);
  }

  function contains(x: number, z: number): boolean {
    const insideArena = x > -0.5 && x < bounds.cols + 0.5 && z > -0.5 && z < bounds.rows + 0.5;
    if (insideArena) return false;
    const cx = bounds.cols / 2;
    const cz = bounds.rows / 2;
    return Math.hypot(x - cx, z - cz) <= opts.radius + bounds.cols / 2;
  }

  function addQuad(
    s: GeoStore,
    p0: [number, number, number],
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    n: [number, number, number],
    vTop: number,
  ): void {
    const base = s.pos.length / 3;
    s.pos.push(...p0, ...p1, ...p2, ...p3);
    for (let i = 0; i < 4; i++) s.norm.push(...n);
    s.uv.push(0, 0, 1, 0, 1, vTop, 0, vTop);
    s.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function addCliff(
    s: GeoStore,
    x: number,
    z: number,
    nh: number,
    h: number,
    dir: "east" | "west" | "south" | "north",
  ): void {
    if (nh >= h) return;
    const x0 = x;
    const x1 = x + 1;
    const z0 = z;
    const z1 = z + 1;
    const depth = h - nh;
    // Winding must be CCW as seen from outside, otherwise the face is culled and
    // the sky shows through the terrain (visible on the volcano flanks).
    if (dir === "east") addQuad(s, [x1, nh, z1], [x1, nh, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0], depth);
    else if (dir === "west") addQuad(s, [x0, nh, z0], [x0, nh, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0], depth);
    else if (dir === "south") addQuad(s, [x0, nh, z1], [x1, nh, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1], depth);
    else addQuad(s, [x1, nh, z0], [x0, nh, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1], depth);
  }

  function toGeometry(s: GeoStore): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(s.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(s.norm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(s.uv, 2));
    g.setIndex(s.idx);
    g.computeBoundingSphere();
    return g;
  }

  // Lava rivers / obsidian / burned trees are computed ONCE per rebuild (static
  // world) by the pure tracer in lava.ts, so there is zero per-frame cost.
  let lavaCells = new Set<number>();
  let obsidianCells = new Set<number>();
  let burnedCells = new Set<number>();

  function buildTerrain(): void {
    const traced = traceLavaRivers({
      volcanoes,
      heightAt,
      contains,
      seed,
      waterLevel: WATER_LEVEL,
      branches: 6,
      maxSteps: 600,
      burnRadius: 3,
    });
    lavaCells = traced.lava;
    obsidianCells = traced.obsidian;
    burnedCells = traced.burned;
    const cols = bounds.cols;
    const rows = bounds.rows;
    const R = opts.radius;
    const x0 = Math.floor(-R);
    const x1 = Math.ceil(cols + R);
    const z0 = Math.floor(-R);
    const z1 = Math.ceil(rows + R);
    const CH = 32;
    const stores = new Map<string, GeoStore>();
    const put = (matKey: string, x: number, z: number): GeoStore => {
      const k = `${matKey}|${Math.floor(x / CH)},${Math.floor(z / CH)}`;
      let s = stores.get(k);
      if (!s) {
        s = store();
        stores.set(k, s);
      }
      return s;
    };
    const WATER_KEY = " water";
    const LAVA_KEY = " lava";

    for (let x = x0; x < x1; x++) {
      const cx = x + 0.5;
      for (let z = z0; z < z1; z++) {
        if (x >= 0 && x < cols && z >= 0 && z < rows) continue;
        const cz = z + 0.5;
        const h = Math.round(heightAt(cx, cz));
        const palette = biomeAt(cx, cz);
        const surf = surfaceFor(palette, h);
        const volcanic = volcanoInfluence(cx, cz);

        const ck = cellKey(x, z);
        const isObsidian = obsidianCells.has(ck);
        const isLava = !isObsidian && (lavaCells.has(ck) || (opts.volcano && volcanic > 0.72 && h >= 8));
        const isWater = opts.rivers && h < WATER_LEVEL && volcanic <= 0.25 && !isObsidian && !isLava;

        if (isObsidian) {
          addQuad(
            put("obsidian", x, z),
            [x, Math.max(h, WATER_LEVEL), z],
            [x, Math.max(h, WATER_LEVEL), z + 1],
            [x + 1, Math.max(h, WATER_LEVEL), z + 1],
            [x + 1, Math.max(h, WATER_LEVEL), z],
            [0, 1, 0],
            1,
          );
        } else if (isLava) {
          addQuad(
            put(LAVA_KEY, x, z),
            [x, h + 0.03, z],
            [x, h + 0.03, z + 1],
            [x + 1, h + 0.03, z + 1],
            [x + 1, h + 0.03, z],
            [0, 1, 0],
            1,
          );
        } else if (isWater) {
          addQuad(
            put(WATER_KEY, x, z),
            [x, WATER_LEVEL, z],
            [x, WATER_LEVEL, z + 1],
            [x + 1, WATER_LEVEL, z + 1],
            [x + 1, WATER_LEVEL, z],
            [0, 1, 0],
            1,
          );
        } else {
          addQuad(put(surf.top, x, z), [x, h, z], [x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z], [0, 1, 0], 1);
        }

        const sideMat = isObsidian ? "obsidian" : isLava ? "basalt_side" : surf.side;
        const east = Math.round(heightAt(x + 1.5, cz));
        const west = Math.round(heightAt(x - 0.5, cz));
        const south = Math.round(heightAt(cx, z + 1.5));
        const north = Math.round(heightAt(cx, z - 0.5));
        addCliff(put(sideMat, x, z), x, z, east, h, "east");
        addCliff(put(sideMat, x, z), x, z, west, h, "west");
        addCliff(put(sideMat, x, z), x, z, south, h, "south");
        addCliff(put(sideMat, x, z), x, z, north, h, "north");
      }
    }

    for (const [k, s] of stores) {
      if (!s.pos.length) continue;
      const matKey = k.slice(0, k.indexOf("|"));
      const material =
        matKey === WATER_KEY ? materials.water : matKey === LAVA_KEY ? materials.lava : terrainMaterial(matKey);
      const mesh = new THREE.Mesh(toGeometry(s), material);
      mesh.receiveShadow = matKey !== WATER_KEY;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
    }
  }

  function buildTrees(): void {
    const cols = bounds.cols;
    const rows = bounds.rows;
    const R = opts.radius;
    const rnd = mulberry(seed ^ 0x9e3779b9);
    interface Placement {
      spec: TreeSpec;
      x: number;
      y: number;
      z: number;
    }
    const placed: Placement[] = [];
    const cap = 420;
    for (let x = Math.floor(-R); x < Math.ceil(cols + R) && placed.length < cap; x++) {
      for (let z = Math.floor(-R); z < Math.ceil(rows + R) && placed.length < cap; z++) {
        if (x >= -1 && x <= cols && z >= -1 && z <= rows) continue;
        const cx = x + 0.5;
        const cz = z + 0.5;
        if (!contains(cx, cz)) continue;
        const odx = Math.max(0, -cx, cx - cols);
        const odz = Math.max(0, -cz, cz - rows);
        if (Math.hypot(odx, odz) < 6) continue;
        const h = Math.round(heightAt(cx, cz));
        if (h <= WATER_LEVEL + 1 || h > 18 || volcanoInfluence(cx, cz) > 0.2) continue;
        if (burnedCells.has(cellKey(cx, cz))) {
          if (rnd() < 0.35) placed.push({ spec: BURNT_TREE, x: cx, y: h, z: cz });
          continue;
        }
        const palette = biomeAt(cx, cz);
        if (!palette.trees.length || rnd() > palette.treeDensity) continue;
        const slope = Math.abs(h - Math.round(heightAt(cx + 1, cz))) + Math.abs(h - Math.round(heightAt(cx, cz + 1)));
        if (slope > 2) continue;
        placed.push({ spec: palette.trees[Math.floor(rnd() * palette.trees.length)], x: cx, y: h, z: cz });
      }
    }

    const byKey = new Map<string, { spec: TreeSpec; items: Placement[] }>();
    for (const p of placed) {
      const key = `${p.spec.kind}|${p.spec.trunk}|${p.spec.leaves}`;
      let g = byKey.get(key);
      if (!g) {
        g = { spec: p.spec, items: [] };
        byKey.set(key, g);
      }
      g.items.push(p);
    }

    const dummy = new THREE.Object3D();
    for (const { spec, items } of byKey.values()) {
      const trunk = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), terrainMaterial(spec.trunk), items.length);
      const crowns: THREE.Matrix4[] = [];
      items.forEach((it, i) => {
        const th = spec.height;
        dummy.position.set(it.x, it.y + th / 2, it.z);
        dummy.scale.set(1, th, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        trunk.setMatrixAt(i, dummy.matrix);
        if (spec.kind === "cactus" || spec.kind === "burnt") {
          dummy.position.set(it.x, it.y + th + 0.5, it.z);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          crowns.push(dummy.matrix.clone());
          return;
        }
        const layers = spec.kind === "spruce" ? [2, 1.6, 1.1] : [2, 1.5];
        layers.forEach((rad, li) => {
          const w = rad * 2 + 1;
          dummy.position.set(it.x, it.y + th - 1 + li * 1.1, it.z);
          dummy.scale.set(w, 1.2, w);
          dummy.updateMatrix();
          crowns.push(dummy.matrix.clone());
        });
      });
      trunk.instanceMatrix.needsUpdate = true;
      group.add(trunk);
      const leaf = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), terrainMaterial(spec.leaves), crowns.length);
      crowns.forEach((m, i) => leaf.setMatrixAt(i, m));
      leaf.instanceMatrix.needsUpdate = true;
      group.add(leaf);
    }
  }

  function buildBorder(): void {
    if (opts.border === "off" || opts.world === "off") return;
    const cols = bounds.cols;
    const rows = bounds.rows;
    const height = opts.border === "wall" ? 2.4 : 0.4;
    const thickness = 0.6;
    const mat = terrainMaterial("stone_bricks");
    const capMat = terrainMaterial("deepslate_tiles");
    const sides: { x: number; z: number; w: number; d: number }[] = [
      { x: cols / 2, z: -thickness / 2, w: cols + thickness * 2, d: thickness },
      { x: cols / 2, z: rows + thickness / 2, w: cols + thickness * 2, d: thickness },
      { x: -thickness / 2, z: rows / 2, w: thickness, d: rows + thickness * 2 },
      { x: cols + thickness / 2, z: rows / 2, w: thickness, d: rows + thickness * 2 },
    ];
    for (const s of sides) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(s.w, height, s.d), mat);
      mesh.position.set(s.x, height / 2, s.z);
      group.add(mesh);
      if (opts.border === "wall") {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(s.w, 0.25, s.d), capMat);
        cap.position.set(s.x, height + 0.12, s.z);
        group.add(cap);
      }
    }
  }

  function disposeChildren(): void {
    group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    group.clear();
    heightCache.clear();
  }

  return {
    group,
    rebuild(nextBounds, nextOpts, nextSeed) {
      bounds = nextBounds;
      opts = nextOpts;
      seed = nextSeed >>> 0;
      volcanoes = [];
      heightCache.clear();
      if (opts.world !== "off" && opts.volcano) {
        const cx = bounds.cols / 2;
        const czc = bounds.rows / 2;
        const rnd = mulberry(seed ^ 0x51ed270b);
        const count = rnd() > 0.5 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          const a = rnd() * Math.PI * 2;
          const dist = opts.radius * (0.55 + rnd() * 0.25);
          volcanoes.push({
            x: cx + Math.cos(a) * dist,
            z: czc + Math.sin(a) * dist,
            r: 9 + rnd() * 5,
            peak: 13 + rnd() * 8,
          });
        }
      }
      disposeChildren();
      heightCache.clear();
      volcanoTops = volcanoes.map((v) => ({ x: v.x, y: heightAt(v.x, v.z), z: v.z }));
      if (opts.world === "off" && opts.border === "off") return;
      if (opts.world !== "off") {
        buildTerrain();
        buildTrees();
      }
      buildBorder();
    },
    heightAt,
    biomeAt,
    contains,
    volcanoPoints() {
      return volcanoTops;
    },
    dispose() {
      disposeChildren();
      for (const m of terrainMats.values()) {
        m.map?.dispose?.();
        m.dispose();
      }
      terrainMats.clear();
    },
  };
}

export default createOuterWorld;
