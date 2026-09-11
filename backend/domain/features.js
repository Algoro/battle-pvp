// features.js — допустимые опциональные фичи-патчи (домен).
// Список — контракт с фронтендом/ядром; синхронность проверяется qa-тестом
// (backend не импортирует emulator-core: слои независимы).
//
// Относительный путь: ./backend/domain/features.js

export const SUPPORTED_FEATURES = ["pistol"];

const SUPPORTED = new Set(SUPPORTED_FEATURES);

/** Канонический список фич: известные, уникальные, отсортированные. */
export function normalizeFeatures(features) {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  return [...new Set(arr.map((x) => String(x)))].filter((id) => SUPPORTED.has(id)).sort();
}

export default { SUPPORTED_FEATURES, normalizeFeatures };
