// features.ts — метаданные опциональных фич-патчей для UI.
// id должны совпадать с backend/domain/features.js и emulator-core/patching/registry.js
// (синхронность стережёт qa-тест).

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
}

export const OPTIONAL_FEATURES: FeatureInfo[] = [
  {
    id: "pistol",
    title: "Пистолет (супер-оружие)",
    description: "Приз «пистолет» и 4-я звезда: луч, сносящий всё по линии.",
  },
];

export const FEATURE_IDS = OPTIONAL_FEATURES.map((f) => f.id);

export default OPTIONAL_FEATURES;
