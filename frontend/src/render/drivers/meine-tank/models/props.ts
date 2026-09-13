// props.ts — bullets and bonus "items" for `meine-tank`. Prizes are Minecraft-style
// flat item sprites (billboards) that spin and bob.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/props.ts
import * as THREE from "three";
import { DIR_ROT, spriteCenter } from "../../../coords.ts";
import type { SceneState } from "../../../types.ts";
import type { Atlas } from "../textures/atlas.ts";

interface PrizeSkin {
  /** Item-atlas tile name; `frames` swaps clock_00..07 over time. */
  tex: string;
  animated?: "clock";
}

const PRIZE: Record<number, PrizeSkin> = {
  0: { tex: "iron_helmet" },
  1: { tex: "clock_00", animated: "clock" },
  2: { tex: "iron_shovel" },
  3: { tex: "nether_star" },
  4: { tex: "fire_charge" },
  5: { tex: "golden_apple" },
  6: { tex: "crossbow_standby" },
};

export interface MtProps {
  group: THREE.Group;
  update(scene: SceneState, timeMs: number): void;
  dispose(): void;
}

export function createMtProps(blockAtlas: Atlas, itemAtlas: Atlas, shadows: boolean): MtProps {
  const group = new THREE.Group();

  const bulletMat = new THREE.MeshStandardMaterial({
    map: blockAtlas.tile("magma"),
    normalMap: blockAtlas.tileNormal("magma"),
    normalScale: new THREE.Vector2(0.6, 0.6),
    color: 0xffb347,
    emissive: 0xff7a1a,
    emissiveIntensity: 1.1,
    roughness: 0.7,
  });
  const bulletGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const bullets: THREE.Mesh[] = [];
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(bulletGeo.clone(), bulletMat);
    m.visible = false;
    group.add(m);
    bullets.push(m);
  }

  const prizeMat = new THREE.MeshStandardMaterial({
    map: itemAtlas.tile("nether_star"),
    transparent: true,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    emissive: 0x222222,
    emissiveIntensity: 0.6,
    roughness: 0.6,
  });
  const prize = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), prizeMat);
  prize.visible = false;
  prize.castShadow = shadows;
  group.add(prize);

  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xfff2b0,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), glowMat);
  prize.add(glow);
  glow.position.z = -0.01;

  let prizeId = -1;

  function applyPrizeSkin(id: number, timeMs: number): void {
    const skin = PRIZE[id] ?? PRIZE[3];
    if (skin.animated === "clock") {
      const frame = Math.floor(timeMs / 125) % 8;
      prizeMat.map = itemAtlas.tile(`clock_0${frame}`);
    } else if (id !== prizeId) {
      prizeMat.map = itemAtlas.tile(skin.tex);
    }
    prizeId = id;
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
        applyPrizeSkin(scene.prize.id, timeMs);
        prize.visible = true;
        prize.position.set(p.x, 0.8 + Math.sin(timeMs * 0.004) * 0.16, p.z);
        prize.rotation.y = timeMs * 0.0022;
        const pulse = 1 + Math.sin(timeMs * 0.006) * 0.08;
        glow.scale.setScalar(pulse);
      } else {
        prize.visible = false;
        prizeId = -1;
      }
    },
    dispose() {
      bulletGeo.dispose();
      prize.geometry.dispose();
      glow.geometry.dispose();
      for (const m of [bulletMat, prizeMat, glowMat]) {
        m.map?.dispose?.();
        m.dispose();
      }
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
    },
  };
}

export default createMtProps;
