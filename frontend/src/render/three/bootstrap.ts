// bootstrap.ts — общий каркас three-сцены для 3D-драйверов: renderer/scene/camera/resize.
//
// Относительный путь: ./frontend/src/render/three/bootstrap.ts
import * as THREE from "three";
import type { RenderHost } from "../types.ts";

export interface ThreeBootstrap {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize(width: number, height: number): void;
  dispose(): void;
}

export function createThreeBootstrap(host: RenderHost, opts: { fov?: number; clear?: number } = {}): ThreeBootstrap {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(host.width, host.height, false);
  renderer.setClearColor(opts.clear ?? 0x87ceeb, 1);
  renderer.domElement.className = "webgl";
  host.container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 70, host.width / Math.max(1, host.height), 0.1, 1000);

  return {
    renderer,
    scene,
    camera,
    resize(width: number, height: number) {
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },
    dispose() {
      renderer.domElement.remove();
      try {
        renderer.forceContextLoss();
      } catch {
        /* ignore */
      }
      renderer.dispose();
    },
  };
}

export default createThreeBootstrap;
