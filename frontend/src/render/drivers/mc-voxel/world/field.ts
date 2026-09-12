// field.ts — построение воксельного поля по срезам SceneState.field: чанки 8×8,
// пересборка только изменившихся чанков, земля + контур.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/world/field.ts
import * as THREE from "three";
import type { RenderBounds } from "../../../types.ts";
import { blockForTile, type BlockDef } from "./blocks.ts";
import { meshCells, type MeshArrays, type MeshContext, type MeshCell } from "./mesher.ts";
import type { VoxelMaterials } from "../materials.ts";

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
  dispose(): void;
}

function toMesh(a: MeshArrays, material: THREE.Material, shadows: boolean): THREE.Mesh | null {
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
  materials: VoxelMaterials,
  opts: { ao: "off" | "simple" | "smooth"; outline: boolean; shadows: boolean },
): FieldWorld {
  const group = new THREE.Group();
  const chunks = new Map<string, Chunk>();
  let current: Uint8Array | null = null;
  let bounds: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };
  let ao = opts.ao;
  let outline = opts.outline;
  let groundBuilt = false;
  const groundMeshes: THREE.Mesh[] = [];

  function buildGround(): void {
    const cols = bounds.cols;
    const rows = bounds.rows;
    const grass = materials.atlas.standalone("grassTop");
    grass.repeat.set(cols / 2, rows / 2);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(cols, rows), new THREE.MeshLambertMaterial({ map: grass }));
    top.rotation.x = -Math.PI / 2;
    top.position.set(cols / 2, 0, rows / 2);
    top.receiveShadow = true;
    group.add(top);
    groundMeshes.push(top);

    const dirt = materials.atlas.standalone("dirt");
    dirt.repeat.set(cols, rows);
    const base = new THREE.Mesh(new THREE.BoxGeometry(cols, 1, rows), new THREE.MeshLambertMaterial({ map: dirt }));
    // Верх основания на -0.01, чтобы не z-fight с травяной плоскостью на y=0.
    base.position.set(cols / 2, -0.51, rows / 2);
    group.add(base);
    groundMeshes.push(base);
    groundBuilt = true;
  }

  function defAt(col: number, row: number): BlockDef | null {
    if (!current) return null;
    return blockForTile(current[row * 32 + col]);
  }

  function chunkSlice(cx: number, cy: number): Uint8Array {
    const out = new Uint8Array(CH * CH);
    const c0 = bounds.col0 + cx * CH;
    const r0 = bounds.row0 + cy * CH;
    for (let j = 0; j < CH; j++) {
      for (let i = 0; i < CH; i++) {
        const c = c0 + i;
        const r = r0 + j;
        out[j * CH + i] = current && c < bounds.col0 + bounds.cols && r < bounds.row0 + bounds.rows ? current[r * 32 + c] : 0;
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
        const def = blockForTile(current[r * 32 + c]);
        if (def) cells.push({ col: c, row: r, def });
      }
    }

    const ctx: MeshContext = { bounds, defAt, uvOf: (n) => materials.atlas.uv[n], ao, outline };
    const data = meshCells(cells, ctx);

    for (const [arrays, mat, shadows] of [
      [data.opaque, materials.opaque, opts.shadows],
      [data.cutout, materials.cutout, opts.shadows],
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
      resetChunks(); // земля не зависит от ao/outline — оставляем
    },
    update(field, b) {
      bounds = b;
      current = field;
      if (!groundBuilt) buildGround();
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
      for (const m of groundMeshes) {
        group.remove(m);
        m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
        else mat.dispose();
      }
      groundMeshes.length = 0;
      group.clear();
      groundBuilt = false;
    },
  };
}

export default createFieldWorld;
