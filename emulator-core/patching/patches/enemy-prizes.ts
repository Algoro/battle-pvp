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
//   Если враг не найден — переход на оригинальный цикл игроков ($E97A), поведение
//   0..1 не меняется.
//
// Относительный путь: ./emulator-core/patching/patches/enemy-prizes.ts
import { hex, jmp, jmpT, absT } from "../descriptor.ts";
import { RAM } from "../../rom-contract.ts";

export const enemyPrizes = {
  id: "enemy-prizes",
  version: 1,
  description: "Враги (танки 2..7) при наезде забирают приз и получают его эффект",
  symbols: {
    bra_E97A_player_bonus_loop: 0xe97a, // оригинальный цикл подбора игроков
    ram_enemy_bonus_idx: RAM.ENEMY_PRIZE_IDX, // 0xFF — нет события
    ram_enemy_bonus_id: RAM.ENEMY_PRIZE_ID,
  },
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      // Вход = оригинальный вход sub_E972. На выходе либо RTS (как оригинал:
      // приза нет / идёт исчезновение), либо JMP в оригинальный цикл игроков.
      symbol: "sub_enemy_pick_up_bonus",
      bytes: [
        0xa5, RAM.PRIZE_X, // LDA ram_bonus_pos_X
        0xf0, 0x3f, // BEQ rts  (нет приза)
        0xa5, RAM.BONUS_TIMER, // LDA ram_bonus_timer
        0xd0, 0x3b, // BNE rts  (идёт исчезновение)
        0xa2, 0x07, // LDX #$07 (танки 7..2)
        // loop:
        0xb5, RAM.TANK_FLAG, // LDA ram_tank_flags,X
        0x10, 0x36, // BPL next (взрыв)
        0xc9, 0xe0, // CMP #$E0
        0xb0, 0x32, // BCS next (респавн)
        0xb5, RAM.TANK_X, // LDA ram_tank_pos_X,X
        0x38, // SEC
        0xe5, RAM.PRIZE_X, // SBC ram_bonus_pos_X
        0x10, 0x05, // BPL .xabs
        0x49, 0xff, // EOR #$FF
        0x18, // CLC
        0x69, 0x01, // ADC #$01
        // .xabs:
        0xc9, 0x0c, // CMP #$0C
        0xb0, 0x22, // BCS next (далеко по X)
        0xb5, RAM.TANK_Y, // LDA ram_tank_pos_Y,X
        0x38, // SEC
        0xe5, RAM.PRIZE_Y, // SBC ram_bonus_pos_Y
        0x10, 0x05, // BPL .yabs
        0x49, 0xff, // EOR #$FF
        0x18, // CLC
        0x69, 0x01, // ADC #$01
        // .yabs:
        0xc9, 0x0c, // CMP #$0C
        0xb0, 0x12, // BCS next (далеко по Y)
        // overlap: запомнить подобравшего и съесть приз (эффект — JS)
        0xa9, 0x32, // LDA #$32
        0x85, RAM.BONUS_TIMER, // STA ram_bonus_timer
        0x8e, absT("ram_enemy_bonus_idx"), // STX ram_enemy_bonus_idx
        0xa5, RAM.PRIZE_ID, // LDA ram_bonus_id
        0x8d, absT("ram_enemy_bonus_id"), // STA ram_enemy_bonus_id
        0xa9, 0x01, // LDA #$01
        0x8d, RAM.SFX_BONUS_PICKUP & 0xff, RAM.SFX_BONUS_PICKUP >> 8, // STA ram_sfx_bonus_pickup
        0x60, // RTS
        // next:
        0xca, // DEX
        0xe0, 0x01, // CPX #$01
        0xd0, 0xc1, // BNE loop
        // враги не нашли приз -> оригинальный цикл игроков
        jmpT("bra_E97A_player_bonus_loop"),
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
