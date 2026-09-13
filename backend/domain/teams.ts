// teams.ts — match teams (domain). Zero external dependencies: pure values.
// Engine physical limits: DEF — tanks 0,1; ATT — up to 6 tanks (ports 2..7).
//
// Relative path: ./backend/domain/teams.ts

export type Team = "DEF" | "ATT";

export const TEAM_DEF = "DEF";
export const TEAM_ATT = "ATT";

// Engine: DEF tanks 0,1 (2 slots), ATT — ports 2..7 (up to 6 slots).
export const MAX_TEAM_SIZE: Record<Team, number> = { [TEAM_DEF]: 2, [TEAM_ATT]: 6 };

/** Whether the team is valid (only DEF/ATT). */
export function isTeam(team: unknown): team is Team {
  return team === TEAM_DEF || team === TEAM_ATT;
}

/** The opposite team. */
export function otherTeam(team: Team): Team {
  return team === TEAM_DEF ? TEAM_ATT : TEAM_DEF;
}

// Normalizes a lobby team. Historical rule: explicit DEF — DEF,
// everything else (including an empty value) — ATT.
export function normalizeTeam(team: unknown): Team {
  return team === TEAM_DEF ? TEAM_DEF : TEAM_ATT;
}

export default { TEAM_DEF, TEAM_ATT, MAX_TEAM_SIZE, isTeam, otherTeam, normalizeTeam };
