// pixel-2d.ts — драйвер рендера по умолчанию: оригинальный кадр PPU (256×240) на 2D-canvas.
// Переносит прежнюю отрисовку EmulatorDriver в слой рендера без изменения результата.
//
// Относительный путь: ./frontend/src/render/drivers/pixel-2d.ts
import type { RenderDriver, RenderHost, SceneState } from "../types.ts";

const W = 256;
const H = 240;

export function createPixelDriver(): RenderDriver {
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let image: ImageData | null = null;
  let img32: Uint32Array | null = null;
  let scene: SceneState | null = null;

  return {
    id: "pixel-2d",
    mount(host: RenderHost) {
      canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      canvas.className = "pixelated";
      host.container.appendChild(canvas);
      ctx = canvas.getContext("2d");
      if (ctx) {
        image = ctx.createImageData(W, H);
        img32 = new Uint32Array(image.data.buffer);
      }
    },
    setScene(next: SceneState) {
      scene = next;
    },
    resize() {
      /* размер задаётся CSS-контейнером */
    },
    render() {
      if (!ctx || !image || !img32 || !scene?.pixels) return;
      const buf = scene.pixels;
      const n = Math.min(img32.length, buf.length);
      for (let i = 0; i < n; i++) img32[i] = 0xff000000 | buf[i];
      ctx.putImageData(image, 0, 0);
    },
    dispose() {
      canvas?.remove();
      canvas = null;
      ctx = null;
      image = null;
      img32 = null;
      scene = null;
    },
  };
}

export default createPixelDriver;
