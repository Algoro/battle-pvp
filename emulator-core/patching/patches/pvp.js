// pvp.js — PvP-патч ROM: детерминированный PRNG + сетевое управление ATT-танками
// + per-player респавн. Все хуки — строго равного размера (JMP/JSR + NOP-пады),
// чтобы адреса оригинального кода не сдвигались.
//
// Раскладка рутин фиксирована явными `at` (совпадает с исторически собранным ROM).
// Внутренние переходы рутин оставлены литеральными байтами (адреса оригинального
// кода фиксированы); хуки используют символические JMP/JSR (релокация линкером).
//
// Относительный путь: ./emulator-core/patching/patches/pvp.js
import { hex, jmp, jsr, jmpT, jsrT, absT, selfJmpT } from "../descriptor.js";

export const pvp = {
  id: "pvp",
  version: 1,
  description: "Детерминированный PRNG, сетевой ввод ATT, per-player respawn",
  routines: [
    {
      // X = индекс танка (2..7). Сетевой dir если задан, иначе оригинальный AI.
      symbol: "sub_net_enemy_dir",
      at: 0xef75,
      bytes: [
        0x8a, 0x38, 0xe9, 0x02, 0xa8,
        0xb9, absT("ram_net_enemy_dir"),
        0x30, 0x03, 0x09, 0xa0, 0x60,
        jmpT("bra_DDE4"),
      ],
    },
    {
      symbol: "sub_net_enemy_dir_store",
      at: 0xef85,
      bytes: [
        0x8a, 0x38, 0xe9, 0x02, 0xa8,
        0xb9, absT("ram_net_enemy_dir"),
        0x30, 0x05, 0x09, 0xa0, 0x95, 0xa0, 0x60, 0x60,
      ],
    },
    {
      // Скан слотов 2..7: пустой слот + запрос респавна -> sub_E363, сброс флага.
      // Вход EF95 (LDX #$07), цель цикла EF97 (CPX #$02) = self+2.
      symbol: "sub_net_respawn_check",
      at: 0xef95,
      bytes: [
        0xa2, 0x07, 0xe0, 0x02, 0x90, 0x1b, 0xb5, 0xa0, 0xd0, 0x13,
        0x8a, 0x38, 0xe9, 0x02, 0xa8,
        0xb9, absT("ram_net_enemy_respawn"),
        0xf0, 0x09,
        jsrT("sub_E363_tank_spawn_handler"),
        0xa9, 0x00, 0x99, absT("ram_net_enemy_respawn"), 0x60, 0xca,
        selfJmpT(2), // 4C 97 EF -> цикл на CPX #$02
        0x60,
      ],
    },
    {
      // Обёртка спавна: сначала per-player респавн, затем оригинальный таймер.
      symbol: "sub_DB48_patched",
      at: 0xefb7,
      bytes: [
        jsrT("sub_net_respawn_check"),
        0xa5, 0x82, 0xf0, 0x03, 0xc6, 0x82, 0x60,
        jmpT("bra_DB4F"),
      ],
    },
    {
      // Сетевой огонь: при ram_net_enemy_fire!=0 A=0 (выстрел); иначе оригинальный RNG.
      symbol: "sub_net_enemy_fire_check",
      at: 0xefc4,
      bytes: [
        0x8a, 0x38, 0xe9, 0x02, 0xa8,
        0xb9, absT("ram_net_enemy_fire"),
        0xd0, 0x03,
        jmpT("sub_D44D_generate_random_number"),
        0xa9, 0x00, 0x60,
      ],
    },
    {
      // Вход sub_DE72: сетевое направление, иначе оригинальное продолжение на DE75.
      symbol: "sub_DE72_patched",
      at: 0xefe0,
      bytes: [
        0x8a, 0x38, 0xe9, 0x02, 0xa8,
        0xb9, absT("ram_net_enemy_dir"),
        0xc9, 0xff, 0xf0, 0x05, 0x09, 0xa0, 0x95, 0xa0, 0x60,
        0xa5, 0x84, 0x4a,
        jmpT("loc_DE75"),
      ],
    },
  ],
  writes: [
    {
      id: "prng-deterministic",
      at: 0xd45a,
      len: 6,
      // было: INC $10; LDX $10; ADC $00,X
      expect: hex("E6 10 A6 10 75 00"),
      // стало: CLC; ADC $0B; NOP NOP NOP  => random = (random*7 + frm_hi + frm_lo) & FF
      bytes: hex("18 65 0B EA EA EA"),
    },
    {
      id: "spawn-handler",
      at: 0xdb48,
      len: 7,
      expect: hex("A5 82 F0 03 C6 82 60"),
      bytes: jmp("sub_DB48_patched", 7),
    },
    {
      id: "enemy-dir",
      at: 0xddd4,
      len: 7,
      expect: hex("20 4D D4 29 01 F0 09"),
      bytes: jmp("sub_net_enemy_dir", 7),
    },
    {
      id: "enemy-target",
      at: 0xde72,
      len: 3,
      expect: hex("A5 84 4A"),
      bytes: jmp("sub_DE72_patched", 3),
    },
    {
      id: "enemy-turn",
      at: 0xde84,
      len: 5,
      expect: hex("20 4D D4 29 03"),
      bytes: jmp("sub_net_enemy_dir_store", 5),
    },
    {
      id: "enemy-fire",
      at: 0xe171,
      len: 5,
      expect: hex("20 4D D4 29 1F"),
      bytes: jsr("sub_net_enemy_fire_check", 5),
    },
  ],
};

export default pvp;
