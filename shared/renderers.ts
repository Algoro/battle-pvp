// renderers.ts — unified manifest of the RENDER LAYER (metadata of drivers and extensions).
//
// These are NOT game patches (see shared/features.ts): drivers/extensions change only
// the image, are fully local, do not participate in the fingerprint and do not affect determinism.
//
// Source of truth for `id/kind/provides/requires/order`. From it are derived:
//   * the render registry (frontend/src/render/registry.ts) — checked by assertRenderersConsistent;
//   * UI for choosing driver/extensions (RenderSettings).
// Adding an entity: a line here + registerRenderer in the registry (+ driver module).
//
// The module intentionally has no imports.

export type RenderKind = "driver" | "extension";

export type SettingValue = string | number | boolean;

export interface RenderSettingOption {
  value: SettingValue;
  label: string;
}

/** Declarative description of a single driver/extension setting (for auto-UI). */
export interface RenderSettingSpec {
  id: string;
  label: string;
  type: "select" | "range" | "toggle";
  default: SettingValue;
  options?: RenderSettingOption[];
  min?: number;
  max?: number;
  step?: number;
  group?: string;
  hint?: string;
}

/** Ready-made preset of values by setting id. */
export interface RenderPresetSpec {
  id: string;
  label: string;
  values: Record<string, SettingValue>;
}

export interface RenderSettingsSpec {
  fields: RenderSettingSpec[];
  presets?: RenderPresetSpec[];
}

export interface RendererInfo {
  id: string;
  kind: RenderKind;
  title: string;
  description: string;
  /** capabilities provided by the driver (for kind="driver"). */
  provides?: string[];
  /** capabilities required by the extension (for kind="extension"). */
  requires?: string[];
  /** Order of applying extensions (lower — earlier). Defaults to 1000. */
  order?: number;
  /** Plugin settings (generate UI automatically). */
  settings?: RenderSettingsSpec;
}

// --- Meine Tank (Minecraft-fidelity voxel driver) ---

