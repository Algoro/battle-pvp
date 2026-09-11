// lobby.ts — лобби (pre-game): создание, ожидание живых игроков, настраиваемые слоты.
//
// Модель B: Lobby — отдельная сущность до старта; при старте создаётся Match (Room из
// domain/room.ts), куда копируются игроки. Пустые слоты добивает ИИ (движок умеет).
//
// Физические границы движка: DEF — танки 0,1 (порты $4016/$4017), ATT — танки 2..7
// (NET_DIR/NET_FIRE, 6 байт). Поэтому: DEF 1..2, ATT 1..6.
//
// Домен: не знает о транспорте/БД/фреймворках. Стартовая стадия/звёзды — чистые данные.
//
// Относительный путь: ./backend/domain/lobby.ts
import { TEAM_DEF, TEAM_ATT, normalizeTeam, type Team } from "./teams.ts";
import { systemClock, type Clock } from "./clock.ts";
import { normalizeFeatures } from "./features.ts";
import type { Room, RoomManager } from "./room.ts";

export const DEFAULT_LOBBY_TTL_MS = 10 * 60 * 1000; // 10 минут простоя
export const MIN_DEF_SLOTS = 1;
export const MAX_DEF_SLOTS = 2;
export const MIN_ATT_SLOTS = 1;
export const MAX_ATT_SLOTS = 6;
export const MAX_NAME_LEN = 20;
export const MAX_LOBBY_NAME_LEN = 40;

export type LobbyState = "open" | "starting" | "closed";

export interface LobbySettings {
  defSlots: number;
  attSlots: number;
  autoStart: boolean;
  requireReady: boolean;
  fillBots: boolean;
  stage: number;
  defStars: number;
  defPistol: boolean;
  features: string[];
}

export interface LobbyPlayer {
  playerId: string;
  name: string;
  team: Team;
  ready: boolean;
  host: boolean;
  sessionId: string | null | undefined;
  socket: any;
  fingerprint: string | null;
  disconnectedAt: number | null;
  joinedAt: number;
}

export type LobbyJoinResult =
  | { ok: false; error: string }
  | { ok: true; reconnected: boolean; port: number | null; team: Team };

export type SettingsResult =
  | { ok: false; error: string }
  | { ok: true; settings: LobbySettings };

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

// Нормализует настройки лобби (фиксируя допустимые диапазоны слотов).
export function normalizeSettings(s: any = {}): LobbySettings {
  return {
    defSlots: clampInt(s.defSlots, MIN_DEF_SLOTS, MAX_DEF_SLOTS, 2),
    attSlots: clampInt(s.attSlots, MIN_ATT_SLOTS, MAX_ATT_SLOTS, 2),
    autoStart: !!s.autoStart, // авто-старт при полном лобби и готовности всех
    requireReady: !!s.requireReady, // хост стартует только когда не-хост игроки ready
    fillBots: s.fillBots !== false, // пустые слоты добивает ИИ (иначе старт невозможен без людей)
    stage: clampInt(s.stage, 1, 35, 1), // стартовая стадия (1..35)
    defStars: clampInt(s.defStars, 0, 3, 0), // стартовые звёзды команды DEF (0..3)
    defPistol: !!s.defPistol, // стартовое супер-оружие DEF (аналог 4-й звезды)
    features: normalizeFeatures(s.features), // включённые опциональные фичи-патчи
  };
}

export interface StartLobbyPeer {
  playerId: string;
  team: Team;
  port: number | null;
  name: string;
}

export type StartLobbyResult =
  | { ok: false; error: string }
  | { ok: true; room: Room; peers: StartLobbyPeer[] };

