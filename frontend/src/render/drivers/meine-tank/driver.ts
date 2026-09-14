// driver.ts — `meine-tank` render driver: a Minecraft-fidelity voxel world built from
// the curated Faithful texture set: real blocks, MC-style models, sky, particles and
// configurable fauna. Reads only the read-only SceneState.
//
// Relative path: ./frontend/src/render/drivers/meine-tank/driver.ts
import * as THREE from "three";
import { createThreeBootstrap, type ThreeBootstrap } from "../../three/bootstrap.ts";
import { attachCameraControls } from "../../camera-controls.ts";
import { tankCenter, cellCenter, fieldCenter, FACING, followYaw } from "../../coords.ts";
import { tankPassable } from "@core/domain.ts";
import { towerCellCenter, towerToSceneTank } from "../../tower-visual.ts";
import { loadTextureStore, type TextureStore } from "./textures/loader.ts";
import { buildAtlas, type Atlas } from "./textures/atlas.ts";
import { createAnimatedTextures, type AnimatedSet } from "./textures/animated.ts";
import { createMaterials, type MtMaterials } from "./materials.ts";
import { createFieldWorld, type FieldWorld } from "./world/field.ts";
import { createDecor, decorReadyToBuild, type Decor } from "./world/decor.ts";
import { createOuterWorld, type OuterWorld } from "./world/outer.ts";
import { createMtTank, type MtTank } from "./models/tank.ts";
import { createMtBase, type MtBase } from "./models/base.ts";
import { createMtProps, type MtProps } from "./models/props.ts";
import { createMob } from "./models/mobs/geometry.ts";
import { MOB_GEOMETRY, type MobSpecies } from "./models/mobs/defs.ts";
import { createFauna, type MtFauna } from "./fauna/manager.ts";
import { createSky, type MtSky } from "./sky/sky.ts";
import { createRayTracing, type RayTracingPipeline } from "./post/raytracing.ts";
import { createParticles, type MtParticles, type ParticleSprites } from "./fx/particles.ts";
import { particleSpriteRanges } from "./fx/sprites.ts";
import { normalizeMtOptions, type MtBiome, type MtBorder, type MtOptions, type MtOuterWorld } from "./options.ts";
import type { RenderDriver, RenderHost, SceneState } from "../../types.ts";

const BRICK_COLOR = 0x9b4f2a;
const STEEL_COLOR = 0xb7bec7;
const ICE_COLOR = 0xbfe4ff;
const PARROT_SKINS = ["parrot_green", "parrot_blue", "parrot_grey", "parrot_red_blue", "parrot_yellow_blue"];
const WORLD_SEED = 1337;
const DEFAULT_BOUNDS = { col0: 2, row0: 2, cols: 26, rows: 26 } as const;

