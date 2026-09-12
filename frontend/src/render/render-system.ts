// render-system.ts — хост СЛОЯ РЕНДЕРА: композиция «один драйвер + N расширений».
//
// Пайплайн кадра:
//   scene -> driver.setScene -> ext.beforeRender (в порядке) -> driver.render
//         -> ext.afterRender (в обратном порядке)
//
// Хост не знает о детерминизме и не вызывает ядро: сцену он получает провайдером.
//
// Относительный путь: ./frontend/src/render/render-system.ts
import { CameraRig } from "./camera-rig.ts";
import { canonicalRenderExtensions, driverCapabilities, rendererById, resolveDriver, resolveExtensions } from "./registry.ts";
import { loadRenderOptions } from "./prefs.ts";
import { normalizeValues, specDefaults } from "./settings.ts";
import { emptyScene } from "./scene-state.ts";
import type { RenderDriver, RenderExtension, RenderHost, SceneState } from "./types.ts";

export interface RenderSystemOptions {
  container: HTMLElement;
  scene: () => SceneState;
}

export interface ExtensionStatus {
  id: string;
  state: "active" | "skipped";
  reason?: string;
}

export class RenderSystem {
  readonly camera = new CameraRig();
  driverId = "";
  readonly extensionStatus: ExtensionStatus[] = [];

  private container: HTMLElement;
  private sceneProvider: () => SceneState;
  private driver: RenderDriver | null = null;
  private extensions: { id: string; ext: RenderExtension }[] = [];
  private capabilities = new Set<string>();
  private host: RenderHost;
  private generation = 0;
  private lastT = 0;
  private obs: ResizeObserver | null = null;
  private pendingOptions: unknown = undefined;

  constructor(opts: RenderSystemOptions) {
    this.container = opts.container;
    this.sceneProvider = opts.scene;
    this.host = {
      container: opts.container,
      width: 256,
      height: 240,
      capabilities: this.capabilities,
      camera: this.camera,
      scene: emptyScene(),
      dtMs: 0,
      shared: {},
      viewer: { port: 0 },
    };
    this.measure();
  }

  /** Указать локального игрока (порт танка) — для камер «из глаз». */
  setViewer(viewer: { port: number }): void {
    this.host.viewer = { port: viewer.port | 0 };
  }

  private measure(): void {
    const w = this.container.clientWidth || 256;
    const h = this.container.clientHeight || 240;
    this.host.width = w;
    this.host.height = h;
  }

  async init(driverId: string, extensionIds: unknown): Promise<void> {
    await this.setDriver(driverId);
    await this.setExtensions(extensionIds);
    this.observeResize();
  }

  async setDriver(id: string): Promise<boolean> {
    const gen = ++this.generation;
    let next: RenderDriver;
    try {
      next = await resolveDriver(id);
    } catch (err) {
      if (this.driver) return false;
      throw err;
    }
    if (gen !== this.generation) {
      try {
        next.dispose();
      } catch {
        /* устаревший кандидат */
      }
      return false;
    }
    // Новая связка: расширения пересобираются под capabilities нового драйвера.
    await this.disposeExtensions();
    this.disposeDriver();
    this.capabilities = driverCapabilities(id);
    this.host.capabilities = this.capabilities;
    this.host.shared = {};
    this.driver = next;
    this.driverId = id;
    this.measure();
    try {
      await next.mount(this.host);
    } catch (err) {
      try {
        next.dispose();
      } catch {
        /* ignore */
      }
      this.driver = null;
      this.driverId = "";
      this.capabilities = new Set();
      this.host.capabilities = this.capabilities;
      // Откат на безопасный пиксельный драйвер (например, нет WebGL).
      if (id !== "pixel-2d") {
        const fallback = await resolveDriver("pixel-2d").catch(() => null);
        if (fallback) {
          this.driver = fallback;
          this.driverId = "pixel-2d";
          this.capabilities = driverCapabilities("pixel-2d");
          this.host.capabilities = this.capabilities;
          this.host.shared = {};
          await fallback.mount(this.host);
          this.applyStoredOptions("pixel-2d");
          this.applyPendingOptions();
          this.resize(this.container.clientWidth, this.container.clientHeight);
          return true;
        }
      }
      throw err;
    }
    if (gen !== this.generation) return false;
    this.applyStoredOptions(id);
    this.applyPendingOptions();
    this.resize(this.container.clientWidth, this.container.clientHeight);
    return true;
  }

