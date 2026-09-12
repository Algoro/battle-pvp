// sky.ts — небо и атмосфера: купол-градиент, квадратное солнце/луна, звёзды, плоские
// облака; расчёт палитры дня/ночи (визуально, без влияния на игру).
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/sky/sky.ts
import * as THREE from "three";
import type { McTime } from "../options.ts";

export interface DayState {
  skyTop: number;
  skyHorizon: number;
  sunColor: number;
  sunIntensity: number;
  ambientColor: number;
  ambientIntensity: number;
  fogColor: number;
  starOpacity: number;
  sunDir: THREE.Vector3;
  moonDir: THREE.Vector3;
}

export interface Sky {
  group: THREE.Group;
  update(mode: McTime, dtMs: number, timeMs: number): DayState;
  setClouds(on: boolean): void;
  setCloudDrift(on: boolean): void;
  dispose(): void;
}

interface Key {
  frac: number;
  top: number;
  horizon: number;
  sun: number;
  sunI: number;
  amb: number;
  ambI: number;
  fog: number;
  star: number;
}

const KEYS: Key[] = [
  { frac: 0.0, top: 0x070c1c, horizon: 0x18233f, sun: 0xcdd8ff, sunI: 0.45, amb: 0x26304d, ambI: 0.4, fog: 0x0c1428, star: 1 },
  { frac: 0.25, top: 0x2b3a67, horizon: 0xff9d5c, sun: 0xffb066, sunI: 1.1, amb: 0xb98a8a, ambI: 0.6, fog: 0xe0a070, star: 0.15 },
  { frac: 0.5, top: 0x4a90d9, horizon: 0xbcd8f2, sun: 0xfff6e0, sunI: 1.7, amb: 0xa9c8ee, ambI: 0.9, fog: 0xcfe3f5, star: 0 },
  { frac: 0.75, top: 0x2b3a67, horizon: 0xff9d5c, sun: 0xffb066, sunI: 1.1, amb: 0xb98a8a, ambI: 0.6, fog: 0xe0a070, star: 0.15 },
  { frac: 1.0, top: 0x070c1c, horizon: 0x18233f, sun: 0xcdd8ff, sunI: 0.45, amb: 0x26304d, ambI: 0.4, fog: 0x0c1428, star: 1 },
];

// Фиксированные «времена»: frac 0=полночь, 0.25=восход, 0.5=полдень, 0.75=закат.
const FIXED_FRAC: Record<Exclude<McTime, "cycle">, number> = { noon: 0.5, day: 0.5, sunset: 0.78, night: 0.05 };
const CYCLE_SECONDS = 120;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return (Math.round(lerp(ar, br, t)) << 16) | (Math.round(lerp(ag, bg, t)) << 8) | Math.round(lerp(ab, bb, t));
}

function sample(frac: number): DayState {
  let i = 0;
  while (i < KEYS.length - 2 && frac > KEYS[i + 1].frac) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const t = (frac - a.frac) / (b.frac - a.frac);
  const elev = Math.sin(frac * Math.PI * 2 - Math.PI / 2);
  const sunDir = new THREE.Vector3(0.5, Math.max(0.08, elev), 0.6).normalize();
  return {
    skyTop: lerpColor(a.top, b.top, t),
    skyHorizon: lerpColor(a.horizon, b.horizon, t),
    sunColor: lerpColor(a.sun, b.sun, t),
    sunIntensity: lerp(a.sunI, b.sunI, t),
    ambientColor: lerpColor(a.amb, b.amb, t),
    ambientIntensity: lerp(a.ambI, b.ambI, t),
    fogColor: lerpColor(a.fog, b.fog, t),
    starOpacity: lerp(a.star, b.star, t),
    sunDir,
    moonDir: sunDir.clone().multiplyScalar(-1),
  };
}

/** Палитра неба для доли суток (0=полночь, 0.5=полдень) — для тестов и отладки. */
export function dayStateForFraction(frac: number): DayState {
  return sample(frac);
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 64, 64);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * 64;
      const y = Math.random() * 64;
      const r = 6 + Math.random() * 10;
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function createSky(): Sky {
  const group = new THREE.Group();

  const domeMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x4a90d9) },
      bottomColor: { value: new THREE.Color(0xbcd8f2) },
      offset: { value: 12 },
      exponent: { value: 0.7 },
    },
    vertexShader: `varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position,1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorld;
      void main(){ float h = normalize(vWorld + vec3(0.0, offset, 0.0)).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0), exponent), 0.0)), 1.0); }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(480, 24, 16), domeMat);
  group.add(dome);

  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  const sun = new THREE.Mesh(new THREE.BoxGeometry(14, 14, 14), sunMat);
  sun.position.set(120, 180, 140);
  group.add(sun);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xcdd8ff });
  const moon = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 10), moonMat);
  moon.position.set(-120, -180, -140);
  group.add(moon);

  // звёзды
  const starCount = 300;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(450);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = Math.abs(v.y);
    pos[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);

  // облака
  const cloudTex = cloudTexture();
  cloudTex.repeat.set(3, 3);
  const cloudMat = new THREE.MeshLambertMaterial({ map: cloudTex, transparent: true, opacity: 0.75, depthWrite: false });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), cloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.set(13, 48, 13);
  group.add(clouds);

  let t = 0;
  let cloudsOn = true;
  let drift = true;

  return {
    group,
    setClouds(on: boolean) {
      cloudsOn = on;
      clouds.visible = on;
    },
    setCloudDrift(on: boolean) {
      drift = on;
    },
    update(mode, dtMs, timeMs) {
      t += dtMs;
      const frac = mode === "cycle" ? (t / 1000 / CYCLE_SECONDS) % 1 : FIXED_FRAC[mode];
      const day = sample(frac);

      const domeAt = (dome.material as THREE.ShaderMaterial).uniforms;
      (domeAt.topColor.value as THREE.Color).setHex(day.skyTop);
      (domeAt.bottomColor.value as THREE.Color).setHex(day.skyHorizon);

      sun.position.copy(day.sunDir).multiplyScalar(360);
      moon.position.copy(day.moonDir).multiplyScalar(360);
      sun.visible = day.sunDir.y > 0.02;
      moon.visible = day.moonDir.y > 0.02;
      sunMat.color.setHex(day.sunColor);
      moonMat.color.setHex(day.sunColor);

      starMat.opacity = day.starOpacity;

      clouds.visible = cloudsOn;
      if (drift) cloudTex.offset.x = (timeMs * 0.000004) % 1;

      return day;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
        const mat = m.material as THREE.Material | undefined;
        mat?.dispose?.();
      });
      cloudTex.dispose();
      starGeo.dispose();
      starMat.dispose();
    },
  };
}

export default createSky;
