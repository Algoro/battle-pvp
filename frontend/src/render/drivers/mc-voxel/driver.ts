// driver.ts — драйвер рендера `mc-voxel`: воксельный «sandbox» look (кубические блоки,
// пиксельные текстуры, небо/день-ночь, вода, частицы). Читает только SceneState.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/driver.ts
import * as THREE from "three";
import { createThreeBootstrap, type ThreeBootstrap } from "../../three/bootstrap.ts";
import { attachCameraControls } from "../../camera-controls.ts";
import { tankCenter, cellCenter, fieldCenter, FACING, followYaw } from "../../coords.ts";
import { buildAtlas, type TextureAtlas } from "./atlas.ts";
import { createMaterials, type VoxelMaterials } from "./materials.ts";
import { createFieldWorld, type FieldWorld } from "./world/field.ts";
import { createVoxelTank, type VoxelTank } from "./models/tank.ts";
import { createVoxelBase, type VoxelBase } from "./models/base.ts";
import { createVoxelProps, type VoxelProps } from "./models/props.ts";
import { createSky, type Sky } from "./sky/sky.ts";
import { createParticles, type VoxelParticles } from "./fx/particles.ts";
import { createAmbient, type VoxelAmbient } from "./ambient.ts";
import { normalizeMcOptions, type McVoxelOptions } from "./options.ts";
import type { RenderDriver, RenderHost, SceneState } from "../../types.ts";

const BRICK_COLOR = 0x9b4f2a;
const STEEL_COLOR = 0xb7bec7;
const ICE_COLOR = 0xbfe4ff;

