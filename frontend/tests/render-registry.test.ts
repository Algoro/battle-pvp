// render-registry.test.ts — контракт слоя рендера: манифест ↔ реестр, capabilities, kind.
import { test } from "node:test";
import assert from "node:assert";
import {
  assertRenderersConsistent,
  canonicalRenderExtensions,
  driverCapabilities,
  listRenderers,
  rendererById,
  resolveDriver,
  resolveExtensions,
} from "../src/render/registry.ts";
import { RENDER_IDS } from "../../shared/renderers.ts";

test("render-registry: манифест и реестр согласованы", () => {
  assert.doesNotThrow(() => assertRenderersConsistent());
  assert.deepStrictEqual(
    listRenderers()
      .map((r) => r.id)
      .sort(),
    [...RENDER_IDS].sort(),
  );
});

test("render-registry: виды/kind и capabilities", () => {
  assert.strictEqual(rendererById("pixel-2d")?.kind, "driver");
  assert.strictEqual(rendererById("topdown-3d")?.kind, "driver");
  assert.strictEqual(rendererById("minimap")?.kind, "extension");
  assert.ok(driverCapabilities("topdown-3d").has("camera"));
  assert.ok(driverCapabilities("pixel-2d").has("canvas2d"));
});

test("render-registry: canonicalRenderExtensions — уникальные и отсортированные", () => {
  assert.deepStrictEqual(canonicalRenderExtensions(["particles", "minimap", "particles"]), ["minimap", "particles"]);
  assert.deepStrictEqual(canonicalRenderExtensions(null), []);
});

test("render-registry: разрешение только своего kind", async () => {
  await assert.rejects(() => resolveDriver("minimap"), /не драйвер/);
  await assert.rejects(() => resolveDriver("nope"), /неизвестный драйвер/);
  const exts = await resolveExtensions(["minimap", "nope"]);
  assert.deepStrictEqual(
    exts.map((e) => e.id),
    ["minimap"],
  );
});
