// base.ts — орёл (штаб) в воксельном стиле: постамент, золотая фигура, состояния
// разрушен/укреплён.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/models/base.ts
import * as THREE from "three";
import type { TextureAtlas } from "../atlas.ts";
import type { RenderBounds, SceneEagle } from "../../../types.ts";

export interface VoxelBase {
  group: THREE.Group;
  update(eagle: SceneEagle, bounds: RenderBounds, timeMs: number): void;
  dispose(): void;
}

export function createVoxelBase(atlas: TextureAtlas, shadows: boolean): VoxelBase {
  const group = new THREE.Group();

  const stoneMat = new THREE.MeshLambertMaterial({ map: atlas.tile("quartz"), color: 0xffffff });
  const goldMat = new THREE.MeshLambertMaterial({ map: atlas.tile("gold"), color: 0xffffff, emissive: 0x2a1c00, emissiveIntensity: 1 });
  const wreckMat = new THREE.MeshLambertMaterial({ map: atlas.tile("obsidian"), color: 0xffffff });
  const barMat = new THREE.MeshLambertMaterial({ map: atlas.tile("iron"), color: 0x9aa1ab });

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 2), stoneMat);
  plinth.position.y = 0.2;
  plinth.castShadow = shadows;
  plinth.receiveShadow = shadows;
  group.add(plinth);

  const eagle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), goldMat);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), goldMat);
  head.position.set(0, 1.62, 0.08);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.24), goldMat);
  beak.position.set(0, 1.6, 0.3);
  eagle.add(body, head, beak);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.14), goldMat);
    wing.position.set(s * 0.5, 1.15, 0);
    eagle.add(wing);
    const talon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), goldMat);
    talon.position.set(s * 0.16, 0.62, 0.08);
    eagle.add(talon);
  }
  group.add(eagle);

  const wreck = new THREE.Group();
  wreck.visible = false;
  for (const [x, y, z, s] of [
    [0, 0.3, 0, 1.2],
    [-0.4, 0.7, 0.2, 0.5],
    [0.45, 0.55, -0.25, 0.5],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wreckMat);
    m.position.set(x, y, z);
    m.rotation.y = x * 2;
    wreck.add(m);
  }
  group.add(wreck);

  const cage = new THREE.Group();
  cage.visible = false;
  for (const [x, z] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.2, 0.14), barMat);
    bar.position.set(x, 1.1, z);
    cage.add(bar);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 2.1), barMat);
  roof.position.y = 2.2;
  cage.add(roof);
  group.add(cage);

  return {
    group,
    update(e, b, timeMs) {
      group.position.set(e.col - b.col0 + 1, 0, e.row - b.row0 + 1);
      eagle.visible = !e.destroyed;
      wreck.visible = e.destroyed;
      cage.visible = e.fortified && !e.destroyed;
      if (!e.destroyed) head.rotation.y = Math.sin(timeMs * 0.0015) * 0.25;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else if (mat) {
          (mat as THREE.MeshLambertMaterial).map?.dispose?.();
          mat.dispose();
        }
      });
    },
  };
}

export default createVoxelBase;
