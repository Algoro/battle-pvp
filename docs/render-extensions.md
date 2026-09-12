# Драйверы и расширения рендерера (render drivers & extensions)

> Статус: **реализовано** (`frontend/src/render/`: драйверы `pixel-2d`, `topdown-3d`,
> `mc-voxel`; расширения `minimap`, `particles`). Тип сущностей, параллельный «патчам»:
> патч меняет **игру** (ROM + JS-рантайм, детерминизм, fingerprint), а драйвер/расширение
> рендерера меняют **только изображение** и полностью локальны.

## 1. Идея

Вводим отдельный слой — **Render Layer** — с двумя видами сущностей:

| Сущность | Роль | Активных одновременно |
|---|---|---|
| **RenderDriver** (драйвер рендерера) | Полностью определяет кадр: создаёт канвас/DOM, рисует сцену. Может кардинально менять вид (2D-пиксели, 3D, изометрия, воксели, ASCII, тепловизор…). | **ровно один** |
| **RenderExtension** (расширение рендерера) | Добавочный слой поверх драйвера: пост-эффекты, оверлеи, частицы, миникарта, подписи. | **ноль и более, упорядочены** |

Обе сущности — плагины: `id`, метаданные, ленивая загрузка, реестр, единый манифест,
как у патч-фич. Композиция: `driver + [extensions]`.

Ключевое отличие от патчей:

| | Патч (feature) | Драйвер/расширение рендерера |
|---|---|---|
| Что меняет | логику/ROM в памяти | только отображение |
| Детерминизм | обязателен, влияет на `getFrameHash` | не влияет вообще |
| Fingerprint / netcode | входит в набор, сверяется | **нет**, локально у каждого |
| Манифест | `shared/features.ts` | `shared/renderers.ts` |
| Слой | `emulator-core` (+shared/backend/ui) | `frontend` (+shared manifest) |
| Обратная связь в игру | да (RAM) | **запрещена** |

## 2. Манифест (единый источник метаданных)

`shared/renderers.ts` — зеркало `shared/features.ts`, без импортов:

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

Правила: драйвер и расширение с одним `id` недопустимы; `requires` расширения обязаны
пересекаться с `provides` активного драйвера, иначе расширение **пропускается**
(со статусом в UI, без ошибки).

## 3. Контракты (типы)

`frontend/src/render/types.ts`:

```ts
import type { CameraRig } from "./camera-rig";

/** Авторитетный срез для отрисовки. Неизменяемый; формируется из RAM (readScene). */
export interface SceneState { /* см. docs/3d-view-plan.md §4 */ }

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

## 4. Реестр (по образцу патч-реестра)

`frontend/src/render/registry.ts`:

```ts
registerRenderer(id: string, load: () => Promise<RenderDriver | RenderExtension>);
resolveDriver(id): Promise<RenderDriver>;
resolveExtensions(ids: string[]): Promise<{ id: string; ext: RenderExtension }[]>;
listRenderers(): RendererInfo[];         // из shared/renderers.ts
assertRenderersConsistent(): void;        // манифест ↔ реестр, уникальность id, kind
canonicalRenderExtensions(ids): string[]; // уникальные, отсортированные
```

- Загрузка **ленивая**: `load` делает `await import("./drivers/topdown-3d.ts")` и т.п.
  Поэтому `three` и тяжёлые драйверы не попадают в базовый бандл.
- `assertRenderersConsistent()` вызывается при инициализации модуля — как у патчей.
- Разрешение зависимостей: расширение с невыполненным `requires` не грузится/не
  монтируется, а помечается `skipped` (не критическая ошибка).

## 5. Хост композиции — `RenderSystem`

`frontend/src/render/render-system.ts` — владелец активной связки:

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

Пайплайн кадра:

```
scene() ──► for ext of active: ext.beforeRender(scene, dt)   // прямой порядок
         ─► driver.setScene(scene); driver.render(dt)
         ─► for ext of active (reverse): ext.afterRender(scene, dt)
```

- **Один драйвер**; при переключении старый драйвер/расширения освобождаются до mount
  нового; при ошибке mount — откат на `pixel-2d` (не на предыдущий).
- **`frame()` вызывается из игрового тика** (соло/онлайн/spectator) — вместе с `draw()`.
- Анимации/демпфирование камеры — внутри `driver.render`/rAF хоста, ядро **не шагается**.
- Смена драйвера пересобирает стек расширений по `requires`.
- Контекст WebGL потерян/нет WebGL → драйвер сообщает об ошибке, хост откатывается на
  `pixel-2d`.

## 6. Жизненный цикл

```
idle ──setDriver(mount ok)──► live ──setDriver/ошибка──► disposing ──► idle
                                  │
                                  └── setExtensions: diff пересобирает только изменения
