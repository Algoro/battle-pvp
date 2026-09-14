// raytracing.ts — experimental "ray-traced" lighting for the `meine-tank` driver.
//
// Real hardware ray tracing is not available in WebGL, so this approximates it with a
// screen-space pipeline built from three's addons:
//   RenderPass → GTAO (ground-truth ambient occlusion) → SSR (screen-space reflections)
//   → UnrealBloom → SMAA → OutputPass (ACES tonemapping)
// plus an image-based lighting environment generated from a painted sky gradient.
// It is display-only and opt-in via the `rayTracing` setting ("on" | "ultra").
//
// Relative path: ./frontend/src/render/drivers/meine-tank/post/raytracing.ts
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { SSRPass } from "three/examples/jsm/postprocessing/SSRPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

export type MtRayTracingQuality = "on" | "ultra";

export interface RayTracingPipeline {
  render(): void;
  setSize(width: number, height: number): void;
  dispose(): void;
}

/** Image-based lighting: a small equirectangular sky gradient turned into a PMREM env. */
function createSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture | null {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0, "#3f7fd0");
  grad.addColorStop(0.48, "#bcd8f2");
  grad.addColorStop(0.52, "#93b46f");
  grad.addColorStop(1, "#40592f");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const equirect = new THREE.CanvasTexture(canvas);
  equirect.mapping = THREE.EquirectangularReflectionMapping;
  equirect.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(equirect).texture;
  pmrem.dispose();
  equirect.dispose();
  return env;
}

export interface RayTracingSources {
  /** Meshes allowed to receive reflections (water + ice) — everything else must stay matte. */
  reflectiveMeshes(): THREE.Mesh[];
  /** Changes when the field is remeshed, so the reflection list can be refreshed. */
  chunkVersion(): number;
}

export function createRayTracing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  quality: MtRayTracingQuality,
  size: { width: number; height: number },
  sources: RayTracingSources,
): RayTracingPipeline {
  const ultra = quality === "ultra";
  const width = Math.max(1, Math.floor(size.width));
  const height = Math.max(1, Math.floor(size.height));

  const composer = new EffectComposer(renderer);

  composer.addPass(new RenderPass(scene, camera));

  const gtao = new GTAOPass(scene, camera, width, height);
  gtao.output = GTAOPass.OUTPUT.Default;
  gtao.blendIntensity = ultra ? 1.15 : 1.0;
  gtao.updateGtaoMaterial({
    radius: 1.1,
    distanceExponent: 1,
    thickness: 1,
    scale: 1,
    samples: ultra ? 32 : 16,
    screenSpaceRadius: false,
  });
  composer.addPass(gtao);

  const ssr = new SSRPass({ renderer, scene, camera, width, height, selects: null, groundReflector: null });
  ssr.opacity = ultra ? 0.6 : 0.45;
  // Long enough to keep tall/far geometry (trees, hills, the flying dragon, volcano smoke)
  // in reflections; the three.js default is 180, a small value drops them entirely.
  ssr.maxDistance = ultra ? 150 : 100;
  ssr.thickness = 0.02;
  ssr.blur = true;
  ssr.distanceAttenuation = true;
  ssr.fresnel = true;
  composer.addPass(ssr);

  // Selective reflections: only water/ice meshes get a metalness of 1 in the SSR mask,
  // so walls and grass stay matte. With an empty list SSR is disabled completely —
  // passing `null` would switch the pass to non-selective and reflect the whole scene.
  let reflectionVersion = -1;
  function refreshSelects(): void {
    const v = sources.chunkVersion();
    if (v === reflectionVersion) return;
    reflectionVersion = v;
    const list = sources.reflectiveMeshes();
    ssr.selects = list;
    ssr.enabled = list.length > 0;
    (globalThis as { __mtRtInfo?: unknown }).__mtRtInfo = {
      selective: ssr.selective,
      enabled: ssr.enabled,
      selects: list.length,
    };
  }
  refreshSelects();

  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), ultra ? 0.4 : 0.25, 0.4, ultra ? 0.85 : 0.9);
  composer.addPass(bloom);

  composer.addPass(new SMAAPass());
  composer.addPass(new OutputPass());

  // Size every pass only after they are all attached. Cap the render scale so HiDPI
  // screens don't multiply the (already heavy) screen-space passes.
  composer.setPixelRatio(Math.min(renderer.getPixelRatio(), ultra ? 1.25 : 1));
  composer.setSize(width, height);

  const env = createSkyEnvironment(renderer);
  if (env) scene.environment = env;
  scene.environmentIntensity = ultra ? 0.5 : 0.35;

  let disposed = false;
  return {
    render() {
      if (disposed) return;
      refreshSelects();
      composer.render();
    },
    setSize(nextWidth, nextHeight) {
      composer.setSize(Math.max(1, Math.floor(nextWidth)), Math.max(1, Math.floor(nextHeight)));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.environment = null;
      env?.dispose();
      gtao.dispose();
      ssr.dispose();
      bloom.dispose();
      composer.dispose();
    },
  };
}

export default createRayTracing;
