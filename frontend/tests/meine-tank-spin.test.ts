// meine-tank-spin.test.ts — regression: animals must not rotate in place forever.
// Reproduces the old bug (per-frame heading nudges at the arena bounds) by running the
// fauna in a comb maze where mobs constantly reach the border.
import { test } from "node:test";
import assert from "node:assert";
import * as THREE from "three";
import { createFauna } from "../src/render/drivers/meine-tank/fauna/manager.ts";
import { normalizeMtOptions } from "../src/render/drivers/meine-tank/options.ts";
import type { RenderBounds } from "../src/render/types.ts";

test("meine-tank: фауна не закручивается на месте у границ арены", () => {
  const orig = Math.random;
  let seed = 99;
  Math.random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  try {
    const bounds: RenderBounds = { col0: 2, row0: 2, cols: 26, rows: 26 };
    const opts = normalizeMtOptions({ fauna: "lively", faunaDensity: 2, outerWorld: "off" });
    // Comb: every 3rd column is a wall, so animals constantly bounce off edges/corners.
    const walkable = (x: number, z: number): boolean => {
      const c = Math.floor(x);
      const r = Math.floor(z);
      if (c <= 0 || r <= 0 || c >= 25 || r >= 25) return false;
      return c % 3 !== 0;
    };
    const speciesOf = new Map<THREE.Object3D, string>();
    let hookCalls = 0;
    const fauna = createFauna({
      createMob: (species) => {
        const group = new THREE.Group();
        speciesOf.set(group, species);
        return { group, bones: new Map<string, THREE.Group>(), dispose() {} };
      },
      getBounds: () => bounds,
      getOptions: () => opts,
      getTankPositions: () => [],
      walkableAt: walkable,
      onSpin: () => {
        hookCalls++;
      },
      terrain: { enabled: false, heightAt: () => 0, contains: () => false },
    });

    interface Track {
      yaw: number;
      n: number;
      x0: number;
      z0: number;
      x: number;
      z: number;
      py: number;
    }
    const tracks = new Map<THREE.Object3D, Track>();
    const WINDOW = 90;
    const spins: string[] = [];
    for (let i = 0; i < 5000; i++) {
      fauna.update(16, i * 16);
      for (const child of fauna.group.children) {
        if (!child.visible) continue;
        let t = tracks.get(child);
        if (!t) {
          t = { yaw: 0, n: 0, x0: child.position.x, z0: child.position.z, x: child.position.x, z: child.position.z, py: child.rotation.y };
          tracks.set(child, t);
        }
        let d = child.rotation.y - t.py;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        t.py = child.rotation.y;
        t.yaw += d;
        t.n++;
        t.x = child.position.x;
        t.z = child.position.z;
        const moved = Math.hypot(t.x - t.x0, t.z - t.z0);
        if (t.n >= WINDOW) {
          if (Math.abs(t.yaw) > Math.PI * 2 && moved < 0.35) {
            spins.push(`${speciesOf.get(child)}: ${(t.yaw / (Math.PI * 2)).toFixed(1)} об. на ${moved.toFixed(2)} ед.`);
          }
          t.yaw = 0;
          t.n = 0;
          t.x0 = t.x;
          t.z0 = t.z;
        }
      }
    }
    assert.deepStrictEqual(spins, [], `закручивания на месте:\n${spins.join("\n")}`);
    assert.ok(hookCalls < 100, `слишком много резких разворотов на месте: ${hookCalls}`);
    fauna.dispose();
  } finally {
    Math.random = orig;
  }
});
