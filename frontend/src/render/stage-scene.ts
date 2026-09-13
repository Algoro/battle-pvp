// stage-scene.ts — SceneState for previewing a SPECIFIC stage (13×13 ROM blocks
// → 26×26 collision field). Used by 3D drivers to preview a level.
//
// Stage block mapping to the domain (derived from ROM tbl_DACB/DABB):
//   0..4 — brick (quadrants/full), 5..9 — steel (quadrants/full),
//   a — water, b — trees, c — ice, d — empty.
//
// Relative path: ./frontend/src/render/stage-scene.ts
import { PLAY_BOUNDS } from "./scene-state.ts";
import type { SceneState } from "./types.ts";

const BLOCK_TILE: Record<number, number> = {
  0: 0x0f, 1: 0x0f, 2: 0x0f, 3: 0x0f, 4: 0x0f, // brick
  5: 0x10, 6: 0x10, 7: 0x10, 8: 0x10, 9: 0x10, // steel
  0xa: 0x12, // water
  0xb: 0x22, // trees
  0xc: 0x21, // ice
  0xd: 0x00, // empty
};

function buildField(stage: any): Uint8Array {
  const b = PLAY_BOUNDS;
  const field = new Uint8Array(32 * 32);
  if (stage?.blocks && stage?.tiles) {
    for (let row = 0; row < 13; row++) {
      for (let col = 0; col < 13; col++) {
        const bi = row * 13 + col;
        const tile = BLOCK_TILE[stage.blocks[bi]] ?? 0;
        if (!tile) continue;
        for (let k = 0; k < 4; k++) {
          if (stage.tiles[bi * 4 + k] === 0) continue; // empty quadrant tile
          const fc = b.col0 + col * 2 + (k & 1);
          const fr = b.row0 + row * 2 + (k >> 1);
          field[fr * 32 + fc] = tile;
        }
      }
    }
  }
  // Free up space for the eagle (bottom center) so the model does not intersect the brick.
  const ec = b.col0 + 12;
  const er = b.row0 + 24;
  for (let r = er; r < er + 2; r++) for (let c = ec; c < ec + 2; c++) field[r * 32 + c] = 0;
  return field;
}

const cache = new Map<number, SceneState>();

/** Static level scene without tanks/bonuses — only terrain and HQ. */
export function stageScene(emulator: { getStage?: (s: number) => any } | null | undefined, stage: number): SceneState {
  const s = Math.max(1, Math.floor(stage) || 1);
  const hit = cache.get(s);
  if (hit) return hit;
  const data = emulator?.getStage?.(s) ?? null;
  const b = PLAY_BOUNDS;
  const scene: SceneState = {
    frame: 0,
    field: buildField(data),
    bounds: b,
    tanks: [],
    bullets: [],
    prize: null,
    towers: [],
    eagle: { col: b.col0 + 12, row: b.row0 + 24, fortified: false, destroyed: false },
    effects: { freezeTimer: 0, dotsLeft: null },
    pixels: null,
  };
  cache.set(s, scene);
  return scene;
}

export default stageScene;
