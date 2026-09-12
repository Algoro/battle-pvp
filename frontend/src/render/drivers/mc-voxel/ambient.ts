// ambient.ts — «живой мир» воксельного драйвера: птицы, блочные облака и мышки.
// Только отображение (Math.random допустим), не влияет на игру.
//
// Относительный путь: ./frontend/src/render/drivers/mc-voxel/ambient.ts
import * as THREE from "three";
import type { TextureAtlas } from "./atlas.ts";
import type { RenderBounds } from "../../types.ts";

export interface VoxelAmbient {
  group: THREE.Group;
  update(dtMs: number, bounds: RenderBounds, timeMs: number): void;
  setBirds(on: boolean): void;
  setMice(on: boolean): void;
  setVoxelClouds(on: boolean): void;
  dispose(): void;
}

interface Bird {
  group: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  cx: number;
  cz: number;
  r: number;
  a: number;
  w: number;
  y: number;
  flap: number;
}

interface Mouse {
  group: THREE.Group;
  x: number;
  z: number;
  heading: number;
  speed: number;
  turnIn: number;
  bob: number;
}

interface Cloud {
  group: THREE.Group;
  speed: number;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function createAmbient(atlas: TextureAtlas): VoxelAmbient {
  const group = new THREE.Group();
  const birdMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0x3a3f46 });
  const wingMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0x565d66 });
  const mouseMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0x9a8d7f });
  const earMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0xc2a08a });
  const tailMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0x6b5a4a });
  const cloudMat = new THREE.MeshLambertMaterial({ map: atlas.tile("wool"), color: 0xf4f7ff });

  // --- Птицы ---
  const birds: Bird[] = [];
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.2, 0.26), birdMat);
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), birdMat);
    head.position.set(0.3, 0.06, 0);
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.5), wingMat);
    wingL.position.set(0, 0.06, -0.28);
    const wingR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.5), wingMat);
    wingR.position.set(0, 0.06, 0.28);
    g.add(body, head, wingL, wingR);
    group.add(g);
    birds.push({ group: g, wingL, wingR, cx: 13, cz: 13, r: rand(7, 15), a: rand(0, Math.PI * 2), w: rand(0.00035, 0.00065) * (Math.random() > 0.5 ? 1 : -1), y: rand(7, 12), flap: rand(0, Math.PI * 2) });
  }

  // --- Мышки ---
  const mice: Mouse[] = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.24, 0.28), mouseMat);
    body.position.y = 0.14;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mouseMat);
    head.position.set(0.32, 0.14, 0);
    const earL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.05), earMat);
    earL.position.set(0.28, 0.28, -0.09);
    const earR = earL.clone();
    earR.position.z = 0.09;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.05), tailMat);
    tail.position.set(-0.4, 0.12, 0);
    g.add(body, head, earL, earR, tail);
    group.add(g);
    mice.push({ group: g, x: rand(3, 23), z: rand(3, 23), heading: rand(-Math.PI, Math.PI), speed: rand(0.0015, 0.0032), turnIn: rand(800, 3000), bob: rand(0, Math.PI * 2) });
  }

  // --- Блочные облака ---
  const clouds: Cloud[] = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const puffs = [
      [0, 0, 0, 3, 1.2, 2.2],
      [-1.6, 0.2, 0.4, 1.8, 1, 1.6],
      [1.7, 0.1, -0.5, 1.6, 0.9, 1.5],
      [0.3, 0.7, 0.2, 1.6, 0.9, 1.4],
    ];
    for (const [x, y, z, sx, sy, sz] of puffs) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), cloudMat);
      m.position.set(x, y, z);
      g.add(m);
    }
    g.position.set(rand(0, 26), rand(16, 22), rand(0, 26));
    group.add(g);
    clouds.push({ group: g, speed: rand(0.0006, 0.0014) });
  }

  function update(dtMs: number, b: RenderBounds, timeMs: number): void {
    const cx = b.cols / 2;
    const cz = b.rows / 2;

    for (const bird of birds) {
      bird.cx = cx;
      bird.cz = cz;
      bird.a += bird.w * dtMs;
      const x = bird.cx + Math.cos(bird.a) * bird.r;
      const z = bird.cz + Math.sin(bird.a) * bird.r;
      const y = bird.y + Math.sin(timeMs * 0.001 + bird.flap) * 0.6;
      bird.group.position.set(x, y, z);
      // Курс — по касательной к окружности.
      bird.group.rotation.y = -bird.a + (bird.w > 0 ? 0 : Math.PI);
      const flap = Math.sin(timeMs * 0.02 + bird.flap) * 0.7;
      bird.wingL.rotation.x = flap;
      bird.wingR.rotation.x = -flap;
    }

    for (const mouse of mice) {
      mouse.turnIn -= dtMs;
      if (mouse.turnIn <= 0) {
        mouse.heading += rand(-1.4, 1.4);
        mouse.turnIn = rand(800, 3000);
      }
      mouse.x += Math.cos(mouse.heading) * mouse.speed * dtMs;
      mouse.z += Math.sin(mouse.heading) * mouse.speed * dtMs;
      // Держимся в пределах поля.
      if (mouse.x < 1 || mouse.x > b.cols - 1 || mouse.z < 1 || mouse.z > b.rows - 1) {
        mouse.x = Math.max(1, Math.min(b.cols - 1, mouse.x));
        mouse.z = Math.max(1, Math.min(b.rows - 1, mouse.z));
        mouse.heading += Math.PI;
      }
      mouse.group.position.set(mouse.x, 0, mouse.z);
      mouse.group.rotation.y = -mouse.heading;
      mouse.group.position.y = Math.abs(Math.sin(timeMs * 0.02 + mouse.bob)) * 0.04;
    }

    for (const cloud of clouds) {
      cloud.group.position.x += cloud.speed * dtMs;
      if (cloud.group.position.x > b.cols + 10) cloud.group.position.x = -10;
    }
  }

  return {
    group,
    update,
    setBirds(on: boolean) {
      for (const bird of birds) bird.group.visible = on;
    },
    setMice(on: boolean) {
      for (const mouse of mice) mouse.group.visible = on;
    },
    setVoxelClouds(on: boolean) {
      for (const cloud of clouds) cloud.group.visible = on;
    },
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose?.();
      });
      for (const mat of [birdMat, wingMat, mouseMat, earMat, tailMat, cloudMat]) {
        mat.map?.dispose?.();
        mat.dispose();
      }
    },
  };
}

export default createAmbient;
