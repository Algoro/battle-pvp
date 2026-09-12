// stage-scene.ts — SceneState для предпросмотра КОНКРЕТНОЙ стадии (13×13 блоков ROM
// → поле коллизий 26×26). Используется драйверами 3D для предпросмотра уровня.
//
// Соответствие блоков стадии домену (выведено из tbl_DACB/DABB ROM):
//   0..4 — кирпич (квадранты/полный), 5..9 — сталь (квадранты/полный),
//   a — вода, b — деревья, c — лёд, d — пусто.
//
// Относительный путь: ./frontend/src/render/stage-scene.ts
import { PLAY_BOUNDS } from "./scene-state.ts";
import type { SceneState } from "./types.ts";

const BLOCK_TILE: Record<number, number> = {
  0: 0x0f, 1: 0x0f, 2: 0x0f, 3: 0x0f, 4: 0x0f, // кирпич
  5: 0x10, 6: 0x10, 7: 0x10, 8: 0x10, 9: 0x10, // сталь
  0xa: 0x12, // вода
  0xb: 0x22, // деревья
  0xc: 0x21, // лёд
  0xd: 0x00, // пусто
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
          if (stage.tiles[bi * 4 + k] === 0) continue; // пустой тайл квадранта
          const fc = b.col0 + col * 2 + (k & 1);
          const fr = b.row0 + row * 2 + (k >> 1);
          field[fr * 32 + fc] = tile;
        }
      }
    }
  }
  // Освободить место под орла (центр низа), чтобы модель не пересекалась с кирпичом.
  const ec = b.col0 + 12;
  const er = b.row0 + 24;
  for (let r = er; r < er + 2; r++) for (let c = ec; c < ec + 2; c++) field[r * 32 + c] = 0;
  return field;
}

const cache = new Map<number, SceneState>();

/** Статичная сцена уровня без танков/призов — только рельеф и штаб. */
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
    eagle: { col: b.col0 + 12, row: b.row0 + 24, fortified: false, destroyed: false },
    effects: { freezeTimer: 0, dotsLeft: null },
    pixels: null,
  };
  cache.set(s, scene);
  return scene;
}

export default stageScene;
