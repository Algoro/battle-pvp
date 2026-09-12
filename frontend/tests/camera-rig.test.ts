// camera-rig.test.ts — чистая математика камеры: орбита, крен, масштаб, панорама, пресеты.
import { test } from "node:test";
import assert from "node:assert";
import { CameraRig, PRESETS } from "../src/render/camera-rig.ts";

test("camera-rig: масштаб клампится в границах", () => {
  const rig = new CameraRig();
  rig.zoom(0.001);
  assert.strictEqual(rig.distance, rig.minDistance);
  rig.zoom(1000);
  assert.strictEqual(rig.distance, rig.maxDistance);
});

test("camera-rig: pitch не уходит под землю и не переворачивается", () => {
  const rig = new CameraRig();
  rig.orbit(0, -100);
  assert.strictEqual(rig.pitch, rig.minPitch);
  rig.orbit(0, 100);
  assert.strictEqual(rig.pitch, rig.maxPitch);
});

test("camera-rig: вращение по трём плоскостям (yaw/pitch/roll) и поля", () => {
  const rig = new CameraRig();
  const yaw0 = rig.yaw;
  rig.orbit(0.5, 0.1);
  assert.notStrictEqual(rig.yaw, yaw0);
  rig.rotateRoll(0.3);
  assert.strictEqual(rig.roll, 0.3);
  rig.rotateField(0.2, -0.4, 0.1);
  assert.deepStrictEqual(rig.fieldEuler, { x: 0.2, y: -0.4, z: 0.1 });
});

test("camera-rig: позиция выше цели и следует за ней", () => {
  const rig = new CameraRig();
  const p = rig.position();
  assert.ok(p.y > rig.target.y, "камера должна быть над целью");
  rig.target = { x: 5, y: 0, z: 7 };
  const q = rig.position();
  assert.ok(Math.abs(q.x - (5 + (p.x - 13))) < 1e-6);
  assert.ok(Math.abs(q.z - (7 + (p.z - 13))) < 1e-6);
});

test("camera-rig: панорама двигает цель, пресеты и сброс работают", () => {
  const rig = new CameraRig();
  const before = { ...rig.target };
  rig.pan(100, 0);
  assert.notDeepStrictEqual(rig.target, before);
  rig.setPreset("top");
  assert.strictEqual(rig.pitch, PRESETS.top.pitch);
  rig.setPreset("iso");
  assert.strictEqual(rig.yaw, PRESETS.iso.yaw);
  rig.reset();
  assert.deepStrictEqual(rig.target, { x: 13, y: 0, z: 13 });
  assert.strictEqual(rig.roll, 0);
  assert.deepStrictEqual(rig.fieldEuler, { x: 0, y: 0, z: 0 });
});

test("camera-rig: панорама согласована по осям X и Z (хват мира)", () => {
  const h = new CameraRig();
  h.yaw = 0;
  h.pan(100, 0);
  assert.ok(h.target.x < 13, "перетаскивание вправо сдвигает мир влево по X");
  assert.ok(Math.abs(h.target.z - 13) < 1e-9);

  const v = new CameraRig();
  v.yaw = 0;
  v.pan(0, 100);
  assert.ok(v.target.z < 13, "перетаскивание вниз сдвигает мир вверх по Z");
  assert.ok(Math.abs(v.target.x - 13) < 1e-9);
});
