// lobby.js — лобби (pre-game): создание, ожидание живых игроков, настраиваемые слоты.
//
// Модель B: Lobby — отдельная сущность до старта; при старте создаётся Match (Room из
// matchmaking/rooms.js), куда копируются игроки. Пустые слоты добивает ИИ (движок умеет).
//
// Физические границы движка: DEF — танки 0,1 (порты $4016/$4017), ATT — танки 2..7
// (NET_DIR/NET_FIRE, 6 байт). Поэтому: DEF 1..2, ATT 1..6.
//
// Относительный путь: ./backend/lobby/lobby.js
import { TEAM_DEF, TEAM_ATT } from "../matchmaking/rooms.js";

export const DEFAULT_LOBBY_TTL_MS = 10 * 60 * 1000; // 10 минут простоя
export const MIN_DEF_SLOTS = 1;
export const MAX_DEF_SLOTS = 2;
export const MIN_ATT_SLOTS = 1;
export const MAX_ATT_SLOTS = 6;
export const MAX_NAME_LEN = 20;
export const MAX_LOBBY_NAME_LEN = 40;

function clampInt(v, lo, hi, dflt) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

// Нормализует настройки лобби (фиксируя допустимые диапазоны слотов).
export function normalizeSettings(s = {}) {
  return {
    defSlots: clampInt(s.defSlots, MIN_DEF_SLOTS, MAX_DEF_SLOTS, 2),
    attSlots: clampInt(s.attSlots, MIN_ATT_SLOTS, MAX_ATT_SLOTS, 2),
    autoStart: !!s.autoStart,             // авто-старт при полном лобби и готовности всех
    requireReady: !!s.requireReady,       // хост стартует только когда не-хост игроки ready
    fillBots: s.fillBots !== false,       // пустые слоты добивает ИИ (иначе старт невозможен без людей)
    stage: clampInt(s.stage, 1, 35, 1),   // стартовая стадия (1..35)
    defStars: clampInt(s.defStars, 0, 3, 0), // стартовые звёзды команды DEF (0..3)
  };
}