// Создаёт Match (Room) из лобби и копирует игроков. Общая логика relay и HTTP.
// Возвращает { ok:true, room, peers } либо { ok:false, error } (лобби не стартует частично).
export function startLobbyMatch(lobby: Lobby, rooms: RoomManager): StartLobbyResult {
  if (lobby.state !== "open") return { ok: false, error: "lobby-not-open" };
  if (!lobby.fingerprintsAgree()) return { ok: false, error: "cartridge-mismatch" };
  const room = rooms.createRoom();
  room.cartridgeFingerprint = lobby.representativeFingerprint();
  const peers: StartLobbyPeer[] = [];
  for (const p of lobby.players.values()) {
    const r = room.join(p.playerId, p.team, p.sessionId, p.socket);
    if (!r.ok) {
      rooms.removeRoom(room.id);
      return { ok: false, error: `cannot-start: ${r.error}` };
    }
    peers.push({ playerId: p.playerId, team: p.team, port: room.portFor(p.playerId), name: p.name });
  }
  room.start(true);
  lobby.state = "starting";
  return { ok: true, room, peers };
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без похожих 0/O/1/I
let lobbyCounter = 0;

function makeCode(len = 4): string {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function cleanName(name: unknown, max: number): string {
  const s = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (s || "Игрок").slice(0, max);
}

export interface LobbyOptions {
  hostPlayerId?: string;
  name?: string;
  settings?: any;
  ttlMs?: number;
  clock?: Clock;
}

export interface LobbyJoinInput {
  playerId: string;
  name?: string | null;
  team?: unknown;
  sessionId?: string | null;
  socket: any;
  fingerprint?: string | null;
}

export class Lobby {
  clock: Clock;
  id: string;
  code: string;
  name: string;
  hostPlayerId: string | undefined;
  settings: LobbySettings;
  players: Map<string, LobbyPlayer>;
  state: LobbyState;
  createdAt: number;
  lastActive: number;
  ttlMs: number;

  constructor({ hostPlayerId, name, settings, ttlMs = DEFAULT_LOBBY_TTL_MS, clock = systemClock }: LobbyOptions = {}) {
    this.clock = clock;
    this.id = `l_${(lobbyCounter++).toString(36)}_${this.now().toString(36)}`;
    this.code = makeCode();
    this.name = cleanName(name, MAX_LOBBY_NAME_LEN);
    this.hostPlayerId = hostPlayerId;
    this.settings = normalizeSettings(settings);
    this.players = new Map(); // playerId -> LobbyPlayer
    this.state = "open"; // open | starting | closed
    this.createdAt = this.now();
    this.lastActive = this.now();
    this.ttlMs = ttlMs;
  }

  now(): number {
    return this.clock.now();
  }

  get playerCount(): number {
    return this.players.size;
  }
  get capacity(): number {
    return this.settings.defSlots + this.settings.attSlots;
  }
  teamCap(team: Team): number {
    return team === TEAM_DEF ? this.settings.defSlots : this.settings.attSlots;
  }
  teamPlayers(team: Team): LobbyPlayer[] {
    return [...this.players.values()].filter((p) => p.team === team);
  }
  teamCount(team: Team): number {
    return this.teamPlayers(team).length;
  }
  isFull(): boolean {
    return (
      this.teamCount(TEAM_DEF) >= this.settings.defSlots &&
      this.teamCount(TEAM_ATT) >= this.settings.attSlots
    );
  }

  // Логический порт игрока: DEF -> 0..defSlots-1; ATT -> 2+idx (танки 2..7).
  portFor(playerId: string): number | null {
    const p = this.players.get(playerId);
    if (!p) return null;
    const idx = this.teamPlayers(p.team).findIndex((x) => x.playerId === playerId);
    return p.team === TEAM_DEF ? idx : 2 + idx;
  }

  join({ playerId, name, team, sessionId, socket, fingerprint = null }: LobbyJoinInput): LobbyJoinResult {
    if (this.state !== "open") return { ok: false, error: "lobby-not-open" };
    const existing = this.players.get(playerId);
    if (existing) {
      // реконнект
      existing.socket = socket;
      existing.disconnectedAt = null;
      if (name) existing.name = cleanName(name, MAX_NAME_LEN);
      if (fingerprint) existing.fingerprint = fingerprint;
      this.lastActive = this.now();
      return { ok: true, reconnected: true, port: this.portFor(playerId), team: existing.team };
    }
    const t = normalizeTeam(team);
    if (this.teamCount(t) >= this.teamCap(t)) return { ok: false, error: `team ${t} full` };
    const entry: LobbyPlayer = {
      playerId,
      name: cleanName(name, MAX_NAME_LEN),
      team: t,
      ready: false,
      host: playerId === this.hostPlayerId,
      sessionId,
      socket,
      fingerprint: fingerprint || null,
      disconnectedAt: null,
      joinedAt: this.now(),
    };
    this.players.set(playerId, entry);
    this.lastActive = this.now();
    return { ok: true, reconnected: false, port: this.portFor(playerId), team: t };
  }

  // Отпечатки картриджей всех игроков совпадают (непустые).
  fingerprintsAgree(): boolean {
    const fps = new Set([...this.players.values()].map((p) => p.fingerprint).filter(Boolean));
    return fps.size <= 1;
  }

  representativeFingerprint(): string | null {
    for (const p of this.players.values()) if (p.fingerprint) return p.fingerprint;
    return null;
  }

  leave(playerId: string): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    this.players.delete(playerId);
    // передача хоста первому оставшемуся
    if (playerId === this.hostPlayerId) {
      const next = [...this.players.values()][0];
      if (next) {
        this.hostPlayerId = next.playerId;
        next.host = true;
      }
    }
    if (this.players.size === 0) this.state = "closed";
    this.lastActive = this.now();
    return true;
  }

  disconnect(playerId: string): void {
    const p = this.players.get(playerId);
    if (p) p.disconnectedAt = this.now();
  }

  reconnect(playerId: string, socket: any): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.socket = socket;
    p.disconnectedAt = null;
    this.lastActive = this.now();
    return true;
  }

  setTeam(
    playerId: string,
    team: unknown,
  ): { ok: false; error: string } | { ok: true; team: Team } {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: "not-in-lobby" };
    const t = normalizeTeam(team);
    if (p.team === t) return { ok: true, team: t };
    if (this.teamCount(t) >= this.teamCap(t)) return { ok: false, error: `team ${t} full` };
    p.team = t;
    p.ready = false;
    this.lastActive = this.now();
    return { ok: true, team: t };
  }

  setReady(
    playerId: string,
    ready: unknown,
  ): { ok: false; error: string } | { ok: true; ready: boolean } {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: "not-in-lobby" };
    p.ready = !!ready;
    this.lastActive = this.now();
    return { ok: true, ready: p.ready };
  }

  setSettings(byPlayerId: string, settings: any): SettingsResult {
    if (byPlayerId !== this.hostPlayerId) return { ok: false, error: "not-host" };
    const next = normalizeSettings({ ...this.settings, ...settings });
    // нельзя ужать слоты ниже числа уже занятых
    if (this.teamCount(TEAM_DEF) > next.defSlots || this.teamCount(TEAM_ATT) > next.attSlots) {
      return { ok: false, error: "slots-below-occupied" };
    }
    this.settings = next;
    this.lastActive = this.now();
    return { ok: true, settings: next };
  }

  kick(byPlayerId: string, playerId: string): { ok: boolean; error?: string } {
    if (byPlayerId !== this.hostPlayerId) return { ok: false, error: "not-host" };
    if (playerId === this.hostPlayerId) return { ok: false, error: "cannot-kick-host" };
    return this.leave(playerId) ? { ok: true } : { ok: false, error: "not-in-lobby" };
  }

  // Готовы ли все, кроме хоста (хост считается готовым).
  allReady(): boolean {
    for (const p of this.players.values()) if (!p.host && !p.ready) return false;
    return true;
  }

  // Авто-старт: включён, все слоты заполнены живыми игроками и все готовы.
  shouldAutoStart(): boolean {
    return (
      this.settings.autoStart &&
      this.state === "open" &&
      this.isFull() &&
      this.playerCount >= 2 &&
      this.allReady()
    );
  }

  canStart(byPlayerId: string): boolean {
    if (byPlayerId !== this.hostPlayerId || this.state !== "open" || this.playerCount < 1) return false;
    if (this.settings.requireReady && !this.allReady()) return false;
    return true;
  }

  isActive(now: number = this.now()): boolean {
    return this.state !== "closed" && now - this.lastActive < this.ttlMs;
  }

  // Сериализуемое состояние (для WS/HTTP).
  toState(): object {
    const players = [...this.players.values()].map((p) => ({
      id: p.playerId,
      name: p.name,
      team: p.team,
      ready: p.ready,
      host: p.host,
      port: this.portFor(p.playerId),
      online: !p.disconnectedAt,
    }));
    return {
      id: this.id,
      code: this.code,
      name: this.name,
      host: this.hostPlayerId,
      state: this.state,
      settings: this.settings,
      slots: { DEF: this.teamCount(TEAM_DEF), ATT: this.teamCount(TEAM_ATT) },
      capacity: this.capacity,
      players,
      createdAt: this.createdAt,
    };
  }
}

