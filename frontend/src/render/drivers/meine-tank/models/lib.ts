// lib.ts — small block-textured model helpers for `meine-tank`: a material cache
// and box builders with per-face textures (Minecraft-style cube models).
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/lib.ts
import * as THREE from "three";
import type { Atlas } from "../textures/atlas.ts";

export type FaceKey = "px" | "nx" | "py" | "ny" | "pz" | "nz";

/** BoxGeometry material order: +x, -x, +y, -y, +z, -z. */
const FACE_ORDER: FaceKey[] = ["px", "nx", "py", "ny", "pz", "nz"];

export interface MaterialOptions {
  color?: number;
  emissive?: number;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  alphaTest?: number;
  side?: THREE.Side;
  roughness?: number;
  metalness?: number;
  normals?: boolean;
}

export interface MaterialLibrary {
  get(name: string, opts?: MaterialOptions): THREE.MeshStandardMaterial;
  dispose(): void;
}

export function createMaterialLibrary(atlas: Atlas): MaterialLibrary {
  const cache = new Map<string, THREE.MeshStandardMaterial>();

  function get(name: string, opts: MaterialOptions = {}): THREE.MeshStandardMaterial {
    const key = [
      name,
      opts.color ?? 0xffffff,
      opts.emissive ?? 0,
      opts.emissiveIntensity ?? 0,
      opts.transparent ? 1 : 0,
      opts.opacity ?? 1,
      opts.alphaTest ?? 0,
      opts.side ?? THREE.FrontSide,
      opts.roughness ?? 0.9,
      opts.metalness ?? 0,
      opts.normals === false ? 0 : 1,
    ].join("|");
    const hit = cache.get(key);
    if (hit) return hit;
    const normals = opts.normals !== false;
    const mat = new THREE.MeshStandardMaterial({
      map: atlas.tile(name),
      normalMap: normals ? atlas.tileNormal(name) : null,
      normalScale: new THREE.Vector2(normals ? 0.8 : 0, normals ? 0.8 : 0),
      color: opts.color ?? 0xffffff,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      alphaTest: opts.alphaTest ?? 0,
      side: opts.side ?? THREE.FrontSide,
      roughness: opts.roughness ?? 0.9,
      metalness: opts.metalness ?? 0,
    });
    cache.set(key, mat);
    return mat;
  }

  return {
    get,
    dispose() {
      const maps = new Set<THREE.Texture>();
      for (const m of cache.values()) {
        if (m.map) maps.add(m.map);
        if (m.normalMap) maps.add(m.normalMap);
        m.dispose();
      }
      for (const t of maps) t.dispose();
      cache.clear();
    },
  };
}

export type BoxTex = string | Partial<Record<FaceKey, string>>;

export interface BoxSpec {
  w: number;
  h: number;
  d: number;
  x?: number;
  y?: number;
  z?: number;
  tex: BoxTex;
  mat?: MaterialOptions;
  shadows?: boolean;
}

/** Build a box mesh with per-face materials from the library. */
export function buildBox(mats: MaterialLibrary, spec: BoxSpec): THREE.Mesh {
  const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
  const faceOf = (key: FaceKey): string =>
    typeof spec.tex === "string" ? spec.tex : (spec.tex[key] ?? spec.tex.pz ?? spec.tex.px ?? "smooth_stone");
  const materialArr = FACE_ORDER.map((k) => mats.get(faceOf(k), spec.mat));
  const mesh = new THREE.Mesh(geo, materialArr);
  mesh.position.set(spec.x ?? 0, spec.y ?? 0, spec.z ?? 0);
  if (spec.shadows) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  return mesh;
}

/** Dispose a model tree (geometries only; materials are owned by the library). */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
  });
}

export default { createMaterialLibrary, buildBox, disposeTree };
