// features.ts — единый манифест опциональных фич (метаданные для UI/валидации).
//
// Источник истины по `id/title/description`. Из него выводятся:
//   * backend SUPPORTED_FEATURES (валидация настроек лобби),
//   * frontend OPTIONAL_FEATURES (чекбоксы в UI),
//   * emulator-core listFeatures() (сверяется с реестром патчей).
// Добавление фичи: строка здесь + registerFeature в emulator-core (+ patch/runtime).
// UI и backend править НЕ нужно.
//
// Модуль намеренно без импортов (его подключают все слои, включая domain).

export interface FeatureInfo {
  id: string;
  title: string;
  description: string;
  /** true — не показывать в общем выборе патчей (включается отдельным режимом). */
  hidden?: boolean;
}

export const FEATURE_MANIFEST: FeatureInfo[] = [
  {
    id: "pistol",
    title: "Пистолет (супер-оружие)",
    description: "Приз «пистолет» и 4-я звезда: луч, сносящий всё по линии.",
  },
  {
    id: "enemy-prizes",
    title: "Враги берут призы",
    description: "Танки 2..7 забирают приз и получают его эффект (каска — нет).",
  },
  {
    id: "friendly-fire-def",
    title: "Friendly fire (защитники)",
    description: "Попадание защитника в союзника убивает его.",
  },
  {
    id: "friendly-fire-att",
    title: "Friendly fire (атакующие)",
    description: "Попадание врага в союзного врага наносит урон.",
  },
  {
    id: "player-names",
    title: "Имена над танками",
    description: "Имя игрока отображается над его танком (шрифт ROM).",
  },
  {
    id: "pacman",
    title: "Pac-Man (сбор точек)",
    description: "Лабиринт из бетона, DEF собирают точки; бомбы-призы; победа по зачистке.",
  },
  {
    id: "tower-defence",
    title: "Tower Defence",
    description: "Соло-режим обороны: покупка и расстановка неподвижных танков-башен, волны врагов.",
    hidden: true,
  },
];

export const FEATURE_IDS: string[] = FEATURE_MANIFEST.map((f) => f.id);

export default FEATURE_MANIFEST;