export interface LobbyManagerOptions {
  ttlMs?: number;
  clock?: Clock;
}

export class LobbyManager {
  lobbies: Map<string, Lobby>;
  ttlMs: number;
  clock: Clock;

  constructor({ ttlMs = DEFAULT_LOBBY_TTL_MS, clock = systemClock }: LobbyManagerOptions = {}) {
    this.lobbies = new Map();
    this.ttlMs = ttlMs;
    this.clock = clock;
  }

  now(): number {
    return this.clock.now();
  }

  create(opts: LobbyOptions): Lobby {
    const lobby = new Lobby({ ...opts, ttlMs: this.ttlMs, clock: this.clock });
    this.lobbies.set(lobby.id, lobby);
    return lobby;
  }

  get(id: string): Lobby | null {
    const l = this.lobbies.get(id);
    return l && l.isActive() ? l : null;
  }

  getByCode(code: unknown): Lobby | null {
    const c = String(code ?? "").trim().toUpperCase();
    if (!c) return null;
    for (const l of this.lobbies.values()) if (l.code === c && l.isActive()) return l;
    return null;
  }

  remove(id: string): void {
    this.lobbies.delete(id);
  }

  cleanup(now: number = this.now()): void {
    for (const [id, l] of this.lobbies) if (!l.isActive(now)) this.lobbies.delete(id);
  }

  // Открытые лобби для списка (сводка).
  listOpen(): Lobby[] {
    return [...this.lobbies.values()].filter((l) => l.state === "open");
  }
}

export default LobbyManager;
