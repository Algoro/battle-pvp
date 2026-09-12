// player-names.ts — ROM-дескриптор фичи `player-names` (полностью JS-рантайм).
//
// Имя игрока рисуется над его танком BG-тайлами nametable, используя шрифт ROM
// (tile index == ASCII-код, CHR bank1). ROM не патчится.
//
// Относительный путь: ./emulator-core/patching/patches/player-names.ts
export const playerNames = {
  id: "player-names",
  version: 1,
  description: "Имя игрока отображается над его танком шрифтом ROM",
  symbols: {},
  free: [],
  routines: [],
  writes: [],
};

export default playerNames;
