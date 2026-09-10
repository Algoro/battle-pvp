// rooms.js — лобби/комнаты: 2 команды (DEF 1-2, ATT 1-2), TTL, реконнект.
// Правила симметричные: разница только в спавн-позициях (см. reports).
//
// Относительный путь: ./backend/matchmaking/rooms.js

export const TEAM_DEF = "DEF";
export const TEAM_ATT = "ATT";
export const MAX_PER_TEAM = 2; // совместимость (DEF-лимит)
// Движок: DEF-танки 0,1 (2 слота), ATT — порты 2..7 (до 6 слотов).
export const MAX_TEAM_SIZE = { [TEAM_DEF]: 2, [TEAM_ATT]: 6 };
export const DEFAULT_ROOM_TTL_MS = 5 * 60 * 1000; // 5 минут простоя
export const RECONNECT_WINDOW_MS = 30 * 1000; // 30 сек на реконнект

let counter = 0;

export class Room {
  constructor(ttlMs = DEFAULT_ROOM_TTL_MS) {
    this.id = `m_${(counter++).toString(36)}_${Date.now().toString(36)}`;
    this.ttlMs = ttlMs;
    this.state = "lobby"; // lobby | playing | finished
    this.teams = { [TEAM_DEF]: [], [TEAM_ATT]: [] }; // [{playerId, sessionId, socket}]
    this.players = new Map(); // playerId -> {team, sessionId, socket, disconnectedAt}
    this.spectators = new Map(); // playerId -> {playerId, socket, joinedAt}
    this.cartridgeFingerprint = null; // отпечаток пропатченного PRG (netcode-инвариант)
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.winner = null;
  }

  get playerCount() {
    return this.players.size;
  }

  // Возвращает логический порт игрока в команде (DEF 0..1, ATT 2..3).
  portFor(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const idx = this.teams[p.team].findIndex((x) => x.playerId === playerId);
    return p.team === TEAM_DEF ? idx : 2 + idx;
  }

  join(playerId, team, sessionId, socket) {
    if (team !== TEAM_DEF && team !== TEAM_ATT) return { ok: false, error: "bad-team" };
    if (!playerId) return { ok: false, error: "playerId required" };
    // реконнект: игрок уже в комнате
    if (this.players.has(playerId)) {
      const p = this.players.get(playerId);
      p.socket = socket;
      p.disconnectedAt = null;
      this.lastActive = Date.now();
      return { ok: true, reconnected: true, room: this, port: this.portFor(playerId) };
    }
    if (this.teams[team].length >= (MAX_TEAM_SIZE[team] ?? MAX_PER_TEAM)) {
      return { ok: false, error: `team ${team} full` };
    }
    const entry = { playerId, sessionId, team, socket, disconnectedAt: null };
    this.teams[team].push(entry);
    this.players.set(playerId, entry);
    this.lastActive = Date.now();
    return { ok: true, reconnected: false, room: this, port: this.portFor(playerId) };
  }

  leave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.teams[p.team] = this.teams[p.team].filter((x) => x.playerId !== playerId);
    this.players.delete(playerId);
    this.lastActive = Date.now();
  }

  // Пометить игрока отключённым (ожидание реконнекта).
  disconnect(playerId) {
    const p = this.players.get(playerId);
    if (p) p.disconnectedAt = Date.now();
  }

  // Наблюдатель (spectator): не занимает слот, не участвует во вводе.
  spectate(playerId, socket) {
    if (!playerId) return { ok: false, error: "playerId required" };
    this.spectators.set(playerId, { playerId, socket, joinedAt: Date.now() });
    this.lastActive = Date.now();
    return { ok: true };
  }

  unspectate(playerId) {
    return this.spectators.delete(playerId);
  }

  isSpectator(playerId) {
    return this.spectators.has(playerId);
  }

  // Принять/сверить отпечаток картриджа. Первый задаёт, остальные должны совпасть.
  // Пустой отпечаток (старый клиент) не блокирует.
  acceptFingerprint(fp) {
    if (!fp) return true;
    if (this.cartridgeFingerprint == null) {
      this.cartridgeFingerprint = fp;
      return true;
    }
    return this.cartridgeFingerprint === fp;
  }

  // force=true — старт по решению хоста (лобби) даже при <2 игроках (пустые слоты — ИИ).
  start(force = false) {
    if (this.state === "lobby" && (force || this.playerCount >= 2)) {
      this.state = "playing";
      this.lastActive = Date.now();
      return true;
    }
    return false;
  }

  finish(winnerTeam) {
    this.state = "finished";
    this.winner = winnerTeam;
    this.lastActive = Date.now();
  }

  // Активна ли комната (не завершена и не истёк TTL).
  isActive(now = Date.now()) {
    return this.state !== "finished" && now - this.lastActive < this.ttlMs;
  }
}

export class RoomManager {
  constructor({ ttlMs = DEFAULT_ROOM_TTL_MS } = {}) {
    this.rooms = new Map();
    this.ttlMs = ttlMs;
  }

  createRoom() {
    const room = new Room(this.ttlMs);
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(id) {
    const r = this.rooms.get(id);
    return r && r.isActive() ? r : null;
  }

  removeRoom(id) {
    this.rooms.delete(id);
  }

  // Прибрать истёкшие комнаты.
  cleanup(now = Date.now()) {
    for (const [id, room] of this.rooms) {
      if (!room.isActive(now)) this.rooms.delete(id);
    }
  }

  // Все открытые комнаты-лобби (для списка).
  listLobbies() {
    return [...this.rooms.values()].filter((r) => r.state === "lobby");
  }
}

export default RoomManager;
