// atlas.ts — процедурный пиксель-арт атлас блоков (16×16 в сетке, опц. 32×32).
// Никаких внешних/ROM-ассетов: всё рисуется на canvas. Стиль воксельный, «sandbox».
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/atlas.ts
import * as THREE from "three";

export interface TileUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface TextureAtlas {
  texture: THREE.CanvasTexture;
  cols: number;
  rows: number;
  uv: Record<string, TileUV>;
  /** Текстура одного тайла (clone с offset/repeat) — для материалов моделей. */
  tile(name: string): THREE.Texture;
  /** Отдельная тайлящаяся текстура тайла (для земли/пола). */
  standalone(name: string): THREE.Texture;
}

type Draw = (c: CanvasRenderingContext2D, rnd: () => number) => void;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fill(c: CanvasRenderingContext2D, col: string): void {
  c.fillStyle = col;
  c.fillRect(0, 0, 16, 16);
}
function px(c: CanvasRenderingContext2D, x: number, y: number, col: string, w = 1, h = 1): void {
  c.fillStyle = col;
  c.fillRect(x, y, w, h);
}
function noise(c: CanvasRenderingContext2D, rnd: () => number, amount: number, shade = "rgba(0,0,0,0.12)"): void {
  c.fillStyle = shade;
  for (let i = 0; i < amount; i++) c.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1);
}

const DRAW: Record<string, Draw> = {
  brick: (c, rnd) => {
    fill(c, "#9b4f2a");
    c.fillStyle = "#c9a07a";
    for (let y = 0; y < 16; y += 4) c.fillRect(0, y, 16, 1);
    for (let y = 0; y < 16; y += 8) {
      c.fillRect(7, y, 1, 4);
      c.fillRect(15, y + 4, 1, 4);
    }
    noise(c, rnd, 30, "rgba(255,220,180,0.10)");
  },
  brickCracked: (c, rnd) => {
    DRAW.brick(c, rnd);
    c.fillStyle = "rgba(20,10,5,0.55)";
    let x = 3 + Math.floor(rnd() * 4);
    for (let y = 1; y < 15; y++) {
      c.fillRect(x, y, 1, 1);
      x += rnd() > 0.5 ? 1 : -1;
      x = Math.max(1, Math.min(14, x));
    }
  },
  iron: (c, rnd) => {
    fill(c, "#c9ced6");
    c.fillStyle = "#9aa1ab";
    c.fillRect(0, 0, 16, 1);
    c.fillRect(0, 15, 16, 1);
    c.fillRect(0, 0, 1, 16);
    c.fillRect(15, 0, 1, 16);
    c.fillStyle = "#e7ebf0";
    c.fillRect(2, 2, 2, 2);
    c.fillRect(12, 2, 2, 2);
    c.fillRect(2, 12, 2, 2);
    c.fillRect(12, 12, 2, 2);
    noise(c, rnd, 18, "rgba(0,0,0,0.10)");
  },
  steel: (c, rnd) => {
    fill(c, "#b7bec7");
    c.fillStyle = "#8f969f";
    for (let x = 1; x < 16; x += 4) c.fillRect(x, 0, 1, 16);
    noise(c, rnd, 22, "rgba(255,255,255,0.10)");
  },
  stone: (c, rnd) => {
    fill(c, "#8f8f8f");
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
      px(c, x, y, rnd() > 0.5 ? "#9d9d9d" : "#7d7d7d");
    }
  },
  cobble: (c, rnd) => {
    fill(c, "#7f7f7f");
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(rnd() * 13), y = Math.floor(rnd() * 13);
      const s = 2 + Math.floor(rnd() * 2);
      px(c, x, y, rnd() > 0.5 ? "#989898" : "#6b6b6b", s, s);
    }
    noise(c, rnd, 20, "rgba(0,0,0,0.15)");
  },
  water: (c, rnd) => {
    fill(c, "#3a6fd8");
    c.strokeStyle = "rgba(170,210,255,0.55)";
    c.lineWidth = 1;
    for (let y = 2; y < 16; y += 5) {
      c.beginPath();
      c.moveTo(0, y);
      for (let x = 0; x <= 16; x += 4) c.lineTo(x, y + (x % 8 === 0 ? 1 : -1));
      c.stroke();
    }
    noise(c, rnd, 12, "rgba(255,255,255,0.08)");
  },
  ice: (c, rnd) => {
    fill(c, "#bfe4ff");
    c.strokeStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < 5; i++) {
      const x = Math.floor(rnd() * 12) + 2;
      c.beginPath();
      c.moveTo(x, 2);
      c.lineTo(x + 3, 13);
      c.stroke();
    }
    noise(c, rnd, 10, "rgba(120,180,240,0.15)");
  },
  leaves: (c, rnd) => {
    c.clearRect(0, 0, 16, 16);
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (rnd() < 0.12) continue; // дырки (cutout)
        px(c, x, y, rnd() > 0.5 ? "#2f7d32" : "#276b2b");
      }
    }
    for (let i = 0; i < 20; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), "#3f9a44");
  },
  path: (c, rnd) => {
    fill(c, "#7a5a38");
    for (let i = 0; i < 40; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), rnd() > 0.5 ? "#6b4d2e" : "#8a6a46");
  },
  gravel: (c, rnd) => {
    fill(c, "#7d7a76");
    for (let i = 0; i < 50; i++) {
      const s = 1 + Math.floor(rnd() * 2);
      px(c, Math.floor(rnd() * 15), Math.floor(rnd() * 15), rnd() > 0.5 ? "#9a978f" : "#5f5c58", s, s);
    }
  },
  grassTop: (c, rnd) => {
    fill(c, "#5aa64f");
    for (let i = 0; i < 50; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), rnd() > 0.5 ? "#4c9442" : "#6cbb60");
  },
  dirt: (c, rnd) => {
    fill(c, "#6b4f34");
    for (let i = 0; i < 45; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), rnd() > 0.5 ? "#5c432c" : "#7c5d3f");
  },
  gold: (c, rnd) => {
    fill(c, "#f2c94c");
    c.fillStyle = "#fbe07a";
    c.fillRect(0, 0, 16, 2);
    c.fillStyle = "#c79a2e";
    c.fillRect(0, 14, 16, 2);
    noise(c, rnd, 16, "rgba(255,255,255,0.15)");
  },
  obsidian: (c, rnd) => {
    fill(c, "#241a33");
    for (let i = 0; i < 26; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), rnd() > 0.5 ? "#3a2a52" : "#191126");
  },
  quartz: (c, rnd) => {
    fill(c, "#ece6dc");
    c.fillStyle = "#d8d0c2";
    c.fillRect(0, 0, 16, 1);
    c.fillRect(0, 15, 16, 1);
    noise(c, rnd, 12, "rgba(0,0,0,0.05)");
  },
  wool: (c, rnd) => {
    fill(c, "#e9e9e9");
    for (let i = 0; i < 60; i++) px(c, Math.floor(rnd() * 16), Math.floor(rnd() * 16), rnd() > 0.5 ? "#ffffff" : "#d0d0d0");
  },
  log: (c, rnd) => {
    fill(c, "#6d4c2f");
    c.fillStyle = "#573b24";
    for (let x = 3; x < 16; x += 5) c.fillRect(x, 0, 1, 16);
    noise(c, rnd, 20, "rgba(0,0,0,0.12)");
  },
  tnt: (c, rnd) => {
    fill(c, "#c0392b");
    c.fillStyle = "#f4f4f4";
    c.fillRect(0, 6, 16, 4);
    c.fillStyle = "#333";
    c.fillRect(2, 7, 2, 2);
    c.fillRect(6, 7, 2, 2);
    c.fillRect(10, 7, 2, 2);
    noise(c, rnd, 10, "rgba(0,0,0,0.12)");
  },
  star: (c, rnd) => {
    c.clearRect(0, 0, 16, 16);
    c.fillStyle = "#f7f2c0";
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const d = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (d < 5) px(c, x, y, d < 2 ? "#ffffff" : "#e8e09a");
    }
    void rnd;
  },
  glass: (c, rnd) => {
    c.clearRect(0, 0, 16, 16);
    c.strokeStyle = "rgba(220,240,255,0.9)";
    c.lineWidth = 1;
    c.strokeRect(0.5, 0.5, 15, 15);
    c.fillStyle = "rgba(220,240,255,0.18)";
    c.fillRect(1, 1, 14, 14);
    void rnd;
  },
};

