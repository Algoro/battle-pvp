// ports.ts — порты (интерфейсы) backend. Домен и application зависят только от них;
// конкретные реализации (SQLite, WebSocket) подаются адаптерами извне.
//
// Реализации: persistence/store.ts (matches/players), persistence/chat-repository.ts.
// Модуль намеренно не импортирует ничего (только типы).

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
