// particles.ts — GPU sprite particles for `meine-tank`, rendered as camera-facing
// instanced billboards (InstancedMesh + atlas shader). Unlike THREE.Points, billboard
// quads carry depth and normals, so the ray-tracing pipeline sees them: smoke reflects
// in water, receives ambient occlusion and casts (alpha-shaped) shadows.
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
  object: THREE.InstancedMesh;
  burst(opts: BurstOptions): void;
  update(dtMs: number): void;
  /** World-space camera position + sun for volumetric-ish scattering in the sprites. */
  setLighting(cameraPos: THREE.Vector3, sunDir: THREE.Vector3, sunColor: THREE.Color): void;
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

/** Billboard world size per unit of `size`: matches the old Points scale at 720p/70°. */
const SIZE_SCALE = 0.5;

export function createParticles(sprites: ParticleSprites, max = 2600): MtParticles {
  const geometry = new THREE.InstancedBufferGeometry();
  const plane = new THREE.PlaneGeometry(1, 1);
  geometry.index = plane.index;
  geometry.setAttribute("position", plane.attributes.position);
  geometry.setAttribute("uv", plane.attributes.uv);

  const colors = new Float32Array(max * 3);
  const frames = new Float32Array(max);
  const alphas = new Float32Array(max);
  const sizes = new Float32Array(max);
  const iColor = new THREE.InstancedBufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage);
  const iFrame = new THREE.InstancedBufferAttribute(frames, 1).setUsage(THREE.DynamicDrawUsage);
  const iAlpha = new THREE.InstancedBufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  const iSize = new THREE.InstancedBufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("iColor", iColor);
  geometry.setAttribute("iFrame", iFrame);
  geometry.setAttribute("iAlpha", iAlpha);
  geometry.setAttribute("iSize", iSize);
  geometry.instanceCount = max;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uAtlas: { value: null },
        uCols: { value: sprites.cols },
        uRows: { value: sprites.rows },
        uCameraPos: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
      },
    ]),
    vertexShader: `
      #include <common>
      #include <fog_pars_vertex>
      attribute vec3 iColor;
      attribute float iFrame;
      attribute float iAlpha;
      attribute float iSize;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vFrame;
      varying float vAlpha;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vColor = iColor;
        vFrame = iFrame;
        vAlpha = iAlpha;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vWorld = origin.xyz;
        vec4 mv = viewMatrix * origin;
        mv.xy += position.xy * iSize;
        #ifdef USE_FOG
          vFogDepth = -mv.z;
        #endif
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform sampler2D uAtlas;
      uniform float uCols;
      uniform float uRows;
      uniform vec3 uCameraPos;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      varying vec2 vUv;
      varying vec3 vColor;
      varying float vFrame;
      varying float vAlpha;
      varying vec3 vWorld;
      void main() {
        float c = mod(vFrame, uCols);
        float r = floor(vFrame / uCols);
        vec2 uv = vec2((c + vUv.x) / uCols, 1.0 - (r + vUv.y) / uRows);
        vec4 tex = texture2D(uAtlas, uv);
        if (tex.a < 0.05 || vAlpha < 0.01) discard;
        gl_FragColor = vec4(tex.rgb * vColor, tex.a * vAlpha);
        // Forward scattering: puffs glow when the sun is behind them, so light reads as
        // being scattered inside the smoke volume.
        vec3 viewDir = normalize(uCameraPos - vWorld);
        float scatter = pow(max(dot(viewDir, uSunDir), 0.0), 6.0);
        gl_FragColor.rgb += uSunColor * scatter * 0.9 * tex.a * vAlpha;
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor * 0.5);
        #endif
      }`,
  });
  material.uniforms.uAtlas.value = sprites.texture;
  geometry.instanceCount = max;

  const depthMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uAtlas: { value: sprites.texture },
      uCols: { value: sprites.cols },
      uRows: { value: sprites.rows },
    },
    vertexShader: `
      attribute float iFrame;
      attribute float iSize;
      varying vec2 vUv;
      varying float vFrame;
      void main() {
        vUv = uv;
        vFrame = iFrame;
        vec4 origin = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 mv = viewMatrix * origin;
        mv.xy += position.xy * iSize;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uAtlas;
      uniform float uCols;
      uniform float uRows;
      varying vec2 vUv;
      varying float vFrame;
      void main() {
        float c = mod(vFrame, uCols);
        float r = floor(vFrame / uCols);
        vec2 uv = vec2((c + vUv.x) / uCols, 1.0 - (r + vUv.y) / uRows);
        if (texture2D(uAtlas, uv).a < 0.4) discard;
      }`,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, max);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  mesh.customDepthMaterial = depthMaterial;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < max; i++) mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;

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

  const _m = new THREE.Matrix4();

  function update(dtMs: number): void {
    for (let i = 0; i < max; i++) {
      const p = pool[i];
      const o = i * 3;
      if (p.life <= 0) {
        _m.makeScale(0, 0, 0);
        mesh.setMatrixAt(i, _m);
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
      _m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(i, _m);
      colors[o] = p.r;
      colors[o + 1] = p.g;
      colors[o + 2] = p.b;
      if (p.frameCount > 1) {
        const t = Math.min(p.frameCount - 1, Math.floor((1 - k) * p.frameCount));
        frames[i] = p.frameStart + t;
      } else {
        frames[i] = p.frameStart;
      }
      const scale = p.grow ? p.size * (0.7 + 0.9 * (1 - k)) : p.size * (0.6 + 0.4 * k);
      sizes[i] = scale * SIZE_SCALE;
      alphas[i] = p.maxAlpha * fade;
    }
    mesh.instanceMatrix.needsUpdate = true;
    iColor.needsUpdate = true;
    iFrame.needsUpdate = true;
    iSize.needsUpdate = true;
    iAlpha.needsUpdate = true;
  }

  return {
    object: mesh,
    burst,
    update,
    setLighting(cameraPos, sunDir, sunColor) {
      (material.uniforms.uCameraPos.value as THREE.Vector3).copy(cameraPos);
      (material.uniforms.uSunDir.value as THREE.Vector3).copy(sunDir).normalize();
      (material.uniforms.uSunColor.value as THREE.Color).copy(sunColor);
    },
    activeCount() {
      let n = 0;
      for (const p of pool) if (p.life > 0) n++;
      return n;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      depthMaterial.dispose();
      mesh.dispose();
    },
  };
}

export default createParticles;
