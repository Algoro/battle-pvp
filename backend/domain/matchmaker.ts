// matchmaker.ts — очередь матчмейкинга: пара «защитник» + «атакующий» -> комната.
// Симметричные правила: команды отличаются только спавн-позициями (см. reports).
//
// Относительный путь: ./backend/domain/matchmaker.ts
import { otherTeam, type Team } from "./teams.ts";
import { RoomManager, type Room } from "./room.ts";

interface QueueEntry {
  playerId: string;
  team: Team;
  sessionId: string | null;
  fingerprint: string | null;
}

export type MatchmakerResult =
  | { room: Room; playerId: string; port: number | null | undefined; opponent: string }
  | { queued: true };

export class Matchmaker {
  rooms: RoomManager;
  queue: QueueEntry[]; // [{playerId, team, sessionId}]

  constructor(roomManager: RoomManager = new RoomManager()) {
    this.rooms = roomManager;
    this.queue = [];
  }

  // Возвращает: {room, playerId, port} либо {queued: true}.
  // Пары образуются ТОЛЬКО между клиентами с одинаковым отпечатком картриджа.
  add(
    playerId: string,
    team: Team,
    sessionId: string | null,
    fingerprint: string | null = null,
  ): MatchmakerResult {
    // ищем ожидающего игрока противоположной команды с тем же картриджем
    const need = otherTeam(team);
    const idx = this.queue.findIndex(
      (q) => q.team === need && (q.fingerprint ?? null) === (fingerprint ?? null),
    );
    if (idx >= 0) {
      const other = this.queue[idx];
      this.queue.splice(idx, 1);
      const room = this.rooms.createRoom();
      room.cartridgeFingerprint = fingerprint ?? null;
      room.join(other.playerId, other.team, other.sessionId, null);
      const res = room.join(playerId, team, sessionId, null);
      room.start();
      return {
        room,
        playerId,
        port: res.ok ? res.port : undefined,
        opponent: other.playerId,
      };
    }
    this.queue.push({ playerId, team, sessionId, fingerprint: fingerprint ?? null });
    return { queued: true };
  }

  cancel(playerId: string): void {
    this.queue = this.queue.filter((q) => q.playerId !== playerId);
  }

  flushIdle(): void {
    // (опционально) ограничивать размер очереди по TTL
  }
}

export default Matchmaker;
