// tank.ts — Minecraft-style voxel tank for `meine-tank`: tracks, hull, turret, barrel,
// team tint, armor, stars, helmet, stun and bonus blinking.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/tank.ts
import * as THREE from "three";
import { DIR_ROT } from "../../../coords.ts";
import type { SceneTank } from "../../../types.ts";
import type { Atlas } from "../textures/atlas.ts";

export interface MtTank {
  group: THREE.Group;
  update(t: SceneTank, dtMs: number, timeMs: number): void;
  dispose(): void;
}

const TEAM_TEX: Record<"DEF" | "ATT", string> = { DEF: "yellow_concrete", ATT: "light_gray_concrete" };

function lam(atlas: Atlas, name: string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: atlas.tile(name),
    normalMap: atlas.tileNormal(name),
    normalScale: new THREE.Vector2(0.8, 0.8),
    roughness: 0.9,
    metalness: 0,
    ...opts,
  });
}

export function createMtTank(atlas: Atlas, shadows: boolean): MtTank {
  const group = new THREE.Group();

  const hullMat = lam(atlas, TEAM_TEX.DEF);
  // Two cached textures per instance: never clone the atlas per frame.
  const hullTex: Record<"DEF" | "ATT", THREE.Texture> = {
    DEF: hullMat.map as THREE.Texture,
    ATT: atlas.tile(TEAM_TEX.ATT),
  };
  const trackMat = lam(atlas, "deepslate_tiles", { color: 0x6f7277 });
  const armorMat = lam(atlas, "iron_block");
  const turretMat = lam(atlas, "polished_blackstone");
  const barrelMat = lam(atlas, "lightning_rod", { color: 0x9aa1ab });
  const lampMat = lam(atlas, "redstone_lamp", { emissive: 0x7a1c00, emissiveIntensity: 1 });
  const starMat = lam(atlas, "gold_block", { emissive: 0x3a2600, emissiveIntensity: 1 });
  const glassMat = lam(atlas, "glass", { transparent: true, opacity: 0.4, depthWrite: false });

  const model = new THREE.Group();
  group.add(model);

  for (const z of [-0.58, 0.58]) {
    const tr = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.62, 0.34), trackMat);
    tr.position.set(0, 0.41, z);
    tr.castShadow = shadows;
    model.add(tr);
  }

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.6, 1.35), hullMat);
  hull.position.y = 0.5;
  hull.castShadow = shadows;
  model.add(hull);

  const armor = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.68, 1.45), armorMat);
  armor.position.y = 0.5;
  armor.visible = false;
  armor.castShadow = shadows;
  model.add(armor);

  const turret = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.8), turretMat);
  turret.position.y = 1.02;
  turret.castShadow = shadows;
  model.add(turret);

  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.2, 0.2), barrelMat);
  barrel.position.set(0.74, 1.02, 0);
  model.add(barrel);

  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.26), lampMat);
  lamp.position.set(0, 1.32, 0);
  lamp.visible = false;
  model.add(lamp);

  const stars: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), starMat);
    s.position.set(-0.22 + i * 0.22, 1.34, -0.2);
    s.visible = false;
    model.add(s);
    stars.push(s);
  }

  const helmet = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.45), glassMat);
  helmet.position.y = 0.75;
  helmet.visible = false;
  model.add(helmet);

  const stun: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), starMat);
    s.visible = false;
    model.add(s);
    stun.push(s);
  }

  return {
    group,
    update(t, dtMs, timeMs) {
      group.visible = t.state !== "dead" && t.state !== "exploding";
      group.rotation.y = DIR_ROT[t.dir & 3];
      group.position.y = t.moving ? Math.abs(Math.sin(timeMs * 0.012)) * 0.04 : 0;

      hullMat.map = hullTex[t.team];
      hullMat.color.setHex(t.armored ? 0xb9c0c9 : 0xffffff);
      armor.visible = t.armored;
      model.scale.set(t.fast ? 1.15 : 1, 1, t.armored ? 1.08 : 1);

      stars.forEach((s, i) => (s.visible = t.team === "DEF" && i < t.stars));
      helmet.visible = t.helmet;
      lamp.visible = t.flashing;
      if (t.flashing) lampMat.emissiveIntensity = 0.6 + 0.4 * Math.abs(Math.sin(timeMs * 0.01));
      stun.forEach((s, i) => {
        s.visible = t.stunned;
        if (t.stunned) {
          const a = timeMs * 0.004 + (i * Math.PI * 2) / 3;
          s.position.set(Math.cos(a) * 0.5, 1.6 + Math.sin(a * 1.3) * 0.1, Math.sin(a) * 0.5);
        }
      });
      void dtMs;
    },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      hullTex.ATT.dispose();
      for (const m of [hullMat, trackMat, armorMat, turretMat, barrelMat, lampMat, starMat, glassMat]) {
        m.map?.dispose?.();
        m.dispose();
      }
    },
  };
}

export default createMtTank;
