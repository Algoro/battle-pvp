// tank.ts — воксельный танк в стиле sandbox: кубические корпус/башня/гусеницы,
// командный тинт, броня/скорость/звёзды/каска/стан/мигание.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/models/tank.ts
import * as THREE from "three";
import type { TextureAtlas } from "../atlas.ts";
import { DIR_ROT } from "../../../coords.ts";
import type { SceneTank } from "../../../types.ts";

export interface VoxelTank {
  group: THREE.Group;
  update(t: SceneTank, dtMs: number, timeMs: number): void;
  dispose(): void;
}

const TEAM = { DEF: 0xf2c94c, ATT: 0xcfd6dd };

export function createVoxelTank(atlas: TextureAtlas, shadows: boolean): VoxelTank {
  const group = new THREE.Group();

  const woolMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: TEAM.ATT });
  const ironMat = new THREE.MeshLambertMaterial({ map: atlas.tile("iron"), color: 0x9aa1ab });
  const barrelMat = new THREE.MeshLambertMaterial({ map: atlas.tile("iron"), color: 0x6b7078 });
  const goldMat = new THREE.MeshLambertMaterial({ map: atlas.tile("gold"), color: 0xffffff });
  const glassMat = new THREE.MeshLambertMaterial({
    map: atlas.tile("glass"),
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
  });
  const lampMat = new THREE.MeshLambertMaterial({ map: atlas.tile("gold"), color: 0xff5a3c, emissive: 0x883000, emissiveIntensity: 1 });

  for (const z of [-0.58, 0.58]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.6, 0.34), ironMat);
    tr.position.set(0, 0.4, z);
    tr.castShadow = shadows;
    group.add(tr);
  }

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.35), woolMat);
  hull.position.y = 0.5;
  hull.castShadow = shadows;
  group.add(hull);

  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.78), woolMat);
  turret.position.y = 1.02;
  turret.castShadow = shadows;
  group.add(turret);

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.22), barrelMat);
  barrel.position.set(0.72, 1.02, 0);
  group.add(barrel);

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.26), lampMat);
  lamp.position.set(0, 1.32, 0);
  lamp.visible = false;
  group.add(lamp);

  const stars: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), goldMat);
    s.position.set(-0.22 + i * 0.22, 1.32, -0.2);
    s.visible = false;
    group.add(s);
    stars.push(s);
  }

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.35), glassMat);
  helmet.position.y = 0.75;
  helmet.visible = false;
  group.add(helmet);

  const stun: THREE.Mesh[] = [];
  for (let i = 0; i < 2; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), goldMat);
    s.position.set(0, 1.7, 0);
    s.visible = false;
    group.add(s);
    stun.push(s);
  }

  return {
    group,
    update(t, dtMs, timeMs) {
      group.visible = t.state !== "dead" && t.state !== "exploding";
      group.rotation.y = DIR_ROT[t.dir & 3];
      group.position.y = t.moving ? Math.abs(Math.sin(timeMs * 0.012)) * 0.04 : 0;

      const base = t.team === "DEF" ? TEAM.DEF : TEAM.ATT;
      woolMat.color.setHex(t.armored ? 0xb9c0c9 : base);
      ironMat.color.setHex(t.armored ? 0xe0e6ee : 0x9aa1ab);
      hull.scale.set(t.fast ? 1.15 : 1, 1, t.armored ? 1.08 : 1);

      stars.forEach((s, i) => (s.visible = t.team === "DEF" && i < t.stars));
      helmet.visible = t.helmet;
      lamp.visible = t.flashing;
      if (t.flashing) {
        const p = 0.6 + 0.4 * Math.abs(Math.sin(timeMs * 0.01));
        lampMat.emissiveIntensity = p;
      }
      stun.forEach((s, i) => {
        s.visible = t.stunned;
        if (t.stunned) {
          const a = timeMs * 0.004 + i * Math.PI;
          s.position.set(Math.cos(a) * 0.5, 1.6 + Math.sin(a * 1.3) * 0.1, Math.sin(a) * 0.5);
        }
      });

      void dtMs;
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

export default createVoxelTank;