// Создаёт Match (Room) из лобби и копирует игроков. Общая логика relay и HTTP.
// Возвращает { ok:true, room, peers } либо { ok:false, error } (лобби не стартует частично).
export function startLobbyMatch(lobby, rooms) {
  if (lobby.state !== "open") return { ok: false, error: "lobby-not-open" };
  if (!lobby.fingerprintsAgree()) return { ok: false, error: "cartridge-mismatch" };
  const room = rooms.createRoom();
  room.cartridgeFingerprint = lobby.representativeFingerprint();
  const peers = [];
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

function makeCode(len = 4) {
  let s = "";
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

function cleanName(name, max) {
  const s = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (s || "Игрок").slice(0, max);
}

export class Lobby {
  constructor({ hostPlayerId, name, settings, ttlMs = DEFAULT_LOBBY_TTL_MS } = {}) {
    this.id = `l_${(lobbyCounter++).toString(36)}_${Date.now().toString(36)}`;
    this.code = makeCode();
    this.name = cleanName(name, MAX_LOBBY_NAME_LEN);
    this.hostPlayerId = hostPlayerId;
    this.settings = normalizeSettings(settings);
    this.players = new Map(); // playerId -> {playerId,name,team,ready,host,sessionId,socket,disconnectedAt,joinedAt}
    this.state = "open"; // open | starting | closed
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.ttlMs = ttlMs;
  }

  get playerCount() { return this.players.size; }
  get capacity() { return this.settings.defSlots + this.settings.attSlots; }
  teamCap(team) { return team === TEAM_DEF ? this.settings.defSlots : this.settings.attSlots; }
  teamPlayers(team) { return [...this.players.values()].filter((p) => p.team === team); }
  teamCount(team) { return this.teamPlayers(team).length; }
  isFull() { return this.teamCount(TEAM_DEF) >= this.settings.defSlots && this.teamCount(TEAM_ATT) >= this.settings.attSlots; }

  // Логический порт игрока: DEF -> 0..defSlots-1; ATT -> 2+idx (танки 2..7).
  portFor(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    const idx = this.teamPlayers(p.team).findIndex((x) => x.playerId === playerId);
    return p.team === TEAM_DEF ? idx : 2 + idx;
  }

  join({ playerId, name, team, sessionId, socket, fingerprint = null }) {
    if (this.state !== "open") return { ok: false, error: "lobby-not-open" };
    const existing = this.players.get(playerId);
    if (existing) {
      // реконнект
      existing.socket = socket;
      existing.disconnectedAt = null;
      if (name) existing.name = cleanName(name, MAX_NAME_LEN);
      if (fingerprint) existing.fingerprint = fingerprint;
      this.lastActive = Date.now();
      return { ok: true, reconnected: true, port: this.portFor(playerId), team: existing.team };
    }
    const t = team === TEAM_DEF ? TEAM_DEF : TEAM_ATT;
    if (this.teamCount(t) >= this.teamCap(t)) return { ok: false, error: `team ${t} full` };
    const entry = {
      playerId,
      name: cleanName(name, MAX_NAME_LEN),
      team: t,
      ready: false,
      host: playerId === this.hostPlayerId,
      sessionId,
      socket,
      fingerprint: fingerprint || null,
      disconnectedAt: null,
      joinedAt: Date.now(),
    };
    this.players.set(playerId, entry);
    this.lastActive = Date.now();
    return { ok: true, reconnected: false, port: this.portFor(playerId), team: t };
  }

  // Отпечатки картриджей всех игроков совпадают (непустые).
  fingerprintsAgree() {
    const fps = new Set([...this.players.values()].map((p) => p.fingerprint).filter(Boolean));
    return fps.size <= 1;
  }

  representativeFingerprint() {
    for (const p of this.players.values()) if (p.fingerprint) return p.fingerprint;
    return null;
  }

  leave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return false;
    this.players.delete(playerId);
    // передача хоста первому оставшемуся
    if (playerId === this.hostPlayerId) {
      const next = [...this.players.values()][0];
      if (next) { this.hostPlayerId = next.playerId; next.host = true; }
    }
    if (this.players.size === 0) this.state = "closed";
    this.lastActive = Date.now();
    return true;
  }

  disconnect(playerId) {
    const p = this.players.get(playerId);
    if (p) p.disconnectedAt = Date.now();
  }

  reconnect(playerId, socket) {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.socket = socket;
    p.disconnectedAt = null;
    this.lastActive = Date.now();
    return true;
  }

  setTeam(playerId, team) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: "not-in-lobby" };
    const t = team === TEAM_DEF ? TEAM_DEF : TEAM_ATT;
    if (p.team === t) return { ok: true, team: t };
    if (this.teamCount(t) >= this.teamCap(t)) return { ok: false, error: `team ${t} full` };
    p.team = t;
    p.ready = false;
    this.lastActive = Date.now();
    return { ok: true, team: t };
  }

  setReady(playerId, ready) {
    const p = this.players.get(playerId);
    if (!p) return { ok: false, error: "not-in-lobby" };
    p.ready = !!ready;
    this.lastActive = Date.now();
    return { ok: true, ready: p.ready };
  }

  setSettings(byPlayerId, settings) {
    if (byPlayerId !== this.hostPlayerId) return { ok: false, error: "not-host" };
    const next = normalizeSettings({ ...this.settings, ...settings });
    // нельзя ужать слоты ниже числа уже занятых
    if (this.teamCount(TEAM_DEF) > next.defSlots || this.teamCount(TEAM_ATT) > next.attSlots) {
      return { ok: false, error: "slots-below-occupied" };
    }
    this.settings = next;
    this.lastActive = Date.now();
    return { ok: true, settings: next };
  }

  kick(byPlayerId, playerId) {
    if (byPlayerId !== this.hostPlayerId) return { ok: false, error: "not-host" };
    if (playerId === this.hostPlayerId) return { ok: false, error: "cannot-kick-host" };
    return this.leave(playerId) ? { ok: true } : { ok: false, error: "not-in-lobby" };
  }

  // Готовы ли все, кроме хоста (хост считается готовым).
  allReady() {
    for (const p of this.players.values()) if (!p.host && !p.ready) return false;
    return true;
  }

  // Авто-старт: включён, все слоты заполнены живыми игроками и все готовы.
  shouldAutoStart() {
    return this.settings.autoStart && this.state === "open" && this.isFull() && this.playerCount >= 2 && this.allReady();
  }

  canStart(byPlayerId) {
    if (byPlayerId !== this.hostPlayerId || this.state !== "open" || this.playerCount < 1) return false;
    if (this.settings.requireReady && !this.allReady()) return false;
    return true;
  }

  isActive(now = Date.now()) {
    return this.state !== "closed" && now - this.lastActive < this.ttlMs;
  }

  // Сериализуемое состояние (для WS/HTTP).
  toState() {
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

export class LobbyManager {
  constructor({ ttlMs = DEFAULT_LOBBY_TTL_MS } = {}) {
    this.lobbies = new Map();
    this.ttlMs = ttlMs;
  }

  create(opts) {
    const lobby = new Lobby({ ...opts, ttlMs: this.ttlMs });
    this.lobbies.set(lobby.id, lobby);
    return lobby;
  }

  get(id) {
    const l = this.lobbies.get(id);
    return l && l.isActive() ? l : null;
  }

  getByCode(code) {
    const c = String(code ?? "").trim().toUpperCase();
    if (!c) return null;
    for (const l of this.lobbies.values()) if (l.code === c && l.isActive()) return l;
    return null;
  }

  remove(id) { this.lobbies.delete(id); }

  cleanup(now = Date.now()) {
    for (const [id, l] of this.lobbies) if (!l.isActive(now)) this.lobbies.delete(id);
  }

  // Открытые лобби для списка (сводка).
  listOpen() { return [...this.lobbies.values()].filter((l) => l.state === "open"); }
}

export default LobbyManager;
