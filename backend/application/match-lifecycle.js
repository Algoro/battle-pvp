// match-lifecycle.js — use cases жизненного цикла матча (application-слой).
// Не знают о WebSocket/HTTP: получают зависимости (rooms/store/chat) и возвращают данные,
// а доставку сообщений выполняет адаптер (signaling/relay или HTTP-роут).
import { startLobbyMatch } from "../domain/lobby.js";
import { TEAM_DEF, TEAM_ATT } from "../domain/teams.js";

const teamIds = (room) => [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]];

/**
 * Создать матч из лобби, записать его в хранилище и очистить чат лобби.
 * @returns {{ok:true, room:object, peers:Array, stage:number, defStars:number}|{ok:false,error:string}}
 */
export function startMatch(lobby, { rooms, store, chat }) {
  const res = startLobbyMatch(lobby, rooms);
  if (!res.ok) return res;
  const { room, peers } = res;
  store.ensureMatch(room.id, teamIds(room));
  if (chat) chat.clear(lobby.id);
  return { ok: true, room, peers, stage: lobby.settings.stage || 1, defStars: lobby.settings.defStars || 0 };
}

/** Завершить матч: зафиксировать победителя и записать в хранилище. */
export function finishMatch(room, winner, { store }) {
  room.finish(winner);
  store.ensureMatch(room.id, teamIds(room));
  store.finishMatch(room.id, winner);
  return { winner };
}
