// features.ts — allowed optional feature patches (domain).
// The list is derived from the single manifest shared/features.ts (UI/validation/registry
// do not duplicate the metadata). A qa test guards sync with the patch registry.
//
// Relative path: ./backend/domain/features.ts
import { FEATURE_IDS } from "../../shared/features.ts";

export const SUPPORTED_FEATURES: string[] = [...FEATURE_IDS];
const SUPPORTED = new Set(SUPPORTED_FEATURES);

/** Canonical feature list: known, unique, sorted. */
export function normalizeFeatures(features: unknown): string[] {
  if (!features) return [];
  const arr = Array.isArray(features) ? features : [features];
  return [...new Set(arr.map((x) => String(x)))].filter((id) => SUPPORTED.has(id)).sort();
}

export default { SUPPORTED_FEATURES, normalizeFeatures };
