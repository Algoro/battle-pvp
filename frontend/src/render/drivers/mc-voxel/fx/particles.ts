// particles.ts — пул частиц (Points) для разрушения блоков, взрывов, искр и пыли.
// Additive-блендинг: затухание в чёрный = исчезновение.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/fx/particles.ts
import * as THREE from "three";

export interface VoxelParticles {
  points: THREE.Points;
  burst(x: number, y: number, z: number, color: number, count: number): void;
  update(dtMs: number): void;
  activeCount(): number;
  dispose(): void;
}

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  r: number; g: number; b: number;
}

export function createParticles(max = 1600): VoxelParticles {
  const pos = new Float32Array(max * 3);
  const col = new Float32Array(max * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.18,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;

  const pool: P[] = [];
  let cursor = 0;
  for (let i = 0; i < max; i++) pool.push({ x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, r: 0, g: 0, b: 0 });

  function spawn(): P {
    const p = pool[cursor];
    cursor = (cursor + 1) % max;
    return p;
  }

  function burst(x: number, y: number, z: number, color: number, count: number): void {
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    for (let i = 0; i < count; i++) {
      const p = spawn();
      p.x = x + (Math.random() - 0.5) * 0.5;
      p.y = y + Math.random() * 0.3;
      p.z = z + (Math.random() - 0.5) * 0.5;
      p.vx = (Math.random() - 0.5) * 0.05;
      p.vy = 0.02 + Math.random() * 0.05;
      p.vz = (Math.random() - 0.5) * 0.05;
      p.max = 600 + Math.random() * 500;
      p.life = p.max;
      p.r = r; p.g = g; p.b = b;
    }
  }

  function update(dtMs: number): void {
    for (let i = 0; i < max; i++) {
      const p = pool[i];
      const o = i * 3;
      if (p.life <= 0) {
        pos[o] = 0; pos[o + 1] = -100; pos[o + 2] = 0;
        col[o] = 0; col[o + 1] = 0; col[o + 2] = 0;
        continue;
      }
      p.life -= dtMs;
      p.vy -= 0.00022 * dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.z += p.vz * dtMs;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = Math.max(0, p.life / p.max);
      const e = k * k;
      pos[o] = p.x; pos[o + 1] = p.y; pos[o + 2] = p.z;
      col[o] = p.r * e; col[o + 1] = p.g * e; col[o + 2] = p.b * e;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  return {
    points,
    burst,
    update,
    activeCount() {
      let n = 0;
      for (const p of pool) if (p.life > 0) n++;
      return n;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}

export default createParticles;
