// matchmaker.js — очередь матчмейкинга: пара «защитник» + «атакующий» -> комната.
// Симметричные правила: команды отличаются только спавн-позициями (см. reports).
//
// Относительный путь: ./backend/domain/matchmaker.js
import { otherTeam } from "./teams.js";
import { RoomManager } from "./room.js";

export class Matchmaker {
  constructor(roomManager = new RoomManager()) {
    this.rooms = roomManager;
    this.queue = []; // [{playerId, team, sessionId}]
  }

  // Возвращает: {room, playerId, port} либо {queued: true}.
  // Пары образуются ТОЛЬКО между клиентами с одинаковым отпечатком картриджа.
  add(playerId, team, sessionId, fingerprint = null) {
    // ищем ожидающего игрока противоположной команды с тем же картриджем
    const need = otherTeam(team);
    const idx = this.queue.findIndex((q) => q.team === need && (q.fingerprint ?? null) === (fingerprint ?? null));
    if (idx >= 0) {
      const other = this.queue[idx];
      this.queue.splice(idx, 1);
      const room = this.rooms.createRoom();
      room.cartridgeFingerprint = fingerprint ?? null;
      room.join(other.playerId, other.team, other.sessionId, null);
      const res = room.join(playerId, team, sessionId, null);
      room.start();
      return { room, playerId, port: res.port, opponent: other.playerId };
    }
    this.queue.push({ playerId, team, sessionId, fingerprint: fingerprint ?? null });
    return { queued: true };
  }

  cancel(playerId) {
    this.queue = this.queue.filter((q) => q.playerId !== playerId);
  }

  flushIdle() {
    // (опционально) ограничивать размер очереди по TTL
  }
}

export default Matchmaker;
