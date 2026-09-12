// materials.ts — материалы воксельного драйвера: единый атлас на несколько проходов
// (opaque / cutout / water), запечённое AO через vertexColors, волна воды в вершинном
// шейдере (onBeforeCompile).
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/materials.ts
import * as THREE from "three";
import type { TextureAtlas } from "./atlas.ts";

export interface VoxelMaterials {
  atlas: TextureAtlas;
  opaque: THREE.MeshLambertMaterial;
  cutout: THREE.MeshLambertMaterial;
  water: THREE.MeshLambertMaterial;
  line: THREE.LineBasicMaterial;
  setWaterTime(ms: number): void;
  dispose(): void;
}

export function createMaterials(atlas: TextureAtlas, opts: { water: boolean }): VoxelMaterials {
  const common = { map: atlas.texture, vertexColors: true };
  const opaque = new THREE.MeshLambertMaterial({ ...common, side: THREE.FrontSide });
  const cutout = new THREE.MeshLambertMaterial({ ...common, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  const water = new THREE.MeshLambertMaterial({
    ...common,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const line = new THREE.LineBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.35 });

  let waterShader: { uniforms: { uTime: { value: number } } } | null = null;
  if (opts.water) {
    water.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.vertexShader = "uniform float uTime;\n" + shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" +
          "transformed.y += sin(position.x * 1.7 + uTime * 0.0022) * 0.035 + cos(position.z * 1.3 + uTime * 0.0027) * 0.035;",
      );
      waterShader = shader as unknown as { uniforms: { uTime: { value: number } } };
    };
    water.needsUpdate = true;
  }

  return {
    atlas,
    opaque,
    cutout,
    water,
    line,
    setWaterTime(ms: number) {
      if (waterShader) waterShader.uniforms.uTime.value = ms;
    },
    dispose() {
      for (const m of [opaque, cutout, water, line]) m.dispose();
      atlas.texture.dispose();
    },
  };
}

export default createMaterials;