const MT_FIELDS: RenderSettingSpec[] = [
  {
    id: "cameraMode",
    label: "Камера",
    type: "select",
    default: "orbit",
    group: "Камера",
    options: [
      { value: "orbit", label: "Обзор (орбита)" },
      { value: "third", label: "От третьего лица" },
      { value: "first", label: "Из глаз" },
    ],
  },
  { id: "cameraFollow", label: "Доворачивать за танком", type: "toggle", default: true, group: "Камера" },
  { id: "fov", label: "Обзор (FOV)", type: "range", default: 70, min: 50, max: 95, step: 1, group: "Камера" },
  {
    id: "time",
    label: "Время суток",
    type: "select",
    default: "day",
    group: "Мир",
    options: [
      { value: "noon", label: "Полдень" },
      { value: "day", label: "День" },
      { value: "sunset", label: "Закат" },
      { value: "night", label: "Ночь" },
      { value: "cycle", label: "Цикл" },
    ],
  },
  {
    id: "lighting",
    label: "Освещение",
    type: "select",
    default: "mc",
    group: "Мир",
    options: [
      { value: "mc", label: "Мягкое" },
      { value: "flat", label: "Плоское" },
    ],
  },
  {
    id: "ao",
    label: "Сглаженный свет (AO)",
    type: "select",
    default: "smooth",
    group: "Мир",
    options: [
      { value: "smooth", label: "Плавный" },
      { value: "simple", label: "Простой" },
      { value: "off", label: "Выкл" },
    ],
  },
  {
    id: "shadows",
    label: "Тени",
    type: "select",
    default: "off",
    group: "Мир",
    options: [
      { value: "off", label: "Выкл" },
      { value: "soft", label: "Мягкие" },
    ],
  },
  { id: "fog", label: "Туман", type: "range", default: 0.35, min: 0, max: 1, step: 0.05, group: "Мир" },
  {
    id: "clouds",
    label: "Облака",
    type: "select",
    default: "voxel",
    group: "Мир",
    options: [
      { value: "voxel", label: "Блочные" },
      { value: "flat", label: "Плоские" },
      { value: "off", label: "Выкл" },
    ],
  },
  {
    id: "water",
    label: "Вода",
    type: "select",
    default: "animated",
    group: "Мир",
    options: [
      { value: "animated", label: "Анимированная" },
      { value: "simple", label: "Простая" },
      { value: "off", label: "Выкл" },
    ],
  },
  {
    id: "decor",
    label: "Декор",
    type: "select",
    default: "light",
    group: "Мир",
    options: [
      { value: "full", label: "Полный" },
      { value: "light", label: "Лёгкий" },
      { value: "off", label: "Выкл" },
    ],
  },
  {
    id: "theme",
    label: "Тема стадии",
    type: "select",
    default: "classic",
    group: "Мир",
    options: [
      { value: "classic", label: "Классика" },
      { value: "desert", label: "Пустыня" },
      { value: "wasteland", label: "Пустошь" },
    ],
  },
  { id: "particles", label: "Частицы", type: "range", default: 1, min: 0, max: 2, step: 1, group: "Мир" },
  {
    id: "textureSize",
    label: "Текстуры",
    type: "select",
    default: 32,
    group: "Мир",
    options: [
      { value: 32, label: "32 px (Faithful)" },
      { value: 16, label: "16 px" },
    ],
  },
  { id: "outline", label: "Контур блоков", type: "toggle", default: false, group: "Мир" },
  { id: "exposure", label: "Экспозиция", type: "range", default: 1, min: 0.6, max: 1.6, step: 0.05, group: "Графика" },
  {
    id: "normalMaps",
    label: "Рельеф (normal maps)",
    type: "toggle",
    default: true,
    group: "Графика",
    hint: "Процедурные normal-map из albedo: объём у блоков и кирпича.",
  },
  {
    id: "rayTracing",
    label: "Рейтрейсинг (эксперимент)",
    type: "select",
    default: "off",
    group: "Графика",
    options: [
      { value: "off", label: "Выкл" },
      { value: "on", label: "Вкл (GTAO + SSR)" },
      { value: "ultra", label: "Ультра (больше сэмплов)" },
    ],
    hint: "Screen-space GI: качественный ambient occlusion, отражения, bloom и мягкие тени + IBL. Требует WebGL2 и заметно грузит GPU.",
  },
  {
    id: "outerRayTracing",
    label: "RT для внешнего мира",
    type: "toggle",
    default: false,
    group: "Графика",
    hint: "Отражать реки и отбрасывать тени холмами/деревьями за ареной: широкая теневая карта 4096² и SSR на реках. Работает только при включённом рейтрейсинге и заметно тяжелее.",
  },
  {
    id: "border",
    label: "Граница арены",
    type: "select",
    default: "edge",
    group: "Внешний мир",
    options: [
      { value: "off", label: "Нет" },
      { value: "edge", label: "Обрыв-плато" },
      { value: "wall", label: "Стена" },
    ],
    hint: "Убирает эффект «арена висит в пустоте».",
  },
  {
    id: "outerWorld",
    label: "Мир за границей",
    type: "select",
    default: "hills",
    group: "Внешний мир",
    options: [
      { value: "off", label: "Выкл" },
      { value: "hills", label: "Холмы" },
      { value: "full", label: "Полный (реки, леса, вулканы)" },
    ],
  },
  {
    id: "outerBiome",
    label: "Биом",
    type: "select",
    default: "mixed",
    group: "Внешний мир",
    options: [
      { value: "mixed", label: "Смешанный" },
      { value: "plains", label: "Равнины" },
      { value: "forest", label: "Леса" },
      { value: "desert", label: "Пустыня" },
      { value: "snow", label: "Снега" },
      { value: "volcanic", label: "Вулканический" },
    ],
  },
  {
    id: "outerRadius",
    label: "Радиус мира",
    type: "range",
    default: 56,
    min: 24,
    max: 96,
    step: 8,
    group: "Внешний мир",
  },
  { id: "outerRivers", label: "Реки и вода", type: "toggle", default: true, group: "Внешний мир" },
  { id: "outerTrees", label: "Деревья", type: "toggle", default: true, group: "Внешний мир" },
  { id: "outerVolcano", label: "Вулканы", type: "toggle", default: true, group: "Внешний мир" },
  { id: "outerMobs", label: "Мобы за границей", type: "toggle", default: true, group: "Внешний мир" },
  { id: "outerDragons", label: "Драконы", type: "toggle", default: false, group: "Внешний мир" },
  {
    id: "fauna",
    label: "Живая природа",
    type: "select",
    default: "ambient",
    group: "Фауна",
    options: [
      { value: "off", label: "Выкл" },
      { value: "ambient", label: "Фоновая" },
      { value: "lively", label: "Живая (реагирует)" },
    ],
    hint: "Пчёлы, птицы, летучие мыши и аллеи; плотность и группы — ниже.",
  },
  { id: "faunaDensity", label: "Плотность фауны", type: "range", default: 1, min: 0, max: 2, step: 1, group: "Фауна" },
  { id: "faunaBees", label: "Пчёлы", type: "toggle", default: true, group: "Фауна" },
  { id: "faunaBirds", label: "Птицы (попугаи, куры)", type: "toggle", default: true, group: "Фауна" },
  { id: "faunaBats", label: "Летучие мыши", type: "toggle", default: true, group: "Фауна" },
  { id: "faunaAllay", label: "Аллеи", type: "toggle", default: true, group: "Фауна" },
  { id: "faunaSmall", label: "Мелкие (кролики, лисы, кошки)", type: "toggle", default: false, group: "Фауна" },
  { id: "faunaLivestock", label: "Скот (коровы, свиньи)", type: "toggle", default: false, group: "Фауна" },
  { id: "faunaAquatic", label: "Водные (лягушки, аксолотли)", type: "toggle", default: false, group: "Фауна" },
  {
    id: "faunaTime",
    label: "Время фауны",
    type: "select",
    default: "auto",
    group: "Фауна",
    options: [
      { value: "auto", label: "По времени суток" },
      { value: "day", label: "Всегда днём" },
      { value: "night", label: "Всегда ночью" },
    ],
  },
  { id: "faunaShadows", label: "Тени фауны", type: "toggle", default: false, group: "Фауна" },
];

