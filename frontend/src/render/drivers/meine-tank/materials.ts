// materials.ts — PBR materials for the `meine-tank` field: opaque / cutout /
// translucent / water (animated, with a wave in the vertex shader) / lava.
// Procedural normal maps add surface relief from the albedo.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/materials.ts
import * as THREE from "three";
import type { Atlas } from "./textures/atlas.ts";
import type { AnimatedSet } from "./textures/animated.ts";

export type MtGlassMode = "off" | "on" | "ultra";

export interface MtMaterials {
  opaque: THREE.MeshStandardMaterial;
  cutout: THREE.MeshStandardMaterial;
  translucent: THREE.MeshStandardMaterial;
  water: THREE.MeshPhysicalMaterial;
  lava: THREE.MeshStandardMaterial;
  line: THREE.LineBasicMaterial;
  /** Called once per frame with the animation time (ms). */
  setWaterTime(ms: number): void;
  /** Tune water/ice for the experimental ray-tracing mode (refraction, gloss). */
  setGlassMode(mode: MtGlassMode): void;
  dispose(): void;
}

export function createMaterials(
  blockAtlas: Atlas,
  animated: AnimatedSet,
  normals: boolean,
  glass: MtGlassMode = "off",
): MtMaterials {
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
  // Physical material: in `ultra` ray tracing it uses true screen-space transmission
  // (refraction of the pond bottom) plus an IBL reflection.
  const water = new THREE.MeshPhysicalMaterial({
    map: waterMap,
    transparent: true,
    opacity: 0.75,
    depthWrite: false,
    side: THREE.DoubleSide,
    roughness: 0.12,
    metalness: 0.15,
    color: 0x3f76e4,
    vertexColors: true,
    ior: 1.33,
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

  function setGlassMode(mode: MtGlassMode): void {
    if (mode === "off") {
      water.transmission = 0;
      water.transparent = true;
      water.depthWrite = false;
      water.opacity = 0.75;
      water.roughness = 0.12;
      water.metalness = 0.15;
      water.thickness = 0;
      water.envMapIntensity = 1;
      translucent.roughness = 0.25;
      translucent.metalness = 0;
      translucent.opacity = 0.82;
      translucent.envMapIntensity = 1;
    } else {
      const ultra = mode === "ultra";
      // ultra: true screen-space refraction (transmission); on: glossy see-through water.
      water.transmission = ultra ? 0.9 : 0;
      water.transparent = !ultra;
      water.depthWrite = ultra;
      water.opacity = ultra ? 1 : 0.55;
      water.roughness = ultra ? 0.04 : 0.06;
      water.metalness = ultra ? 0 : 0.05;
      water.thickness = ultra ? 2.5 : 0;
      water.attenuationColor.setHex(0x2f6fb0);
      water.attenuationDistance = 4;
      water.envMapIntensity = 1.25;
      translucent.roughness = 0.05;
      translucent.metalness = 0.3;
      translucent.opacity = ultra ? 0.62 : 0.7;
      translucent.envMapIntensity = 1.3;
    }
    water.needsUpdate = true;
    translucent.needsUpdate = true;
  }

  setGlassMode(glass);

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
    setGlassMode,
    dispose() {
      for (const m of [opaque, cutout, translucent, water, lava, line]) m.dispose();
    },
  };
}

export default createMaterials;