const NAMES = Object.keys(DRAW);

export function buildAtlas(textureSize: 16 | 32): TextureAtlas {
  const cols = 8;
  const rows = Math.ceil(NAMES.length / cols);
  const TILE = textureSize;
  const canvas = document.createElement("canvas");
  canvas.width = cols * TILE;
  canvas.height = rows * TILE;
  const ctx = canvas.getContext("2d");
  const uv: Record<string, TileUV> = {};
  if (!ctx) {
    const empty = new THREE.CanvasTexture(canvas);
    return { texture: empty, cols, rows, uv, tile: () => empty, standalone: () => empty };
  }
  const scale = TILE / 16;
  NAMES.forEach((name, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    ctx.save();
    ctx.translate(col * TILE, row * TILE);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, 16, 16);
    ctx.clip();
    DRAW[name](ctx, rng(0x9e37 + i * 2654435761));
    ctx.restore();
    uv[name] = {
      u0: col / cols,
      u1: (col + 1) / cols,
      v1: 1 - row / rows,
      v0: 1 - (row + 1) / rows,
    };
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  return {
    texture,
    cols,
    rows,
    uv,
    tile(name: string) {
      const r = uv[name] ?? uv.stone;
      const t = texture.clone();
      t.needsUpdate = true;
      t.offset.set(r.u0, r.v0);
      t.repeat.set(r.u1 - r.u0, r.v1 - r.v0);
      return t;
    },
    standalone(name: string) {
      const c = document.createElement("canvas");
      c.width = TILE;
      c.height = TILE;
      const cx = c.getContext("2d");
      if (cx) {
        cx.save();
        cx.scale(scale, scale);
        cx.beginPath();
        cx.rect(0, 0, 16, 16);
        cx.clip();
        (DRAW[name] ?? DRAW.stone)(cx, rng(0x51ed + name.length * 2654435761));
        cx.restore();
      }
      const t = new THREE.CanvasTexture(c);
      t.magFilter = THREE.NearestFilter;
      t.minFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
      t.needsUpdate = true;
      return t;
    },
  };
}

export default buildAtlas;