```

- Асинхронный `mount` (ленивый импорт) отменяем через токен поколения: устаревший
  mount не применяется.
- `resize` — из ResizeObserver контейнера.
- `dispose` обязателен для освобождения WebGL-ресурсов/слушателей/DOM.

## 7. Выбор и хранение (локально)

- Настройка **не** в лобби-настройках матча и **не** рассылается по сети.
- Персист в `localStorage`: `bc_renderDriver`, `bc_renderExtensions` (JSON-массив id).
- UI: селектор драйвера + чекбоксы расширений (с пометкой «локально, не влияет на матч»),
  индикатор `skipped` с причиной (несовместимый драйвер).
- В соло/онлайн/spectator — одинаковый `<RenderSettings>` в шапке.
- **До старта матча**: `<RenderPicker>` с живым предпросмотром `<RendererPreview>`
  (3D — вращающаяся демо-сцена, 2D — превью стадии из ROM) в `LobbyBrowser`,
  `CreateRoomDialog`, `LobbyRoom`. Выбор сохраняется сразу и подхватывается при старте.

## 7.1 Настройки плагинов (declarative settings)

Каждый драйвер/расширение может объявить свои настройки прямо в манифесте:
`RendererInfo.settings = { fields: RenderSettingSpec[], presets?: RenderPresetSpec[] }`.
Поле описывает `id/label/type(select|range|toggle)/default/options|min|max|step/group`.

- Универсальная форма `RenderSettingsForm.tsx` рисует UI по схеме — без кода под
  конкретный драйвер; `RendererSettingsPanel.tsx` грузит/сохраняет значения
  (`bc_renderOptions`), применяет через `RenderSystem.setDriverOptions` (с очередью до
  монтирования) и подключается в `RenderPicker` (предпросмотр) и `RenderSettings` (бой).
- Утилиты `render/settings.ts`: `specDefaults`, `normalizeValues` (валидация/clamp по
  схеме), `applyPreset`.
- Драйвер валидирует вход своим `normalize` (для mc-voxel — поверх той же схемы) и
  реализует `setOptions`. Структурные изменения (например, `textureSize`, `shadows`)
  пересобирают мир драйвера.
- Локальный игрок для камер «из глаз»: `RenderHost.viewer = { port }`;
  `RenderSystem.setViewer({ port })` вызывают `GameCanvas`/`SpectateView`/предпросмотр.
  Пример: `mc-voxel.cameraMode = "orbit" | "third" | "first"` (плюс `cameraFollow` —
  плавный доворот к направлению танка во всех режимах; ручной ввод временно приоритетнее).
  Драйвер может иметь и нестандартные подсистемы через свои же настройки — например,
  «живой мир» `mc-voxel`: `birds`, `mice`, `clouds = off|flat|voxel`.

## 8. Интеграция с ядром

`EmulatorDriver` теряет собственную отрисовку кадра и становится чистым игровым ядром
(`stepFrame/saveState/loadState/getFrameHash/readMem/...`). Рендер выносится в
`RenderSystem`, которому передаётся провайдер сцены:

```ts
// GameCanvas / SpectateView
const render = new RenderSystem({ container, scene: () => readScene(emulator) });
render.setDriver(savedDriver()); render.setExtensions(savedExtensions());
// в игровом тике: после step/advancedraw -> render.frame(dtMs)
```

Инвариант: `RenderSystem`/драйверы/расширения принимают **только** `SceneState` и никогда
не вызывают методы ядра, изменяющие состояние.

## 9. Инварианты и проверки

- **Игра не меняется**: `getFrameHash()`/`saveState()` идентичны при любом активном
  драйвере/расширении и при их отсутствии (golden-тест ядра).
- **SceneState — read-only**: `readScene(mem)` не мутирует `mem`; одинаковый `mem` →
  одинаковый снимок.
- **Манифест ↔ реестр**: enforcement-тест `qa/tests/renderers.test.ts`.
- **Изоляция**: `three`/DOM/`render/*` не импортируются из `emulator-core`/`netcode`/
  `backend`; `shared/renderers.ts` — без импортов (`qa/tests/architecture.test.ts`).
- **Совместимость расширений**: `requires ⊆ provides(driver)` иначе `skipped`.
- **Никакого `Math.random`/`Date.now` в критике состояния**: только `SceneState.frame`.

## 10. Примеры сущностей (демонстрация «кардинально разного вида»)

- **Драйверы**: `pixel-2d` (текущий), `topdown-3d` (см. `docs/3d-view-plan.md`),
  `voxel`, `isometric-3d`, `ascii` (текстовая карта), `thermal`.
- **Расширения**: `crt` (пост-эффект к 2D), `particles` (three), `cartoon-outline`
  (three), `minimap` (DOM-оверлей), `team-labels`, `night-vision` (шейдер-фильтр).

## 11. Этапы

| Фаза | Что |
|---|---|
| A | Тип сущностей: `shared/renderers.ts`, `render/types.ts`, `render/registry.ts`, `assertRenderersConsistent` + тесты |
| B | `RenderSystem` (гост): пайплайн, жизненный цикл, capabilities, откат; драйвер `pixel-2d` — перевод текущей отрисовки |
| C | Интеграция в `GameCanvas`/`SpectateView`: `RenderSettings`, персист, `frame()` в тике; ядро без рендера |
| D | Первый альтернативный драйвер `topdown-3d` (по `docs/3d-view-plan.md`) |
| E | Расширения (`crt`, `particles`, `minimap`) как проверка композиции |
| F | Enforcement-тесты, детерминизм-тест, docs (`docs/emulator-api.md`, README, `THIRD_PARTY.md`) |
