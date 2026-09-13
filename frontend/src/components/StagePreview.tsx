// StagePreview.tsx — stage preview assembled from the ROM in memory:
// layout (13x13 blocks) + CHR tiles + palette attributes are taken from the core.
import { useEffect, useRef } from "react";
import { useT } from "../i18n/index.tsx";
import type { EmulatorDriver } from "../engine/emulator";

const FIELD = 13; // blocks
const BLOCK = 16; // pixels
const SIZE = FIELD * BLOCK; // 208
const BG = [10, 14, 20];

// Palettes by block attribute (pixel 0..3 -> RGB). pixel 0 = background.
const PALETTES = [
  [BG, [122, 59, 18], [194, 107, 42], [240, 208, 160]], // brick
  [BG, [16, 48, 160], [48, 96, 224], [160, 192, 255]], // water
  [BG, [10, 80, 16], [16, 128, 32], [64, 208, 96]],    // forest
  [BG, [96, 96, 96], [176, 176, 176], [240, 240, 240]], // steel / ice
];

interface Props {
  emulator: EmulatorDriver | null;
  stage: number;
  /** Ready block codes (169) — map preview without a ROM patch (TD setup). */
  blocks?: Uint8Array;
  size?: number;
}

export default function StagePreview({ emulator, stage, blocks, size = SIZE }: Props) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(SIZE, SIZE);
    const put = (x: number, y: number, c: number[]) => {
      const o = (y * SIZE + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) put(x, y, BG);

    const data = emulator?.getStage?.(stage);
    if (emulator && (blocks || data)) {
      for (let row = 0; row < FIELD; row++) {
        for (let col = 0; col < FIELD; col++) {
          const bi = row * FIELD + col;
          const id = blocks ? blocks[bi] : data.blocks[bi];
          const tiles = blocks ? emulator.getBlockTiles(id) : [data.tiles[bi * 4], data.tiles[bi * 4 + 1], data.tiles[bi * 4 + 2], data.tiles[bi * 4 + 3]];
          const attr = blocks ? emulator.getBlockAttribute(id) : data.attrs[bi];
          const pal = PALETTES[attr & 3];
          for (let k = 0; k < 4; k++) {
            const tile = tiles[k];
            const pix = emulator.getChrTilePixels(tile);
            if (!pix) continue;
            const ox = col * BLOCK + (k & 1) * 8;
            const oy = row * BLOCK + (k >> 1) * 8;
            for (let y = 0; y < 8; y++) {
              for (let x = 0; x < 8; x++) {
                const v = pix[y * 8 + x] & 3;
                if (v === 0) continue;
                put(ox + x, oy + y, pal[v]);
              }
            }
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [emulator, stage, blocks]);

  return (
    <canvas
      ref={canvasRef}
      className="stage-preview"
      style={{ width: size, height: size }}
      title={t("Стадия {stage}", { stage })}
    />
  );
}
