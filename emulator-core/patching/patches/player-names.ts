// player-names.ts — ROM descriptor of the `player-names` feature (fully JS runtime).
//
// The player's name is drawn above his tank with BG nametable tiles, using the ROM font
// (tile index == ASCII code, CHR bank1). The ROM is not patched.
//
// Relative path: ./emulator-core/patching/patches/player-names.ts
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
