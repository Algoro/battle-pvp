// registry.ts — реестр драйверов и расширений рендерера (по образцу патч-реестра).
//
// Метаданные — в shared/renderers.ts; здесь только проводка id -> ленивая загрузка.
// Ленивость важна: тяжёлый `three` подгружается лишь при выборе 3D-драйвера.
//
// Относительный путь: ./frontend/src/render/registry.ts
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

/** Канонический список id расширений: уникальные, отсортированные. */
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

/** Загрузить драйвер по id (kind обязан быть "driver"). */
export async function resolveDriver(id: string): Promise<RenderDriver> {
  const info = rendererById(id);
  if (!info) throw new Error(`неизвестный драйвер рендера: ${id}`);
  if (info.kind !== "driver") throw new Error(`«${id}» — не драйвер (kind=${info.kind})`);
  return (await create(id)) as RenderDriver;
}

/** Загрузить активные расширения в каноническом порядке. */
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

/** Capabilities, которые предоставляет драйвер. */
export function driverCapabilities(id: string): Set<string> {
  return new Set(rendererById(id)?.provides ?? []);
}

/** Сверка манифеста и реестра: одно без другого — ошибка конфигурации. */
export function assertRenderersConsistent(): void {
  const manifest = new Set(RENDER_MANIFEST.map((r) => r.id));
  for (const id of manifest) {
    if (!REGISTRY.has(id)) throw new Error(`renderer «${id}» в манифесте, но не зарегистрирован`);
  }
  for (const id of REGISTRY.keys()) {
    if (!manifest.has(id)) throw new Error(`renderer «${id}» зарегистрирован, но отсутствует в манифесте`);
  }
}

// --- Встроенные сущности -----------------------------------------------------

registerRenderer("pixel-2d", async () => (await import("./drivers/pixel-2d.ts")).createPixelDriver());
registerRenderer("topdown-3d", async () => (await import("./drivers/topdown-3d/driver.ts")).createTopdown3DDriver());
registerRenderer("mc-voxel", async () => (await import("./drivers/mc-voxel/driver.ts")).createMcVoxelDriver());
registerRenderer("minimap", async () => (await import("./extensions/minimap.ts")).createMinimapExtension());
registerRenderer("particles", async () => (await import("./extensions/particles.ts")).createParticlesExtension());

assertRenderersConsistent();
