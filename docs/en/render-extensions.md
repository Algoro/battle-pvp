> 🌐 **English** · [Русский](../render-extensions.md)

# Renderer drivers & extensions

> Status: **implemented** (`frontend/src/render/`: drivers `pixel-2d`, `topdown-3d`,
> `mc-voxel`; extensions `minimap`, `particles`). A type of entity parallel to "patches":
> a patch changes the **game** (ROM + JS runtime, determinism, fingerprint), while a renderer
> driver/extension changes **only the image** and is fully local.

## 1. Idea

We introduce a separate layer — the **Render Layer** — with two kinds of entities:

| Entity | Role | Active simultaneously |
|---|---|---|
| **RenderDriver** (renderer driver) | Fully determines the frame: creates the canvas/DOM, draws the scene. Can radically change the look (2D pixels, 3D, isometric, voxel, ASCII, thermal…) | **exactly one** |
| **RenderExtension** (renderer extension) | An additional layer on top of the driver: post-effects, overlays, particles, minimap, labels. | **zero or more, ordered** |

Both entities are plugins: `id`, metadata, lazy loading, registry, a single manifest,
like patch features. Composition: `driver + [extensions]`.

Key difference from patches:

| | Patch (feature) | Renderer driver/extension |
|---|---|---|
| What it changes | logic/ROM in memory | display only |
| Determinism | required, affects `getFrameHash` | does not affect it at all |
| Fingerprint / netcode | part of the set, verified | **no**, local to each client |
| Manifest | `shared/features.ts` | `shared/renderers.ts` |
| Layer | `emulator-core` (+shared/backend/ui) | `frontend` (+shared manifest) |
| Feedback into the game | yes (RAM) | **forbidden** |

## 2. Manifest (single source of metadata)

`shared/renderers.ts` — a mirror of `shared/features.ts`, without imports:

```ts
export type RenderKind = "driver" | "extension";

export interface RendererInfo {
  id: string;
  kind: RenderKind;
  title: string;
  description: string;
  /** capabilities, которые даёт драйвер (для драйверов). */
  provides?: string[];
  /** capabilities, которые требует расширение (для расширений). */
  requires?: string[];
  order?: number; // порядок наложения расширений (по умолчанию 1000)
  /** Декларативная схема настроек драйвера (авто-UI и пресеты). */
  settings?: RenderSettingsSpec;
}

export const RENDER_MANIFEST: RendererInfo[] = [
  { id: "pixel-2d",   kind: "driver",    title: "Пиксельный (NES)",
    description: "Оригинальный кадр PPU, 256×240, pixel-perfect.", provides: ["canvas2d"] },
  { id: "topdown-3d", kind: "driver",    title: "3D сверху",
    description: "Объёмное поле с вращением, наклоном и масштабом.",
    provides: ["three", "camera", "overlay-dom"] },
  { id: "mc-voxel",   kind: "driver",    title: "Воксельный (sandbox)",
    description: "Кубические блоки, пиксельные текстуры, небо и день/ночь.",
    provides: ["three", "camera", "overlay-dom", "voxel"] },
  { id: "minimap",    kind: "extension", title: "Миникарта",
    description: "Угловая схема поля поверх любого драйвера.", requires: ["overlay-dom"], order: 30 },
  { id: "particles",  kind: "extension", title: "Частицы и искры",
    description: "Вспышки взрывов и атмосферные частицы (только 3D).", requires: ["three"], order: 20 },
];

export const RENDER_IDS = RENDER_MANIFEST.map((r) => r.id);
export default RENDER_MANIFEST;
```

Rules: a driver and an extension with the same `id` are not allowed; the `requires` of an extension must
intersect with the `provides` of the active driver, otherwise the extension is **skipped**
(with a status in the UI, without an error).

## 3. Contracts (types)

`frontend/src/render/types.ts`:

