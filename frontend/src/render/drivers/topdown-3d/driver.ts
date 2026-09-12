// driver.ts — драйвер рендера `topdown-3d`: объёмное поле сверху с масштабом и
// вращением по разным плоскостям. Читает только SceneState; игру не меняет.
//
// Относительный путь: ./frontend/src/render/drivers/topdown-3d/driver.ts
import * as THREE from "three";
import { attachCameraControls } from "../../camera-controls.ts";
import { createTank } from "./models/tank.ts";
import { createFieldMeshes } from "./models/terrain.ts";
import { createBase } from "./models/base.ts";
import { createProps } from "./models/props.ts";
import { tankCenter, fieldCenter } from "../../coords.ts";
import { towerCellCenter, towerToSceneTank } from "../../tower-visual.ts";

// Пул моделей башен tower defence (совпадает с shared TD_MAX_TOWERS).
const MAX_TOWERS = 16;
import { PLAY_BOUNDS } from "../../scene-state.ts";
import type { RenderDriver, RenderHost, SceneState } from "../../types.ts";

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function createTopdown3DDriver(): RenderDriver {
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.PerspectiveCamera | null = null;
  let root: THREE.Group | null = null;
  let field: ReturnType<typeof createFieldMeshes> | null = null;
  let base: ReturnType<typeof createBase> | null = null;
  let props: ReturnType<typeof createProps> | null = null;
  let tanks: ReturnType<typeof createTank>[] = [];
  let towerModels: ReturnType<typeof createTank>[] = [];
  let detachControls: (() => void) | null = null;
  let host: RenderHost | null = null;
  let state: SceneState | null = null;
  let lastField: Uint8Array | null = null;
  let time = 0;

  function rebuildField(s: SceneState): void {
    field?.update(s.field, s.bounds);
    lastField = s.field.slice();
  }

  return {
    id: "topdown-3d",
    mount(nextHost: RenderHost) {
      host = nextHost;
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
      renderer.setSize(nextHost.width, nextHost.height, false);
      renderer.domElement.className = "webgl";
      nextHost.container.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x05070b);

      camera = new THREE.PerspectiveCamera(42, nextHost.width / Math.max(1, nextHost.height), 0.1, 600);
      const center = fieldCenter(state?.bounds ?? PLAY_BOUNDS);

      scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x2a2118, 1.0));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(center.x + 14, 28, center.z + 10);
      sun.target.position.set(center.x, 0, center.z);
      scene.add(sun, sun.target);

      // Корень вращения — вокруг центра поля (fieldEuler).
      root = new THREE.Group();
      root.position.set(center.x, 0, center.z);
      scene.add(root);
      const world = new THREE.Group();
      world.position.set(-center.x, 0, -center.z);
      root.add(world);

      field = createFieldMeshes();
      base = createBase();
      props = createProps();
      tanks = Array.from({ length: 8 }, () => createTank());
      towerModels = Array.from({ length: MAX_TOWERS }, () => createTank());
      world.add(field.group, base.group, props.group);
      for (const t of tanks) world.add(t.group);
      for (const t of towerModels) world.add(t.group);

      nextHost.shared.three = { THREE, scene, camera, renderer, root, world };
      detachControls = attachCameraControls(nextHost.container, nextHost.camera);
    },

    setScene(next: SceneState) {
      state = next;
    },

    resize(width: number, height: number) {
      if (!renderer || !camera) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    },

    render(dtMs: number) {
      if (!renderer || !scene || !camera || !root || !field || !base || !props || !host || !state) return;
      time += dtMs;

      if (!lastField || !sameBytes(lastField, state.field)) rebuildField(state);
      field.tick(dtMs);

      for (let i = 0; i < tanks.length; i++) {
        const t = state.tanks[i];
        const model = tanks[i];
        if (!t || t.state === "dead") {
          model.group.visible = false;
          continue;
        }
        const c = tankCenter(state.bounds, t.x, t.y);
        model.group.position.set(c.x, 0, c.z);
        model.update(t, dtMs, time);
      }

      // Башни TD: неподвижные DEF-танки (модель танка, звёзды = уровень).
      for (let i = 0; i < towerModels.length; i++) {
        const tw = state.towers[i];
        const model = towerModels[i];
        if (!tw) {
          model.group.visible = false;
          continue;
        }
        const c = towerCellCenter(state.bounds, tw.cell);
        model.group.position.set(c.x, 0, c.z);
        model.update(towerToSceneTank(tw, i), dtMs, time);
      }

      base.update(state.eagle, state.bounds, time);
      props.update(state, time);

      const fe = host.camera.fieldEuler;
      root.rotation.set(fe.x, fe.y, fe.z);

      const pos = host.camera.position();
      camera.position.set(pos.x, pos.y, pos.z);
      camera.up.set(0, 1, 0);
      camera.lookAt(host.camera.target.x, host.camera.target.y, host.camera.target.z);
      if (host.camera.roll) camera.rotateZ(host.camera.roll);

      renderer.render(scene, camera);
    },

    dispose() {
      detachControls?.();
      detachControls = null;
      field?.dispose();
      base?.dispose();
      props?.dispose();
      for (const t of tanks) t.dispose();
      for (const t of towerModels) t.dispose();
      tanks = [];
      towerModels = [];
      if (host) delete host.shared.three;
      if (renderer) {
        renderer.domElement.remove();
        try {
          renderer.forceContextLoss();
        } catch {
          /* контекст уже потерян */
        }
        renderer.dispose();
      }
      renderer = null;
      scene = null;
      camera = null;
      root = null;
      host = null;
      state = null;
      lastField = null;
    },
  };
}

export default createTopdown3DDriver;
