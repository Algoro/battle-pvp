// ports.ts — backend ports (interfaces). Domain and application depend only on them;
// concrete implementations (SQLite, WebSocket) are supplied by external adapters.
//
// Implementations: persistence/store.ts (matches/players), persistence/chat-repository.ts.
// The module intentionally imports nothing (types only).

export type ChatMessage = {
  scope: string;
  id: string | null;
  from: string;
  name: string;
  text: string;
  ts: number;
};

export interface ChatRepository {
  insert(message: ChatMessage): void;
  list(scope: string, id: string | null, limit: number): ChatMessage[];
}

export type MatchPlayer = { playerId: string; team: string };

export interface MatchRepository {
  ensureMatch(matchId: string, players: MatchPlayer[]): void;
  finishMatch(matchId: string, winnerTeam: string | null): void;
  listMatches?(limit?: number): object[];
}

export interface PlayerRepository {
  upsertPlayer(playerId: string, name: string): void;
}

export interface Clock {
  now(): number;
}
