// renderers.ts — единый манифест СЛОЯ РЕНДЕРА (метаданные драйверов и расширений).
//
// Это НЕ игровые патчи (см. shared/features.ts): драйверы/расширения меняют только
// изображение, полностью локальны, не входят в fingerprint и не влияют на детерминизм.
//
// Источник истины по `id/kind/provides/requires/order`. Из него выводятся:
//   * реестр рендера (frontend/src/render/registry.ts) — сверяется assertRenderersConsistent;
//   * UI выбора драйвера/расширений (RenderSettings).
// Добавление сущности: строка здесь + registerRenderer в реестре (+ модуль драйвера).
//
// Модуль намеренно без импортов.

export type RenderKind = "driver" | "extension";

export type SettingValue = string | number | boolean;

export interface RenderSettingOption {
  value: SettingValue;
  label: string;
}

/** Декларативное описание одной настройки драйвера/расширения (для авто-UI). */
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

/** Готовый пресет значений по id настроек. */
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
  /** capabilities, которые предоставляет драйвер (для kind="driver"). */
  provides?: string[];
  /** capabilities, которые требует расширение (для kind="extension"). */
  requires?: string[];
  /** Порядок наложения расширений (меньше — раньше). По умолчанию 1000. */
  order?: number;
  /** Настройки плагина (генерируют UI автоматически). */
  settings?: RenderSettingsSpec;
}

const MC_FIELDS: RenderSettingSpec[] = [
  {
    id: "cameraMode", label: "Камера", type: "select", default: "orbit",
    options: [
      { value: "orbit", label: "Обзор (орбита)" },
      { value: "third", label: "От третьего лица" },
      { value: "first", label: "Из глаз" },
    ],
    hint: "«От третьего лица» / «Из глаз» — вид от танка игрока.",
  },
  {
    id: "cameraFollow", label: "Доворачивать за танком", type: "toggle", default: true,
    hint: "Плавно доворачивать камеру к направлению движения — во всех режимах (орбита/третье/из глаз).",
  },
  { id: "time", label: "Время суток", type: "select", default: "day", options: [
    { value: "noon", label: "Полдень" },
    { value: "day", label: "День" },
    { value: "sunset", label: "Закат" },
    { value: "night", label: "Ночь" },
    { value: "cycle", label: "Цикл" },
  ] },
  { id: "lighting", label: "Освещение", type: "select", default: "mc", options: [
    { value: "mc", label: "Мягкое" },
    { value: "flat", label: "Плоское" },
  ] },
  { id: "ao", label: "Сглаженный свет (AO)", type: "select", default: "smooth", options: [
    { value: "smooth", label: "Плавный" },
    { value: "simple", label: "Простой" },
    { value: "off", label: "Выкл" },
  ] },
  { id: "shadows", label: "Тени", type: "select", default: "off", options: [
    { value: "off", label: "Выкл" },
    { value: "soft", label: "Мягкие" },
  ] },
  { id: "fog", label: "Туман", type: "range", default: 0.35, min: 0, max: 1, step: 0.05 },
  { id: "clouds", label: "Облака", type: "select", default: "voxel", options: [
    { value: "voxel", label: "Блочные" },
    { value: "flat", label: "Плоские" },
    { value: "off", label: "Выкл" },
  ] },
  { id: "birds", label: "Птицы", type: "toggle", default: true },
  { id: "mice", label: "Мышки", type: "toggle", default: true },
  { id: "water", label: "Вода", type: "select", default: "animated", options: [
    { value: "animated", label: "Анимированная" },
    { value: "simple", label: "Простая" },
    { value: "off", label: "Выкл" },
  ] },
  { id: "particles", label: "Частицы", type: "range", default: 1, min: 0, max: 2, step: 1 },
  { id: "textureSize", label: "Текстуры", type: "select", default: 16, options: [
    { value: 16, label: "16 px" },
    { value: 32, label: "32 px" },
  ] },
  { id: "fov", label: "Обзор (FOV)", type: "range", default: 70, min: 50, max: 95, step: 1 },
  { id: "outline", label: "Контур блоков", type: "toggle", default: false },
  { id: "vignette", label: "Виньетка", type: "toggle", default: false },
  { id: "cloudsDrift", label: "Дрейф облаков", type: "toggle", default: true },
];

const MC_PRESETS: RenderPresetSpec[] = [
  { id: "classic", label: "Классика", values: { time: "day", lighting: "mc", ao: "smooth", shadows: "off", fog: 0.3, clouds: "voxel", birds: true, mice: true, water: "animated", particles: 1, outline: false, vignette: false, fov: 70 } },
  { id: "survival", label: "Выживание", values: { time: "cycle", lighting: "mc", ao: "smooth", shadows: "soft", fog: 0.45, clouds: "voxel", birds: true, mice: true, water: "animated", particles: 2, outline: false, vignette: true, fov: 75 } },
  { id: "cinematic", label: "Кинематограф", values: { time: "sunset", lighting: "mc", ao: "smooth", shadows: "soft", fog: 0.55, clouds: "voxel", birds: true, mice: true, water: "animated", particles: 2, outline: false, vignette: true, fov: 66 } },
  { id: "performance", label: "Производительность", values: { time: "noon", lighting: "flat", ao: "off", shadows: "off", fog: 0.2, clouds: "off", birds: false, mice: false, water: "simple", particles: 0, outline: false, vignette: false, fov: 70 } },
  { id: "retro", label: "Ретро", values: { time: "day", lighting: "mc", ao: "simple", shadows: "off", fog: 0.25, clouds: "flat", birds: false, mice: false, water: "simple", particles: 1, outline: true, vignette: false, fov: 72 } },
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
    id: "mc-voxel",
    kind: "driver",
    title: "Воксельный (sandbox)",
    description: "Кубические блоки, пиксельные текстуры, небо и день/ночь — настраиваемый стиль.",
    provides: ["three", "camera", "overlay-dom", "voxel"],
    settings: { fields: MC_FIELDS, presets: MC_PRESETS },
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