```ts
import type { CameraRig } from "./camera-rig";

/** Авторитетный срез для отрисовки. Неизменяемый; формируется из RAM (readScene). */
export interface SceneState { /* см. docs/render-3d.md §4 */ }

/** Общий контекст, который хост даёт любому драйверу/расширению. */
export interface RenderHost {
  container: HTMLElement; // точка монтирования (драйвер сам создаёт canvas/DOM)
  width: number;
  height: number;
  capabilities: Set<string>;
  camera: CameraRig;
  scene: SceneState;
  /** Миллисекунды с прошлого кадра (для анимаций; НЕ для игровой логики). */
  dtMs: number;
  /** Произвольный обмен между драйвером и расширениями (например, three-контекст). */
  shared: Record<string, unknown>;
  /** Локальный игрок (камера «из глаз»): порт танка. */
  viewer: { port: number };
}

export interface RenderDriver {
  readonly id: string;
  /** Ленивая загрузка уже выполнена хостом; здесь — создание канваса/сцены. */
  mount(host: RenderHost): void | Promise<void>;
  setScene(scene: SceneState): void;
  resize(width: number, height: number): void;
  render(dtMs: number): void;      // рисует кадр
  dispose(): void;
  setOptions?(options: unknown): void; // необязательные локальные настройки
}

export interface RenderExtension {
  readonly id: string;
  order?: number;
  mount(host: RenderHost): void | Promise<void>;
  beforeRender?(scene: SceneState, dtMs: number): void; // до драйвера (in order)
  afterRender?(scene: SceneState, dtMs: number): void;  // после драйвера (reverse)
  resize?(width: number, height: number): void;
  dispose?(): void;
}
```

## 4. Registry (modeled on the patch registry)

`frontend/src/render/registry.ts`:

```ts
registerRenderer(id: string, load: () => Promise<RenderDriver | RenderExtension>);
resolveDriver(id): Promise<RenderDriver>;
resolveExtensions(ids: string[]): Promise<{ id: string; ext: RenderExtension }[]>;
listRenderers(): RendererInfo[];         // из shared/renderers.ts
assertRenderersConsistent(): void;        // манифест ↔ реестр, уникальность id, kind
canonicalRenderExtensions(ids): string[]; // уникальные, отсортированные
```

- Loading is **lazy**: `load` does `await import("./drivers/topdown-3d.ts")` and the like.
  Therefore `three` and heavy drivers do not get into the base bundle.
- `assertRenderersConsistent()` is called on module initialization — as with patches.
- Dependency resolution: an extension with an unsatisfied `requires` is not loaded/mounted,
  but marked `skipped` (not a critical error).

## 5. Composition host — `RenderSystem`

`frontend/src/render/render-system.ts` — the owner of the active combination:

```ts
class RenderSystem {
  constructor(opts: { container: HTMLElement; scene: () => SceneState });
  setDriver(id: string): Promise<void>;          // выключает старый, монтирует новый
  setExtensions(ids: string[]): Promise<void>;   // пересобирает стек
  resize(w: number, h: number): void;
  frame(): void;                                  // scene -> beforeRender -> setScene/render -> afterRender
  driverId: string;
  extensionStatus: { id: string; state: "active" | "skipped"; reason?: string }[];
  dispose(): void;
}
```

Frame pipeline:

```
scene() ──► for ext of active: ext.beforeRender(scene, dt)   // прямой порядок
         ─► driver.setScene(scene); driver.render(dt)
         ─► for ext of active (reverse): ext.afterRender(scene, dt)
```

- **One driver**; when switching, the old driver/extensions are released before mounting
  the new one; on a mount error — fallback to `pixel-2d` (not to the previous one).
- **`frame()` is called from the game tick** (solo/online/spectator) — along with `draw()`.
- Animations/camera damping — inside `driver.render`/the host's rAF, the core is **not stepped**.
- Changing the driver rebuilds the extension stack by `requires`.
- WebGL context lost/no WebGL → the driver reports an error, the host falls back to
  `pixel-2d`.

## 6. Lifecycle

```
idle ──setDriver(mount ok)──► live ──setDriver/ошибка──► disposing ──► idle
                                  │
                                  └── setExtensions: diff пересобирает только изменения
```

- An asynchronous `mount` (lazy import) is cancelled via a generation token: a stale
  mount is not applied.
- `resize` — from the container's ResizeObserver.
- `dispose` is mandatory to release WebGL resources/listeners/DOM.

