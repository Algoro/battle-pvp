// game-state.ts — pure game state logic at the RAM boundary.
// No DOM/React/emulator: takes values from RAM and returns decisions.
// Single source of truth for the frontend (GameCanvas) and tests (qa, unit).
// Relative path: ./frontend/src/engine/game-state.ts
import type { FrameInput, Team } from "../ports";

// Team/FrameInput — domain types: single definition in ports.ts, re-exported for compatibility.
export type { FrameInput, Team };

// con_btn Start (matches the ROM).
export const BTN_START = 0x08;

// Whether the tank is alive: active flags 0x90-0xD0; 0xE0/F0 — respawn, 0x70/0x80 — explosion.
export function isTankAlive(flag: number): boolean {
  const hi = flag & 0xf0;
  return hi >= 0x90 && hi <= 0xd0;
}

// The game has started when enemies_left is initialized (not 0xFF).
export function isGameplayStarted(enemiesLeft: number): boolean {
  return enemiesLeft !== 0xff;
}

// Winner by state (only in a real game, stage 1..35):
// ATT wins when the DEF HQ is destroyed (game_over -> 0),
// DEF — when all ATT tanks are destroyed (enemies_left -> 0) or the points are cleared (pacman).
export function determineWinner(
  stage: number,
  gameOver: number,
  enemiesLeft: number,
  pacmanWin = 0,
): Team | null {
  if (stage < 1 || stage > 35) return null;
  if (gameOver === 0) return "ATT";
  if (pacmanWin === 1) return "DEF";
  if (enemiesLeft === 0) return "DEF";
  return null;
}

export interface SoloInputsArgs {
  port: number; // player port (0 = DEF, 2 = ATT)
  team: Team;
  frame: number;
  started: boolean; // gameplay has started (enemies_left != 0xFF)
  userButtons: number;
  attTankAlive: boolean; // whether the player's tank is alive (for ATT)
}

// Building solo-loop inputs (deterministically):
//  - port 0 (DEF) is fed EVERY frame: 0 normally, Start on auto-start (correct
//    Start edges — otherwise the button sticks and player selection does not pass);
//  - the player port — input from the keyboard;
//  - for ATT — auto-respawn of the tank (Start edge on the player port) while it is not alive.
export function buildSoloInputs(a: SoloInputsArgs): FrameInput[] {
  const autoStart = !a.started && a.frame % 30 === 0;
  const autoRespawn = a.team === "ATT" && a.started && !a.attTankAlive && a.frame % 30 === 0;
  if (a.port === 0) {
    return [{ port: 0, buttons: a.userButtons | (autoStart ? BTN_START : 0) }];
  }
  return [
    { port: 0, buttons: autoStart ? BTN_START : 0 },
    { port: a.port, buttons: a.userButtons | (autoRespawn ? BTN_START : 0) },
  ];
}
