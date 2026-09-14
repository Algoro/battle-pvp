// field.ts — chunked voxel world for `meine-tank`: ground layer and block chunks built
// from the Battle City collision buffer; only changed chunks are remeshed.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/world/field.ts
import * as THREE from "three";
import type { RenderBounds } from "../../../types.ts";
import { blockForTile, themeBlocks, GRASS_TINT, type BlockDef } from "./blocks.ts";
import { computeWaterDepths, waterBlock } from "./water.ts";
import { meshCells, type ChunkMeshData, type MeshContext, type MeshCell } from "./mesher.ts";
import type { MtMaterials } from "../materials.ts";
import type { Atlas } from "../textures/atlas.ts";
import type { MtTheme } from "../options.ts";

const CH = 8;

interface Chunk {
  meshes: THREE.Mesh[];
  line: THREE.LineSegments | null;
  data: Uint8Array;
  group: THREE.Group;
}

export interface FieldWorld {
  group: THREE.Group;
  update(field: Uint8Array, bounds: RenderBounds): void;
  configure(opts: { ao: "off" | "simple" | "smooth"; outline: boolean }): void;
  rebuildGround(theme: MtTheme): void;
  /** Meshes that may receive screen-space reflections (water + ice chunks). */
  reflectiveMeshes(): THREE.Mesh[];
  /** Bumped whenever chunks are rebuilt, so reflection targets can be refreshed. */
  chunkVersion(): number;
  dispose(): void;
}

