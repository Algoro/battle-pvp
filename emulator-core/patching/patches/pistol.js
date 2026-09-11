// pistol.js — PvP-патч ROM: приз «пистолет» (id 6) и супер-оружие.
//
// Что делает патч (правила получения — в ROM):
//   1. Разрешает выпадение приза id 6 (таблица tbl_E8FA_bonus).
//   2. Обработчик подбора id 6 -> sub_grant_super_weapon (флаг + боезапас).
//   3. 4-я звезда (звезда при upgrade == 0x60) -> тот же sub_grant_super_weapon.
//   4. Смерть игрока сбрасывает флаг/боезапас (хук на $E76A).
//
// Сам эффект «луч через весь экран» исполняет JS-ядро (PvPNes): см. emulator-core/pvp.js.
// Все хуки — строго равного размера (JMP/JSR + NOP-пады не нужны, длины совпадают).
//
// Относительный путь: ./emulator-core/patching/patches/pistol.js
import { hex, jmp, jsr, jmpT, absT } from "../descriptor.js";

export const pistol = {
  id: "pistol",
  version: 1,
  description: "Приз «пистолет»: выпадение, подбор, 4-я звезда, сброс при смерти",
  symbols: {
    ram_tank_upgrade: 0x0101,
    ram_tank_type: 0x00a8,
    ram_pistol: 0x01ee,
    ram_pistol_ammo: 0x01f0,
    ram_sfx_bonus_pickup: 0x0306,
  },
  // Свободная зона (0xFF) под новые рутины. Отдельная от pvp (EF75-EFFF).
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      // X = индекс игрока (0/1). Выдать супер-оружие и пополнить боезапас (N=3).
      symbol: "sub_grant_super_weapon",
      bytes: [
        0xa9, 0x01, // LDA #$01
        0x9d, absT("ram_pistol"), // STA ram_pistol,X
        0xa9, 0x03, // LDA #$03 (N выстрелов)
        0x9d, absT("ram_pistol_ammo"), // STA ram_pistol_ammo,X
        0xa9, 0x01, 0x8d, absT("ram_sfx_bonus_pickup"), // LDA #1; STA sfx_bonus_pickup
        0x60, // RTS
      ],
    },
    {
      // Хук входа обработчика звезды ($EA07): апгрейд или супер-оружие на 4-й звезде.
      // X = индекс игрока.
      symbol: "sub_star_pickup",
      bytes: [
        0xbd, 0x01, 0x01, // LDA ram_tank_upgrade,X
        0xc9, 0x60, // CMP #$60
        0xf0, 0x09, // BEQ .max (offset 16)
        0x18, // CLC
        0x69, 0x20, // ADC #$20
        0x9d, 0x01, 0x01, // STA ram_tank_upgrade,X
        0x95, 0xa8, // STA ram_tank_type,X
        0x60, // RTS
        jmpT("sub_grant_super_weapon"), // .max
      ],
    },
    {
      // Хук смерти игрока ($E76A): обнулить апгрейд и супер-оружие, оставив A=0
      // (следующая инструкция STA ram_tank_type,X использует A).
      symbol: "sub_clear_super_weapon",
      bytes: [
        0xa9, 0x00, // LDA #$00
        0x9d, 0x01, 0x01, // STA ram_tank_upgrade,X
        0x9d, absT("ram_pistol"), // STA ram_pistol,X
        0x9d, absT("ram_pistol_ammo"), // STA ram_pistol_ammo,X
        0x60, // RTS
      ],
    },
  ],
  writes: [
    {
      // tbl_E8FA_bonus[6]: было «граната» ($04) -> «пистолет» ($06).
      id: "allow-pistol-drop",
      at: 0xe900,
      len: 1,
      expect: hex("04"),
      bytes: hex("06"),
    },
    {
      // tbl_E9E2_bonus_pickup_handler[6]: было ofs_..._06_RTS ($EA48) -> grant.
      id: "pistol-pickup-handler",
      at: 0xe9ee,
      len: 2,
      expect: hex("48 EA"),
      bytes: (resolve) => {
        const a = resolve("sub_grant_super_weapon");
        return new Uint8Array([a & 0xff, (a >> 8) & 0xff]);
      },
    },
    {
      // ofs_bonus_EA07_03_star -> наш sub_star_pickup.
      id: "star-4th-hook",
      at: 0xea07,
      len: 3,
      expect: hex("BD 01 01"),
      bytes: jmp("sub_star_pickup", 3),
    },
    {
      // Поражение DEF-танка: STA ram_tank_upgrade,X -> JSR clear (A остаётся 0).
      id: "super-clear-on-death",
      at: 0xe76a,
      len: 3,
      expect: hex("9D 01 01"),
      bytes: jsr("sub_clear_super_weapon", 3),
    },
  ],
};

export default pistol;
