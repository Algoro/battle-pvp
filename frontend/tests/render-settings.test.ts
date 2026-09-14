// render-settings.test.ts — universal settings of render plugins via a declarative schema.
import { test } from "node:test";
import assert from "node:assert";
import { rendererById } from "../../shared/renderers.ts";
import { applyPreset, normalizeValues, specDefaults } from "../src/render/settings.ts";

const spec = rendererById("meine-tank")!.settings!;

test("render-settings: схема meine-tank объявлена и содержит камеру", () => {
  assert.ok(spec, "у meine-tank должна быть схема настроек");
  const cam = spec.fields.find((f) => f.id === "cameraMode");
  assert.ok(cam, "нет настройки cameraMode");
  assert.strictEqual(cam!.default, "orbit");
  assert.ok(cam!.options?.some((o) => o.value === "first"), "нет режима «из глаз»");
  assert.ok(cam!.options?.some((o) => o.value === "third"), "нет режима «от третьего лица»");
  assert.ok(spec.presets && spec.presets.length > 0);
});

test("render-settings: экспериментальный рейтрейсинг объявлен", () => {
  const rt = spec.fields.find((f) => f.id === "rayTracing");
  assert.ok(rt, "нет настройки rayTracing");
  assert.strictEqual(rt!.default, "off");
  assert.deepStrictEqual(rt!.options?.map((o) => o.value), ["off", "on", "ultra"]);
  assert.strictEqual(normalizeValues(spec, { rayTracing: "ultra" }).rayTracing, "ultra");
  assert.strictEqual(normalizeValues(spec, { rayTracing: "nope" }).rayTracing, "off");
});

test("render-settings: рейтрейсинг внешнего мира — отдельная опция", () => {
  const f = spec.fields.find((x) => x.id === "outerRayTracing");
  assert.ok(f, "нет настройки outerRayTracing");
  assert.strictEqual(f!.default, false);
  assert.strictEqual(normalizeValues(spec, { outerRayTracing: true }).outerRayTracing, true);
});

test("render-settings: у драйвера без схемы настроек нет", () => {
  assert.strictEqual(rendererById("pixel-2d")?.settings, undefined);
});

test("render-settings: дефолты и нормализация", () => {
  const d = specDefaults(spec);
  assert.strictEqual(d.cameraMode, "orbit");
  assert.strictEqual(d.cameraFollow, true);
  assert.strictEqual(d.clouds, "voxel");
  assert.strictEqual(d.fauna, "ambient");
  assert.strictEqual(d.fov, 70);
  const n = normalizeValues(spec, { fog: 9, time: "nope", cameraMode: "first", textureSize: 32, outline: true });
  assert.strictEqual(n.fog, 1);
  assert.strictEqual(n.time, "day");
  assert.strictEqual(n.cameraMode, "first");
  assert.strictEqual(n.textureSize, 32);
  assert.strictEqual(n.outline, true);
});

test("render-settings: пресет меняет значения, не затирая отсутствующие поля", () => {
  const current = normalizeValues(spec, { outerBiome: "desert", fog: 0.9 });
  const next = applyPreset(spec, "performance", current);
  assert.strictEqual(next.ao, "off");
  assert.strictEqual(next.shadows, "off");
  assert.strictEqual(next.particles, 0);
  assert.strictEqual(next.outerBiome, "desert", "поле вне пресета сохраняется");
  assert.strictEqual(next.fog, 0.2, "поле из пресета перезаписывается");
});
