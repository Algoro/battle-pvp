// pacman.ts — ROM descriptor of the "Pac-Man" mode: authored maze stage + base walling.
//
// 1) Overwrites stage 1 data (tbl_F07A, 91 bytes) with the maze from features/pacman-maze;
//    the mode forces the start on this stage. Walls — concrete (indestructible).
// 2) Replaces the base brick (0x0F) with concrete (0x10) in the base draw tables
//    (tbl_D374/D37B/D382): the eagle stays inside but is unreachable (ATT cannot destroy the base).
//
// Relative path: ./emulator-core/patching/patches/pacman.ts
import { hex } from "../descriptor.ts";
import { buildStageBytes } from "../../features/pacman-maze.ts";

const STAGE1 =
  "DD DD DD DD DD DD DD D4 D4 D4 D4 D4 D4 DD D4 D4 D4 D4 D4 D4 DD D4 D4 D4 94 D4 D4 " +
  "DD D4 D4 D3 D3 D4 D4 DD D3 D3 D1 D1 D3 D3 DD 1D 11 D3 D3 D1 1D 1D 8D 33 D1 D1 D3 " +
  "3D 8D D1 D1 D4 44 D1 D1 DD D4 D4 D4 D4 D4 D4 DD D4 D4 D3 D3 D4 D4 DD D4 D4 DD DD " +
  "D4 D4 DD DD DD DD DD DD DD DD";

export const pacman = {
  id: "pacman",
  version: 1,
  description: "Уровень-лабиринт: DEF собирают точки, стены из бетона, база замурована",
  symbols: {},
  free: [],
  routines: [],
  writes: [
    {
      id: "pacman-stage1",
      at: 0xf07a,
      len: 91,
      expect: hex(STAGE1),
      bytes: Array.from(buildStageBytes()),
    },
    // Base walling: brick -> concrete (visual + FIELD collision).
    {
      id: "pacman-base-seal-1",
      at: 0xd374,
      len: 7,
      expect: hex("00 0F 0F 0F 0F 00 FF"),
      bytes: hex("00 10 10 10 10 00 FF"),
    },
    {
      id: "pacman-base-seal-2",
      at: 0xd37b,
      len: 8,
      expect: hex("00 0F C8 CA 0F 00 FF 00"),
      bytes: hex("00 10 C8 CA 10 00 FF 00"),
    },
    {
      id: "pacman-base-seal-3",
      at: 0xd382,
      len: 8,
      expect: hex("00 0F C9 CB 0F 00 FF 00"),
      bytes: hex("00 10 C9 CB 10 00 FF 00"),
    },
  ],
};

export default pacman;
