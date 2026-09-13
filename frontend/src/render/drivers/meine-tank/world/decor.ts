// decor.ts — seeded decorative ground props (grass, flowers, small rocks) for
// `meine-tank`. Display-only: no collision, placed on walkable cells.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/decor.ts
import * as THREE from "three";
import type { RenderBounds } from "../../../types.ts";
import type { Atlas } from "../textures/atlas.ts";
import type { MtDecor, MtTheme } from "../options.ts";

export interface Decor {
  group: THREE.Group;
  rebuild(bounds: RenderBounds, field: Uint8Array, level: MtDecor, theme: MtTheme): void;
  dispose(): void;
}

const PLANTS = [
  "short_grass",
  "fern",
  "poppy",
  "dandelion",
  "cornflower",
  "allium",
  "azure_bluet",
  "oxeye_daisy",
  "red_tulip",
  "orange_tulip",
  "white_tulip",
];
const DESERT = ["dead_bush", "short_grass", "cactus_top"];
const WASTE = ["dead_bush", "short_grass", "fern"];

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDecor(atlas: Atlas): Decor {
  const group = new THREE.Group();
  const mats = new Map<string, THREE.MeshLambertMaterial>();

  function mat(name: string): THREE.MeshLambertMaterial {
    let m = mats.get(name);
    if (!m) {
      m = new THREE.MeshLambertMaterial({
        map: atlas.tile(name),
        transparent: true,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
      });
      mats.set(name, m);
    }
    return m;
  }

  function plantMesh(name: string, x: number, z: number): THREE.Group {
    const g = new THREE.Group();
    const h = name === "fern" || name === "short_grass" ? 0.55 : 0.6;
    const m = mat(name);
    for (const rot of [0, Math.PI / 2]) {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(0.8, h), m);
      p.rotation.y = rot;
      p.position.y = h / 2;
      g.add(p);
    }
    g.position.set(x, 0, z);
    return g;
  }

  function rockMesh(x: number, z: number): THREE.Mesh {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 0.5), mat("cobblestone"));
    r.position.set(x, 0.15, z);
    r.rotation.y = Math.random() * Math.PI;
    return r;
  }

  return {
    group,
    rebuild(bounds, field, level, theme) {
      while (group.children.length) {
        const c = group.children.pop()!;
        c.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
        group.remove(c);
      }
      if (level === "off") return;
      const rnd = mulberry(0x51a7 + bounds.cols * 7919 + bounds.rows * 104729);
      const palette = theme === "desert" ? DESERT : theme === "wasteland" ? WASTE : PLANTS;
      const target = level === "full" ? 90 : 40;
      let placed = 0;
      let attempts = 0;
      while (placed < target && attempts < target * 25) {
        attempts++;
        const c = bounds.col0 + Math.floor(rnd() * bounds.cols);
        const r = bounds.row0 + Math.floor(rnd() * bounds.rows);
        const tile = field[r * 32 + c];
        const walkable = tile === 0 || (tile >= 0x20 && tile < 0x80);
        if (!walkable) continue;
        const x = c - bounds.col0 + 0.5;
        const z = r - bounds.row0 + 0.5;
        if (rnd() < 0.14 && theme === "classic") {
          group.add(rockMesh(x, z));
        } else {
          group.add(plantMesh(palette[Math.floor(rnd() * palette.length)], x, z));
        }
        placed++;
      }
    },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      for (const m of mats.values()) {
        m.map?.dispose?.();
        m.dispose();
      }
      mats.clear();
      group.clear();
    },
  };
}

export default createDecor;
