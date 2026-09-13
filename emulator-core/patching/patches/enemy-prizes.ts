// enemy-prizes.ts — опциональный ROM-патч: враги (танки 2..7) могут брать призы.
//
// Что делает патч (правила — в ROM):
//   Хук входа sub_E972_try_to_pick_up_bonus ($E972). Оригинал проверяет приз и
//   перебирает ТОЛЬКО игроков (танки 0..1, `LDA #con_max_players`). Наша рутина сначала
//   проверяет танки 2..7 (враги/ATT) на близость к призу и, если кто-то наехал,
//   «съедает» приз (ram_bonus_timer = 0x32 + SFX) и записывает в RAM пару
//   (индекс врага, id приза). Эффекты исполняет JS-рантайм фичи (features/enemy-prizes.ts):
//   helmet — нет, clock — заморозка DEF, shovel — снять защиту базы, star — броня врага,
//   grenade — взорвать DEF, tank — подкрепление, pistol — супер-оружие врагу.
//
//   Перед перебором врагов рутина проверяет маску ram_enemy_prize_allow (бит id приза):
//   если тип приза запрещён врагу, сразу переход на оригинальный цикл игроков — приз
//   остаётся лежать и может быть взят DEF. 0xFF — все типы разрешены (поведение по умолчанию).
//
//   Если враг не найден — переход на оригинальный цикл игроков ($E97A), поведение
//   0..1 не меняется.
//
// Относительный путь: ./emulator-core/patching/patches/enemy-prizes.ts
import { hex, jmp } from "../descriptor.ts";
import { RAM } from "../../rom-contract.ts";

export const enemyPrizes = {
  id: "enemy-prizes",
  version: 1,
  description: "Враги (танки 2..7) при наезде забирают приз и получают его эффект",
  symbols: {
    bra_E97A_player_bonus_loop: 0xe97a, // оригинальный цикл подбора игроков
    ram_enemy_bonus_idx: RAM.ENEMY_PRIZE_IDX, // 0xFF — нет события
    ram_enemy_bonus_id: RAM.ENEMY_PRIZE_ID,
    ram_enemy_prize_allow: RAM.ENEMY_PRIZE_ALLOW,
  },
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      // Вход = оригинальный вход sub_E972. На выходе либо RTS (как оригинал:
      // приза нет / идёт исчезновение), либо JMP в оригинальный цикл игроков.
      symbol: "sub_enemy_pick_up_bonus",
      bytes: [
        0xa5, 0x86, 0xf0, 0x58, 0xa5, 0x62, 0xd0, 0x54, 0xa5, 0x88, 0xc9, 0x07, 0xb0, 0x13, 0xa8, 0xa9, 0x01, 0xc0, 0x00, 0xf0, 0x04, 0x0a, 0x88, 0xd0, 0xfc, 0x2d, 0xfd, 0x03, 0xd0, 0x03, 0x4c, 0x7a, 0xe9, 0xa2, 0x07, 0xb5, 0xa0, 0x10, 0x36, 0xc9, 0xe0, 0xb0, 0x32, 0xb5, 0x90, 0x38, 0xe5, 0x86, 0x10, 0x05, 0x49, 0xff, 0x18, 0x69, 0x01, 0xc9, 0x0c, 0xb0, 0x22, 0xb5, 0x98, 0x38, 0xe5, 0x87, 0x10, 0x05, 0x49, 0xff, 0x18, 0x69, 0x01, 0xc9, 0x0c, 0xb0, 0x12, 0xa9, 0x32, 0x85, 0x62, 0x8e, 0xf8, 0x01, 0xa5, 0x88, 0x8d, 0xf9, 0x01, 0xa9, 0x01, 0x8d, 0x06, 0x03, 0x60, 0xca, 0xe0, 0x01, 0xd0, 0xc1, 0x4c, 0x7a, 0xe9,
      ],
    },
  ],
  writes: [
    {
      // sub_E972: LDA ram_bonus_pos_X; BEQ ... -> наш хук (первые 3 байта).
      id: "enemy-bonus-pickup-hook",
      at: 0xe972,
      len: 3,
      expect: hex("A5 86 F0"),
      bytes: jmp("sub_enemy_pick_up_bonus", 3),
    },
  ],
};

export default enemyPrizes;
