// tower-defence.ts — ROM descriptor of the tower defence mode.
//
// Currently: intercepting stage completion. The ROM (`sub_C728_check_condition_for_stage_ending`)
// ends the stage when `enemies_left_cnt == 0` or both DEF tanks have died. In TD
// the stage must not end on wave clear — the runtime manages the waves and
// phases itself. The hook `sub_td_stage_end_check`:
//   * TD off (TD_STATE==0) -> original behavior;
//   * TD on and game over -> original behavior (defeat by base/lives);
//   * TD on and the game has not started -> return A=0 (Z=1, "stage not finished").
//
// The routine is placed in the free area $FF50-$FFF9 (filled with 0xFF, not
// addressed in the original). The `at`/`expect` hook — the 3 entry bytes of sub_C728 (A5 68 F0 = LDA $68; BEQ).
//
// Relative path: ./emulator-core/patching/patches/tower-defence.ts
import { hex, jmp, jmpT, absT } from "../descriptor.ts";
import { TD_MAPS, buildTdStageBytes } from "../../features/td-levels.ts";

// Original bytes of stages 1..3 (for the all-or-nothing check before writing).
const STAGE_ORIG = [
  "ddddddddddddddd4d4d4d4d4d4ddd4d4d4d4d4d4ddd4d4d494d4d4ddd4d4d3d3d4d4ddd3d3d1d1d3d3dd1d11d3d3d11d1d8d33d1d1d33d8dd1d1d444d1d1ddd4d4d4d4d4d4ddd4d4d3d3d4d4ddd4d4ddddd4d4dddddddddddddddd",
  "ddd9ddd9ddddddd4d9ddd4d4d4ddd4dddd44d494ddddd4ddddd9ddddbdd4dd9dd4b49dbbddd4dd9dbdddd444bbb9ddb4ddddd9b4d4d4d4dd94d9d4d4ddd4ddd4d4d444d494ddd4d4d444ddddddd4ddddddd4d4ddd4d4ddddd444dd",
  "dddd4ddd4ddddddbbb4ddddd666d4bbbddddddddddbbbbddd4d4442dbbbb4443d4d0ddbbbbdd4dddd0dddbdddd999ddbddd1d1dddddbbbbd420420333bbbbdddddd4d11bbbbd4dd7ddd33bbbdd44d7dddddbbbdd944dddddd4dddd",
];

// Stages 1..3 — TD maps (index = map number in the TD_MAPS registry).
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
    ram_td_state: 0x01ff, // matches RAM.TD_STATE in rom-contract.ts
    ram_game_over_flag: 0x0068,
    bra_C737_it_is_game_over: 0xc737,
    loc_C72C_after_game_over_check: 0xc72c,
  },
  // Free area after the stage table (verified: 0xFF in the image).
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
        0x60, // RTS (Z=1: "stage not finished")
        0xea, 0xea, // NOP NOP (.orig alignment)
        // .orig (offset 17): repeat the overwritten bytes and continue the original
        0xa5, 0x68, // LDA ram_game_over_flag
        0xd0, 0x03, // BNE .continue (skip the JMP to game-over)
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
