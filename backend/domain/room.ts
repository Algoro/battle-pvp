// room.ts — матч-комната: 2 команды (DEF 1-2, ATT 1-6), TTL, реконнект, spectator.
// Домен: не знает о транспорте/БД/фреймворках (сокеты хранятся как непрозрачные ссылки).
//
// Относительный путь: ./backend/domain/room.ts
import { TEAM_DEF, TEAM_ATT, MAX_TEAM_SIZE, isTeam, type Team } from "./teams.ts";
import { systemClock, type Clock } from "./clock.ts";

export { TEAM_DEF, TEAM_ATT, MAX_TEAM_SIZE };
export type { Team };
export const DEFAULT_ROOM_TTL_MS = 5 * 60 * 1000; // 5 минут простоя
export const RECONNECT_WINDOW_MS = 30 * 1000; // 30 сек на реконнект

export type RoomState = "lobby" | "playing" | "finished";

export interface RoomPlayer {
  playerId: string;
  sessionId: string | null | undefined;
  team: Team;
  socket: any;
  disconnectedAt: number | null;
}

export interface Spectator {
  playerId: string;
  socket: any;
  joinedAt: number;
}

export type JoinResult =
  | { ok: false; error: string }
  | { ok: true; reconnected: boolean; room: Room; port: number | null };

let counter = 0;

export class Room {
  clock: Clock;
  id: string;
  ttlMs: number;
  state: RoomState;
  teams: Record<Team, RoomPlayer[]>;
  players: Map<string, RoomPlayer>;
  spectators: Map<string, Spectator>;
  cartridgeFingerprint: string | null;
  createdAt: number;
  lastActive: number;
  winner: string | null;

  constructor(ttlMs = DEFAULT_ROOM_TTL_MS, clock: Clock = systemClock) {
    this.clock = clock;
    this.id = `m_${(counter++).toString(36)}_${this.now().toString(36)}`;
    this.ttlMs = ttlMs;
    this.state = "lobby"; // lobby | playing | finished
    this.teams = { [TEAM_DEF]: [], [TEAM_ATT]: [] }; // [{playerId, sessionId, socket}]
    this.players = new Map(); // playerId -> {team, sessionId, socket, disconnectedAt}
    this.spectators = new Map(); // playerId -> {playerId, socket, joinedAt}
    this.cartridgeFingerprint = null; // отпечаток пропатченного PRG (netcode-инвариант)
    this.createdAt = this.now();
    this.lastActive = this.now();
    this.winner = null;
  }

  now(): number {
    return this.clock.now();
  }

  get playerCount(): number {
    return this.players.size;
  }

  // Возвращает логический порт игрока в команде (DEF 0..1, ATT 2..3).
  portFor(playerId: string): number | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const idx = this.teams[p.team].findIndex((x) => x.playerId === playerId);
    return p.team === TEAM_DEF ? idx : 2 + idx;
  }

  join(playerId: string, team: unknown, sessionId: string | null | undefined, socket: any): JoinResult {
    if (!isTeam(team)) return { ok: false, error: "bad-team" };
    if (!playerId) return { ok: false, error: "playerId required" };
    // реконнект: игрок уже в комнате
    if (this.players.has(playerId)) {
      const p = this.players.get(playerId)!;
      p.socket = socket;
      p.disconnectedAt = null;
      this.lastActive = this.now();
      return { ok: true, reconnected: true, room: this, port: this.portFor(playerId) };
    }
    if (this.teams[team].length >= MAX_TEAM_SIZE[team]) {
      return { ok: false, error: `team ${team} full` };
    }
    const entry: RoomPlayer = { playerId, sessionId, team, socket, disconnectedAt: null };
    this.teams[team].push(entry);
    this.players.set(playerId, entry);
    this.lastActive = this.now();
    return { ok: true, reconnected: false, room: this, port: this.portFor(playerId) };
  }

  leave(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    this.teams[p.team] = this.teams[p.team].filter((x) => x.playerId !== playerId);
    this.players.delete(playerId);
    this.lastActive = this.now();
  }

  // Пометить игрока отключённым (ожидание реконнекта).
  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) p.disconnectedAt = this.now();
  }

  // Наблюдатель (spectator): не занимает слот, не участвует во вводе.
  spectate(playerId: string, socket: any): { ok: boolean; error?: string } {
    if (!playerId) return { ok: false, error: "playerId required" };
    this.spectators.set(playerId, { playerId, socket, joinedAt: this.now() });
    this.lastActive = this.now();
    return { ok: true };
  }

  unspectate(playerId: string): boolean {
    return this.spectators.delete(playerId);
  }

  isSpectator(playerId: string): boolean {
    return this.spectators.has(playerId);
  }

  // Принять/сверить отпечаток картриджа. Первый задаёт, остальные должны совпасть.
  // Пустой отпечаток (старый клиент) не блокирует.
  acceptFingerprint(fp: string | null | undefined): boolean {
    if (!fp) return true;
    if (this.cartridgeFingerprint == null) {
      this.cartridgeFingerprint = fp;
      return true;
    }
    return this.cartridgeFingerprint === fp;
  }

  // force=true — старт по решению хоста (лобби) даже при <2 игроках (пустые слоты — ИИ).
  start(force = false): boolean {
    if (this.state === "lobby" && (force || this.playerCount >= 2)) {
      this.state = "playing";
      this.lastActive = this.now();
      return true;
    }
    return false;
  }

  finish(winnerTeam: string | null): void {
    this.state = "finished";
    this.winner = winnerTeam;
    this.lastActive = this.now();
  }

  // Активна ли комната (не завершена и не истёк TTL).
  isActive(now: number = this.now()): boolean {
    return this.state !== "finished" && now - this.lastActive < this.ttlMs;
  }
}

export interface RoomManagerOptions {
  ttlMs?: number;
  clock?: Clock;
}

export class RoomManager {
  rooms: Map<string, Room>;
  ttlMs: number;
  clock: Clock;

  constructor({ ttlMs = DEFAULT_ROOM_TTL_MS, clock = systemClock }: RoomManagerOptions = {}) {
    this.rooms = new Map();
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  now(): number {
    return this.clock.now();
  }

  createRoom(): Room {
    const room = new Room(this.ttlMs, this.clock);
    this.rooms.set(room.id, room);
    return room;
  }

  getRoom(id: string): Room | null {
    const r = this.rooms.get(id);
    return r && r.isActive() ? r : null;
  }

  removeRoom(id: string): void {
    this.rooms.delete(id);
  }

  // Прибрать истёкшие комнаты.
  cleanup(now: number = this.now()): void {
    for (const [id, room] of this.rooms) {
      if (!room.isActive(now)) this.rooms.delete(id);
    }
  }

  // Все открытые комнаты-лобби (для списка).
  listLobbies(): Room[] {
    return [...this.rooms.values()].filter((r) => r.state === "lobby");
  }
}

export default RoomManager;
