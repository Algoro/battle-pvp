// materials.ts — PBR materials for the `meine-tank` field: opaque / cutout /
// translucent / water (animated, with a wave in the vertex shader) / lava.
// Procedural normal maps add surface relief from the albedo.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/materials.ts
import * as THREE from "three";
import type { Atlas } from "./textures/atlas.ts";
import type { AnimatedSet } from "./textures/animated.ts";

export interface MtMaterials {
  opaque: THREE.MeshStandardMaterial;
  cutout: THREE.MeshStandardMaterial;
  translucent: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  lava: THREE.MeshStandardMaterial;
  line: THREE.LineBasicMaterial;
  /** Called once per frame with the animation time (ms). */
  setWaterTime(ms: number): void;
  dispose(): void;
}

export function createMaterials(blockAtlas: Atlas, animated: AnimatedSet, normals: boolean): MtMaterials {
  const normalMap = normals ? blockAtlas.normal : null;
  const normalScale = new THREE.Vector2(normals ? 0.85 : 0, normals ? 0.85 : 0);
  const common = {
    map: blockAtlas.texture,
    normalMap,
    normalScale,
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.0,
  };
  const opaque = new THREE.MeshStandardMaterial({ ...common, side: THREE.FrontSide });
  const cutout = new THREE.MeshStandardMaterial({
    ...common,
    alphaTest: 0.5,
    side: THREE.DoubleSide,
    transparent: false,
  });
  const translucent = new THREE.MeshStandardMaterial({
    ...common,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.25,
  });
  const waterMap = animated.get("water_still")?.texture ?? blockAtlas.texture;
  const water = new THREE.MeshStandardMaterial({
    map: waterMap,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.15,
    color: 0x3f76e4,
  });
  const lavaMap = animated.get("lava_still")?.texture ?? blockAtlas.texture;
  const lava = new THREE.MeshStandardMaterial({
    map: lavaMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.75,
    emissiveMap: lavaMap,
    roughness: 0.6,
    side: THREE.DoubleSide,
  });
  const line = new THREE.LineBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.35 });

  let waterShader: { uniforms: { uTime: { value: number } } } | null = null;
  water.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.vertexShader =
      "uniform float uTime;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\n" +
          "transformed.y += sin(position.x * 1.6 + uTime * 0.0021) * 0.03 + cos(position.z * 1.3 + uTime * 0.0026) * 0.03;",
      );
    waterShader = shader as unknown as { uniforms: { uTime: { value: number } } };
  };
  water.needsUpdate = true;

  return {
    opaque,
    cutout,
    translucent,
    water,
    lava,
    line,
    setWaterTime(ms) {
      if (waterShader) waterShader.uniforms.uTime.value = ms;
    },
    dispose() {
      for (const m of [opaque, cutout, translucent, water, lava, line]) m.dispose();
    },
  };
}

export default createMaterials;
