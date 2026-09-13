// particles.ts — GPU sprite particles (Points + atlas shader) for `meine-tank`.
// Each point picks a frame in a particle atlas; motion is simple ballistic physics,
// frames animate over life, alpha fades out and size can grow (smoke).
//
// Relative path: ./frontend/src/render/drivers/meine-tank/fx/particles.ts
import * as THREE from "three";

export interface SpriteRange {
  start: number;
  count: number;
}

export interface ParticleSprites {
  texture: THREE.Texture;
  cols: number;
  rows: number;
  sprites: Record<string, SpriteRange>;
}

export interface BurstOptions {
  x: number;
  y: number;
  z: number;
  sprite: string;
  count: number;
  color?: number;
  size?: number;
  spread?: number;
  upward?: number;
  drift?: number;
  lifeMs?: number;
  alpha?: number;
  /** Grow over life (smoke) instead of shrinking. */
  grow?: boolean;
  /** Apply gravity (default true; smoke sets false). */
  gravity?: boolean;
}

export interface MtParticles {
  points: THREE.Points;
  burst(opts: BurstOptions): void;
  update(dtMs: number): void;
  activeCount(): number;
  dispose(): void;
}

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
  frameStart: number;
  frameCount: number;
  size: number;
  maxAlpha: number;
  grow: boolean;
  gravity: boolean;
}

export function createParticles(sprites: ParticleSprites, max = 2600): MtParticles {
  const positions = new Float32Array(max * 3);
  const colors = new Float32Array(max * 3);
  const frames = new Float32Array(max);
  const sizes = new Float32Array(max);
  const alphas = new Float32Array(max);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aColor", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("aFrame", new THREE.BufferAttribute(frames, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uAtlas: { value: sprites.texture },
      uCols: { value: sprites.cols },
      uRows: { value: sprites.rows },
    },
    vertexShader: `
      attribute vec3 aColor;
      attribute float aFrame;
      attribute float aSize;
      attribute float aAlpha;
      varying vec3 vColor;
      varying float vFrame;
      varying float vAlpha;
      void main() {
        vColor = aColor;
        vFrame = aFrame;
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (260.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform float uCols;
      uniform float uRows;
      varying vec3 vColor;
      varying float vFrame;
      varying float vAlpha;
      void main() {
        float c = mod(vFrame, uCols);
        float r = floor(vFrame / uCols);
        vec2 uv = vec2((c + gl_PointCoord.x) / uCols, 1.0 - (r + gl_PointCoord.y) / uRows);
        vec4 tex = texture2D(uAtlas, uv);
        if (tex.a < 0.05 || vAlpha < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * vColor, tex.a * vAlpha);
      }`,
  });

  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;

  const pool: P[] = [];
  let cursor = 0;
  for (let i = 0; i < max; i++) {
    pool.push({
      x: 0,
      y: -100,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      max: 1,
      r: 1,
      g: 1,
      b: 1,
      frameStart: 0,
      frameCount: 1,
      size: 1,
      maxAlpha: 1,
      grow: false,
      gravity: true,
    });
  }

  function range(sprite: string): SpriteRange {
    return sprites.sprites[sprite] ?? sprites.sprites.flame ?? { start: 0, count: 1 };
  }

  function burst(o: BurstOptions): void {
    const color = o.color ?? 0xffffff;
    const r = ((color >> 16) & 255) / 255;
    const g = ((color >> 8) & 255) / 255;
    const b = (color & 255) / 255;
    const spread = o.spread ?? 0.5;
    const upward = o.upward ?? 0.04;
    const drift = o.drift ?? 0.05;
    const life = o.lifeMs ?? 600;
    const rr = range(o.sprite);
    for (let i = 0; i < o.count; i++) {
      const p = pool[cursor];
      cursor = (cursor + 1) % max;
      p.x = o.x + (Math.random() - 0.5) * spread;
      p.y = o.y + Math.random() * spread * 0.6;
      p.z = o.z + (Math.random() - 0.5) * spread;
      p.vx = (Math.random() - 0.5) * drift;
      p.vy = upward * (0.6 + Math.random() * 0.9);
      p.vz = (Math.random() - 0.5) * drift;
      p.max = life * (0.7 + Math.random() * 0.6);
      p.life = p.max;
      p.r = r;
      p.g = g;
      p.b = b;
      p.frameStart = rr.start;
      p.frameCount = rr.count;
      p.size = o.size ?? 1;
      p.maxAlpha = o.alpha ?? 1;
      p.grow = o.grow ?? false;
      p.gravity = o.gravity ?? true;
    }
  }

  function update(dtMs: number): void {
    for (let i = 0; i < max; i++) {
      const p = pool[i];
      const o = i * 3;
      if (p.life <= 0) {
        positions[o] = 0;
        positions[o + 1] = -100;
        positions[o + 2] = 0;
        sizes[i] = 0;
        alphas[i] = 0;
        continue;
      }
      p.life -= dtMs;
      if (p.gravity) p.vy -= 0.00022 * dtMs;
      p.x += p.vx * dtMs;
      p.y += p.vy * dtMs;
      p.z += p.vz * dtMs;
      if (p.y < 0.02) {
        p.y = 0.02;
        p.vy = 0;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      const k = Math.max(0, p.life / p.max); // 1 → 0 over life
      const fade = k < 0.35 ? k / 0.35 : 1;
      positions[o] = p.x;
      positions[o + 1] = p.y;
      positions[o + 2] = p.z;
      colors[o] = p.r;
      colors[o + 1] = p.g;
      colors[o + 2] = p.b;
      if (p.frameCount > 1) {
        const t = Math.min(p.frameCount - 1, Math.floor((1 - k) * p.frameCount));
        frames[i] = p.frameStart + t;
      } else {
        frames[i] = p.frameStart;
      }
      sizes[i] = p.grow ? p.size * (0.7 + 0.9 * (1 - k)) : p.size * (0.6 + 0.4 * k);
      alphas[i] = p.maxAlpha * fade;
    }
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aFrame as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
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
      material.dispose();
    },
  };
}

export default createParticles;
