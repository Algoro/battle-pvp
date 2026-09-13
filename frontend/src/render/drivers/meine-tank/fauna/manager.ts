// manager.ts — display-only fauna for `meine-tank`: spawning, wandering and species
// animations. Never touches game state; uses its own RNG/timers.
//
// Wave 1 lives in the arena; small animals and dragons roam the outer world when it is
// enabled (and stand on its terrain via the provided height function).
//
// Relative path: ./frontend/src/render/drivers/meine-tank/fauna/manager.ts
import * as THREE from "three";
import type { MobInstance } from "../models/mobs/geometry.ts";
import type { MobSpecies } from "../models/mobs/defs.ts";
import type { RenderBounds } from "../../../types.ts";
import type { MtOptions } from "../options.ts";
import { faunaGroups } from "../options.ts";

export interface FaunaTerrain {
  enabled: boolean;
  heightAt(x: number, z: number): number;
  contains(x: number, z: number): boolean;
}

export interface FaunaDeps {
  createMob(species: MobSpecies, shadows: boolean): MobInstance;
  getBounds(): RenderBounds;
  getOptions(): MtOptions;
  /** Tank world positions to avoid in `lively` mode. */
  getTankPositions(): { x: number; z: number }[];
  terrain: FaunaTerrain;
}

export interface MtFauna {
  group: THREE.Group;
  update(dtMs: number, timeMs: number): void;
  activeCount(): number;
  dispose(): void;
}

type FaunaGroup = "bees" | "birds" | "bats" | "allay" | "small" | "livestock" | "aquatic" | "dragons";

interface SpeciesCfg {
  species: MobSpecies;
  group: FaunaGroup;
  base: number;
  flying: boolean;
  night?: boolean;
  speed: number;
  size: number;
  yMin: number;
  yMax: number;
  outerOnly?: boolean;
  outer?: boolean;
}

const SPECIES: SpeciesCfg[] = [
  { species: "bee", group: "bees", base: 4, flying: true, speed: 0.9, size: 1.0, yMin: 0.7, yMax: 1.8 },
  { species: "parrot", group: "birds", base: 2, flying: true, speed: 1.4, size: 1.1, yMin: 1.4, yMax: 3.2 },
  { species: "chicken", group: "birds", base: 2, flying: false, speed: 0.35, size: 1.0, yMin: 0, yMax: 0 },
  { species: "bat", group: "bats", base: 3, flying: true, night: true, speed: 1.8, size: 0.9, yMin: 1.8, yMax: 4.0 },
  { species: "allay", group: "allay", base: 2, flying: true, speed: 1.1, size: 1.05, yMin: 1.0, yMax: 3.0 },
  { species: "rabbit", group: "small", base: 3, flying: false, speed: 0.7, size: 0.8, yMin: 0, yMax: 0, outer: true },
  { species: "fox", group: "small", base: 2, flying: false, speed: 1.2, size: 0.95, yMin: 0, yMax: 0, outer: true },
  { species: "cow", group: "livestock", base: 2, flying: false, speed: 0.45, size: 1.0, yMin: 0, yMax: 0, outer: true },
  { species: "pig", group: "livestock", base: 2, flying: false, speed: 0.5, size: 0.9, yMin: 0, yMax: 0, outer: true },
  { species: "frog", group: "aquatic", base: 3, flying: false, speed: 0.45, size: 1.0, yMin: 0, yMax: 0, outer: true },
  {
    species: "axolotl",
    group: "aquatic",
    base: 2,
    flying: false,
    speed: 0.35,
    size: 1.0,
    yMin: 0,
    yMax: 0,
    outer: true,
  },
  {
    species: "dragon",
    group: "dragons",
    base: 1,
    flying: true,
    speed: 4.5,
    size: 1.0,
    yMin: 7,
    yMax: 14,
    outerOnly: true,
  },
];

interface Mob {
  cfg: SpeciesCfg;
  inst: MobInstance;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  timer: number;
  phase: number;
  outer: boolean;
  ground: number;
}

const TAU = Math.PI * 2;

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function wrapAngle(a: number): number {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}

