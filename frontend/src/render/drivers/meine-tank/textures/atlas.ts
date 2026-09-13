// atlas.ts — packing loaded textures into a canvas atlas (blocks / items / particles)
// and generating procedural normal maps from albedo, so block surfaces gain relief
// without an external PBR pack.
//
// Nearest filtering, no mipmaps: the Minecraft pixel look.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/textures/atlas.ts
import * as THREE from "three";
import type { LoadedTexture } from "./loader.ts";

export interface AtlasUV {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface Atlas {
  texture: THREE.CanvasTexture;
  /** Procedural normal map in the same layout as `texture` (linear color space). */
  normal: THREE.CanvasTexture;
  cols: number;
  rows: number;
  cell: number;
  uv: Record<string, AtlasUV>;
  has(name: string): boolean;
  /** Cloned atlas texture cropped to a tile (for box-model materials). */
  tile(name: string): THREE.Texture;
  /** Cloned normal-map texture cropped to the same tile. */
  tileNormal(name: string): THREE.Texture;
  /** Separate repeating texture at native resolution (for ground/floor planes). */
  standalone(name: string): THREE.Texture;
  /** Separate repeating normal map at native resolution. */
  standaloneNormal(name: string): THREE.Texture;
  dispose(): void;
}

function makeTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  return t;
}

function drawScaled(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  w: number,
  h: number,
  x: number,
  y: number,
  cell: number,
): void {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h, x, y, cell, cell);
}

/** Sobel height-to-normal over a single tile (RGBA in, RGBA out). */
export function normalTile(src: ImageData, out: ImageData, strength = 2.2): void {
  const { width: w, height: h, data } = src;
  const lum = new Float32Array(w * h);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) {
    lum[i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
  }
  const at = (x: number, y: number): number =>
    lum[Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))];
  const o = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx =
        at(x + 1, y - 1) +
        2 * at(x + 1, y) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        at(x - 1, y + 1) +
        2 * at(x, y + 1) +
        at(x + 1, y + 1) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = -dy * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      const p = (y * w + x) * 4;
      o[p] = (nx * 0.5 + 0.5) * 255;
      o[p + 1] = (ny * 0.5 + 0.5) * 255;
      o[p + 2] = (nz / len) * 0.5 * 255 + 127.5;
      o[p + 3] = 255;
    }
  }
}

function buildNormalCanvas(
  color: HTMLCanvasElement,
  cols: number,
  cell: number,
  textures: LoadedTexture[],
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = color.width;
  canvas.height = color.height;
  const ctx = canvas.getContext("2d");
  const cctx = color.getContext("2d");
  if (!ctx || !cctx) return canvas;
  ctx.imageSmoothingEnabled = false;
  for (let i = 0; i < textures.length; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const src = cctx.getImageData(col * cell, row * cell, cell, cell);
    const out = ctx.createImageData(cell, cell);
    normalTile(src, out);
    ctx.putImageData(out, col * cell, row * cell);
  }
  return canvas;
}

export function buildAtlas(textures: LoadedTexture[], opts: { cell: number; cols?: number; normals?: boolean }): Atlas {
  const cell = Math.max(1, Math.round(opts.cell));
  const cols = opts.cols ?? 8;
  const rows = Math.max(1, Math.ceil(textures.length / cols));
  const canvas = document.createElement("canvas");
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext("2d");
  const uv: Record<string, AtlasUV> = {};

  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    textures.forEach((t, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      drawScaled(ctx, t.image, t.width, t.height, col * cell, row * cell, cell);
      uv[t.asset.name] = {
        u0: col / cols,
        u1: (col + 1) / cols,
        v1: 1 - row / rows,
        v0: 1 - (row + 1) / rows,
      };
    });
  }

  const texture = makeTexture(canvas, true);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;

  const wantNormals = opts.normals !== false;
  const normalCanvas = wantNormals ? buildNormalCanvas(canvas, cols, cell, textures) : document.createElement("canvas");
  if (!wantNormals) {
    normalCanvas.width = canvas.width;
    normalCanvas.height = canvas.height;
  }
  const normal = makeTexture(normalCanvas, false);
  normal.wrapS = THREE.ClampToEdgeWrapping;
  normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.needsUpdate = true;

  const byName = new Map(textures.map((t) => [t.asset.name, t]));

  function tileOf(source: THREE.CanvasTexture, name: string): THREE.Texture {
    const r = uv[name];
    const t = source.clone();
    t.needsUpdate = true;
    if (r) {
      t.offset.set(r.u0, r.v0);
      t.repeat.set(r.u1 - r.u0, r.v1 - r.v0);
    }
    return t;
  }

  function standaloneOf(source: HTMLCanvasElement, srgb: boolean, name: string): THREE.Texture {
    const src = byName.get(name);
    const c = document.createElement("canvas");
    c.width = cell;
    c.height = cell;
    const cx = c.getContext("2d");
    if (cx && src) {
      const idx = textures.indexOf(src);
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      cx.imageSmoothingEnabled = false;
      cx.drawImage(source, col * cell, row * cell, cell, cell, 0, 0, cell, cell);
    }
    const t = makeTexture(c, srgb);
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.needsUpdate = true;
    return t;
  }

  return {
    texture,
    normal,
    cols,
    rows,
    cell,
    uv,
    has: (name) => byName.has(name),
    tile: (name) => tileOf(texture, name),
    tileNormal: (name) => tileOf(normal, name),
    standalone: (name) => standaloneOf(canvas, true, name),
    standaloneNormal: (name) => standaloneOf(normalCanvas, false, name),
    dispose() {
      texture.dispose();
      normal.dispose();
    },
  };
}

export default buildAtlas;
