// registry.ts — registry of renderer drivers and extensions (modeled on the patch registry).
//
// Metadata is in shared/renderers.ts; here only the id -> lazy load wiring.
// Laziness matters: the heavy `three` is loaded only when a 3D driver is selected.
//
// Relative path: ./frontend/src/render/registry.ts
import { RENDER_MANIFEST, rendererById, type RendererInfo } from "../../../shared/renderers.ts";
import type { RenderDriver, RenderExtension } from "./types.ts";

export { rendererById };

type Loader = () => Promise<RenderDriver | RenderExtension>;

interface Entry {
  info: RendererInfo;
  load: Loader;
}

const REGISTRY = new Map<string, Entry>();

export function registerRenderer(id: string, load: Loader): void {
  const info = rendererById(id);
  if (!info) throw new Error(`renderer «${id}» отсутствует в shared/renderers.ts`);
  if (REGISTRY.has(id)) throw new Error(`renderer «${id}» уже зарегистрирован`);
  REGISTRY.set(id, { info, load });
}

export function listRenderers(): RendererInfo[] {
  return RENDER_MANIFEST.map((r) => ({ ...r }));
}

/** Canonical list of extension ids: unique, sorted. */
export function canonicalRenderExtensions(ids: unknown): string[] {
  if (!ids) return [];
  const arr = Array.isArray(ids) ? ids : [ids];
  return [...new Set(arr.map((x) => String(x)).filter(Boolean))].sort();
}

async function create(id: string): Promise<RenderDriver | RenderExtension> {
  const entry = REGISTRY.get(id);
  if (!entry) throw new Error(`renderer «${id}» не зарегистрирован`);
  const inst = await entry.load();
  if (!inst || typeof inst !== "object" || typeof (inst as RenderDriver).mount !== "function") {
    throw new Error(`renderer «${id}»: некорректная реализация (нет mount)`);
  }
  return inst;
}

/** Load a driver by id (kind must be "driver"). */
export async function resolveDriver(id: string): Promise<RenderDriver> {
  const info = rendererById(id);
  if (!info) throw new Error(`неизвестный драйвер рендера: ${id}`);
  if (info.kind !== "driver") throw new Error(`«${id}» — не драйвер (kind=${info.kind})`);
  return (await create(id)) as RenderDriver;
}

/** Load active extensions in canonical order. */
export async function resolveExtensions(ids: unknown): Promise<{ id: string; ext: RenderExtension }[]> {
  const out: { id: string; ext: RenderExtension }[] = [];
  for (const id of canonicalRenderExtensions(ids)) {
    const info = rendererById(id);
    if (!info || info.kind !== "extension") continue;
    const ext = (await create(id)) as RenderExtension;
    out.push({ id, ext });
    out.sort((a, b) => extOrder(a.ext) - extOrder(b.ext) || a.id.localeCompare(b.id));
  }
  return out;
}

function extOrder(ext: RenderExtension): number {
  const info = rendererById(ext.id);
  return ext.order ?? info?.order ?? 1000;
}

/** Capabilities provided by the driver. */
export function driverCapabilities(id: string): Set<string> {
  return new Set(rendererById(id)?.provides ?? []);
}

/** Check the manifest against the registry: one without the other is a configuration error. */
export function assertRenderersConsistent(): void {
  const manifest = new Set(RENDER_MANIFEST.map((r) => r.id));
  for (const id of manifest) {
    if (!REGISTRY.has(id)) throw new Error(`renderer «${id}» в манифесте, но не зарегистрирован`);
  }
  for (const id of REGISTRY.keys()) {
    if (!manifest.has(id)) throw new Error(`renderer «${id}» зарегистрирован, но отсутствует в манифесте`);
  }
}

// --- Built-in entities -----------------------------------------------------

registerRenderer("pixel-2d", async () => (await import("./drivers/pixel-2d.ts")).createPixelDriver());
registerRenderer("topdown-3d", async () => (await import("./drivers/topdown-3d/driver.ts")).createTopdown3DDriver());
registerRenderer("meine-tank", async () => (await import("./drivers/meine-tank/driver.ts")).createMeineTankDriver());
registerRenderer("minimap", async () => (await import("./extensions/minimap.ts")).createMinimapExtension());
registerRenderer("particles", async () => (await import("./extensions/particles.ts")).createParticlesExtension());

assertRenderersConsistent();
