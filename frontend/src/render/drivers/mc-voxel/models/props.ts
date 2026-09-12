// props.ts — воксельные объекты: пули и призы-«итемы».
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/models/props.ts
import * as THREE from "three";
import type { TextureAtlas } from "../atlas.ts";
import { DIR_ROT, spriteCenter } from "../../../coords.ts";
import type { SceneState } from "../../../types.ts";

const PRIZE_TEX: Record<number, string> = {
  0: "glass",
  1: "gold",
  2: "iron",
  3: "star",
  4: "tnt",
  5: "wool",
  6: "steel",
};
const PRIZE_COLORS: Record<number, number> = {
  0: 0x9fe8ff,
  1: 0x7aa2ff,
  2: 0xb07a3a,
  3: 0xffe27a,
  4: 0xff5c5c,
  5: 0x6fe08a,
  6: 0xcfd6dd,
};

export interface VoxelProps {
  group: THREE.Group;
  update(scene: SceneState, timeMs: number): void;
  dispose(): void;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose?.();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
    else if (mat) {
      (mat as THREE.MeshLambertMaterial).map?.dispose?.();
      mat.dispose();
    }
  });
}

export function createVoxelProps(atlas: TextureAtlas): VoxelProps {
  const group = new THREE.Group();

  const bulletMat = new THREE.MeshLambertMaterial({
    map: atlas.tile("gold"),
    color: 0xffd24a,
    emissive: 0xff8a1a,
    emissiveIntensity: 1.2,
  });
  const bullets: THREE.Mesh[] = [];
  const bulletGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(bulletGeo.clone(), bulletMat);
    m.visible = false;
    group.add(m);
    bullets.push(m);
  }

  const prize = new THREE.Group();
  const prizeGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  let prizeId = -1;
  let prizeMat: THREE.MeshLambertMaterial | null = null;
  const prizeCore = new THREE.Mesh(prizeGeo, new THREE.MeshLambertMaterial({ map: atlas.tile("star") }));
  prize.add(prizeCore);
  const prizeGlowMat = new THREE.MeshLambertMaterial({
    map: atlas.tile("star"),
    color: 0xffe27a,
    emissive: 0xffcf4a,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), prizeGlowMat);
  prize.add(glow);
  prize.visible = false;
  group.add(prize);

  function ensurePrizeMaterial(id: number): void {
    if (id === prizeId && prizeMat) return;
    prizeId = id;
    const next = new THREE.MeshLambertMaterial({ map: atlas.tile(PRIZE_TEX[id] ?? "star"), color: PRIZE_COLORS[id] ?? 0xffffff });
    prizeCore.material = next;
    prizeMat?.map?.dispose?.();
    prizeMat?.dispose?.();
    prizeMat = next;
  }

  return {
    group,
    update(scene, timeMs) {
      for (const b of bullets) b.visible = false;
      scene.bullets.forEach((bl, i) => {
        const m = bullets[i];
        if (!m) return;
        const p = spriteCenter(scene.bounds, bl.x, bl.y, 8);
        m.position.set(p.x, 0.62, p.z);
        m.rotation.y = DIR_ROT[bl.dir & 3];
        m.visible = true;
      });

      if (scene.prize) {
        const p = spriteCenter(scene.bounds, scene.prize.x, scene.prize.y, 16);
        ensurePrizeMaterial(scene.prize.id);
        prize.visible = true;
        prize.position.set(p.x, 1.15 + Math.sin(timeMs * 0.004) * 0.16, p.z);
        prize.rotation.y = timeMs * 0.002;
        const pulse = 1 + Math.sin(timeMs * 0.006) * 0.08;
        glow.scale.setScalar(pulse);
      } else {
        prize.visible = false;
      }
    },
    dispose() {
      bulletGeo.dispose();
      disposeTree(group);
    },
  };
}

export default createVoxelProps;