  /** Применить сохранённые в prefs настройки драйвера (независимо от UI-панели). */
  private applyStoredOptions(id: string): void {
    const spec = rendererById(id)?.settings;
    if (!spec || !this.driver?.setOptions) return;
    this.driver.setOptions(normalizeValues(spec, loadRenderOptions(id, specDefaults(spec))));
  }

  private applyPendingOptions(): void {
    if (this.pendingOptions !== undefined) this.driver?.setOptions?.(this.pendingOptions);
  }

  async setExtensions(ids: unknown): Promise<void> {
    await this.disposeExtensions();
    this.extensionStatus.length = 0;
    const compatible: string[] = [];
    for (const id of canonicalRenderExtensions(ids)) {
      const info = rendererById(id);
      if (!info || info.kind !== "extension") {
        this.extensionStatus.push({ id, state: "skipped", reason: "неизвестное расширение" });
        continue;
      }
      const missing = (info.requires ?? []).filter((cap) => !this.capabilities.has(cap));
      if (missing.length) {
        this.extensionStatus.push({ id, state: "skipped", reason: `нет capabilities: ${missing.join(", ")}` });
        continue;
      }
      compatible.push(id);
    }
    const resolved = await resolveExtensions(compatible);
    for (const { id, ext } of resolved) {
      try {
        await ext.mount(this.host);
        this.extensions.push({ id, ext });
        this.extensionStatus.push({ id, state: "active" });
      } catch (err) {
        this.extensionStatus.push({ id, state: "skipped", reason: String((err as Error)?.message ?? err) });
      }
    }
  }

  /** Отрисовать текущий кадр. Вызывается из игрового цикла (после step/advance/draw). */
  frame(): void {
    const now = performance.now();
    const dt = this.lastT ? Math.min(100, now - this.lastT) : 16.7;
    this.lastT = now;
    this.measure();
    const scene = this.sceneProvider();
    this.host.scene = scene;
    this.host.dtMs = dt;
    for (const { ext } of this.extensions) ext.beforeRender?.(scene, dt);
    if (this.driver) {
      this.driver.setScene(scene);
      this.driver.render(dt);
    }
    for (let i = this.extensions.length - 1; i >= 0; i--) this.extensions[i].ext.afterRender?.(scene, dt);
  }

  /** Передать локальные настройки активному драйверу (если он их поддерживает). */
  setDriverOptions(options: unknown): void {
    this.pendingOptions = options;
    this.driver?.setOptions?.(options);
  }

  resize(width = this.container.clientWidth, height = this.container.clientHeight): void {
    this.host.width = width || 256;
    this.host.height = height || 240;
    this.driver?.resize(this.host.width, this.host.height);
    for (const { ext } of this.extensions) ext.resize?.(this.host.width, this.host.height);
  }

  observeResize(): void {
    if (this.obs || typeof ResizeObserver === "undefined") return;
    this.obs = new ResizeObserver(() => this.resize());
    this.obs.observe(this.container);
  }

  private async disposeExtensions(): Promise<void> {
    for (const { ext } of this.extensions) {
      try {
        ext.dispose?.();
      } catch {
        /* ignore */
      }
    }
    this.extensions = [];
  }

  private disposeDriver(): void {
    if (!this.driver) return;
    try {
      this.driver.dispose();
    } catch {
      /* ignore */
    }
    this.driver = null;
    this.driverId = "";
  }

  dispose(): void {
    this.obs?.disconnect();
    this.obs = null;
    void this.disposeExtensions();
    this.disposeDriver();
  }
}

export default RenderSystem;
