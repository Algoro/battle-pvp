// friendly-fire-def.ts — ROM-дескриптор фичи `friendly-fire-def` (полностью JS-рантайм).
//
// ROM уже обрабатывает попадание DEF-пули в союзного DEF-танка (sub_E70C, 3-й проход),
// но эффект — стан. Фича меняет исход на смерть через JS-рантайм
// (features/friendly-fire-def.ts), поэтому ROM не патчится.
//
// Относительный путь: ./emulator-core/patching/patches/friendly-fire-def.ts
export const friendlyFireDef = {
  id: "friendly-fire-def",
  version: 1,
  description: "Попадание своего в своего у защитников убивает (вместо стана)",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default friendlyFireDef;
