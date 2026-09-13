// boxuv.ts — Minecraft box-UV geometry. A box is unwrapped like MC models
// (east/west/up/down/north/south) and mapped onto a skin texture.
//
// All box definitions use vanilla texel units; Faithful skins are 2x, so callers
// pass `texScale = 2` and the model-space texture size (actual / texScale).
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/mobs/boxuv.ts
import * as THREE from "three";

export interface BoxRect {
  /** UV origin in texels (top-left of the unwrap, v downward). */
  u: number;
  v: number;
}

export interface BoxUVOptions {
  /** Texture dimensions in model texels (vanilla units). */
  texWidth: number;
  texHeight: number;
  /** Mirror the U axis (MC `mirror`). */
  mirror?: boolean;
  /** Uniform inflate in texels (MC `inflate`). */
  inflate?: number;
}

type FaceName = "east" | "west" | "up" | "down" | "north" | "south";

interface FaceDef {
  name: FaceName;
  normal: [number, number, number];
  /** Corner order: bottom-left, bottom-right, top-right, top-left (seen from outside). */
  corners: [number, number, number][];
  rect: (u: number, v: number, w: number, h: number, d: number, i: number) => [number, number, number, number];
}

function faceCorners(hx: number, hy: number, hz: number): Record<FaceName, [number, number, number][]> {
  return {
    east: [
      [hx, -hy, hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [hx, hy, hz],
    ],
    west: [
      [-hx, -hy, -hz],
      [-hx, -hy, hz],
      [-hx, hy, hz],
      [-hx, hy, -hz],
    ],
    north: [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
    ],
    south: [
      [hx, -hy, hz],
      [-hx, -hy, hz],
      [-hx, hy, hz],
      [hx, hy, hz],
    ],
    up: [
      [-hx, hy, hz],
      [hx, hy, hz],
      [hx, hy, -hz],
      [-hx, hy, -hz],
    ],
    down: [
      [-hx, -hy, -hz],
      [hx, -hy, -hz],
      [hx, -hy, hz],
      [-hx, -hy, hz],
    ],
  };
}

const FACES: FaceDef[] = [
  {
    name: "east",
    normal: [1, 0, 0],
    corners: [],
    rect: (u, v, _w, h, d, i) => [u - i, v + d - i, d + 2 * i, h + 2 * i],
  },
  {
    name: "west",
    normal: [-1, 0, 0],
    corners: [],
    rect: (u, v, w, h, d, i) => [u + d + w - i, v + d - i, d + 2 * i, h + 2 * i],
  },
  { name: "up", normal: [0, 1, 0], corners: [], rect: (u, v, w, _h, d, i) => [u + d - i, v - i, w + 2 * i, d + 2 * i] },
  {
    name: "down",
    normal: [0, -1, 0],
    corners: [],
    rect: (u, v, w, _h, d, i) => [u + d + w - i, v - i, w + 2 * i, d + 2 * i],
  },
  {
    name: "north",
    normal: [0, 0, -1],
    corners: [],
    rect: (u, v, w, h, d, i) => [u + d - i, v + d - i, w + 2 * i, h + 2 * i],
  },
  {
    name: "south",
    normal: [0, 0, 1],
    corners: [],
    rect: (u, v, w, h, d, i) => [u + d + w + d - i, v + d - i, w + 2 * i, h + 2 * i],
  },
];

/**
 * Build a box geometry (positions in texel/model pixels, centered at the origin)
 * with UVs from the Minecraft box unwrap.
 */
export function boxUV(w: number, h: number, d: number, rect: BoxRect, opts: BoxUVOptions): THREE.BufferGeometry {
  const { texWidth, texHeight, mirror = false, inflate = 0 } = opts;
  const i = inflate;
  const hx = w / 2 + i;
  const hy = h / 2 + i;
  const hz = d / 2 + i;
  const corners = faceCorners(hx, hy, hz);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (const face of FACES) {
    const [rx, ry, rw, rh] = face.rect(rect.u, rect.v, w, h, d, i);
    let u0 = rx / texWidth;
    let u1 = (rx + rw) / texWidth;
    if (mirror) [u0, u1] = [u1, u0];
    const vTop = 1 - ry / texHeight;
    const vBottom = 1 - (ry + rh) / texHeight;

    const faceCornersList = corners[face.name];
    const base = positions.length / 3;
    // bottom-left, bottom-right, top-right, top-left (from outside)
    const uvList: [number, number][] = [
      [u0, vBottom],
      [u1, vBottom],
      [u1, vTop],
      [u0, vTop],
    ];
    for (let k = 0; k < 4; k++) {
      positions.push(faceCornersList[k][0], faceCornersList[k][1], faceCornersList[k][2]);
      normals.push(face.normal[0], face.normal[1], face.normal[2]);
      uvs.push(uvList[k][0], uvList[k][1]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

export default boxUV;
