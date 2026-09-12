// particles.ts — расширение к three-драйверу: атмосферные частицы и искры взрывов.
// Требует capability "three"; сцену берёт из host.shared.three (предоставляет драйвер).
//
// Относительный путь: ./frontend/src/render/extensions/particles.ts
import * as THREE from "three";
import type { RenderExtension, RenderHost, SceneState } from "../types.ts";

const COUNT = 240;

export function createParticlesExtension(): RenderExtension {
  let scene: THREE.Scene | null = null;
  let points: THREE.Points | null = null;
  let geometry: THREE.BufferGeometry | null = null;
  let material: THREE.PointsMaterial | null = null;
  let pos: Float32Array | null = null;
  let vel: Float32Array | null = null;
  let cursor = 0;

  function resetParticle(i: number, b: { cols: number; rows: number }): void {
    if (!pos || !vel) return;
    pos[i * 3] = Math.random() * b.cols;
    pos[i * 3 + 1] = 0.4 + Math.random() * 3.5;
    pos[i * 3 + 2] = Math.random() * b.rows;
    vel[i * 3] = (Math.random() - 0.5) * 0.01;
    vel[i * 3 + 1] = Math.random() * 0.006;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.01;
  }

  return {
    id: "particles",
    mount(nextHost: RenderHost) {
      const ctx = nextHost.shared.three as { scene?: THREE.Scene } | undefined;
      if (!ctx?.scene) throw new Error("particles: three-контекст недоступен");
      scene = ctx.scene;

      pos = new Float32Array(COUNT * 3);
      vel = new Float32Array(COUNT * 3);
      const b = nextHost.scene.bounds;
      for (let i = 0; i < COUNT; i++) resetParticle(i, b);

      geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      material = new THREE.PointsMaterial({
        color: 0xffb347,
        size: 0.16,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      points = new THREE.Points(geometry, material);
      scene.add(points);
    },
    afterRender(s: SceneState, dtMs: number) {
      if (!geometry || !pos || !vel) return;
      const b = s.bounds;
      const dt = Math.min(50, dtMs);
      for (let i = 0; i < COUNT; i++) {
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        vel[i * 3 + 1] -= 0.00025 * dt;
        if (pos[i * 3 + 1] < 0.1) resetParticle(i, b);
      }
      // Искры от взрывающихся танков.
      for (const t of s.tanks) {
        if (t.state !== "exploding") continue;
        const cx = (t.x >> 3) - b.col0 + 1;
        const cz = (t.y >> 3) - b.row0 + 1;
        for (let k = 0; k < 10; k++) {
          const i = cursor++ % COUNT;
          pos[i * 3] = cx + (Math.random() - 0.5) * 0.8;
          pos[i * 3 + 1] = 0.4 + Math.random() * 0.6;
          pos[i * 3 + 2] = cz + (Math.random() - 0.5) * 0.8;
          vel[i * 3] = (Math.random() - 0.5) * 0.05;
          vel[i * 3 + 1] = 0.03 + Math.random() * 0.05;
          vel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
        }
      }
      (geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    },
    dispose() {
      if (points && scene) scene.remove(points);
      geometry?.dispose();
      material?.dispose();
      points = null;
      geometry = null;
      material = null;
      pos = null;
      vel = null;
      scene = null;
    },
  };
}

export default createParticlesExtension;
