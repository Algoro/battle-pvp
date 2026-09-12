// base.ts — модель штаба (орла): целый, разрушенный, укреплённый (лопата).
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/models/base.ts
import * as THREE from "three";
import { COLORS } from "../textures.ts";
import type { RenderBounds, SceneEagle } from "../../../types.ts";

export interface BaseModel {
  group: THREE.Group;
  update(eagle: SceneEagle, b: RenderBounds, timeMs: number): void;
  dispose(): void;
}

export function createBase(): BaseModel {
  const group = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({ color: COLORS.eagle, emissive: 0x4a3200, roughness: 0.35, metalness: 0.7 });
  const pedestalMat = new THREE.MeshStandardMaterial({ color: 0x6a7280, roughness: 0.8 });
  const wreckMat = new THREE.MeshStandardMaterial({ color: COLORS.eagleWreck, roughness: 0.95 });
  const cageMat = new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.4, metalness: 0.7 });

  const pedestal = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 2), pedestalMat);
  pedestal.position.y = 0.2;
  group.add(pedestal);

  const eagle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), goldMat);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), goldMat);
  head.position.y = 1.62;
  eagle.add(body, head);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.7, 0.95), goldMat);
    wing.position.set(s * 0.42, 1.12, 0);
    wing.rotation.z = s * 0.5;
    eagle.add(wing);
    const talon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), goldMat);
    talon.position.set(s * 0.16, 0.62, 0.1);
    eagle.add(talon);
  }
  group.add(eagle);

  const wreck = new THREE.Group();
  wreck.visible = false;
  const chunks = [
    [0, 0.3, 0, 1.2, 0.5, 1.2],
    [-0.4, 0.7, 0.2, 0.5, 0.5, 0.5],
    [0.45, 0.55, -0.25, 0.5, 0.4, 0.6],
  ];
  for (const [x, y, z, sx, sy, sz] of chunks) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wreckMat);
    m.position.set(x, y, z);
    m.rotation.y = x * 2;
    wreck.add(m);
  }
  group.add(wreck);

  const cage = new THREE.Group();
  cage.visible = false;
  for (const [x, z] of [
    [-0.95, -0.95],
    [0.95, -0.95],
    [-0.95, 0.95],
    [0.95, 0.95],
  ]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.12), cageMat);
    bar.position.set(x, 1.1, z);
    cage.add(bar);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.12, 2.1), cageMat);
  roof.position.y = 2.2;
  cage.add(roof);
  group.add(cage);

  return {
    group,
    update(e: SceneEagle, b: RenderBounds, timeMs: number) {
      group.position.set(e.col - b.col0 + 1, 0, e.row - b.row0 + 1);
      eagle.visible = !e.destroyed;
      wreck.visible = e.destroyed;
      cage.visible = e.fortified && !e.destroyed;
      if (cage.visible) cage.rotation.y = Math.sin(timeMs * 0.001) * 0.05;
      if (!e.destroyed) head.rotation.y = Math.sin(timeMs * 0.002) * 0.2;
    },
    dispose() {
      group.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose?.();
      });
    },
  };
}

export default createBase;