## 7. Selection and storage (local)

- The setting is **not** in the match lobby settings and is **not** broadcast over the network.
- Persistence in `localStorage`: `bc_renderDriver`, `bc_renderExtensions` (a JSON array of ids).
- UI: a driver selector + extension checkboxes (with the note "local, does not affect the match"),
  a `skipped` indicator with the reason (incompatible driver).
- In solo/online/spectator — the same `<RenderSettings>` in the header.
- **Before the match starts**: `<RenderPicker>` with a live `<RendererPreview>`
  (3D — a rotating demo scene, 2D — a stage preview from ROM) in `LobbyBrowser`,
  `CreateRoomDialog`, `LobbyRoom`. The choice is saved immediately and picked up at start.

## 7.1 Plugin settings (declarative settings)

Each driver/extension can declare its settings right in the manifest:
`RendererInfo.settings = { fields: RenderSettingSpec[], presets?: RenderPresetSpec[] }`.
A field describes `id/label/type(select|range|toggle)/default/options|min|max|step/group`.

- The universal form `RenderSettingsForm.tsx` draws the UI from the schema — without code specific
  to a driver; `RendererSettingsPanel.tsx` loads/saves the values
  (`bc_renderOptions`), applies them via `RenderSystem.setDriverOptions` (with a queue until
  mounting) and is connected in `RenderPicker` (preview) and `RenderSettings` (battle).
- Utilities `render/settings.ts`: `specDefaults`, `normalizeValues` (validation/clamp by the
  schema), `applyPreset`.
- The driver validates the input with its own `normalize` (for mc-voxel — on top of the same schema) and
  implements `setOptions`. Structural changes (e.g. `textureSize`, `shadows`)
  rebuild the driver's world.
- Local player for first-person cameras: `RenderHost.viewer = { port }`;
  `RenderSystem.setViewer({ port })` is called by `GameCanvas`/`SpectateView`/the preview.
  Example: `mc-voxel.cameraMode = "orbit" | "third" | "first"` (plus `cameraFollow` —
  a smooth turn toward the tank's direction in all modes; manual input temporarily takes priority).
  A driver may also have non-standard subsystems via its own settings — for example,
  the "living world" of `mc-voxel`: `birds`, `mice`, `clouds = off|flat|voxel`.

## 8. Integration with the core

`EmulatorDriver` loses its own frame drawing and becomes a pure game core
(`stepFrame/saveState/loadState/getFrameHash/readMem/...`). Rendering is moved into
`RenderSystem`, to which a scene provider is passed:

```ts
// GameCanvas / SpectateView
const render = new RenderSystem({ container, scene: () => readScene(emulator) });
render.setDriver(savedDriver()); render.setExtensions(savedExtensions());
// в игровом тике: после step/advancedraw -> render.frame(dtMs)
```

Invariant: `RenderSystem`/drivers/extensions accept **only** `SceneState` and never
call core methods that change state.

## 9. Invariants and checks

- **The game does not change**: `getFrameHash()`/`saveState()` are identical with any active
  driver/extension and without them (core golden test).
- **SceneState is read-only**: `readScene(mem)` does not mutate `mem`; identical `mem` →
  identical snapshot.
- **Manifest ↔ registry**: enforcement test `qa/tests/renderers.test.ts`.
- **Isolation**: `three`/DOM/`render/*` are not imported from `emulator-core`/`netcode`/
  `backend`; `shared/renderers.ts` — without imports (`qa/tests/architecture.test.ts`).
- **Extension compatibility**: `requires ⊆ provides(driver)` otherwise `skipped`.
- **No `Math.random`/`Date.now` in state-critical code**: only `SceneState.frame`.

## 10. Example entities (demonstrating a "radically different look")

- **Drivers**: `pixel-2d` (current), `topdown-3d` (see `render-3d.md`),
  `voxel`, `isometric-3d`, `ascii` (text map), `thermal`.
- **Extensions**: `crt` (post-effect for 2D), `particles` (three), `cartoon-outline`
  (three), `minimap` (DOM overlay), `team-labels`, `night-vision` (shader filter).
