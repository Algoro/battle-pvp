// terrain.ts — статичная геометрия поля: кирпич (по квадрантам!), сталь, вода, лёд,
// деревья, дорога. Кирпич собирается из четверть-кубов по битовой маске тайла (BRICK_QUADRANT),
// поэтому визуальное разрушение совпадает с логикой brickHit (см. @core/domain).
//
// Материалы и текстуры создаются один раз на драйвер (общие) — пересборка поля не течёт.
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/models/terrain.ts
import * as THREE from "three";
import { BRICK_QUADRANT, brickHealth, isBrick, isSteel, isWater, isIce, isTree, isRoad } from "@core/domain.ts";
import { COLORS, waterTexture, groundTexture } from "../textures.ts";
import { cellCenter } from "../../../coords.ts";
import type { RenderBounds } from "../../../types.ts";

export interface FieldMeshes {
  group: THREE.Group;
  update(field: Uint8Array, bounds: RenderBounds): void;
  tick(dtMs: number): void;
  dispose(): void;
}

const QUAD = [
  { bit: BRICK_QUADRANT.TL, dx: -0.24, dz: -0.24 },
  { bit: BRICK_QUADRANT.TR, dx: 0.24, dz: -0.24 },
  { bit: BRICK_QUADRANT.BL, dx: -0.24, dz: 0.24 },
  { bit: BRICK_QUADRANT.BR, dx: 0.24, dz: 0.24 },
];

export function createFieldMeshes(): FieldMeshes {
  const group = new THREE.Group();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  // Общие ресурсы: живут до dispose(), пересборка поля их не трогает.
  const groundTex = groundTexture();
  const waterTex = waterTexture();
  const groundMat = new THREE.MeshStandardMaterial({ color: COLORS.ground, map: groundTex, roughness: 0.95 });
  const brickMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
  const steelMat = new THREE.MeshStandardMaterial({ color: COLORS.steel, roughness: 0.7, metalness: 0.5 });
  const iceMat = new THREE.MeshStandardMaterial({ color: COLORS.ice, roughness: 0.05, metalness: 0.4 });
  const waterMat = new THREE.MeshStandardMaterial({ color: COLORS.water, map: waterTex, transparent: true, opacity: 0.9, roughness: 0.2 });
  const roadMat = new THREE.MeshStandardMaterial({ color: COLORS.road, roughness: 0.9 });
  const treeMat = new THREE.MeshStandardMaterial({ color: COLORS.tree, roughness: 0.8 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: COLORS.trunk, roughness: 0.9 });

  function clear(): void {
    for (const child of [...group.children]) {
      group.remove(child);
      (child as THREE.Mesh).geometry?.dispose?.();
    }
  }

  function addBoxes(cells: [number, number][], sx: number, sy: number, sz: number, mat: THREE.Material, y: number): void {
    if (!cells.length) return;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(sx, sy, sz), mat, cells.length);
    cells.forEach(([x, z], i) => {
      dummy.position.set(x, y, z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }

  function update(field: Uint8Array, b: RenderBounds): void {
    clear();

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(b.cols, b.rows), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(b.cols / 2, 0, b.rows / 2);
    group.add(ground);

    const qx: number[] = [];
    const qz: number[] = [];
    const qcolor: number[] = [];
    const steel: [number, number][] = [];
    const water: [number, number][] = [];
    const ice: [number, number][] = [];
    const trees: [number, number][] = [];
    const roads: [number, number][] = [];

    for (let r = b.row0; r < b.row0 + b.rows; r++) {
      for (let c = b.col0; c < b.col0 + b.cols; c++) {
        const v = field[r * 32 + c];
        if (v === 0) continue;
        const p = cellCenter(b, c, r);
        if (isBrick(v)) {
          const damaged = brickHealth(v) < 2;
          for (const q of QUAD) {
            if (v & q.bit) {
              qx.push(p.x + q.dx);
              qz.push(p.z + q.dz);
              qcolor.push(damaged ? COLORS.brickDamaged : COLORS.brick);
            }
          }
        } else if (isSteel(v)) steel.push([p.x, p.z]);
        else if (isWater(v)) water.push([p.x, p.z]);
        else if (isIce(v)) ice.push([p.x, p.z]);
        else if (isTree(v)) trees.push([p.x, p.z]);
        else if (isRoad(v)) roads.push([p.x, p.z]);
      }
    }

    if (qx.length) {
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.46, 0.62, 0.46), brickMat, qx.length);
      for (let i = 0; i < qx.length; i++) {
        dummy.position.set(qx[i], 0.31, qz[i]);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, color.setHex(qcolor[i]));
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    }

    addBoxes(steel, 0.96, 0.9, 0.96, steelMat, 0.45);
    addBoxes(ice, 1, 0.06, 1, iceMat, 0.03);
    addBoxes(water, 1, 0.06, 1, waterMat, 0.03);
    addBoxes(roads, 1, 0.04, 1, roadMat, 0.02);

    if (trees.length) {
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 0.5, 6), trunkMat, trees.length);
      const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(0.66, 1.9, 7), treeMat, trees.length);
      trees.forEach(([x, z], i) => {
        dummy.position.set(x, 0.25, z);
        dummy.updateMatrix();
        trunks.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 1.15, z);
        dummy.updateMatrix();
        crowns.setMatrixAt(i, dummy.matrix);
      });
      trunks.instanceMatrix.needsUpdate = true;
      crowns.instanceMatrix.needsUpdate = true;
      group.add(trunks, crowns);
    }
  }

  return {
    group,
    update,
    tick(dtMs: number) {
      waterTex.offset.y -= dtMs * 0.00025;
    },
    dispose() {
      clear();
      for (const m of [groundMat, brickMat, steelMat, iceMat, waterMat, roadMat, treeMat, trunkMat]) m.dispose();
      groundTex.dispose();
      waterTex.dispose();
    },
  };
}

export default createFieldMeshes;
