// textures.ts — цвета и процедурные текстуры (canvas). Ассеты ROM не используются,
// поэтому файл безопасен; текстуры создаются в браузере при монтировании драйвера.
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/textures.ts
import * as THREE from "three";

export const COLORS = {
  ground: 0x10141b,
  road: 0x555f6a,
  brick: 0xb5651d,
  brickDamaged: 0x8a4a12,
  steel: 0xaeb8c2,
  water: 0x1e4fd6,
  ice: 0xcdeeff,
  tree: 0x2f8f46,
  trunk: 0x4a3524,
  defTank: 0xf2c14e,
  attTank: 0xcfd6dd,
  armored: 0x8c98a4,
  barrel: 0x2b2f36,
  track: 0x23262b,
  bullet: 0xffe27a,
  prize: 0xffd54a,
  eagle: 0xf5c542,
  eagleWreck: 0x5b5b5b,
  frame: 0x3a4351,
};

function canvas(size: number, draw: (ctx: CanvasRenderingContext2D) => void): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (ctx) draw(ctx);
  return c;
}

/** Полосатая текстура гусениц (тайлится). */
export function treadTexture(): THREE.Texture {
  const c = canvas(64, (ctx) => {
    ctx.fillStyle = "#1b1e22";
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = "#3b4048";
    for (let y = 0; y < 64; y += 16) ctx.fillRect(0, y, 64, 7);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 4);
  return tex;
}

/** Анимируемая текстура воды. */
export function waterTexture(): THREE.Texture {
  const c = canvas(64, (ctx) => {
    ctx.fillStyle = "#1e4fd6";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(160,200,255,0.55)";
    ctx.lineWidth = 2;
    for (let y = 6; y < 64; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= 64; x += 8) ctx.lineTo(x, y + (x % 16 === 0 ? 2 : -2));
      ctx.stroke();
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 4);
  return tex;
}

/** Земляная подложка с лёгкой сеткой. */
export function groundTexture(): THREE.Texture {
  const c = canvas(64, (ctx) => {
    ctx.fillStyle = "#10141b";
    ctx.fillRect(0, 0, 64, 64);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 63, 63);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  return tex;
}

export default { COLORS, treadTexture, waterTexture, groundTexture };
