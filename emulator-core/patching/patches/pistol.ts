// pistol.js — PvP ROM patch: the "pistol" prize (id 6) and the super-weapon.
//
// What the patch does (the pickup rules are in the ROM):
//   1. Allows the id 6 prize to drop (tbl_E8FA_bonus table).
//   2. Handler for picking up id 6 -> sub_grant_super_weapon (flag + ammo).
//   3. 4th star (a star at upgrade == 0x60) -> the same sub_grant_super_weapon.
//   4. Player death resets the flag/ammo (hook at $E76A).
//
// The effect itself, "a beam across the whole screen", is performed by the JS core (PvPNes): see emulator-core/pvp.js.
// All hooks are strictly the same size (JMP/JSR + NOP pads are not needed, lengths match).
//
// Relative path: ./emulator-core/patching/patches/pistol.js
import { hex, jmp, jsr, jmpT, absT } from "../descriptor.ts";

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
  // Free area (0xFF) for new routines. Separate from pvp (EF75-EFFF).
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      // X = player index (0/1). Grant the super-weapon and refill the ammo (N=3).
      symbol: "sub_grant_super_weapon",
      bytes: [
        0xa9, 0x01, // LDA #$01
        0x9d, absT("ram_pistol"), // STA ram_pistol,X
        0xa9, 0x03, // LDA #$03 (N shots)
        0x9d, absT("ram_pistol_ammo"), // STA ram_pistol_ammo,X
        0xa9, 0x01, 0x8d, absT("ram_sfx_bonus_pickup"), // LDA #1; STA sfx_bonus_pickup
        0x60, // RTS
      ],
    },
    {
      // Star handler entry hook ($EA07): upgrade or super-weapon on the 4th star.
      // X = player index.
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
      // Player death hook ($E76A): reset upgrade and super-weapon, leaving A=0
      // (the next instruction STA ram_tank_type,X uses A).
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
      // tbl_E8FA_bonus[6]: was "grenade" ($04) -> "pistol" ($06).
      id: "allow-pistol-drop",
      at: 0xe900,
      len: 1,
      expect: hex("04"),
      bytes: hex("06"),
    },
    {
      // tbl_E9E2_bonus_pickup_handler[6]: was ofs_..._06_RTS ($EA48) -> grant.
      id: "pistol-pickup-handler",
      at: 0xe9ee,
      len: 2,
      expect: hex("48 EA"),
      bytes: (resolve: any) => {
        const a = resolve("sub_grant_super_weapon");
        return new Uint8Array([a & 0xff, (a >> 8) & 0xff]);
      },
    },
    {
      // ofs_bonus_EA07_03_star -> our sub_star_pickup.
      id: "star-4th-hook",
      at: 0xea07,
      len: 3,
      expect: hex("BD 01 01"),
      bytes: jmp("sub_star_pickup", 3),
    },
    {
      // DEF tank defeat: STA ram_tank_upgrade,X -> JSR clear (A stays 0).
      id: "super-clear-on-death",
      at: 0xe76a,
      len: 3,
      expect: hex("9D 01 01"),
      bytes: jsr("sub_clear_super_weapon", 3),
    },
  ],
};

export default pistol;