export function createMcVoxelDriver(): RenderDriver {
  let host: RenderHost | null = null;
  let boot: ThreeBootstrap | null = null;
  let options: McVoxelOptions = normalizeMcOptions(null);
  let atlas: TextureAtlas | null = null;
  let materials: VoxelMaterials | null = null;
  let field: FieldWorld | null = null;
  let base: VoxelBase | null = null;
  let props: VoxelProps | null = null;
  let sky: Sky | null = null;
  let particles: VoxelParticles | null = null;
  let ambient: VoxelAmbient | null = null;
  let tanks: VoxelTank[] = [];
  let root: THREE.Group | null = null;
  let world: THREE.Group | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  let sun: THREE.DirectionalLight | null = null;
  let fogObj: THREE.FogExp2 | null = null;
  let detachControls: (() => void) | null = null;
  let vignette: HTMLDivElement | null = null;

  let state: SceneState | null = null;
  let prevField: Uint8Array | null = null;
  let prevBullets: { x: number; y: number }[] = [];
  const explodeTimer: number[] = new Array(8).fill(0);
  let time = 0;
  const _q = new THREE.Quaternion();

  function center(): { x: number; z: number } {
    return fieldCenter(state?.bounds ?? { col0: 2, row0: 2, cols: 26, rows: 26 });
  }

  function initWorld(): void {
    if (!host || !boot) return;
    const c = center();
    atlas = buildAtlas(options.textureSize);
    materials = createMaterials(atlas, { water: options.water !== "off" });

    root = new THREE.Group();
    root.position.set(c.x, 0, c.z);
    boot.scene.add(root);
    world = new THREE.Group();
    world.position.set(-c.x, 0, -c.z);
    root.add(world);

    field = createFieldWorld(materials, { ao: options.ao, outline: options.outline, shadows: options.shadows === "soft" });
    base = createVoxelBase(atlas, options.shadows === "soft");
    props = createVoxelProps(atlas);
    sky = createSky();
    particles = createParticles();
    ambient = createAmbient(atlas);
    tanks = Array.from({ length: 8 }, () => createVoxelTank(atlas!, options.shadows === "soft"));
    world.add(field.group, base.group, props.group, particles.points, ambient.group);
    for (const t of tanks) world.add(t.group);
    boot.scene.add(sky.group);

    hemi = new THREE.HemisphereLight(0xa9c8ee, 0x3a2f22, 0.9);
    sun = new THREE.DirectionalLight(0xfff6e0, 1.6);
    boot.scene.add(hemi, sun, sun.target);

    if (options.shadows === "soft") {
      boot.renderer.shadowMap.enabled = true;
      boot.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      const sc = sun.shadow.camera as THREE.OrthographicCamera;
      sc.left = -22; sc.right = 22; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 160;
      sc.updateProjectionMatrix();
    }

    host.shared.three = { THREE, scene: boot.scene, camera: boot.camera, renderer: boot.renderer, root, world };
  }

  function teardownWorld(): void {
    if (boot && root) boot.scene.remove(root);
    if (boot && sky) boot.scene.remove(sky.group);
    if (boot && hemi) boot.scene.remove(hemi);
    if (boot && sun) boot.scene.remove(sun, sun.target);
    if (boot) boot.scene.fog = null;
    fogObj = null;
    field?.dispose();
    base?.dispose();
    props?.dispose();
    sky?.dispose();
    particles?.dispose();
    ambient?.dispose();
    for (const t of tanks) t.dispose();
    tanks = [];
    materials?.dispose();
    root = null;
    world = null;
    field = null;
    base = null;
    props = null;
    sky = null;
    particles = null;
    ambient = null;
    hemi = null;
    sun = null;
    atlas = null;
    materials = null;
    prevField = null;
    prevBullets = [];
  }

  function applyVignette(): void {
    if (!host) return;
    if (options.vignette && !vignette) {
      vignette = document.createElement("div");
      vignette.className = "mc-vignette";
      host.container.appendChild(vignette);
    } else if (!options.vignette && vignette) {
      vignette.remove();
      vignette = null;
    }
  }

  function fogDensity(): number {
    return options.fog <= 0 ? 0 : 0.002 + options.fog * 0.02;
  }

  return {
    id: "mc-voxel",
    mount(nextHost: RenderHost) {
      host = nextHost;
      boot = createThreeBootstrap(nextHost, { fov: options.fov, clear: 0x0c1428 });
      initWorld();
      applyVignette();
      detachControls = attachCameraControls(nextHost.container, nextHost.camera);
    },

    setOptions(raw: unknown) {
      const next = normalizeMcOptions(raw);
      const structural = next.textureSize !== options.textureSize || next.shadows !== options.shadows;
      const modeChanged = next.cameraMode !== options.cameraMode;
      options = next;
      if (structural) {
        teardownWorld();
        initWorld();
        applyVignette();
      } else {
        field?.configure({ ao: options.ao, outline: options.outline });
        if (boot) boot.camera.fov = options.fov;
        if (boot) boot.camera.updateProjectionMatrix();
        applyVignette();
      }
      // Смена режима камеры: орбита смотрит вниз (pitch≈60°), «из глаз» — почти горизонтально,
      // «от третьего лица» — средний наклон и небольшая дистанция до танка.
      if (modeChanged && host) {
        host.camera.roll = 0;
        if (options.cameraMode === "first") {
          host.camera.pitch = 0.2;
        } else if (options.cameraMode === "third") {
          host.camera.pitch = 0.45;
          host.camera.distance = 4.5;
        } else {
          host.camera.pitch = 1.05;
          host.camera.distance = 34;
        }
      }
    },

    setScene(next: SceneState) {
      state = next;
    },

    resize(width: number, height: number) {
      boot?.resize(width, height);
    },

    render(dtMs: number) {
      if (!boot || !host || !root || !world || !field || !base || !props || !sky || !particles || !ambient || !materials || !state || !atlas) {
        return;
      }
      time += dtMs;

      // Поле: сначала применяем режимы (ao/outline), затем пересобираем dirty-чанки.
      field.configure({ ao: options.ao, outline: options.outline });
      field.update(state.field, state.bounds);

      // Танки.
      for (let i = 0; i < tanks.length; i++) {
        const t = state.tanks[i];
        const model = tanks[i];
        if (!t || t.state === "dead") {
          model.group.visible = false;
          continue;
        }
        const p = tankCenter(state.bounds, t.x, t.y);
        model.group.position.set(p.x, 0, p.z);
        model.update(t, dtMs, time);
      }

      base.update(state.eagle, state.bounds, time);
      props.update(state, time);

      // События для частиц.
      if (options.particles > 0) {
        const mult = options.particles;
        if (prevField && prevField.length === state.field.length) {
          for (let r = state.bounds.row0; r < state.bounds.row0 + state.bounds.rows; r++) {
            for (let c = state.bounds.col0; c < state.bounds.col0 + state.bounds.cols; c++) {
              const idx = r * 32 + c;
              const before = prevField[idx];
              const now = state.field[idx];
              if (before === now || now !== 0) continue;
              const cc = cellCenter(state.bounds, c, r);
              const color = before === 0x12 ? ICE_COLOR : before >= 0x10 && before <= 0x11 ? STEEL_COLOR : BRICK_COLOR;
              particles.burst(cc.x, 0.4, cc.z, color, 4 * mult);
            }
          }
        }
        // Мелкая пыль/искры из-под гусениц и вспышки выстрелов.
        const fly = state.bullets.filter((b) => !prevBullets.some((p) => Math.abs(p.x - b.x) < 3 && Math.abs(p.y - b.y) < 3));
        for (const b of fly) {
          const gx = b.x / 8 - state.bounds.col0 + 0.5;
          const gz = b.y / 8 - state.bounds.row0 + 0.5;
          particles.burst(gx, 0.6, gz, 0xffd24a, 3 * mult);
        }
        prevBullets = state.bullets.map((b) => ({ x: b.x, y: b.y }));
        for (let i = 0; i < tanks.length; i++) {
          const t = state.tanks[i];
          if (t && t.state === "exploding") {
            explodeTimer[i] += dtMs;
            if (explodeTimer[i] > 70) {
              explodeTimer[i] = 0;
              const p = tankCenter(state.bounds, t.x, t.y);
              particles.burst(p.x, 0.7, p.z, 0xff8a1a, 8 * mult);
              particles.burst(p.x, 0.7, p.z, 0x555555, 4 * mult);
            }
          } else {
            explodeTimer[i] = 0;
          }
        }
      }
      prevField = state.field.slice();
      particles.update(dtMs);
      // «Живой мир»: птицы, мышки, блочные облака.
      ambient.update(dtMs, state.bounds, time);
      ambient.setBirds(options.birds);
      ambient.setMice(options.mice);
      ambient.setVoxelClouds(options.clouds === "voxel");

      // Небо/свет/туман.
      sky.setClouds(options.clouds === "flat");
      sky.setCloudDrift(options.cloudsDrift);
      const day = sky.update(options.time, dtMs, time);
      if (hemi && sun) {
        hemi.color.setHex(day.ambientColor);
        hemi.intensity = options.lighting === "flat" ? Math.max(day.ambientIntensity, 1.1) : day.ambientIntensity;
        sun.color.setHex(day.sunColor);
        sun.intensity = options.lighting === "flat" ? Math.max(day.sunIntensity, 1.2) : day.sunIntensity;
        const c = center();
        sun.position.set(c.x + day.sunDir.x * 60, day.sunDir.y * 60, c.z + day.sunDir.z * 60);
        sun.target.position.set(c.x, 0, c.z);
      }
      const density = fogDensity();
      if (density > 0) {
        if (!fogObj) {
          fogObj = new THREE.FogExp2(day.fogColor, density);
          boot.scene.fog = fogObj;
        } else {
          fogObj.color.setHex(day.fogColor);
          fogObj.density = density;
        }
      } else if (fogObj) {
        boot.scene.fog = null;
        fogObj = null;
      }
      boot.renderer.setClearColor(day.fogColor, 1);

      materials.setWaterTime(options.water === "animated" ? time : 0);

      const fe = host.camera.fieldEuler;
      root.rotation.set(fe.x, fe.y, fe.z);
      root.updateMatrixWorld(true);

      const rig = host.camera;
      const viewerTank = state.tanks[host.viewer.port];
      const tankVisible = !!viewerTank && viewerTank.state !== "dead" && viewerTank.state !== "exploding";

      // Плавный доворот камеры к направлению танка — во всех режимах (орбита/третье/из глаз),
      // если пользователь не крутит обзор вручную.
      if (options.cameraFollow && tankVisible) {
        const now = typeof performance !== "undefined" ? performance.now() : 0;
        if (now > rig.userHoldUntil) {
          const targetYaw = followYaw(viewerTank!.dir);
          let dd = targetYaw - rig.yaw;
          dd = Math.atan2(Math.sin(dd), Math.cos(dd));
          rig.yaw += dd * Math.min(1, dtMs * 0.0015);
        }
      }

      if (options.cameraMode === "first" && tankVisible) {
        // Вид «из глаз»: камера чуть впереди и над танком игрока, направление — из rig.
        const p = tankCenter(state.bounds, viewerTank!.x, viewerTank!.y);
        const f = FACING[viewerTank!.dir & 3];
        // Чуть впереди и над башней, чтобы камера не оказалась внутри модели танка.
        const eye = new THREE.Vector3(p.x + f.x * 0.55, 1.28, p.z + f.z * 0.55);
        world.localToWorld(eye);
        const cp = Math.cos(rig.pitch);
        const sp = Math.sin(rig.pitch);
        const dir = new THREE.Vector3(-cp * Math.sin(rig.yaw), -sp, -cp * Math.cos(rig.yaw)).normalize();
        world.getWorldQuaternion(_q);
        dir.applyQuaternion(_q);
        boot.camera.position.copy(eye);
        boot.camera.up.set(0, 1, 0);
        boot.camera.lookAt(eye.x + dir.x, eye.y + dir.y, eye.z + dir.z);
      } else if (options.cameraMode === "third" && tankVisible) {
        // Вид от третьего лица: камера вращается вокруг танка игрока (yaw/pitch/zoom rig).
        const p = tankCenter(state.bounds, viewerTank!.x, viewerTank!.y);
        const target = new THREE.Vector3(p.x, 0.8, p.z);
        world.localToWorld(target);
        const d = Math.max(2.5, Math.min(14, rig.distance));
        const cp = Math.cos(rig.pitch);
        const sp = Math.sin(rig.pitch);
        const off = new THREE.Vector3(cp * Math.sin(rig.yaw), sp, cp * Math.cos(rig.yaw)).multiplyScalar(d);
        world.getWorldQuaternion(_q);
        off.applyQuaternion(_q);
        boot.camera.position.set(target.x + off.x, target.y + off.y, target.z + off.z);
        boot.camera.up.set(0, 1, 0);
        boot.camera.lookAt(target.x, target.y + 0.25, target.z);
      } else {
        const cp = host.camera.position();
        boot.camera.position.set(cp.x, cp.y, cp.z);
        boot.camera.up.set(0, 1, 0);
        boot.camera.lookAt(host.camera.target.x, host.camera.target.y, host.camera.target.z);
      }
      if (host.camera.roll) boot.camera.rotateZ(host.camera.roll);
      if (boot.camera.fov !== options.fov) {
        boot.camera.fov = options.fov;
        boot.camera.updateProjectionMatrix();
      }

      boot.renderer.render(boot.scene, boot.camera);
    },

    dispose() {
      detachControls?.();
      detachControls = null;
      teardownWorld();
      vignette?.remove();
      vignette = null;
      if (host) delete host.shared.three;
      boot?.dispose();
      boot = null;
      host = null;
      state = null;
    },
  };
}

export default createMcVoxelDriver;