const MT_PRESETS: RenderPresetSpec[] = [
  {
    id: "vanilla",
    label: "Ванилла",
    values: {
      time: "day",
      lighting: "mc",
      ao: "smooth",
      shadows: "off",
      fog: 0.3,
      clouds: "voxel",
      water: "animated",
      decor: "light",
      theme: "classic",
      particles: 1,
      textureSize: 32,
      outline: false,
      fauna: "ambient",
      faunaDensity: 1,
      faunaTime: "auto",
      exposure: 1,
      normalMaps: true,
      border: "edge",
      outerWorld: "hills",
      outerBiome: "mixed",
      outerRadius: 56,
      outerRivers: true,
      outerTrees: true,
      outerVolcano: true,
      outerMobs: true,
      outerDragons: false,
    },
  },
  {
    id: "cinematic",
    label: "Кинематограф",
    values: {
      time: "sunset",
      lighting: "mc",
      ao: "smooth",
      shadows: "soft",
      fog: 0.5,
      clouds: "voxel",
      water: "animated",
      decor: "full",
      theme: "classic",
      particles: 2,
      textureSize: 32,
      outline: false,
      fauna: "lively",
      faunaDensity: 1,
      faunaTime: "auto",
      faunaSmall: true,
      faunaLivestock: true,
      faunaAquatic: true,
      exposure: 1.05,
      normalMaps: true,
      border: "edge",
      outerWorld: "full",
      outerBiome: "mixed",
      outerRadius: 72,
      outerRivers: true,
      outerTrees: true,
      outerVolcano: true,
      outerMobs: true,
      outerDragons: true,
    },
  },
  {
    id: "lively",
    label: "Живая природа",
    values: {
      time: "cycle",
      lighting: "mc",
      ao: "smooth",
      shadows: "off",
      fog: 0.35,
      clouds: "voxel",
      water: "animated",
      decor: "full",
      theme: "classic",
      particles: 2,
      textureSize: 32,
      outline: false,
      fauna: "lively",
      faunaDensity: 2,
      faunaTime: "auto",
      faunaBees: true,
      faunaBirds: true,
      faunaBats: true,
      faunaAllay: true,
      faunaSmall: true,
      faunaLivestock: true,
      faunaAquatic: true,
      exposure: 1,
      normalMaps: true,
      border: "edge",
      outerWorld: "full",
      outerBiome: "mixed",
      outerRadius: 72,
      outerRivers: true,
      outerTrees: true,
      outerVolcano: true,
      outerMobs: true,
      outerDragons: true,
    },
  },
  {
    id: "performance",
    label: "Производительность",
    values: {
      time: "noon",
      lighting: "flat",
      ao: "off",
      shadows: "off",
      fog: 0.2,
      clouds: "off",
      water: "simple",
      decor: "off",
      theme: "classic",
      particles: 0,
      textureSize: 16,
      outline: false,
      fauna: "ambient",
      faunaDensity: 0,
      faunaTime: "day",
      exposure: 1,
      normalMaps: false,
      faunaBees: true,
      faunaBirds: false,
      faunaBats: false,
      faunaAllay: false,
      border: "off",
      outerWorld: "off",
      outerMobs: false,
      outerDragons: false,
    },
  },
  {
    id: "retro16",
    label: "Ретро 16 px",
    values: {
      time: "day",
      lighting: "flat",
      ao: "simple",
      shadows: "off",
      fog: 0.25,
      clouds: "flat",
      water: "simple",
      decor: "light",
      theme: "classic",
      particles: 1,
      textureSize: 16,
      outline: true,
      fauna: "ambient",
      faunaDensity: 1,
      faunaTime: "auto",
      exposure: 1,
      normalMaps: false,
      border: "edge",
      outerWorld: "hills",
      outerBiome: "mixed",
      outerRadius: 56,
      outerRivers: false,
      outerTrees: true,
      outerVolcano: false,
      outerMobs: true,
      outerDragons: false,
    },
  },
];

