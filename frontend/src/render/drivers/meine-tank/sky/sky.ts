// sky.ts — day/night cycle, sky dome, textured sun/moon, stars and clouds.
// Visual only; all colors are keyframed like Minecraft's overworld.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/sky/sky.ts
import * as THREE from "three";
import type { MtTime } from "../options.ts";

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

export interface MtSky {
  group: THREE.Group;
  update(mode: MtTime, dtMs: number, timeMs: number): DayState;
  setFlatClouds(on: boolean): void;
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
  {
    frac: 0.0,
    top: 0x070c1c,
    horizon: 0x18233f,
    sun: 0xcdd8ff,
    sunI: 0.45,
    amb: 0x26304d,
    ambI: 0.4,
    fog: 0x0c1428,
    star: 1,
  },
  {
    frac: 0.25,
    top: 0x2b3a67,
    horizon: 0xff9d5c,
    sun: 0xffb066,
    sunI: 1.1,
    amb: 0xb98a8a,
    ambI: 0.6,
    fog: 0xe0a070,
    star: 0.15,
  },
  {
    frac: 0.5,
    top: 0x4a90d9,
    horizon: 0xbcd8f2,
    sun: 0xfff6e0,
    sunI: 1.7,
    amb: 0xa9c8ee,
    ambI: 0.9,
    fog: 0xcfe3f5,
    star: 0,
  },
  {
    frac: 0.75,
    top: 0x2b3a67,
    horizon: 0xff9d5c,
    sun: 0xffb066,
    sunI: 1.1,
    amb: 0xb98a8a,
    ambI: 0.6,
    fog: 0xe0a070,
    star: 0.15,
  },
  {
    frac: 1.0,
    top: 0x070c1c,
    horizon: 0x18233f,
    sun: 0xcdd8ff,
    sunI: 0.45,
    amb: 0x26304d,
    ambI: 0.4,
    fog: 0x0c1428,
    star: 1,
  },
];

const FIXED_FRAC: Record<Exclude<MtTime, "cycle">, number> = { noon: 0.5, day: 0.5, sunset: 0.78, night: 0.05 };
const CYCLE_SECONDS = 120;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255,
    ag = (a >> 8) & 255,
    ab = a & 255;
  const br = (b >> 16) & 255,
    bg = (b >> 8) & 255,
    bb = b & 255;
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

export function dayStateForFraction(frac: number): DayState {
  return sample(frac);
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");
  if (ctx) {
    ctx.clearRect(0, 0, 128, 128);
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * 128;
      const y = Math.random() * 128;
      const r = 8 + Math.random() * 18;
      ctx.fillStyle = `rgba(255,255,255,${0.35 + Math.random() * 0.3})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createSky(env: { sun?: THREE.Texture; moon?: THREE.Texture } = {}): MtSky {
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

  const sunMat = new THREE.MeshBasicMaterial({
    color: 0xfff6e0,
    map: env.sun ?? null,
    transparent: true,
    depthWrite: false,
  });
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), sunMat);
  group.add(sun);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xcdd8ff,
    map: env.moon ?? null,
    transparent: true,
    depthWrite: false,
  });
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), moonMat);
  group.add(moon);

  const starCount = 350;
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(450);
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = Math.abs(v.y);
    pos[i * 3 + 2] = v.z;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2.4,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  group.add(stars);

  const cloudTex = cloudTexture();
  cloudTex.repeat.set(2, 2);
  const flatCloudMat = new THREE.MeshLambertMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
  });
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), flatCloudMat);
  clouds.rotation.x = -Math.PI / 2;
  clouds.position.y = 52;
  group.add(clouds);

  let t = 0;
  let flatOn = false;

  return {
    group,
    setFlatClouds(on) {
      flatOn = on;
      clouds.visible = on;
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
      sun.lookAt(0, 0, 0);
      moon.lookAt(0, 0, 0);
      sun.visible = day.sunDir.y > 0.02;
      moon.visible = day.moonDir.y > 0.02;
      sunMat.color.setHex(day.sunColor);
      moonMat.color.setHex(day.sunColor);

      starMat.opacity = day.starOpacity;
      clouds.visible = flatOn;
      cloudTex.offset.x = (timeMs * 0.000004) % 1;

      return day;
    },
    dispose() {
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose?.());
      cloudTex.dispose();
      starGeo.dispose();
      starMat.dispose();
      sunMat.dispose();
      moonMat.dispose();
      domeMat.dispose();
      flatCloudMat.dispose();
    },
  };
}

export default createSky;
