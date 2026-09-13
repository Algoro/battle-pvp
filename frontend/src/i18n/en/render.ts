// en/render.ts — English translations (source Russian string -> English).
// Filled by localization; keep keys exactly as the Russian source strings.
const messages: Record<string, string> = {
  // --- Выбор драйвера/расширений (RenderSettings) -----------------------------
  "Вид: {name}": "View: {name}",
  "Драйвер": "Driver",
  "Расширения": "Extensions",
  "нет: {list}": "missing: {list}",
  "Камера": "Camera",
  "Масштаб": "Zoom",
  "Поворот (Yaw)": "Rotation (Yaw)",
  "Наклон (Pitch)": "Tilt (Pitch)",
  "Крен (Roll)": "Roll",
  "Тилт поля X": "Field tilt X",
  "Тилт поля Z": "Field tilt Z",
  "Сверху": "Top",
  "Изометрия": "Isometric",
  "Низко": "Low",
  "Сброс": "Reset",
  "Мышь: ЛКМ — орбита, ПКМ/Shift — сдвиг, колесо — масштаб. Клавиши: Q/E, R/F, T/G, H, 1/2/3.":
    "Mouse: LMB — orbit, RMB/Shift — pan, wheel — zoom. Keys: Q/E, R/F, T/G, H, 1/2/3.",
  "Применить пресет": "Apply preset",
  "Пиксельный вид (ROM)": "Pixel view (ROM)",

  // --- Статусы RenderSystem ----------------------------------------------------
  "неизвестное расширение": "unknown extension",
  "нет capabilities: {caps}": "missing capabilities: {caps}",
  "3D-карта · кадр {n}": "3D map · frame {n}",
  "particles: three-контекст недоступен": "particles: three context unavailable",

  // --- Манифест: драйверы ------------------------------------------------------
  "Пиксельный (NES)": "Pixel (NES)",
  "Оригинальный кадр PPU, 256×240, pixel-perfect.": "Original PPU frame, 256×240, pixel-perfect.",
  "3D сверху": "3D top-down",
  "Объёмное поле с вращением, наклоном и масштабом.": "Volumetric field with rotation, tilt, and zoom.",
  "Воксельный (sandbox)": "Voxel (sandbox)",
  "Кубические блоки, пиксельные текстуры, небо и день/ночь — настраиваемый стиль.":
    "Cubic blocks, pixel textures, sky and day/night — a customizable style.",

  // --- Манифест: расширения ----------------------------------------------------
  "Миникарта": "Minimap",
  "Угловая схема поля поверх любого драйвера.": "Corner field map over any driver.",
  "Частицы и искры": "Particles and sparks",
  "Вспышки взрывов и атмосферные частицы (только 3D).": "Explosion flashes and atmospheric particles (3D only).",

  // --- Настройки драйвера (shared/renderers.ts) --------------------------------
  "Обзор (орбита)": "Overview (orbit)",
  "От третьего лица": "Third person",
  "Из глаз": "First person",
  "«От третьего лица» / «Из глаз» — вид от танка игрока.":
    "\"Third person\" / \"First person\" — view from the player's tank.",
  "Доворачивать за танком": "Follow the tank",
  "Плавно доворачивать камеру к направлению движения — во всех режимах (орбита/третье/из глаз).":
    "Smoothly rotate the camera toward the movement direction — in all modes (orbit/third/first).",
  "Время суток": "Time of day",
  "Полдень": "Noon",
  "День": "Day",
  "Закат": "Sunset",
  "Ночь": "Night",
  "Цикл": "Cycle",
  "Освещение": "Lighting",
  "Мягкое": "Soft",
  "Плоское": "Flat",
  "Сглаженный свет (AO)": "Smooth lighting (AO)",
  "Плавный": "Smooth",
  "Простой": "Simple",
  "Выкл": "Off",
  "Тени": "Shadows",
  "Мягкие": "Soft",
  "Туман": "Fog",
  "Облака": "Clouds",
  "Блочные": "Blocky",
  "Плоские": "Flat",
  "Птицы": "Birds",
  "Мышки": "Mice",
  "Вода": "Water",
  "Анимированная": "Animated",
  "Простая": "Simple",
  "Частицы": "Particles",
  "Текстуры": "Textures",
  "Обзор (FOV)": "FOV",
  "Контур блоков": "Block outline",
  "Виньетка": "Vignette",
  "Дрейф облаков": "Cloud drift",

  // --- Пресеты драйвера (shared/renderers.ts) ---------------------------------
  "Классика": "Classic",
  "Выживание": "Survival",
  "Кинематограф": "Cinematic",
  "Производительность": "Performance",
  "Ретро": "Retro",
};
export default messages;
