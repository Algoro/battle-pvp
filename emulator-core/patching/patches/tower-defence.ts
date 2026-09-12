// tower-defence.ts — ROM-дескриптор режима tower defence.
//
// Сейчас: перехват завершения стадии. ROM (`sub_C728_check_condition_for_stage_ending`)
// завершает стадию, когда `enemies_left_cnt == 0` или погибли оба DEF-танка. В TD
// стадия не должна завершаться по зачистке волны — рантайм сам управляет волнами и
// фазами. Хук `sub_td_stage_end_check`:
//   * TD выключен (TD_STATE==0) -> оригинальное поведение;
//   * TD включён и game over -> оригинальное поведение (поражение по базе/жизням);
//   * TD включён и игры ещё нет -> вернуть A=0 (Z=1, «стадия не окончена»).
//
// Рутина размещается в свободной зоне $FF50-$FFF9 (заполнена 0xFF, в оригинале не
// адресуется). Хук `at`/`expect` — 3 байта входа sub_C728 (A5 68 F0 = LDA $68; BEQ).
//
// Относительный путь: ./emulator-core/patching/patches/tower-defence.ts
import { hex, jmp, jmpT, absT } from "../descriptor.ts";
import { TD_MAPS, buildTdStageBytes } from "../../features/td-levels.ts";

// Оригинальные байты стадий 1..3 (для all-or-nothing проверки перед записью).
const STAGE_ORIG = [
  "ddddddddddddddd4d4d4d4d4d4ddd4d4d4d4d4d4ddd4d4d494d4d4ddd4d4d3d3d4d4ddd3d3d1d1d3d3dd1d11d3d3d11d1d8d33d1d1d33d8dd1d1d444d1d1ddd4d4d4d4d4d4ddd4d4d3d3d4d4ddd4d4ddddd4d4dddddddddddddddd",
  "ddd9ddd9ddddddd4d9ddd4d4d4ddd4dddd44d494ddddd4ddddd9ddddbdd4dd9dd4b49dbbddd4dd9dbdddd444bbb9ddb4ddddd9b4d4d4d4dd94d9d4d4ddd4ddd4d4d444d494ddd4d4d444ddddddd4ddddddd4d4ddd4d4ddddd444dd",
  "dddd4ddd4ddddddbbb4ddddd666d4bbbddddddddddbbbbddd4d4442dbbbb4443d4d0ddbbbbdd4dddd0dddbdddd999ddbddd1d1dddddbbbbd420420333bbbbdddddd4d11bbbbd4dd7ddd33bbbdd44d7dddddbbbdd944dddddd4dddd",
];

// Стадии 1..3 — TD-карты (индекс = номер карты в реестре TD_MAPS).
const stageWrites = TD_MAPS.slice(0, STAGE_ORIG.length).map((map, i) => ({
  id: `td-stage${i + 1}`,
  at: 0xf07a + i * 91,
  len: 91,
  expect: hex(STAGE_ORIG[i]),
  bytes: Array.from(buildTdStageBytes(map)),
}));

export const towerDefence = {
  id: "tower-defence",
  version: 1,
  description: "Tower defence: волны и фазы вместо завершения стадии по счётчику врагов",
  symbols: {
    ram_td_state: 0x01ff, // совпадает с RAM.TD_STATE в rom-contract.ts
    ram_game_over_flag: 0x0068,
    bra_C737_it_is_game_over: 0xc737,
    loc_C72C_after_game_over_check: 0xc72c,
  },
  // Свободная зона после таблицы стадий (проверено: 0xFF в образе).
  free: [{ start: 0xff50, end: 0xfff9 }],
  routines: [
    {
      symbol: "sub_td_stage_end_check",
      at: 0xff50,
      bytes: [
        0xad, absT("ram_td_state"), // LDA ram_td_state
        0xf0, 0x0c, // BEQ .orig (+12 -> .orig)
        0xad, absT("ram_game_over_flag"), // LDA ram_game_over_flag
        0xc9, 0x80, // CMP #$80 (con_not_game_over)
        0xd0, 0x05, // BNE .orig
        0xa9, 0x00, // LDA #$00
        0x60, // RTS (Z=1: «стадия не окончена»)
        0xea, 0xea, // NOP NOP (выравнивание .orig)
        // .orig (offset 17): повторить перезаписанные байты и продолжить оригинал
        0xa5, 0x68, // LDA ram_game_over_flag
        0xd0, 0x03, // BNE .continue (пропустить JMP на игру-окончена)
        jmpT("bra_C737_it_is_game_over"),
        jmpT("loc_C72C_after_game_over_check"),
      ],
    },
  ],
  writes: [
    ...stageWrites,
    {
      id: "td-stage-end-hook",
      at: 0xc728,
      len: 3,
      expect: "A5 68 F0", // LDA ram_game_over_flag; BEQ bra_C737
      bytes: jmp("sub_td_stage_end_check", 3),
    },
  ],
};

export default towerDefence;
