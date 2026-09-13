// mesher.ts — voxel field geometry: cubes and slabs with hidden-face culling,
// smooth ambient occlusion, biome tint and an optional block outline.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/mesher.ts
import type { RenderBounds } from "../../../types.ts";
import { solidAt, GRASS_TINT, FOLIAGE_TINT, type BlockDef } from "./blocks.ts";
import type { AtlasUV } from "../textures/atlas.ts";

export interface MeshArrays {
  position: number[];
  normal: number[];
  uv: number[];
  color: number[];
  index: number[];
}

export interface ChunkMeshData {
  opaque: MeshArrays;
  cutout: MeshArrays;
  translucent: MeshArrays;
  water: MeshArrays;
  outline: number[];
}

export interface MeshContext {
  bounds: RenderBounds;
  defAt(col: number, row: number): BlockDef | null;
  uvOf(name: string): AtlasUV;
  ao: "off" | "simple" | "smooth";
  outline: boolean;
}

export interface MeshCell {
  col: number;
  row: number;
  def: BlockDef;
}

export function newArrays(): MeshArrays {
  return { position: [], normal: [], uv: [], color: [], index: [] };
}

const FACES: {
  key: "top" | "bottom" | "px" | "nx" | "pz" | "nz";
  normal: [number, number, number];
  brightness: number;
  tile: "top" | "side" | "bottom";
  ao: boolean;
}[] = [
  { key: "top", normal: [0, 1, 0], brightness: 1.0, tile: "top", ao: true },
  { key: "bottom", normal: [0, -1, 0], brightness: 0.5, tile: "bottom", ao: false },
  { key: "px", normal: [1, 0, 0], brightness: 0.8, tile: "side", ao: false },
  { key: "nx", normal: [-1, 0, 0], brightness: 0.8, tile: "side", ao: false },
  { key: "pz", normal: [0, 0, 1], brightness: 0.62, tile: "side", ao: false },
  { key: "nz", normal: [0, 0, -1], brightness: 0.62, tile: "side", ao: false },
];

const AO_LEVELS = [0.5, 0.72, 0.86, 1.0];

function tintOf(def: BlockDef): [number, number, number] {
  const hex = def.tint === "grass" ? GRASS_TINT : def.tint === "foliage" ? FOLIAGE_TINT : 0xffffff;
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function occ(ctx: MeshContext, c: number, r: number, y: number): number {
  return solidAt(ctx.defAt(c, r), y) ? 1 : 0;
}

function aoValue(side1: number, side2: number, corner: number): number {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

function cornerVerts(def: BlockDef, x: number, z: number, key: string, y1: number): number[][] {
  const y0 = def.y0;
  const x0 = x;
  const x1 = x + 1;
  const z0 = z;
  const z1 = z + 1;
  switch (key) {
    case "top":
      return [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ];
    case "bottom":
      return [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ];
    case "px":
      return [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ];
    case "nx":
      return [
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
      ];
    case "pz":
      return [
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [x0, y0, z1],
      ];
    default:
      return [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ];
  }
}

/** Top-face corners (i,j): 0=(0,0) 1=(0,1) 2=(1,1) 3=(1,0). */
const TOP_CORNERS: [number, number][] = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];

function pushQuad(
  out: MeshArrays,
  verts: number[][],
  normal: [number, number, number],
  uv: AtlasUV,
  colors: [number, number, number][],
): void {
  const base = out.position.length / 3;
  for (let i = 0; i < 4; i++) {
    out.position.push(verts[i][0], verts[i][1], verts[i][2]);
    out.normal.push(normal[0], normal[1], normal[2]);
    out.color.push(colors[i][0], colors[i][1], colors[i][2]);
  }
  out.uv.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v1, uv.u1, uv.v0);
  out.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function meshCells(cells: MeshCell[], ctx: MeshContext): ChunkMeshData {
  const data: ChunkMeshData = {
    opaque: newArrays(),
    cutout: newArrays(),
    translucent: newArrays(),
    water: newArrays(),
    outline: [],
  };
  const { bounds } = ctx;

  for (const { col, row, def } of cells) {
    const x = col - bounds.col0;
    const z = row - bounds.row0;
    const y1 = def.y0 + def.h;
    const out =
      def.pass === "cutout"
        ? data.cutout
        : def.pass === "translucent"
          ? data.translucent
          : def.pass === "water"
            ? data.water
            : data.opaque;
    const tint = tintOf(def);

    for (const face of FACES) {
      const n = neighbor(col, row, face.key);
      const nb = ctx.defAt(n.col, n.row);
      const occluded =
        def.solid &&
        nb &&
        nb.solid &&
        nb.y0 <= def.y0 + 0.05 &&
        nb.y0 + nb.h >= y1 - 0.05 &&
        !(face.key === "top" && nb.h <= def.h);
      if (face.key === "top" && occluded) continue;
      if (face.key === "bottom" && def.y0 <= 0.001) continue;
      if (face.key !== "top" && face.key !== "bottom" && occluded) continue;

      const verts = cornerVerts(def, x, z, face.key, y1);
      const uvr = ctx.uvOf(face.tile === "top" ? def.top : face.tile === "bottom" ? def.bottom : def.side);
      const bright = face.brightness;

      const brights =
        face.ao && ctx.ao === "smooth"
          ? TOP_CORNERS.map(([i, j]) => {
              const dc = i === 1 ? 1 : -1;
              const dr = j === 1 ? 1 : -1;
              const s1 = occ(ctx, col + dc, row, y1 - 0.01);
              const s2 = occ(ctx, col, row + dr, y1 - 0.01);
              const cr = occ(ctx, col + dc, row + dr, y1 - 0.01);
              return bright * AO_LEVELS[aoValue(s1, s2, cr)];
            })
          : [bright, bright, bright, bright];

      const colors = brights.map((b) => [b * tint[0], b * tint[1], b * tint[2]] as [number, number, number]);
      pushQuad(out, verts, face.normal, uvr, colors);

      if (
        ctx.outline &&
        def.solid &&
        (face.key === "px" || face.key === "nx" || face.key === "pz" || face.key === "nz")
      ) {
        if (!occluded) addEdge(data.outline, face.key, x, z, y1);
      }
    }
  }
  return data;
}

function neighbor(col: number, row: number, key: string): { col: number; row: number } {
  switch (key) {
    case "px":
      return { col: col + 1, row };
    case "nx":
      return { col: col - 1, row };
    case "pz":
      return { col, row: row + 1 };
    case "nz":
      return { col, row: row - 1 };
    default:
      return { col, row };
  }
}

function addEdge(out: number[], key: string, x: number, z: number, y1: number): void {
  const x0 = x,
    x1 = x + 1,
    z0 = z,
    z1 = z + 1;
  switch (key) {
    case "px":
      out.push(x1, y1, z0, x1, y1, z1);
      break;
    case "nx":
      out.push(x0, y1, z0, x0, y1, z1);
      break;
    case "pz":
      out.push(x0, y1, z1, x1, y1, z1);
      break;
    default:
      out.push(x0, y1, z0, x1, y1, z0);
      break;
  }
}

export default meshCells;
