// sprites.ts — mapping of particle texture names to frame ranges in the particle atlas.
// Pure data helper (no three import) so it is unit-testable.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/fx/sprites.ts
export interface SpriteRange {
  start: number;
  count: number;
}

export function particleSpriteRanges(names: string[]): Record<string, SpriteRange> {
  const out: Record<string, SpriteRange> = {};
  names.forEach((name, i) => {
    const m = /^(explosion|big_smoke)_(\d+)$/.exec(name);
    const base = m ? (m[1] === "big_smoke" ? "smoke" : "explosion") : name;
    if (!out[base]) out[base] = { start: i, count: 1 };
    else out[base].count = i - out[base].start + 1;
  });
  return out;
}

export default particleSpriteRanges;
