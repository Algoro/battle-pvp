// TowerPlacementEditor.tsx — редактор расстановки башен (адаптация StagePreview).
// Рисует стадию из ROM (блоки/тайлы/палитры), сетку 13×13, подсветку строимых клеток
// и уже поставленные башни. Клик по клетке отдаёт её наружу (cell = row*13+col).
//
// Стадия (тяжёлый попиксельный разбор) рисуется один раз в offscreen-канвас; каждый
// кадр поверх копируется только дешёвый слой башен (иначе 60 fps перерисовывали всю
// стадию из-за нового массива towers при каждом снимке статуса).
import { useEffect, useRef, useState, type MouseEvent } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import { TD_SIZE, towerById } from "../../../shared/tower-defence.ts";

const FIELD = TD_SIZE; // блоков
const BLOCK = 16; // пикселей на блок
const SIZE = FIELD * BLOCK; // 208
const BG = [10, 14, 20];

const PALETTES = [
  [BG, [122, 59, 18], [194, 107, 42], [240, 208, 160]],
  [BG, [16, 48, 160], [48, 96, 224], [160, 192, 255]],
  [BG, [10, 80, 16], [16, 128, 32], [64, 208, 96]],
  [BG, [96, 96, 96], [176, 176, 176], [240, 240, 240]],
];

export interface EditorTower {
  cell: number;
  type: string;
  level: number;
  hp: number;
  maxHp: number;
}

interface Props {
  emulator: EmulatorDriver | null;
  stage: number;
  buildable: Set<number>;
  towers: EditorTower[];
  onCell: (cell: number) => void;
  onContextCell?: (cell: number) => void;
  size?: number;
}

export default function TowerPlacementEditor({
  emulator,
  stage,
  buildable,
  towers,
  onCell,
  onContextCell,
  size = SIZE,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const [baseReady, setBaseReady] = useState(0);

  // Слой 1: стадия + сетка + строимые клетки. Тяжёлый, пересобирается редко.
  useEffect(() => {
    const base = baseRef.current ?? document.createElement("canvas");
    baseRef.current = base;
    base.width = SIZE;
    base.height = SIZE;
    const ctx = base.getContext("2d");
    if (!ctx) return;

    const img = ctx.createImageData(SIZE, SIZE);
    const put = (x: number, y: number, c: number[]) => {
      const o = (y * SIZE + x) * 4;
      img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
    };
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) put(x, y, BG);

    const data = emulator?.getStage?.(stage);
    if (data && emulator) {
      for (let row = 0; row < FIELD; row++) {
        for (let col = 0; col < FIELD; col++) {
          const bi = row * FIELD + col;
          const pal = PALETTES[data.attrs[bi] & 3];
          for (let k = 0; k < 4; k++) {
            const tile = data.tiles[bi * 4 + k];
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

    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= FIELD; i++) {
      ctx.beginPath(); ctx.moveTo(i * BLOCK, 0); ctx.lineTo(i * BLOCK, SIZE); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i * BLOCK); ctx.lineTo(SIZE, i * BLOCK); ctx.stroke();
    }
    ctx.fillStyle = "rgba(80,200,255,0.14)";
    for (const cell of buildable) {
      const r = (cell / FIELD) | 0;
      const c = cell % FIELD;
      ctx.fillRect(c * BLOCK + 3, r * BLOCK + 3, BLOCK - 6, BLOCK - 6);
    }
    setBaseReady((n) => n + 1);
  }, [emulator, stage, buildable]);

  // Слой 2: копия стадии + башни. Дешёвый, обновляется при изменении состава.
  useEffect(() => {
    const canvas = canvasRef.current;
    const base = baseRef.current;
    if (!canvas || !base) return;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(base, 0, 0);
    for (const tw of towers) {
      const r = (tw.cell / FIELD) | 0;
      const c = tw.cell % FIELD;
      const cx = c * BLOCK + BLOCK / 2;
      const cy = r * BLOCK + BLOCK / 2;
      const info = towerById(tw.type);
      ctx.beginPath();
      ctx.arc(cx, cy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = tw.hp < tw.maxHp ? "#e0a030" : "#4fd1ff";
      ctx.fill();
      ctx.strokeStyle = "#0b1017";
      ctx.stroke();
      ctx.fillStyle = "#0b1017";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((info?.title ?? "?").slice(0, 2), cx, cy + 0.5);
    }
  }, [baseReady, towers]);

  const cellFromEvent = (e: MouseEvent<HTMLCanvasElement>): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * SIZE;
    const y = ((e.clientY - rect.top) / rect.height) * SIZE;
    const c = Math.max(0, Math.min(FIELD - 1, Math.floor(x / BLOCK)));
    const r = Math.max(0, Math.min(FIELD - 1, Math.floor(y / BLOCK)));
    return r * FIELD + c;
  };

  return (
    <canvas
      ref={canvasRef}
      className="td-editor"
      style={{ width: size, height: size }}
      onClick={(e) => onCell(cellFromEvent(e))}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextCell?.(cellFromEvent(e));
      }}
    />
  );
}
