// matchmaker.ts — matchmaking queue: a "defender" + "attacker" pair -> a room.
// Symmetric rules: teams differ only in spawn positions (see reports).
//
// Relative path: ./backend/domain/matchmaker.ts
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

  // Returns: {room, playerId, port} or {queued: true}.
  // Pairs are formed ONLY between clients with the same cartridge fingerprint.
  add(
    playerId: string,
    team: Team,
    sessionId: string | null,
    fingerprint: string | null = null,
  ): MatchmakerResult {
    // look for a waiting player on the opposite team with the same cartridge
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
    // (optionally) limit the queue size by TTL
  }
}

export default Matchmaker;
