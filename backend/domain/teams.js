// teams.js — команды матча (домен). Ноль внешних зависимостей: чистые значения.
// Физические границы движка: DEF — танки 0,1; ATT — до 6 танков (порты 2..7).
//
// Относительный путь: ./backend/domain/teams.js

export const TEAM_DEF = "DEF";
export const TEAM_ATT = "ATT";

// Движок: DEF-танки 0,1 (2 слота), ATT — порты 2..7 (до 6 слотов).
export const MAX_TEAM_SIZE = { [TEAM_DEF]: 2, [TEAM_ATT]: 6 };

/** Допустима ли команда (только DEF/ATT). */
export function isTeam(team) {
  return team === TEAM_DEF || team === TEAM_ATT;
}

/** Противоположная команда. */
export function otherTeam(team) {
  return team === TEAM_DEF ? TEAM_ATT : TEAM_DEF;
}

// Нормализует команду лобби. Историческое правило: явный DEF — DEF,
// всё остальное (в т.ч. пустое значение) — ATT.
export function normalizeTeam(team) {
  return team === TEAM_DEF ? TEAM_DEF : TEAM_ATT;
}

export default { TEAM_DEF, TEAM_ATT, MAX_TEAM_SIZE, isTeam, otherTeam, normalizeTeam };
