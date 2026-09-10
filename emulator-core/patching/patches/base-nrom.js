// base-nrom.js — метаданные базового ROM и общая таблица символов.
//
// ВАЖНО: base.fingerprint — FNV-1a32 по PRG-ROM ОРИГИНАЛА. Любой другой ROM будет
// отвергнут (PATCH_BASE_MISMATCH), что защищает от патчинга неверной ревизии.
//
// Относительный путь: ./emulator-core/patching/patches/base-nrom.js

export const baseNrom = {
  id: "base:nrom",
  version: 1,
  description: "Battle City (Japan), NROM, 1x16K PRG",
  base: {
    mapper: 0,
    prgBanks: 1,
    fingerprint: "b8a818c1", // FNV-1a32 PRG-ROM оригинала
    sha1: "941ad7ca825e3f86407472113aad00520cb45783",
    file: "rom/original/_battle_city.nes",
  },
  symbols: {
    // --- zero page ---
    ram_frm_cnt_hi: 0x000a,
    ram_frm_cnt_lo: 0x000b,
    ram_random: 0x000f,
    ram_enemy_timer_before_spawn: 0x0082,
    ram_enemy_spawn_interval: 0x0084,
    ram_tank_flags: 0x00a0,
    // --- сетевая RAM-зона (должна совпадать с bank_ram.inc и emulator-core/pvp.js) ---
    ram_net_enemy_dir: 0x01db,
    ram_net_enemy_fire: 0x01e1,
    ram_net_enemy_respawn: 0x01e7,
    ram_net_enemy_state: 0x01ed,
    // --- метки оригинального кода ---
    bra_DDE4: 0xdde4,
    bra_DB4F: 0xdb4f,
    loc_DE75: 0xde75,
    sub_E363_tank_spawn_handler: 0xe363,
    sub_D44D_generate_random_number: 0xd44d,
  },
  // Свободная зона (заполнена 0xFF, в оригинале не адресуется) под новый код.
  free: [{ start: 0xef75, end: 0xefff }],
  routines: [],
  writes: [],
};

export default baseNrom;
