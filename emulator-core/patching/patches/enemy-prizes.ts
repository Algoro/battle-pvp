// enemy-prizes.ts — optional ROM patch: enemies (tanks 2..7) can take prizes.
//
// What the patch does (the rules are in the ROM):
//   Hook at the entry of sub_E972_try_to_pick_up_bonus ($E972). The original checks the prize and
//   iterates over players ONLY (tanks 0..1, `LDA #con_max_players`). Our routine first
//   checks tanks 2..7 (enemies/ATT) for proximity to the prize and, if someone drove over it,
//   "eats" the prize (ram_bonus_timer = 0x32 + SFX) and writes the pair
//   (enemy index, prize id) to RAM. The effects are performed by the feature's JS runtime (features/enemy-prizes.ts):
//   helmet — no, clock — freeze DEF, shovel — remove base protection, star — enemy armor,
//   grenade — blow up DEF, tank — reinforcement, pistol — super-weapon for the enemy.
//
//   Before iterating over enemies the routine checks the ram_enemy_prize_allow mask (prize id bit):
//   if the prize type is forbidden to enemies, it jumps straight to the original player loop — the prize
//   stays and can be taken by DEF. 0xFF — all types allowed (default behavior).
//
//   If no enemy is found — jump to the original player loop ($E97A); the behavior of
//   0..1 is unchanged.
//
// Relative path: ./emulator-core/patching/patches/enemy-prizes.ts
import { hex, jmp } from "../descriptor.ts";
import { RAM } from "../../rom-contract.ts";

export const enemyPrizes = {
  id: "enemy-prizes",
  version: 1,
  description: "Враги (танки 2..7) при наезде забирают приз и получают его эффект",
  symbols: {
    bra_E97A_player_bonus_loop: 0xe97a, // original player pickup loop
    ram_enemy_bonus_idx: RAM.ENEMY_PRIZE_IDX, // 0xFF — no event
    ram_enemy_bonus_id: RAM.ENEMY_PRIZE_ID,
    ram_enemy_prize_allow: RAM.ENEMY_PRIZE_ALLOW,
  },
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      // Entry = the original sub_E972 entry. The output is either RTS (like the original:
      // no prize / disappearing), or a JMP into the original player loop.
      symbol: "sub_enemy_pick_up_bonus",
      bytes: [
        0xa5, 0x86, 0xf0, 0x58, 0xa5, 0x62, 0xd0, 0x54, 0xa5, 0x88, 0xc9, 0x07, 0xb0, 0x13, 0xa8, 0xa9, 0x01, 0xc0, 0x00, 0xf0, 0x04, 0x0a, 0x88, 0xd0, 0xfc, 0x2d, 0xfd, 0x03, 0xd0, 0x03, 0x4c, 0x7a, 0xe9, 0xa2, 0x07, 0xb5, 0xa0, 0x10, 0x36, 0xc9, 0xe0, 0xb0, 0x32, 0xb5, 0x90, 0x38, 0xe5, 0x86, 0x10, 0x05, 0x49, 0xff, 0x18, 0x69, 0x01, 0xc9, 0x0c, 0xb0, 0x22, 0xb5, 0x98, 0x38, 0xe5, 0x87, 0x10, 0x05, 0x49, 0xff, 0x18, 0x69, 0x01, 0xc9, 0x0c, 0xb0, 0x12, 0xa9, 0x32, 0x85, 0x62, 0x8e, 0xf8, 0x01, 0xa5, 0x88, 0x8d, 0xf9, 0x01, 0xa9, 0x01, 0x8d, 0x06, 0x03, 0x60, 0xca, 0xe0, 0x01, 0xd0, 0xc1, 0x4c, 0x7a, 0xe9,
      ],
    },
  ],
  writes: [
    {
      // sub_E972: LDA ram_bonus_pos_X; BEQ ... -> our hook (the first 3 bytes).
      id: "enemy-bonus-pickup-hook",
      at: 0xe972,
      len: 3,
      expect: hex("A5 86 F0"),
      bytes: jmp("sub_enemy_pick_up_bonus", 3),
    },
  ],
};

export default enemyPrizes;
