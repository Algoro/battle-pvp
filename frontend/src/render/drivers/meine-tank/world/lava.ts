// lava.ts — static lava-river tracing for the `meine-tank` outer world.
//
// Fully deterministic and pure: given a height field, volcano cones and a water
// level it returns the lava / obsidian / burned-tree cells. Computed once per world
// rebuild, so it adds zero per-frame cost.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/lava.ts

export interface VolcanoCone {
  x: number;
  z: number;
  r: number;
  peak: number;
}

export interface LavaInput {
  volcanoes: VolcanoCone[];
  heightAt(x: number, z: number): number;
  contains(x: number, z: number): boolean;
  seed: number;
  waterLevel: number;
  branches?: number;
  maxSteps?: number;
  burnRadius?: number;
}

export interface LavaResult {
  lava: Set<number>;
  obsidian: Set<number>;
  burned: Set<number>;
}

export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function cellKey(x: number, z: number): number {
  return (Math.round(x) + 8192) * 65536 + (Math.round(z) + 8192);
}

/**
 * Trace lava rivers downhill from every volcano crater:
 * - follows the steepest descent, widening the channel periodically;
 * - when the next step is water, quenches it (and the neighbouring water) into obsidian
 *   and stops the river;
 * - marks a small radius around lava as burned (trees there are charred).
 */
export function traceLavaRivers(input: LavaInput): LavaResult {
  const { volcanoes, heightAt, contains, seed, waterLevel } = input;
  const branches = input.branches ?? 6;
  const maxSteps = input.maxSteps ?? 600;
  const burnRadius = input.burnRadius ?? 3;
  const lava = new Set<number>();
  const obsidian = new Set<number>();
  const burned = new Set<number>();

  for (const v of volcanoes) {
    for (let b = 0; b < branches; b++) {
      const visited = new Set<number>();
      const ang = (b / branches) * Math.PI * 2 + mulberry(seed + b * 131)() * 0.5;
      let x = Math.round(v.x + Math.cos(ang) * 1.5);
      let z = Math.round(v.z + Math.sin(ang) * 1.5);
      for (let step = 0; step < maxSteps; step++) {
        if (!contains(x + 0.5, z + 0.5)) break;
        const k = cellKey(x, z);
        if (visited.has(k)) break;
        visited.add(k);
        lava.add(k);

        // Lava touching water solidifies: quench neighbouring water into obsidian.
        let touchedWater = false;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue;
            const nx = x + dx;
            const nz = z + dz;
            if (heightAt(nx + 0.5, nz + 0.5) < waterLevel) {
              obsidian.add(cellKey(nx, nz));
              touchedWater = true;
            }
          }
        }
        if (touchedWater) break;

        let bh = heightAt(x + 0.5, z + 0.5);
        let bx = x;
        let bz = z;
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (!dx && !dz) continue;
            const nx = x + dx;
            const nz = z + dz;
            if (!contains(nx + 0.5, nz + 0.5)) continue;
            if (visited.has(cellKey(nx, nz))) continue;
            const nh = heightAt(nx + 0.5, nz + 0.5);
            if (nh < bh) {
              bh = nh;
              bx = nx;
              bz = nz;
            }
          }
        }
        if (bx === x && bz === z) break; // local minimum → lava pool
        if (step % 2 === 0) {
          // Widen the channel perpendicular to the flow.
          const px = bx - (bz - z);
          const pz = bz + (bx - x);
          if (contains(px + 0.5, pz + 0.5)) lava.add(cellKey(px, pz));
        }
        if (bh < waterLevel) {
          obsidian.add(cellKey(bx, bz));
          for (let dx = -1; dx <= 1; dx++) {
            for (let dz = -1; dz <= 1; dz++) {
              if (heightAt(bx + dx + 0.5, bz + dz + 0.5) < waterLevel) obsidian.add(cellKey(bx + dx, bz + dz));
            }
          }
          lava.delete(cellKey(bx, bz));
          break;
        }
        x = bx;
        z = bz;
      }
    }
  }

  for (const k of lava) {
    const x = Math.floor(k / 65536) - 8192;
    const z = (k % 65536) - 8192;
    for (let dx = -burnRadius; dx <= burnRadius; dx++) {
      for (let dz = -burnRadius; dz <= burnRadius; dz++) burned.add(cellKey(x + dx, z + dz));
    }
  }

  return { lava, obsidian, burned };
}

export default traceLavaRivers;
