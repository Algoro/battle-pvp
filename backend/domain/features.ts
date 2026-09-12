// features.ts — допустимые опциональные фичи-патчи (домен).
// Список выводится из единого манифеста shared/features.ts (UI/валидация/реестр не
// дублируют метаданные). Синхронность с реестром патчей стережёт qa-тест.
//
// Относительный путь: ./backend/domain/features.ts
import { FEATURE_IDS } from "../../shared/features.ts";

export const SUPPORTED_FEATURES: string[] = [...FEATURE_IDS];
const SUPPORTED = new Set(SUPPORTED_FEATURES);

/** Канонический список фич: известные, уникальные, отсортированные. */
export function normalizeFeatures(features: unknown): string[] {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  return [...new Set(arr.map((x) => String(x)))].filter((id) => SUPPORTED.has(id)).sort();
}

export default { SUPPORTED_FEATURES, normalizeFeatures };
