// prefs.ts — локальные (не сетевые) настройки слоя рендера: выбранный драйвер и
// расширения. Хранятся в localStorage; матч/детерминизм они не затрагивают.
//
// Относительный путь: ./frontend/src/render/prefs.ts

export interface RenderPrefs {
  driver: string;
  extensions: string[];
}

const DRIVER_KEY = "bc_renderDriver";
const EXT_KEY = "bc_renderExtensions";
const OPTIONS_KEY = "bc_renderOptions";
export const DEFAULT_DRIVER = "pixel-2d";

export function loadRenderPrefs(): RenderPrefs {
  try {
    const driver = localStorage.getItem(DRIVER_KEY) || DEFAULT_DRIVER;
    const raw = localStorage.getItem(EXT_KEY);
    const extensions: string[] = raw ? JSON.parse(raw) : [];
    return { driver, extensions: Array.isArray(extensions) ? extensions.map(String) : [] };
  } catch {
    return { driver: DEFAULT_DRIVER, extensions: [] };
  }
}

export function saveRenderPrefs(p: RenderPrefs): void {
  try {
    localStorage.setItem(DRIVER_KEY, p.driver);
    localStorage.setItem(EXT_KEY, JSON.stringify(p.extensions ?? []));
  } catch {
    /* localStorage недоступен */
  }
}

/** Настройки конкретного драйвера (например, mc-voxel). Карта driverId -> options. */
export function loadRenderOptions<T>(driver: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const value = map && typeof map === "object" ? map[driver] : undefined;
    return value && typeof value === "object" ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}

export function saveRenderOptions(driver: string, options: unknown): void {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    const map = raw ? JSON.parse(raw) : {};
    const next = map && typeof map === "object" ? map : {};
    next[driver] = options;
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
  } catch {
    /* localStorage недоступен */
  }
}
