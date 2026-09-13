// animated.ts — animated block textures from vertical strips (water_still / water_flow).
// A frame is selected via texture offset; geometry uses UV 0..1 per quad.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/textures/animated.ts
import * as THREE from "three";
import type { TextureStore } from "./loader.ts";

export interface AnimatedTexture {
  texture: THREE.Texture;
  frames: number;
  /** Select a frame (wraps). */
  setFrame(frame: number): void;
}

export interface AnimatedSet {
  names: string[];
  get(name: string): AnimatedTexture | undefined;
  /** Advance all animations from a millisecond timestamp. */
  update(timeMs: number): void;
  dispose(): void;
}

/** Minecraft default: one animation frame per 2 game ticks (~100 ms). */
const FRAME_MS = 100;

export function createAnimatedTextures(store: TextureStore): AnimatedSet {
  const map = new Map<string, AnimatedTexture>();
  for (const t of store.all.values()) {
    if (!t.asset.animated || t.frames <= 1) continue;
    const texture = new THREE.Texture(t.image);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.repeat.set(1, 1 / t.frames);
    texture.needsUpdate = true;
    const at: AnimatedTexture = {
      texture,
      frames: t.frames,
      setFrame(frame: number) {
        const f = ((frame % t.frames) + t.frames) % t.frames;
        texture.offset.set(0, f / t.frames);
      },
    };
    at.setFrame(0);
    map.set(t.asset.name, at);
  }

  return {
    names: [...map.keys()],
    get: (name) => map.get(name),
    update(timeMs) {
      const frame = Math.floor(timeMs / FRAME_MS);
      for (const at of map.values()) at.setFrame(frame);
    },
    dispose() {
      for (const at of map.values()) at.texture.dispose();
      map.clear();
    },
  };
}

export default createAnimatedTextures;
