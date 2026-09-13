// geometry.ts — build a Minecraft entity model (Bedrock-style geometry) from box-UV
// boxes, grouped by bones so parts can be animated.
//
// Model units are vanilla texels; the root group scales them to field-cell units
// (16 texels = 1 block). Faithful skins are 2x vanilla but UV fractions are unchanged.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/models/mobs/geometry.ts
import * as THREE from "three";
import { boxUV, type BoxRect } from "./boxuv.ts";

export interface MobCube {
  origin: [number, number, number];
  size: [number, number, number];
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
  /** Cube rotation in Bedrock degrees; rotated about `pivot` (or the cube center). */
  rotation?: [number, number, number];
  /** Rotation pivot in model space (Bedrock `pivot`). */
  pivot?: [number, number, number];
}

export interface MobBone {
  name: string;
  parent?: string;
  pivot: [number, number, number];
  rotation?: [number, number, number];
  cubes?: MobCube[];
}

export interface MobGeometry {
  texWidth: number;
  texHeight: number;
  bones: MobBone[];
}

export interface MobInstance {
  group: THREE.Group;
  bones: Map<string, THREE.Group>;
  dispose(): void;
}

const DEG = Math.PI / 180;

export function createMob(geom: MobGeometry, material: THREE.Material, shadows = false): MobInstance {
  const root = new THREE.Group();
  root.scale.setScalar(1 / 16);
  const boneGroups = new Map<string, THREE.Group>();
  const geometries: THREE.BufferGeometry[] = [];
  const pivotOf = new Map<string, [number, number, number]>();
  for (const b of geom.bones) pivotOf.set(b.name, b.pivot);

  for (const bone of geom.bones) {
    const g = new THREE.Group();
    // Bedrock pivots are absolute in model space; make them relative to the parent bone.
    const parentPivot = bone.parent ? (pivotOf.get(bone.parent) ?? [0, 0, 0]) : [0, 0, 0];
    g.position.set(bone.pivot[0] - parentPivot[0], bone.pivot[1] - parentPivot[1], bone.pivot[2] - parentPivot[2]);
    if (bone.rotation) g.rotation.set(bone.rotation[0] * DEG, bone.rotation[1] * DEG, bone.rotation[2] * DEG);
    boneGroups.set(bone.name, g);
    const parent = bone.parent ? boneGroups.get(bone.parent) : undefined;
    (parent ?? root).add(g);
  }

  for (const bone of geom.bones) {
    const g = boneGroups.get(bone.name);
    if (!g) continue;
    for (const cube of bone.cubes ?? []) {
      const [w, h, d] = cube.size;
      const geo = boxUV(w, h, d, { u: cube.uv[0], v: cube.uv[1] } as BoxRect, {
        texWidth: geom.texWidth,
        texHeight: geom.texHeight,
        mirror: cube.mirror,
        inflate: cube.inflate && cube.inflate > 0 ? cube.inflate : 0,
      });
      geometries.push(geo);
      const mesh = new THREE.Mesh(geo, material);
      const centerRel = new THREE.Vector3(
        cube.origin[0] + w / 2 - bone.pivot[0],
        cube.origin[1] + h / 2 - bone.pivot[1],
        cube.origin[2] + d / 2 - bone.pivot[2],
      );
      let pos = centerRel;
      if (cube.rotation) {
        // Bedrock rotations are the opposite sign of three.js for the same visual result.
        const euler = new THREE.Euler(-cube.rotation[0] * DEG, -cube.rotation[1] * DEG, -cube.rotation[2] * DEG);
        const pivotRel = cube.pivot
          ? new THREE.Vector3(
              cube.pivot[0] - bone.pivot[0],
              cube.pivot[1] - bone.pivot[1],
              cube.pivot[2] - bone.pivot[2],
            )
          : centerRel;
        const v = centerRel.clone().sub(pivotRel).applyEuler(euler);
        pos = pivotRel.clone().add(v);
        mesh.rotation.copy(euler);
      }
      mesh.position.copy(pos);
      if (shadows) mesh.castShadow = true;
      g.add(mesh);
    }
  }

  return {
    group: root,
    bones: boneGroups,
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}

export default createMob;
