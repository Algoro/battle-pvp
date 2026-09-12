// friendly-fire-att.ts — ROM-дескриптор фичи `friendly-fire-att` (полностью JS-рантайм).
//
// Коллизии «враг-пуля → другой враг» в ROM нет, поэтому проход целиком реализован
// JS-рантаймом (features/friendly-fire-att.ts); ROM не патчится.
//
// Относительный путь: ./emulator-core/patching/patches/friendly-fire-att.ts
export const friendlyFireAtt = {
  id: "friendly-fire-att",
  version: 1,
  description: "Попадание врага в союзного врага наносит урон (с бронёй и призом)",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default friendlyFireAtt;