function toMesh(a: ChunkMeshData["opaque"], material: THREE.Material, shadows: boolean): THREE.Mesh | null {
  if (!a.position.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(a.position, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(a.normal, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
  g.setAttribute("color", new THREE.Float32BufferAttribute(a.color, 3));
  g.setIndex(a.index);
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, material);
  m.castShadow = shadows;
  m.receiveShadow = shadows;
  return m;
}

export function createFieldWorld(
  materials: MtMaterials,
  atlas: Atlas,
  opts: { ao: "off" | "simple" | "smooth"; outline: boolean; shadows: boolean; theme: MtTheme },
): FieldWorld {
  const group = new THREE.Group();
  const chunks = new Map<string, Chunk>();
  let current: Uint8Array | null = null;
  let waterDepth: Uint8Array | null = null;
  let bounds: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };
  let ao = opts.ao;
  let outline = opts.outline;
  let theme = opts.theme;
  let version = 0;
  const groundMeshes: THREE.Mesh[] = [];
  const groundTextures: THREE.Texture[] = [];
  let groundBuilt = false;
  let groundSig = "";

  interface GroundQuad {
    p: [number, number, number][];
    n: [number, number, number];
    uv: [number, number][];
  }

  function keepTexture(t: THREE.Texture): THREE.Texture {
    groundTextures.push(t);
    return t;
  }

  function quadMesh(quads: GroundQuad[], material: THREE.Material): THREE.Mesh | null {
    if (!quads.length) return null;
    const position: number[] = [];
    const normal: number[] = [];
    const uv: number[] = [];
    const index: number[] = [];
    for (const q of quads) {
      const base = position.length / 3;
      for (let i = 0; i < 4; i++) {
        position.push(q.p[i][0], q.p[i][1], q.p[i][2]);
        normal.push(q.n[0], q.n[1], q.n[2]);
        uv.push(q.uv[i][0], q.uv[i][1]);
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(normal, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(index);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.receiveShadow = true;
    return m;
  }

  function buildGround(): void {
    const cols = bounds.cols;
    const rows = bounds.rows;
    const t = themeBlocks(theme);
    const topMat = new THREE.MeshLambertMaterial({
      map: keepTexture(atlas.standalone(t.groundTop)),
      side: THREE.DoubleSide,
    });
    if (t.groundTint === "grass") topMat.color.setHex(GRASS_TINT);
    const floorMat = new THREE.MeshLambertMaterial({
      map: keepTexture(atlas.standalone(t.groundBottom)),
      side: THREE.DoubleSide,
    });
    const sideMat = new THREE.MeshLambertMaterial({
      map: keepTexture(atlas.standalone(t.groundSide)),
      side: THREE.DoubleSide,
    });

    const depthAt = (c: number, r: number): number => {
      if (c < bounds.col0 || c >= bounds.col0 + cols || r < bounds.row0 || r >= bounds.row0 + rows) return 0;
      return waterDepth ? waterDepth[r * 32 + c] : 0;
    };
    const EPS = 0.015;
    const wall = (
      ax: number,
      az: number,
      bx: number,
      bz: number,
      depth: number,
      n: [number, number, number],
    ): GroundQuad => ({
      p: [
        [ax, 0, az],
        [bx, 0, bz],
        [bx, -depth, bz],
        [ax, -depth, az],
      ],
      n,
      uv: [
        [0, 0],
        [1, 0],
        [1, depth],
        [0, depth],
      ],
    });

    const tops: GroundQuad[] = [];
    const floors: GroundQuad[] = [];
    const walls: GroundQuad[] = [];
    let maxDepth = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const d = depthAt(bounds.col0 + c, bounds.row0 + r);
        const x = c;
        const z = r;
        if (d > 0) {
          maxDepth = Math.max(maxDepth, d);
          floors.push({
            p: [
              [x, -d, z],
              [x, -d, z + 1],
              [x + 1, -d, z + 1],
              [x + 1, -d, z],
            ],
            n: [0, 1, 0],
            uv: [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
            ],
          });
          if (depthAt(bounds.col0 + c + 1, bounds.row0 + r) === 0)
            walls.push(wall(x + 1 + EPS, z, x + 1 + EPS, z + 1, d, [1, 0, 0]));
          if (depthAt(bounds.col0 + c - 1, bounds.row0 + r) === 0)
            walls.push(wall(x - EPS, z + 1, x - EPS, z, d, [-1, 0, 0]));
          if (depthAt(bounds.col0 + c, bounds.row0 + r + 1) === 0)
            walls.push(wall(x, z + 1 + EPS, x + 1, z + 1 + EPS, d, [0, 0, 1]));
          if (depthAt(bounds.col0 + c, bounds.row0 + r - 1) === 0)
            walls.push(wall(x + 1, z - EPS, x, z - EPS, d, [0, 0, -1]));
        } else {
          tops.push({
            p: [
              [x, 0, z],
              [x, 0, z + 1],
              [x + 1, 0, z + 1],
              [x + 1, 0, z],
            ],
            n: [0, 1, 0],
            uv: [
              [0, 0],
              [0, 1],
              [1, 1],
              [1, 0],
            ],
          });
        }
      }
    }

    // Underground: the arena keeps its own walls and floor, so it stays solid when the
    // outer world is disabled and the water basins open into it.
    const baseTop = -(maxDepth + 0.8);
    const perimeter: GroundQuad[] = [
      {
        p: [
          [0, 0, 0],
          [cols, 0, 0],
          [cols, baseTop, 0],
          [0, baseTop, 0],
        ],
        n: [0, 0, -1],
        uv: [
          [0, 0],
          [cols, 0],
          [cols, -baseTop],
          [0, -baseTop],
        ],
      },
      {
        p: [
          [cols, 0, rows],
          [0, 0, rows],
          [0, baseTop, rows],
          [cols, baseTop, rows],
        ],
        n: [0, 0, 1],
        uv: [
          [0, 0],
          [cols, 0],
          [cols, -baseTop],
          [0, -baseTop],
        ],
      },
      {
        p: [
          [0, 0, rows],
          [0, 0, 0],
          [0, baseTop, 0],
          [0, baseTop, rows],
        ],
        n: [-1, 0, 0],
        uv: [
          [0, 0],
          [rows, 0],
          [rows, -baseTop],
          [0, -baseTop],
        ],
      },
      {
        p: [
          [cols, 0, 0],
          [cols, 0, rows],
          [cols, baseTop, rows],
          [cols, baseTop, 0],
        ],
        n: [1, 0, 0],
        uv: [
          [0, 0],
          [rows, 0],
          [rows, -baseTop],
          [0, -baseTop],
        ],
      },
    ];
    const bottom: GroundQuad = {
      p: [
        [0, baseTop, 0],
        [0, baseTop, rows],
        [cols, baseTop, rows],
        [cols, baseTop, 0],
      ],
      n: [0, 1, 0],
      uv: [
        [0, 0],
        [0, rows],
        [cols, rows],
        [cols, 0],
      ],
    };

    const meshes = [
      quadMesh(tops, topMat),
      quadMesh(floors, floorMat),
      quadMesh(walls.concat(perimeter), sideMat),
      quadMesh([bottom], floorMat),
    ];
    for (const m of meshes) {
      if (!m) continue;
      group.add(m);
      groundMeshes.push(m);
    }
    groundBuilt = true;
  }

  function disposeGround(): void {
    for (const m of groundMeshes) {
      group.remove(m);
      m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[];
      if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
      else mat.dispose();
    }
    groundMeshes.length = 0;
    for (const tex of groundTextures) tex.dispose();
    groundTextures.length = 0;
    groundBuilt = false;
  }

  function waterSignature(): string {
    let s = `${bounds.col0},${bounds.row0},${bounds.cols},${bounds.rows},${theme}|`;
    for (let r = bounds.row0; r < bounds.row0 + bounds.rows; r++) {
      for (let c = bounds.col0; c < bounds.col0 + bounds.cols; c++) s += String(waterDepth ? waterDepth[r * 32 + c] : 0);
    }
    return s;
  }

  function defAt(col: number, row: number): BlockDef | null {
    if (!current) return null;
    const def = blockForTile(current[row * 32 + col], theme);
    if (def && def.pass === "water" && waterDepth) {
      const d = waterDepth[row * 32 + col];
      if (d > 0) return waterBlock(def, d);
    }
    return def;
  }

  function chunkSlice(cx: number, cy: number): Uint8Array {
    const out = new Uint8Array(CH * CH);
    const c0 = bounds.col0 + cx * CH;
    const r0 = bounds.row0 + cy * CH;
    for (let j = 0; j < CH; j++) {
      for (let i = 0; i < CH; i++) {
        const c = c0 + i;
        const r = r0 + j;
        out[j * CH + i] =
          current && c < bounds.col0 + bounds.cols && r < bounds.row0 + bounds.rows ? current[r * 32 + c] : 0;
      }
    }
    return out;
  }

  function disposeChunk(chunk: Chunk): void {
    for (const m of chunk.meshes) {
      chunk.group.remove(m);
      m.geometry.dispose();
    }
    if (chunk.line) {
      chunk.group.remove(chunk.line);
      chunk.line.geometry.dispose();
    }
    group.remove(chunk.group);
  }

  function resetChunks(): void {
    for (const chunk of chunks.values()) disposeChunk(chunk);
    chunks.clear();
  }

  function buildChunk(cx: number, cy: number): void {
    if (!current) return;
    const key = `${cx},${cy}`;
    let chunk = chunks.get(key);
    if (!chunk) {
      chunk = { meshes: [], line: null, data: new Uint8Array(0), group: new THREE.Group() };
      group.add(chunk.group);
      chunks.set(key, chunk);
    } else {
      for (const m of chunk.meshes) {
        chunk.group.remove(m);
        m.geometry.dispose();
      }
      chunk.meshes = [];
      if (chunk.line) {
        chunk.group.remove(chunk.line);
        chunk.line.geometry.dispose();
        chunk.line = null;
      }
    }

    const cells: MeshCell[] = [];
    const c0 = bounds.col0 + cx * CH;
    const r0 = bounds.row0 + cy * CH;
    for (let r = r0; r < Math.min(r0 + CH, bounds.row0 + bounds.rows); r++) {
      for (let c = c0; c < Math.min(c0 + CH, bounds.col0 + bounds.cols); c++) {
        const def = defAt(c, r);
        if (def) cells.push({ col: c, row: r, def });
      }
    }

    const ctx: MeshContext = {
      bounds,
      defAt,
      uvOf: (n) => atlas.uv[n] ?? { u0: 0, v0: 0, u1: 1, v1: 1 },
      ao,
      outline,
    };
    const data = meshCells(cells, ctx);

    for (const [arrays, mat, shadows] of [
      [data.opaque, materials.opaque, opts.shadows],
      [data.cutout, materials.cutout, opts.shadows],
      [data.translucent, materials.translucent, false],
      [data.water, materials.water, false],
    ] as const) {
      const m = toMesh(arrays, mat, shadows);
      if (m) {
        chunk.group.add(m);
        chunk.meshes.push(m);
      }
    }
    if (outline && data.outline.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(data.outline, 3));
      chunk.line = new THREE.LineSegments(g, materials.line);
      chunk.group.add(chunk.line);
    }
    chunk.data = chunkSlice(cx, cy);
    version++;
  }

  function chunkChanged(cx: number, cy: number): boolean {
    const chunk = chunks.get(`${cx},${cy}`);
    if (!chunk || !chunk.data.length) return true;
    const next = chunkSlice(cx, cy);
    if (next.length !== chunk.data.length) return true;
    for (let i = 0; i < next.length; i++) if (next[i] !== chunk.data[i]) return true;
    return false;
  }

  return {
    group,
    configure(next) {
      if (next.ao === ao && next.outline === outline) return;
      ao = next.ao;
      outline = next.outline;
      resetChunks();
    },
    rebuildGround(nextTheme) {
      theme = nextTheme;
      disposeGround();
      buildGround();
      groundSig = waterSignature();
      resetChunks();
    },
    reflectiveMeshes() {
      const out: THREE.Mesh[] = [];
      for (const chunk of chunks.values()) {
        for (const m of chunk.meshes) {
          if (m.material === materials.water || m.material === materials.translucent) out.push(m);
        }
      }
      return out;
    },
    chunkVersion() {
      return version;
    },
    update(field, b) {
      bounds = b;
      current = field;
      waterDepth = computeWaterDepths(field, bounds);
      const sig = waterSignature();
      if (!groundBuilt || sig !== groundSig) {
        disposeGround();
        buildGround();
        groundSig = sig;
        resetChunks();
      }
      const ncx = Math.ceil(bounds.cols / CH);
      const ncy = Math.ceil(bounds.rows / CH);
      for (let cy = 0; cy < ncy; cy++) {
        for (let cx = 0; cx < ncx; cx++) {
          if (chunkChanged(cx, cy)) buildChunk(cx, cy);
        }
      }
    },
    dispose() {
      resetChunks();
      disposeGround();
      group.clear();
    },
  };
}

export default createFieldWorld;
