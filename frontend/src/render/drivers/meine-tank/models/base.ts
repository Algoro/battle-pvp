// base.ts — eagle / HQ in Minecraft style: quartz pedestal, golden statue,
// destroyed and reinforced (iron bars + obsidian) states.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/base.ts
import * as THREE from "three";
import type { RenderBounds, SceneEagle } from "../../../types.ts";
import type { Atlas } from "../textures/atlas.ts";

export interface MtBase {
  group: THREE.Group;
  update(eagle: SceneEagle, bounds: RenderBounds, timeMs: number): void;
  dispose(): void;
}

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

export function createMtBase(atlas: Atlas, shadows: boolean): MtBase {
  const group = new THREE.Group();

  const quartzMat = lam(atlas, "quartz_block_top");
  const chiselMat = lam(atlas, "chiseled_quartz_block");
  const goldMat = lam(atlas, "gold_block", { emissive: 0x2a1c00, emissiveIntensity: 1 });
  const wreckMat = lam(atlas, "deepslate_tiles");
  const barMat = lam(atlas, "iron_bars");
  const obsidianMat = lam(atlas, "obsidian");

  const plinth = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 2), quartzMat);
  plinth.position.y = 0.2;
  plinth.castShadow = shadows;
  plinth.receiveShadow = shadows;
  group.add(plinth);

  const pillars = new THREE.Group();
  for (const [x, z] of [
    [-0.7, -0.7],
    [0.7, -0.7],
    [-0.7, 0.7],
    [0.7, 0.7],
  ]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.7, 0.28), chiselMat);
    p.position.set(x, 0.75, z);
    p.castShadow = shadows;
    pillars.add(p);
  }
  group.add(pillars);

  const eagle = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), goldMat);
  body.position.y = 1.35;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.36, 0.36), goldMat);
  head.position.set(0, 1.97, 0.08);
  const beak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.24), goldMat);
  beak.position.set(0, 1.95, 0.3);
  eagle.add(body, head, beak);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.14), goldMat);
    wing.position.set(s * 0.5, 1.5, 0);
    const talon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.6), goldMat);
    talon.position.set(s * 0.16, 0.97, 0.08);
    eagle.add(wing, talon);
  }
  eagle.traverse((o) => ((o as THREE.Mesh).castShadow = shadows));
  group.add(eagle);

  const wreck = new THREE.Group();
  wreck.visible = false;
  for (const [x, y, z, s] of [
    [0, 0.5, 0, 1.2],
    [-0.4, 0.9, 0.2, 0.5],
    [0.45, 0.75, -0.25, 0.5],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wreckMat);
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
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.3, 0.14), barMat);
    bar.position.set(x, 1.15, z);
    cage.add(bar);
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 2.1), obsidianMat);
  roof.position.y = 2.3;
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
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      for (const m of [quartzMat, chiselMat, goldMat, wreckMat, barMat, obsidianMat]) {
        m.map?.dispose?.();
        m.dispose();
      }
    },
  };
}

export default createMtBase;
