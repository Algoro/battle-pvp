// match-lifecycle.ts — use cases жизненного цикла матча (application-слой).
// Не знают о WebSocket/HTTP: получают зависимости (rooms/store/chat) и возвращают данные,
// а доставку сообщений выполняет адаптер (signaling/relay или HTTP-роут).
import { startLobbyMatch, type Lobby, type StartLobbyPeer } from "../domain/lobby.ts";
import { TEAM_DEF, TEAM_ATT } from "../domain/teams.ts";
import type { Room, RoomManager } from "../domain/room.ts";
import type { MatchPlayer } from "../ports.ts";

const teamIds = (room: Room): MatchPlayer[] => [
  ...room.teams[TEAM_DEF],
  ...room.teams[TEAM_ATT],
];

export interface MatchStore {
  ensureMatch(matchId: string, players: MatchPlayer[]): void;
  finishMatch(matchId: string, winnerTeam: string | null): void;
}

export interface ChatClearer {
  clear(id: string): void;
}

export interface StartMatchDeps {
  rooms: RoomManager;
  store: MatchStore;
  chat?: ChatClearer | null;
}

export type StartMatchResult =
  | { ok: false; error: string }
  | {
      ok: true;
      room: Room;
      peers: StartLobbyPeer[];
      stage: number;
      defStars: number;
      defPistol: boolean;
      features: string[];
    };

/**
 * Создать матч из лобби, записать его в хранилище и очистить чат лобби.
 */
export function startMatch(lobby: Lobby, { rooms, store, chat }: StartMatchDeps): StartMatchResult {
  const res = startLobbyMatch(lobby, rooms);
  if (!res.ok) return res;
  const { room, peers } = res;
  store.ensureMatch(room.id, teamIds(room));
  if (chat) chat.clear(lobby.id);
  return {
    ok: true,
    room,
    peers,
    stage: lobby.settings.stage || 1,
    defStars: lobby.settings.defStars || 0,
    defPistol: !!lobby.settings.defPistol,
    features: [...(lobby.settings.features || [])],
  };
}

/** Завершить матч: зафиксировать победителя и записать в хранилище. */
export function finishMatch(
  room: Room,
  winner: string | null,
  { store }: { store: MatchStore },
): { winner: string | null } {
  room.finish(winner);
  store.ensureMatch(room.id, teamIds(room));
  store.finishMatch(room.id, winner);
  return { winner };
}