function entityTexture(store: TextureStore, name: string): THREE.Texture | null {
  const t = store.get(name);
  if (!t) return null;
  const tex = new THREE.Texture(t.image);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  // Dragon wing UVs use negative coordinates, so wrap instead of clamp.
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

function outerOptionsFrom(o: MtOptions): {
  world: MtOuterWorld;
  border: MtBorder;
  biome: MtBiome;
  radius: number;
  rivers: boolean;
  trees: boolean;
  volcano: boolean;
} {
  return {
    world: o.outerWorld,
    border: o.border,
    biome: o.outerBiome,
    radius: o.outerRadius,
    rivers: o.outerRivers,
    trees: o.outerTrees,
    volcano: o.outerVolcano,
  };
}

export function createMeineTankDriver(): RenderDriver {
  let host: RenderHost | null = null;
  let boot: ThreeBootstrap | null = null;
  let options: MtOptions = normalizeMtOptions(null);
  let store: TextureStore | null = null;
  let blockAtlas: Atlas | null = null;
  let itemAtlas: Atlas | null = null;
  let particleAtlas: Atlas | null = null;
  let animated: AnimatedSet | null = null;
  let materials: MtMaterials | null = null;
  let field: FieldWorld | null = null;
  let decor: Decor | null = null;
  let outer: OuterWorld | null = null;
  let base: MtBase | null = null;
  let props: MtProps | null = null;
  let sky: MtSky | null = null;
  let particles: MtParticles | null = null;
  let fauna: MtFauna | null = null;
  let tanks: MtTank[] = [];
  let towerModels: MtTank[] = [];
  const MAX_TOWERS = 16;
  const mobMaterials = new Map<string, THREE.MeshStandardMaterial>();
  const mobTextures: THREE.Texture[] = [];
  let root: THREE.Group | null = null;
  let world: THREE.Group | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  let sun: THREE.DirectionalLight | null = null;
  let fogObj: THREE.FogExp2 | null = null;
  let detachControls: (() => void) | null = null;
  let buildToken = 0;
  let ready = false;

  let state: SceneState | null = null;
  let prevField: Uint8Array | null = null;
  let decorReady = false;
  let decorPending = true;
  let decorPendingFrames = 0;
  let rt: RayTracingPipeline | null = null;
  let outerRebuilds = 0;
  let fieldStableFrames = 0;
  let arenaFrames = 0;
  let prevBullets: { x: number; y: number }[] = [];
  const explodeTimer: number[] = new Array(8).fill(0);
  let smokeAccum = 0;
  let time = 0;
  const _q = new THREE.Quaternion();
  const _sunDir = new THREE.Vector3();

  function center(): { x: number; z: number } {
    return fieldCenter(state?.bounds ?? { col0: 2, row0: 2, cols: 26, rows: 26 });
  }

  function mobMaterial(species: MobSpecies): THREE.MeshStandardMaterial {
    const key =
      species === "parrot"
        ? PARROT_SKINS[Math.floor(Math.random() * PARROT_SKINS.length)]
        : species === "fox"
          ? Math.random() < 0.5
            ? "fox"
            : "fox_snow"
          : species === "rabbit"
            ? "rabbit_brown"
            : species;
    let mat = mobMaterials.get(key);
    if (mat) return mat;
    const tex = store ? entityTexture(store, key) : null;
    // PBR + cutout (NOT transparent): alpha-tested entities stay in the opaque queue, so
    // they receive IBL, cast shadows and are not dropped by the transmission/depth passes
    // of the ray-tracing pipeline (where transparent fauna behind water used to vanish).
    mat = new THREE.MeshStandardMaterial({
      map: tex,
      transparent: false,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      roughness: 0.85,
      metalness: 0,
    });
    mobMaterials.set(key, mat);
    if (tex) mobTextures.push(tex);
    return mat;
  }

  /** Meshes that may receive screen-space reflections (arena water/ice, + outer rivers). */
  function collectReflective(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (field) out.push(...field.reflectiveMeshes());
    if (options.outerRayTracing && outer && materials) {
      outer.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && (mesh.material === materials!.water || mesh.material === materials!.translucent)) {
          out.push(mesh);
        }
      });
    }
    return out;
  }

  /** Reflection list identity: arena remesh + outer rebuild + scope flag. */
  function reflectionVersion(): number {
    return (field?.chunkVersion() ?? 0) + outerRebuilds * 1_000_000 + (options.outerRayTracing ? 500_000 : 0);
  }

  function rebuildOuter(seed: number): void {
    if (!outer) return;
    outer.rebuild(state?.bounds ?? DEFAULT_BOUNDS, outerOptionsFrom(options), seed);
    outer.setShadows(!!rt && options.outerRayTracing);
    outerRebuilds++;
  }

  /** Shadow configuration; the experimental RT mode forces shadows and a sharper map. */
  function applyShadowMode(): void {
    if (!boot || !sun) return;
    const want = options.shadows === "soft" || !!rt;
    boot.renderer.shadowMap.enabled = want;
    if (!want) {
      sun.castShadow = false;
      return;
    }
    const outerRt = !!rt && options.outerRayTracing;
    boot.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    sun.castShadow = true;
    const size = outerRt ? 4096 : rt ? (options.rayTracing === "ultra" ? 4096 : 2048) : 1024;
    if (sun.shadow.map && sun.shadow.map.width !== size) {
      sun.shadow.map.dispose();
      (sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
    sun.shadow.mapSize.set(size, size);
    // Tight ortho box around the arena; the outer-world scope widens it to the whole radius.
    const half = outerRt ? Math.max(16, options.outerRadius + 12) : rt ? 16 : 22;
    sun.shadow.radius = rt ? 4 : 1;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = rt ? 0.035 : 0.02;
    const sc = sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -half;
    sc.right = half;
    sc.top = half;
    sc.bottom = -half;
    sc.near = 1;
    sc.far = 200;
    sc.updateProjectionMatrix();
  }

  function teardownRt(): void {
    rt?.dispose();
    rt = null;
  }

  /** (Re)create the experimental ray-tracing pipeline for the current quality setting. */
  function configureRt(): void {
    teardownRt();
    if (!boot || !host || options.rayTracing === "off") return;
    rt = createRayTracing(boot.renderer, boot.scene, boot.camera, options.rayTracing, { width: host.width, height: host.height }, {
      reflectiveMeshes: collectReflective,
      chunkVersion: reflectionVersion,
    });
  }

  async function initWorld(): Promise<void> {
    if (!host || !boot || !store) return;
    const token = ++buildToken;
    const c = center();
    teardownRt();

    blockAtlas = buildAtlas(
      store.ofKind("block").filter((t) => !t.asset.animated),
      { cell: options.textureSize },
    );
    itemAtlas = buildAtlas(store.ofKind("item"), { cell: 32 });
    const particleTextures = store.ofKind("particle");
    particleAtlas = buildAtlas(particleTextures, { cell: 32, cols: 8 });
    animated = createAnimatedTextures(store);
    materials = createMaterials(blockAtlas, animated, options.normalMaps, options.rayTracing);
    boot.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    boot.renderer.toneMappingExposure = options.exposure;

    root = new THREE.Group();
    root.position.set(c.x, 0, c.z);
    boot.scene.add(root);
    world = new THREE.Group();
    world.position.set(-c.x, 0, -c.z);
    root.add(world);

    const shadowsOn = options.shadows === "soft" || options.rayTracing !== "off";
    field = createFieldWorld(materials, blockAtlas, {
      ao: options.ao,
      outline: options.outline,
      shadows: shadowsOn,
      theme: options.theme,
    });
    decor = createDecor(blockAtlas);
    outer = createOuterWorld(materials, blockAtlas);
    rebuildOuter(WORLD_SEED);
    base = createMtBase(blockAtlas, shadowsOn);
    props = createMtProps(blockAtlas, itemAtlas, shadowsOn);
    sky = createSky({
      sun: entityTexture(store, "sun") ?? undefined,
      moon: entityTexture(store, "moon_full") ?? undefined,
    });
    const sprites: ParticleSprites = {
      texture: particleAtlas.texture,
      cols: particleAtlas.cols,
      rows: particleAtlas.rows,
      sprites: particleSpriteRanges(particleTextures.map((t) => t.asset.name)),
    };
    particles = createParticles(sprites);
    tanks = Array.from({ length: 8 }, () => createMtTank(blockAtlas!, shadowsOn));
    towerModels = Array.from({ length: MAX_TOWERS }, () => createMtTank(blockAtlas!, shadowsOn));
    fauna = createFauna({
      createMob: (species, shadows) => createMob(MOB_GEOMETRY[species], mobMaterial(species), shadows),
      getBounds: () => state?.bounds ?? DEFAULT_BOUNDS,
      // Ray tracing forces shadows, so animals cast them too.
      getOptions: () => (rt ? { ...options, faunaShadows: true } : options),
      getTankPositions: () =>
        (state?.tanks ?? [])
          .filter((t) => t.state !== "dead" && t.state !== "exploding")
          .map((t) => tankCenter(state!.bounds, t.x, t.y)),
      walkableAt: (x, z) => {
        const s = state;
        if (!s) return true;
        const col = Math.floor(x) + s.bounds.col0;
        const row = Math.floor(z) + s.bounds.row0;
        if (col < s.bounds.col0 || col >= s.bounds.col0 + s.bounds.cols) return false;
        if (row < s.bounds.row0 || row >= s.bounds.row0 + s.bounds.rows) return false;
        return tankPassable(s.field[row * 32 + col]);
      },
      // Debug: inspect `globalThis.__mtFaunaSpins` (browser console) for spin-in-place
      // regressions; the ring buffer stays empty when animals behave.
      onSpin: (info) => {
        const g = globalThis as { __mtFaunaSpins?: unknown[] };
        const buf = (g.__mtFaunaSpins ??= []);
        buf.push({ t: performance.now(), ...info });
        if (buf.length > 200) buf.shift();
      },
      terrain: {
        get enabled() {
          return !!outer && options.outerWorld !== "off";
        },
        heightAt: (x, z) => (outer ? outer.heightAt(x, z) : 0),
        contains: (x, z) => (outer ? outer.contains(x, z) : false),
      },
    });

    world.add(field.group, decor.group, outer.group, base.group, props.group, particles.object, fauna.group);
    for (const t of tanks) world.add(t.group);
    for (const t of towerModels) world.add(t.group);
    boot.scene.add(sky.group);

    hemi = new THREE.HemisphereLight(0xa9c8ee, 0x3a2f22, 0.9);
    sun = new THREE.DirectionalLight(0xfff6e0, 1.6);
    boot.scene.add(hemi, sun, sun.target);

    configureRt();
    applyShadowMode();
    outer?.setShadows(!!rt && options.outerRayTracing);

    host.shared.three = { THREE, scene: boot.scene, camera: boot.camera, renderer: boot.renderer, root, world };
    if (token === buildToken) ready = true;
  }

  function teardownWorld(): void {
    ready = false;
    if (boot && root) boot.scene.remove(root);
    if (boot && sky) boot.scene.remove(sky.group);
    if (boot && hemi) boot.scene.remove(hemi);
    if (boot && sun) boot.scene.remove(sun, sun.target);
    if (boot) boot.scene.fog = null;
    fogObj = null;
    field?.dispose();
    decor?.dispose();
    outer?.dispose();
    base?.dispose();
    props?.dispose();
    sky?.dispose();
    particles?.dispose();
    fauna?.dispose();
    for (const t of tanks) t.dispose();
    for (const t of towerModels) t.dispose();
    tanks = [];
    towerModels = [];
    materials?.dispose();
    blockAtlas?.dispose();
    itemAtlas?.dispose();
    particleAtlas?.dispose();
    animated?.dispose();
    for (const m of mobMaterials.values()) {
      m.map?.dispose?.();
      m.dispose();
    }
    mobMaterials.clear();
    for (const t of mobTextures) t.dispose();
    mobTextures.length = 0;
    root = null;
    world = null;
    field = null;
    decor = null;
    outer = null;
    base = null;
    props = null;
    sky = null;
    particles = null;
    fauna = null;
    hemi = null;
    sun = null;
    blockAtlas = null;
    itemAtlas = null;
    particleAtlas = null;
    animated = null;
    materials = null;
    prevField = null;
    decorReady = false;
    decorPending = true;
    decorPendingFrames = 0;
    fieldStableFrames = 0;
    arenaFrames = 0;
    prevBullets = [];
    smokeAccum = 0;
  }

  function fogDensity(): number {
    return options.fog <= 0 ? 0 : 0.002 + options.fog * 0.02;
  }

  function burstBlock(x: number, z: number, color: number): void {
    if (!particles || options.particles === 0) return;
    const mult = options.particles;
    particles.burst({ x, y: 0.5, z, sprite: "explosion", count: 3 * mult, color, size: 1.1, lifeMs: 500 });
    particles.burst({
      x,
      y: 0.5,
      z,
      sprite: "smoke",
      count: 2 * mult,
      color: 0x9a9a9a,
      size: 1.2,
      upward: 0.05,
      lifeMs: 700,
    });
  }

  function updateDecor(): void {
    if (decor && state) decor.rebuild(state.bounds, state.field, options.decor, options.theme);
    // Debug: `globalThis.__mtDecorInfo` shows when decor was seeded and whether the stage
    // had already loaded (guards against plants on ice/water from an empty first frame).
    const g = globalThis as { __mtDecorBuilds?: number; __mtDecorInfo?: unknown };
    g.__mtDecorBuilds = (g.__mtDecorBuilds ?? 0) + 1;
    let onIce = 0;
    let onBlocked = 0;
    if (decor && state) {
      for (const child of decor.group.children) {
        const col = Math.floor(child.position.x) + state.bounds.col0;
        const row = Math.floor(child.position.z) + state.bounds.row0;
        const v = state.field[row * 32 + col];
        if (v === 0x21) onIce++;
        if (v !== 0) onBlocked++;
      }
    }
    g.__mtDecorInfo = { frame: arenaFrames, hasTerrain: fieldHasTerrain(), count: decor?.group.children.length ?? 0, onIce, onBlocked };
  }

  /** The stage layout is written into the collision buffer only after the match starts. */
  function fieldHasTerrain(): boolean {
    const s = state;
    if (!s) return false;
    for (let r = s.bounds.row0; r < s.bounds.row0 + s.bounds.rows; r++) {
      for (let c = s.bounds.col0; c < s.bounds.col0 + s.bounds.cols; c++) {
        if (s.field[r * 32 + c] !== 0) return true;
      }
    }
    return false;
  }

  /**
   * Debug: re-check every frame that no seeded prop ended up on a non-empty tile. If the
   * stage loads in several passes, the terrain changes after the decor build and this
   * reports `__mtDecorBadNow > 0` plus the first offender in `__mtDecorFirstBad`.
   */
  function decorSpawnAudit(): void {
    const s = state;
    const g = globalThis as { __mtDecorBadNow?: number; __mtDecorBadFrames?: number; __mtDecorFirstBad?: unknown };
    if (!decor || !s || !decorReady) {
      g.__mtDecorBadNow = 0;
      return;
    }
    let bad = 0;
    for (const child of decor.group.children) {
      const col = Math.floor(child.position.x) + s.bounds.col0;
      const row = Math.floor(child.position.z) + s.bounds.row0;
      const v = s.field[row * 32 + col];
      if (v !== 0) {
        bad++;
        if (!g.__mtDecorFirstBad) {
          g.__mtDecorFirstBad = { frame: arenaFrames, x: +child.position.x.toFixed(2), z: +child.position.z.toFixed(2), tile: v };
        }
      }
    }
    g.__mtDecorBadNow = bad;
    if (bad > 0) g.__mtDecorBadFrames = (g.__mtDecorBadFrames ?? 0) + 1;
  }

  /**
   * Cells that turned from bare ground into an obstacle since the previous frame
   * (stage load or a switch to another level). During a match this never happens: brick
   * only disappears, water/ice/trees never appear. So a positive count means the current
   * decor seed is stale and must be rebuilt.
   */
  function countNewObstacles(): number {
    const s = state;
    if (!s || !prevField || prevField.length !== s.field.length) return 0;
    let n = 0;
    for (let r = s.bounds.row0; r < s.bounds.row0 + s.bounds.rows; r++) {
      for (let c = s.bounds.col0; c < s.bounds.col0 + s.bounds.cols; c++) {
        const idx = r * 32 + c;
        if (prevField[idx] === 0 && s.field[idx] !== 0) n++;
      }
    }
    return n;
  }

  /** Same terrain as the previous frame: the level has finished loading. */
  function fieldUnchanged(): boolean {
    const s = state;
    if (!s || !prevField || prevField.length !== s.field.length) return false;
    for (let r = s.bounds.row0; r < s.bounds.row0 + s.bounds.rows; r++) {
      for (let c = s.bounds.col0; c < s.bounds.col0 + s.bounds.cols; c++) {
        if (prevField[r * 32 + c] !== s.field[r * 32 + c]) return false;
      }
    }
    return true;
  }

  return {
    id: "meine-tank",
    async mount(nextHost: RenderHost) {
      host = nextHost;
      boot = createThreeBootstrap(nextHost, { fov: options.fov, clear: 0x87ceeb });
      try {
        store = await loadTextureStore();
      } catch {
        store = null;
      }
      await initWorld();
      detachControls = attachCameraControls(nextHost.container, nextHost.camera);
    },

    setOptions(raw: unknown) {
      const next = normalizeMtOptions(raw);
      const structural =
        next.textureSize !== options.textureSize ||
        next.shadows !== options.shadows ||
        next.normalMaps !== options.normalMaps ||
        next.rayTracing !== options.rayTracing;
      const groundChanged = next.theme !== options.theme;
      const modeChanged = next.cameraMode !== options.cameraMode;
      const decorChanged = next.decor !== options.decor;
      const outerChanged =
        next.outerWorld !== options.outerWorld ||
        next.border !== options.border ||
        next.outerBiome !== options.outerBiome ||
        next.outerRadius !== options.outerRadius ||
        next.outerRivers !== options.outerRivers ||
        next.outerTrees !== options.outerTrees ||
        next.outerVolcano !== options.outerVolcano;
      const outerRtChanged = next.outerRayTracing !== options.outerRayTracing;
      options = next;
      if (structural) {
        teardownWorld();
        void initWorld();
        return;
      }
      field?.configure({ ao: options.ao, outline: options.outline });
      if (groundChanged) field?.rebuildGround(options.theme);
      if (decorChanged || groundChanged) updateDecor();
      if (outerChanged) rebuildOuter(WORLD_SEED);
      if (outerRtChanged) {
        // Refresh the SSR list (outer rivers in/out) and the shadow scope.
        outer?.setShadows(!!rt && options.outerRayTracing);
        applyShadowMode();
      }
      if (boot) {
        boot.renderer.toneMappingExposure = options.exposure;
        boot.camera.fov = options.fov;
        boot.camera.updateProjectionMatrix();
      }
      if (modeChanged && host) {
        host.camera.roll = 0;
        if (options.cameraMode === "first") host.camera.pitch = 0.2;
        else if (options.cameraMode === "third") {
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

    resize(width, height) {
      boot?.resize(width, height);
      rt?.setSize(width, height);
    },

    render(dtMs) {
      if (
        !ready ||
        !boot ||
        !host ||
        !root ||
        !world ||
        !field ||
        !base ||
        !props ||
        !sky ||
        !particles ||
        !materials ||
        !animated ||
        !state ||
        !blockAtlas ||
        !itemAtlas
      ) {
        return;
      }
      time += dtMs;

      field.configure({ ao: options.ao, outline: options.outline });
      arenaFrames++;
      field.update(state.field, state.bounds);
      // Build decor only when the stage layout has actually loaded and settled —
      // otherwise flowers land on cells that later become ice/water/brick.
      fieldStableFrames = fieldUnchanged() ? fieldStableFrames + 1 : 0;
      // Mark the decor stale on a level load/switch (empty ground turning into an
      // obstacle), then reseed once — after the layout has settled.
      if (decorReady && !fieldHasTerrain()) {
        decorPending = true;
        decorPendingFrames = 0;
      }
      if (countNewObstacles() > 0) {
        // Drop props that a freshly loaded level just swallowed, then reseed when settled.
        if (decor && state) decor.prune(state.field, state.bounds);
        decorPending = true;
        decorPendingFrames = 0;
      }
      if (decorPending) {
        decorPendingFrames++;
        if (decorReadyToBuild(fieldHasTerrain(), fieldStableFrames >= 8, decorPendingFrames)) {
          updateDecor();
          decorReady = true;
          decorPending = false;
        }
      }
      decorSpawnAudit();

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
              burstBlock(cc.x, cc.z, color);
            }
          }
        }
        const fly = state.bullets.filter(
          (b) => !prevBullets.some((p) => Math.abs(p.x - b.x) < 3 && Math.abs(p.y - b.y) < 3),
        );
        for (const b of fly) {
          const gx = b.x / 8 - state.bounds.col0 + 0.5;
          const gz = b.y / 8 - state.bounds.row0 + 0.5;
          particles.burst({
            x: gx,
            y: 0.6,
            z: gz,
            sprite: "flame",
            count: 3 * mult,
            color: 0xffcc55,
            size: 0.9,
            lifeMs: 350,
          });
        }
        prevBullets = state.bullets.map((b) => ({ x: b.x, y: b.y }));
        for (let i = 0; i < tanks.length; i++) {
          const t = state.tanks[i];
          if (t && t.state === "exploding") {
            explodeTimer[i] += dtMs;
            if (explodeTimer[i] > 70) {
              explodeTimer[i] = 0;
              const p = tankCenter(state.bounds, t.x, t.y);
              particles.burst({
                x: p.x,
                y: 0.7,
                z: p.z,
                sprite: "explosion",
                count: 8 * mult,
                color: 0xff8a1a,
                size: 1.4,
                lifeMs: 600,
              });
              particles.burst({
                x: p.x,
                y: 0.7,
                z: p.z,
                sprite: "smoke",
                count: 4 * mult,
                color: 0x555555,
                size: 1.5,
                lifeMs: 900,
              });
            }
          } else {
            explodeTimer[i] = 0;
          }
        }
      }
      prevField = state.field.slice();
      // Volcano smoke: a continuous column of dense, slowly rising puffs.
      if (options.particles > 0 && options.outerWorld !== "off" && options.outerVolcano && outer) {
        smokeAccum += dtMs;
        const interval = 110 / Math.max(0.25, options.particles);
        const vents = outer.volcanoPoints();
        while (smokeAccum >= interval && vents.length) {
          smokeAccum -= interval;
          for (const v of vents) {
            particles.burst({
              x: v.x,
              y: v.y + 1.2,
              z: v.z,
              sprite: "smoke",
              count: Math.max(1, Math.round(options.particles)) * 3,
              color: 0x6f747c,
              size: 11 + Math.random() * 9,
              spread: 3.6,
              upward: 0.0022,
              drift: 0.0007,
              lifeMs: 7200,
              alpha: 0.96,
              grow: true,
              gravity: false,
            });
          }
        }
      } else {
        smokeAccum = 0;
      }
      particles.update(dtMs);
      if (particles) {
        const pm = particles.object.material as THREE.ShaderMaterial;
        (globalThis as { __mtParticlesInfo?: unknown }).__mtParticlesInfo = {
          active: particles.activeCount(),
          visible: particles.object.visible,
          inScene: !!particles.object.parent,
          shadows: particles.object.castShadow,
          fog: pm.fog,
          hasAtlas: !!pm.uniforms?.uAtlas?.value,
          fogDensity: pm.uniforms?.fogDensity?.value ?? null,
        };
      }

      fauna?.update(dtMs, time);
      if (fauna) {
        let visible = 0;
        let firstVisible: { y: number; parentVisible: boolean } | null = null;
        for (const child of fauna.group.children) {
          if (!child.visible) continue;
          visible++;
          if (!firstVisible) firstVisible = { y: child.position.y, parentVisible: !!child.parent?.visible };
        }
        (globalThis as { __mtFaunaInfo?: unknown }).__mtFaunaInfo = {
          rt: !!rt,
          active: fauna.activeCount(),
          visible,
          inScene: !!fauna.group.parent,
          groupVisible: fauna.group.visible,
          firstVisible,
        };
      }

      sky.setFlatClouds(options.clouds === "flat");
      const day = sky.update(options.time, dtMs, time);
      if (hemi && sun) {
        hemi.color.setHex(day.ambientColor);
        hemi.intensity = options.lighting === "flat" ? Math.max(day.ambientIntensity, 1.1) : day.ambientIntensity;
        sun.color.setHex(day.sunColor);
        sun.intensity = options.lighting === "flat" ? Math.max(day.sunIntensity, 1.2) : day.sunIntensity;
        if (rt) {
          // IBL already supplies ambient, so lean on the key light for contrast.
          hemi.intensity *= 0.35;
          sun.intensity *= 1.15;
        }
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

      animated.update(options.water === "off" ? 0 : time);
      materials.setWaterTime(options.water === "animated" ? time : 0);

      const fe = host.camera.fieldEuler;
      root.rotation.set(fe.x, fe.y, fe.z);
      root.updateMatrixWorld(true);

      const rig = host.camera;
      const viewerTank = state.tanks[host.viewer.port];
      const tankVisible = !!viewerTank && viewerTank.state !== "dead" && viewerTank.state !== "exploding";
      // In first person, hide the local tank so the hull does not block the view.
      if (options.cameraMode === "first" && tankVisible && tanks[host.viewer.port]) {
        tanks[host.viewer.port].group.visible = false;
      }

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
        const p = tankCenter(state.bounds, viewerTank!.x, viewerTank!.y);
        const f = FACING[viewerTank!.dir & 3];
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

      if (particles && sun) {
        particles.setLighting(boot.camera.position, _sunDir.set(day.sunDir.x, day.sunDir.y, day.sunDir.z), sun.color);
      }

      if (rt) rt.render();
      else boot.renderer.render(boot.scene, boot.camera);
    },
    dispose() {
      detachControls?.();
      detachControls = null;
      teardownRt();
      teardownWorld();
      if (host) delete host.shared.three;
      boot?.dispose();
      boot = null;
      host = null;
      state = null;
      store = null;
    },
  };
}

export default createMeineTankDriver;