export const RENDER_MANIFEST: RendererInfo[] = [
  {
    id: "pixel-2d",
    kind: "driver",
    title: "Пиксельный (NES)",
    description: "Оригинальный кадр PPU, 256×240, pixel-perfect.",
    provides: ["canvas2d"],
  },
  {
    id: "topdown-3d",
    kind: "driver",
    title: "3D сверху",
    description: "Объёмное поле с вращением, наклоном и масштабом.",
    provides: ["three", "camera", "overlay-dom"],
  },
  {
    id: "meine-tank",
    kind: "driver",
    title: "Meine Tank",
    description: "Воксельный мир на реальных текстурах Minecraft (Faithful 32x): блоки, мобы, частицы и небо.",
    provides: ["three", "camera", "overlay-dom", "voxel"],
    settings: { fields: MT_FIELDS, presets: MT_PRESETS },
  },
  {
    id: "minimap",
    kind: "extension",
    title: "Миникарта",
    description: "Угловая схема поля поверх любого драйвера.",
    requires: ["overlay-dom"],
    order: 30,
  },
  {
    id: "particles",
    kind: "extension",
    title: "Частицы и искры",
    description: "Вспышки взрывов и атмосферные частицы (только 3D).",
    requires: ["three"],
    order: 20,
  },
];

export const RENDER_IDS: string[] = RENDER_MANIFEST.map((r) => r.id);

export function rendererById(id: string): RendererInfo | undefined {
  return RENDER_MANIFEST.find((r) => r.id === id);
}

export default RENDER_MANIFEST;
