// noise.ts — deterministic value noise / fBm for the `meine-tank` outer world.
// Pure and seeded: the same seed always yields the same terrain.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/noise.ts

function hash2i(x: number, y: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0,1]. */
export function valueNoise(x: number, z: number, seed = 0): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const fx = smooth(x - x0);
  const fz = smooth(z - z0);
  const a = hash2i(x0, z0, seed);
  const b = hash2i(x0 + 1, z0, seed);
  const c = hash2i(x0, z0 + 1, seed);
  const d = hash2i(x0 + 1, z0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

/** Fractal Brownian motion in [0,1]. */
export function fbm(x: number, z: number, seed = 0, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, z * freq, seed + o * 131);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridge noise in [0,1]; near 1 along ridge lines (rivers/valleys when inverted). */
export function ridge(x: number, z: number, seed = 0, octaves = 4): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x * freq, z * freq, seed + o * 977) * 2 - 1;
    sum += amp * (1 - Math.abs(n));
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

export default { valueNoise, fbm, ridge };
