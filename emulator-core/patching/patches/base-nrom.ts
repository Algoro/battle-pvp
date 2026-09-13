// base-nrom.js — base ROM metadata and the shared symbol table.
//
// IMPORTANT: base.fingerprint — FNV-1a32 over the ORIGINAL PRG-ROM. Any other ROM will be
// rejected (PATCH_BASE_MISMATCH), which protects against patching a wrong revision.
//
// Relative path: ./emulator-core/patching/patches/base-nrom.js

export const baseNrom = {
  id: "base:nrom",
  version: 1,
  description: "Battle City (Japan), NROM, 1x16K PRG",
  base: {
    mapper: 0,
    prgBanks: 1,
    fingerprint: "b8a818c1", // FNV-1a32 of the original PRG-ROM
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
    // --- network RAM area (must match bank_ram.inc and emulator-core/pvp.js) ---
    ram_net_enemy_dir: 0x01db,
    ram_net_enemy_fire: 0x01e1,
    ram_net_enemy_respawn: 0x01e7,
    ram_net_enemy_state: 0x01ed,
    // --- super-weapon "pistol" (continuation of the free area after net) ---
    ram_pistol: 0x01ee, // 2 bytes: 1 = the player owns the super-weapon
    ram_pistol_ammo: 0x01f0, // 2 bytes: remaining super-shots
    // --- original-code labels ---
    bra_DDE4: 0xdde4,
    bra_DB4F: 0xdb4f,
    loc_DE75: 0xde75,
    sub_E363_tank_spawn_handler: 0xe363,
    sub_D44D_generate_random_number: 0xd44d,
  },
  // Free area (filled with 0xFF, not addressed in the original) for new code.
  free: [{ start: 0xef75, end: 0xefff }],
  routines: [],
  writes: [],
};

export default baseNrom;
