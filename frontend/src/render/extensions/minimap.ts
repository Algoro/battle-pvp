// minimap.ts — расширение-оверлей: схема поля в углу. Работает поверх любого драйвера,
// которому заявлена capability "overlay-dom". DOM-оверлей, не пишет в состояние игры.
//
// Относительный путь: ./frontend/src/render/extensions/minimap.ts
import { isBrick, isSteel, isWater, isIce, isTree } from "@core/domain.ts";
import type { RenderExtension, RenderHost, SceneState } from "../types.ts";

const SIZE = 148;

export function createMinimapExtension(): RenderExtension {
  let root: HTMLDivElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let nameEl: HTMLDivElement | null = null;
  let host: RenderHost | null = null;

  function draw(s: SceneState): void {
    if (!ctx) return;
    const b = s.bounds;
    const cell = SIZE / b.cols;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = "#0a0d12";
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let r = 0; r < b.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        const v = s.field[(r + b.row0) * 32 + (c + b.col0)];
        if (!v) continue;
        ctx.fillStyle = tileColor(v);
        ctx.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
      }
    }

    // орёл
    const ex = (s.eagle.col - b.col0) * cell;
    const ez = (s.eagle.row - b.row0) * cell;
    ctx.fillStyle = s.eagle.destroyed ? "#5b5b5b" : "#f5c542";
    ctx.fillRect(ex, ez, cell * 2, cell * 2);

    for (const t of s.tanks) {
      if (t.state === "dead") continue;
      ctx.fillStyle = t.team === "DEF" ? "#f2c14e" : "#cfd6dd";
      // RAM (x,y) — центр танка (13×13 px); рисуем 2-клеточный квадрат вокруг центра.
      const x = (t.x / 8 - b.col0 - 1) * cell;
      const z = (t.y / 8 - b.row0 - 1) * cell;
      ctx.fillRect(x, z, cell * 2, cell * 2);
    }
    for (const bl of s.bullets) {
      ctx.fillStyle = "#ffe27a";
      // RAM (x,y) — top-left 8×8 спрайта пули; центр = +0.5 клетки.
      const cx = (bl.x / 8 - b.col0 + 0.5) * cell;
      const cz = (bl.y / 8 - b.row0 + 0.5) * cell;
      ctx.fillRect(cx - cell * 0.35, cz - cell * 0.35, cell * 0.7, cell * 0.7);
    }
    if (nameEl) nameEl.textContent = `3D-карта · кадр ${s.frame}`;
  }

  return {
    id: "minimap",
    mount(nextHost: RenderHost) {
      host = nextHost;
      root = document.createElement("div");
      root.className = "render-minimap";
      canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      canvas.className = "render-minimap__canvas";
      nameEl = document.createElement("div");
      nameEl.className = "render-minimap__label";
      root.appendChild(canvas);
      root.appendChild(nameEl);
      nextHost.container.appendChild(root);
      ctx = canvas.getContext("2d");
    },
    afterRender(scene: SceneState) {
      if (host) draw(scene);
    },
    dispose() {
      root?.remove();
      root = null;
      canvas = null;
      ctx = null;
      nameEl = null;
      host = null;
    },
  };
}

function tileColor(v: number): string {
  if (isBrick(v)) return "#b5651d";
  if (isSteel(v)) return "#aeb8c2";
  if (isWater(v)) return "#1e4fd6";
  if (isIce(v)) return "#cdeeff";
  if (isTree(v)) return "#2f8f46";
  return "#4b5563";
}

export default createMinimapExtension;
