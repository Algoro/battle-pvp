// props.ts — динамические объекты: пули, приз и вспышки взрывов.
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/models/props.ts
import * as THREE from "three";
import { COLORS } from "../textures.ts";
import { DIR_ROT, spriteCenter, tankCenter } from "../../../coords.ts";
import type { SceneState } from "../../../types.ts";

const PRIZE_COLORS: Record<number, number> = {
  0: 0x9fe8ff, // каска
  1: 0x7aa2ff, // часы
  2: 0xb07a3a, // лопата
  3: 0xffd54a, // звезда
  4: 0xff5c5c, // граната
  5: 0x6fe08a, // жизнь
};

export interface Props {
  group: THREE.Group;
  update(scene: SceneState, timeMs: number): void;
  dispose(): void;
}

export function createProps(): Props {
  const group = new THREE.Group();

  const bulletMat = new THREE.MeshStandardMaterial({ color: COLORS.bullet, emissive: 0xffb300, emissiveIntensity: 1.2, roughness: 0.3 });
  const bullets: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), bulletMat);
    m.scale.set(1.7, 0.55, 0.55);
    m.visible = false;
    group.add(m);
    bullets.push(m);
  }

  const prize = new THREE.Group();
  const prizeCore = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.45, 0),
    new THREE.MeshStandardMaterial({ color: COLORS.prize, emissive: 0x6a5200, roughness: 0.3, metalness: 0.6 }),
  );
  const prizeRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.62, 0.06, 6, 20),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333, roughness: 0.4 }),
  );
  prizeRing.rotation.x = Math.PI / 2;
  prize.add(prizeCore, prizeRing);
  prize.visible = false;
  group.add(prize);

  const explosionMat = new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
  const bursts: THREE.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 10), explosionMat.clone());
    m.visible = false;
    group.add(m);
    bursts.push(m);
  }

  return {
    group,
    update(scene: SceneState, timeMs: number) {
      // пули
      for (const b of bullets) b.visible = false;
      scene.bullets.forEach((bl, i) => {
        const m = bullets[i];
        if (!m) return;
        const p = spriteCenter(scene.bounds, bl.x, bl.y, 8);
        m.position.set(p.x, 0.7, p.z);
        m.rotation.y = DIR_ROT[bl.dir & 3];
        m.visible = true;
      });

      // приз
      if (scene.prize) {
        const p = spriteCenter(scene.bounds, scene.prize.x, scene.prize.y, 16);
        prize.visible = true;
        prize.position.set(p.x, 1.1 + Math.sin(timeMs * 0.004) * 0.18, p.z);
        prize.rotation.y = timeMs * 0.002;
        const col = PRIZE_COLORS[scene.prize.id] ?? COLORS.prize;
        (prizeCore.material as THREE.MeshStandardMaterial).color.setHex(col);
        (prizeCore.material as THREE.MeshStandardMaterial).emissive.setHex(col);
        (prizeCore.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25;
      } else {
        prize.visible = false;
      }

      // вспышки взрывов танков
      for (let i = 0; i < bursts.length; i++) {
        const t = scene.tanks[i];
        const b = bursts[i];
        if (!t || t.state !== "exploding") {
          b.visible = false;
          continue;
        }
        const c = tankCenter(scene.bounds, t.x, t.y);
        b.visible = true;
        b.position.set(c.x, 0.8, c.z);
        const k = 0.55 + 0.55 * Math.abs(Math.sin(timeMs * 0.02));
        b.scale.setScalar(k);
        (b.material as THREE.MeshBasicMaterial).opacity = 0.9 - 0.4 * (k - 0.55);
      }
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

export default createProps;
