// tank.ts — процедурная 3D-модель танка (низкополигональная, без ассетов).
// Ориентация модели: вперёд = +X. Цвет/броня/звёзды/каска/стан/гусеницы — из SceneTank.
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/models/tank.ts
import * as THREE from "three";
import { COLORS, treadTexture } from "../textures.ts";
import { DIR_ROT } from "../../../coords.ts";
import type { SceneTank } from "../../../types.ts";

export interface TankModel {
  group: THREE.Group;
  update(t: SceneTank, dtMs: number, timeMs: number): void;
  dispose(): void;
}

export function createTank(): TankModel {
  const group = new THREE.Group();

  const hullMat = new THREE.MeshStandardMaterial({ color: COLORS.attTank, roughness: 0.6, metalness: 0.25 });
  const trackMat = new THREE.MeshStandardMaterial({ color: COLORS.track, roughness: 0.95, map: treadTexture() });
  const turretMat = new THREE.MeshStandardMaterial({ color: COLORS.attTank, roughness: 0.5, metalness: 0.35 });
  const barrelMat = new THREE.MeshStandardMaterial({ color: COLORS.barrel, roughness: 0.4, metalness: 0.7 });
  const starMat = new THREE.MeshStandardMaterial({ color: 0xffe27a, emissive: 0x6a5200, roughness: 0.4 });
  const spawnMat = new THREE.MeshStandardMaterial({ color: 0x7fd4ff, emissive: 0x1b6fa8, transparent: true, opacity: 0.85 });
  const helmetMat = new THREE.MeshStandardMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.32, metalness: 0.1, roughness: 0.1 });

  // Габариты модели ≈ спрайт танка 13×13 px (13/8 = 1.625 юнита), чтобы модель не
  // выходила за хитбокс и не «наезжала» на препятствия.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.5, 1.4), hullMat);
  hull.position.y = 0.48;
  group.add(hull);

  for (const z of [-0.6, 0.6]) {
    const track = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.58, 0.3), trackMat);
    track.position.set(0, 0.4, z);
    group.add(track);
  }

  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.38, 0.72), turretMat);
  turret.position.y = 0.85;
  group.add(turret);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.55, 10), barrelMat);
  barrel.rotation.z = -Math.PI / 2;
  barrel.position.set(0.52, 0.88, 0);
  group.add(barrel);

  const stars: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.14), starMat);
    s.position.set(-0.2 + i * 0.2, 1.06, 0);
    s.visible = false;
    group.add(s);
    stars.push(s);
  }

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.88, 14, 10), helmetMat);
  helmet.position.y = 0.66;
  helmet.visible = false;
  group.add(helmet);

  const stun = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 6, 14), starMat);
  stun.rotation.x = Math.PI / 2;
  stun.position.y = 1.5;
  stun.visible = false;
  group.add(stun);

  const spawn = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.07, 6, 18), spawnMat);
  spawn.rotation.x = Math.PI / 2;
  spawn.position.y = 0.12;
  spawn.visible = false;
  group.add(spawn);

  let treadOffset = 0;

  return {
    group,
    update(t: SceneTank, dtMs: number, timeMs: number) {
      const onField = t.state !== "dead" && t.state !== "exploding";
      group.visible = onField || t.state === "spawning";
      group.rotation.y = DIR_ROT[t.dir & 3];

      const baseColor = t.team === "DEF" ? COLORS.defTank : t.armored ? COLORS.armored : COLORS.attTank;
      hullMat.color.setHex(baseColor);
      turretMat.color.setHex(baseColor);

      hullMeshScale(hull, t);
      stars.forEach((s, i) => (s.visible = t.team === "DEF" && i < t.stars));
      helmet.visible = t.helmet;
      stun.visible = t.stunned;
      spawn.visible = t.state === "spawning";

      if (t.moving) {
        treadOffset -= dtMs * 0.004;
        if (trackMat.map) trackMat.map.offset.y = treadOffset;
      }
      if (t.stunned) stun.rotation.z += dtMs * 0.005;

      if (t.flashing) {
        const p = (Math.sin(timeMs * 0.02) + 1) / 2;
        hullMat.emissive.setRGB(0.45 * p, 0.12 * p, 0);
        turretMat.emissive.copy(hullMat.emissive);
      } else {
        hullMat.emissive.setRGB(0, 0, 0);
        turretMat.emissive.setRGB(0, 0, 0);
      }

      const spawnPulse = t.state === "spawning" ? 0.45 + 0.55 * Math.abs(Math.sin(timeMs * 0.006)) : 1;
      group.scale.setScalar(spawnPulse);
    },
    dispose() {
      group.traverse((o: THREE.Object3D) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat?.dispose?.();
      });
      trackMat.map?.dispose();
    },
  };
}

function hullMeshScale(hull: THREE.Mesh, t: SceneTank): void {
  const sx = t.fast ? 1.15 : 1;
  const sy = t.armored ? 1.25 : 1;
  hull.scale.set(sx, sy, t.armored ? 1.06 : 1);
}

export default createTank;
