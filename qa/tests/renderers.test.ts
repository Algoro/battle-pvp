// renderers.test.ts — контракт слоя рендера: манифест ↔ реестр и корректность метаданных.
import { test } from "node:test";
import assert from "node:assert";
import { RENDER_MANIFEST } from "../../shared/renderers.ts";
import { assertRenderersConsistent, listRenderers } from "../../frontend/src/render/registry.ts";

test("renderers: манифест и реестр согласованы", () => {
  assert.doesNotThrow(() => assertRenderersConsistent());
  const core = listRenderers()
    .map((r) => r.id)
    .sort();
  const manifest = RENDER_MANIFEST.map((r) => r.id).sort();
  assert.deepStrictEqual(core, manifest);
});

test("renderers: id уникальны, kind корректен, драйверы предоставляют capabilities", () => {
  const ids = RENDER_MANIFEST.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, "дубли id");
  for (const r of RENDER_MANIFEST) {
    assert.ok(r.kind === "driver" || r.kind === "extension", `неверный kind у ${r.id}`);
    assert.ok(r.title && r.description, `нет метаданных у ${r.id}`);
    if (r.kind === "driver") assert.ok((r.provides ?? []).length > 0, `драйвер ${r.id} без provides`);
    if (r.kind === "extension") assert.ok((r.requires ?? []).length > 0, `расширение ${r.id} без requires`);
  }
});

test("renderers: пиксельный драйвер присутствует как безопасный дефолт", () => {
  const pixel = RENDER_MANIFEST.find((r) => r.id === "pixel-2d");
  assert.ok(pixel && pixel.kind === "driver");
});