export function createFauna(deps: FaunaDeps): MtFauna {
  const group = new THREE.Group();
  const mobs: Mob[] = [];
  const pools = new Map<string, MobInstance[]>();
  let cycleMs = 0;

  function acquire(cfg: SpeciesCfg, shadows: boolean): MobInstance {
    const free = pools.get(cfg.species) ?? [];
    const reused = free.pop();
    if (reused) {
      reused.group.visible = true;
      return reused;
    }
    const inst = deps.createMob(cfg.species, shadows);
    inst.group.scale.multiplyScalar(cfg.size);
    group.add(inst.group);
    return inst;
  }

  function release(cfg: SpeciesCfg, inst: MobInstance): void {
    inst.group.visible = false;
    const list = pools.get(cfg.species) ?? [];
    list.push(inst);
    pools.set(cfg.species, list);
  }

  function isNight(o: MtOptions): boolean {
    if (o.faunaTime === "day") return false;
    if (o.faunaTime === "night") return true;
    if (o.time === "night") return true;
    if (o.time === "cycle") {
      const frac = (cycleMs / 1000 / 120) % 1;
      return frac < 0.18 || frac > 0.82;
    }
    return false;
  }

  function activeSpecies(o: MtOptions, night: boolean): SpeciesCfg[] {
    const groups = faunaGroups(o) as Record<string, boolean>;
    const outerOn = deps.terrain.enabled && o.outerWorld !== "off" && o.outerMobs;
    return SPECIES.filter((cfg) => {
      if (cfg.group === "dragons") return deps.terrain.enabled && o.outerWorld !== "off" && o.outerDragons;
      if (!groups[cfg.group]) return false;
      if (cfg.night && !night) return false;
      if (cfg.outerOnly && !outerOn) return false;
      return true;
    });
  }

  function arenaSpawn(cfg: SpeciesCfg, b: RenderBounds): { x: number; z: number; y: number; outer: boolean } {
    const outerWanted = cfg.outerOnly || (cfg.outer && deps.terrain.enabled && Math.random() < 0.6);
    if (outerWanted && deps.terrain.enabled) {
      const cx = b.cols / 2;
      const cz = b.rows / 2;
      for (let attempt = 0; attempt < 24; attempt++) {
        const a = Math.random() * TAU;
        const r = 12 + Math.random() * 40;
        const x = cx + Math.cos(a) * r;
        const z = cz + Math.sin(a) * r;
        if (!deps.terrain.contains(x, z)) continue;
        const gh = deps.terrain.heightAt(x, z);
        return { x, z, y: cfg.flying ? gh + rand(cfg.yMin, cfg.yMax) : gh, outer: true };
      }
    }
    return {
      x: rand(2, b.cols - 2),
      z: rand(2, b.rows - 2),
      y: cfg.flying ? rand(cfg.yMin, cfg.yMax) : 0,
      outer: false,
    };
  }

  function spawn(cfg: SpeciesCfg, b: RenderBounds, shadows: boolean): Mob {
    const inst = acquire(cfg, shadows);
    const pos = arenaSpawn(cfg, b);
    const m: Mob = {
      cfg,
      inst,
      x: pos.x,
      y: pos.y,
      z: pos.z,
      vx: rand(-0.01, 0.01),
      vz: rand(-0.01, 0.01),
      heading: rand(-Math.PI, Math.PI),
      timer: rand(600, 2600),
      phase: rand(0, TAU),
      outer: pos.outer,
      ground: pos.outer && !cfg.flying ? deps.terrain.heightAt(pos.x, pos.z) : 0,
    };
    inst.group.rotation.y = m.heading;
    inst.group.position.set(m.x, m.y, m.z);
    return m;
  }

  function animate(m: Mob, timeMs: number): void {
    const { inst } = m;
    const t = timeMs * 0.001 + m.phase;
    const bones = inst.bones;
    inst.group.position.set(m.x, m.y, m.z);
    inst.group.rotation.y = m.heading;

    switch (m.cfg.species) {
      case "bee": {
        const flap = Math.sin(t * 46) * 0.9;
        const rw = bones.get("rightwing_bone");
        const lw = bones.get("leftwing_bone");
        if (rw) rw.rotation.z = flap;
        if (lw) lw.rotation.z = -flap;
        inst.group.position.y = m.y + Math.sin(t * 3) * 0.08;
        break;
      }
      case "parrot": {
        const flap = Math.sin(t * 14) * 0.5;
        const w0 = bones.get("wing0");
        const w1 = bones.get("wing1");
        if (w0) w0.rotation.x = flap;
        if (w1) w1.rotation.x = flap;
        const head = bones.get("head");
        if (head) head.rotation.y = Math.sin(t * 1.7) * 0.5;
        break;
      }
      case "chicken": {
        const walk = Math.sin(t * 9) * 0.7;
        const l0 = bones.get("leg0");
        const l1 = bones.get("leg1");
        if (l0) l0.rotation.x = walk;
        if (l1) l1.rotation.x = -walk;
        const w0 = bones.get("wing0");
        const w1 = bones.get("wing1");
        const flap = Math.sin(t * 20) * 0.15;
        if (w0) w0.rotation.z = -flap;
        if (w1) w1.rotation.z = flap;
        inst.group.position.y = m.y + Math.abs(Math.sin(t * 9)) * 0.03;
        break;
      }
      case "bat": {
        const flap = Math.sin(t * 30) * 1.1;
        const rw = bones.get("rightWing");
        const lw = bones.get("leftWing");
        const rwt = bones.get("rightWingTip");
        const lwt = bones.get("leftWingTip");
        if (rw) rw.rotation.z = flap;
        if (lw) lw.rotation.z = -flap;
        if (rwt) rwt.rotation.z = flap * 0.6;
        if (lwt) lwt.rotation.z = -flap * 0.6;
        break;
      }
      case "allay": {
        const flutter = Math.sin(t * 26) * 0.7;
        const rw = bones.get("right_wing");
        const lw = bones.get("left_wing");
        if (rw) rw.rotation.z = flutter;
        if (lw) lw.rotation.z = -flutter;
        const head = bones.get("head");
        if (head) head.rotation.z = Math.sin(t * 2.2) * 0.15;
        inst.group.position.y = m.y + Math.sin(t * 2.6) * 0.12;
        break;
      }
      case "rabbit": {
        const hop = Math.sin(t * 6) * 0.12;
        inst.group.position.y = m.y + Math.abs(hop);
        const head = bones.get("head");
        if (head) head.rotation.x = Math.sin(t * 3) * 0.15;
        break;
      }
      case "fox": {
        const walk = Math.sin(t * 8) * 0.5;
        for (const leg of ["leg0", "leg1", "leg2", "leg3"]) {
          const b = bones.get(leg);
          if (b) b.rotation.x = walk * (leg === "leg0" || leg === "leg3" ? 1 : -1);
        }
        const tail = bones.get("tail");
        if (tail) tail.rotation.x = Math.sin(t * 4) * 0.2;
        break;
      }
      case "cow":
      case "pig": {
        const walk = Math.sin(t * 6) * 0.45;
        for (const leg of ["leg0", "leg1", "leg2", "leg3"]) {
          const b = bones.get(leg);
          if (b) b.rotation.x = walk * (leg === "leg0" || leg === "leg3" ? 1 : -1);
        }
        const head = bones.get("head");
        if (head) head.rotation.x = Math.sin(t * 2.4) * 0.12;
        break;
      }
      case "frog": {
        const hop = Math.abs(Math.sin(t * 2.2));
        inst.group.position.y = m.y + hop * 0.25;
        const legs = ["left_leg", "right_leg"];
        for (const name of legs) {
          const b = bones.get(name);
          if (b) b.rotation.x = -hop * 0.6;
        }
        const arms = ["left_arm", "right_arm"];
        for (const name of arms) {
          const b = bones.get(name);
          if (b) b.rotation.x = hop * 0.4;
        }
        break;
      }
      case "axolotl": {
        const tail = bones.get("tail");
        if (tail) tail.rotation.y = Math.sin(t * 4) * 0.35;
        const legs = ["left_leg", "right_leg", "left_arm", "right_arm"];
        for (const name of legs) {
          const b = bones.get(name);
          if (b) b.rotation.y += Math.sin(t * 5 + name.length) * 0.1;
        }
        inst.group.position.y = m.y + Math.sin(t * 3) * 0.05;
        break;
      }
      case "dragon": {
        const flap = Math.sin(t * 3.2) * 0.55;
        for (const name of ["wingL", "wingR"]) {
          const w = bones.get(name);
          if (w) w.rotation.z = name === "wingL" ? flap : -flap;
        }
        for (const name of ["wingtipL", "wingtipR"]) {
          const w = bones.get(name);
          if (w) w.rotation.z = name === "wingtipL" ? flap * 0.6 : -flap * 0.6;
        }
        const jaw = bones.get("jaw");
        if (jaw) jaw.rotation.x = 0.1 + Math.sin(t * 0.7) * 0.12;
        inst.group.rotation.z = Math.sin(t * 0.9) * 0.05;
        inst.group.position.y = m.y + Math.sin(t * 1.1) * 0.4;
        break;
      }
    }
  }

  function move(m: Mob, dtMs: number, timeMs: number, b: RenderBounds, lively: boolean): void {
    m.timer -= dtMs;
    if (m.timer <= 0) {
      m.timer = rand(700, 2800);
      m.heading = wrapAngle(m.heading + rand(-1.6, 1.6));
    }
    m.vx += Math.cos(m.heading) * 0.0006 * dtMs;
    m.vz += Math.sin(m.heading) * 0.0006 * dtMs;

    if (lively) {
      for (const p of deps.getTankPositions()) {
        const dx = m.x - p.x;
        const dz = m.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 9 && d2 > 0.001) {
          const d = Math.sqrt(d2);
          m.vx += (dx / d) * 0.004 * dtMs;
          m.vz += (dz / d) * 0.004 * dtMs;
        }
      }
    }

    const damping = Math.pow(0.9, dtMs / 16);
    m.vx *= damping;
    m.vz *= damping;
    const max = m.cfg.speed * 0.004;
    const sp = Math.hypot(m.vx, m.vz);
    if (sp > max) {
      m.vx = (m.vx / sp) * max;
      m.vz = (m.vz / sp) * max;
    }
    const nx = m.x + m.vx * dtMs;
    const nz = m.z + m.vz * dtMs;

    if (m.outer && deps.terrain.enabled) {
      if (deps.terrain.contains(nx, nz)) {
        m.x = nx;
        m.z = nz;
      } else {
        m.heading = wrapAngle(m.heading + Math.PI);
        m.vx = 0;
        m.vz = 0;
      }
      if (m.cfg.flying) {
        const t = timeMs * 0.001 + m.phase;
        const target = m.cfg.yMin + ((Math.sin(t * 0.6) + 1) / 2) * (m.cfg.yMax - m.cfg.yMin);
        const groundY = deps.terrain.heightAt(m.x, m.z);
        m.y += (groundY + target - m.y) * Math.min(1, dtMs * 0.0015);
      } else {
        const gh = deps.terrain.heightAt(m.x, m.z);
        m.y += (gh - m.y) * Math.min(1, dtMs * 0.004);
      }
      return;
    }

    if (m.x < 1 || nx < 1) m.heading = wrapAngle(m.heading + 0.4 * (dtMs / 16));
    if (nx > b.cols - 1) m.heading = wrapAngle(m.heading - 0.4 * (dtMs / 16));
    if (m.z < 1 || nz < 1) m.heading = wrapAngle(m.heading - 0.4 * (dtMs / 16));
    if (nz > b.rows - 1) m.heading = wrapAngle(m.heading + 0.4 * (dtMs / 16));
    m.x = Math.max(0.5, Math.min(b.cols - 0.5, nx));
    m.z = Math.max(0.5, Math.min(b.rows - 0.5, nz));
    if (m.cfg.flying) {
      const t = timeMs * 0.001 + m.phase;
      const target = m.cfg.yMin + ((Math.sin(t * 0.7) + 1) / 2) * (m.cfg.yMax - m.cfg.yMin);
      m.y += (target - m.y) * Math.min(1, dtMs * 0.0015);
    } else {
      m.y = 0;
    }
  }

  return {
    group,
    update(dtMs, timeMs) {
      cycleMs += dtMs;
      const o = deps.getOptions();
      const b = deps.getBounds();
      const night = isNight(o);
      const active = new Set(activeSpecies(o, night));

      for (let i = mobs.length - 1; i >= 0; i--) {
        if (!active.has(mobs[i].cfg)) {
          release(mobs[i].cfg, mobs[i].inst);
          mobs.splice(i, 1);
        }
      }
      for (const cfg of active) {
        let present = 0;
        for (const m of mobs) if (m.cfg === cfg) present++;
        const desired = Math.round(cfg.base * o.faunaDensity);
        for (let i = present; i < desired; i++) mobs.push(spawn(cfg, b, o.faunaShadows));
      }

      const lively = o.fauna === "lively";
      for (const m of mobs) {
        move(m, dtMs, timeMs, b, lively);
        animate(m, timeMs);
      }
    },
    activeCount() {
      return mobs.length;
    },
    dispose() {
      for (const m of mobs) m.inst.dispose();
      for (const list of pools.values()) for (const inst of list) inst.dispose();
      mobs.length = 0;
      pools.clear();
      group.clear();
    },
  };
}

export default createFauna;
