// relay.js — WebSocket-сервер: signaling relay + data relay (матч) + лобби (Lobby) и чат.
//
// Матч (как раньше): join/signal/relay.data/start/finish работают с Room.
// Лобби (new): lobby.subscribe/create/join/leave/team/ready/start/kick/settings + chat.send.
// WS-push: сервер рассылает `lobbies` (список), `lobby` (состояние комнаты), `chat`,
// `match.start` (хендофф в бой).
//
// Относительный путь: ./backend/signaling/relay.js
import { TEAM_DEF, TEAM_ATT } from "../domain/teams.js";
import { startMatch, finishMatch } from "../application/match-lifecycle.js";
import { sendChat, chatHistory } from "../application/chat.js";
import { validateMessage, knownTypes } from "./schema.js";

// Диспетчер WS-сообщений: тип -> имя обработчика (заменяет большой switch).
const ROUTES = {
  join: "_onJoin",
  signal: "_onSignal",
  "relay.data": "_onRelayData",
  start: "_onStart",
  finish: "_onFinish",
  pause: "_onPause",
  resume: "_onResume",
  spectate: "_onSpectate",
  "spectate.data": "_onSpectateData",
  "spectate.leave": "_onSpectateLeave",
  "lobby.subscribe": "_onLobbySubscribe",
  "lobby.create": "_onLobbyCreate",
  "lobby.join": "_onLobbyJoin",
  "lobby.leave": "_onLobbyLeave",
  "lobby.team": "_onLobbyTeam",
  "lobby.ready": "_onLobbyReady",
  "lobby.settings": "_onLobbySettings",
  "lobby.kick": "_onLobbyKick",
  "lobby.start": "_onLobbyStart",
  "chat.send": "_onChatSend",
};

// Все типы из схемы обязаны иметь маршрут (проверяется тестом).
export function routeIsComplete() {
  return knownTypes().every((t) => typeof ROUTES[t] === "string");
}

const MAX_PAYLOAD = 256 * 1024;
const MAX_SIGNAL = 64 * 1024; // SDP/ICE не должны быть больше

export class RelayServer {
  /**
   * @param {import('ws').WebSocketServer} wss
   * @param {import('../domain/room.js').RoomManager} rooms
   * @param {import('../persistence/store.js').Store} store
   * @param {import('../domain/lobby.js').LobbyManager} [lobbies]
   * @param {import('../domain/chat.js').ChatManager} [chat]
   */
  constructor(wss, rooms, store, lobbies = null, chat = null) {
    this.wss = wss;
    this.rooms = rooms;
    this.store = store;
    this.lobbies = lobbies;
    this.chat = chat;
    this.sockets = new Map(); // playerId -> ws
    this.names = new Map(); // playerId -> name
    this.lobbySubscribers = new Set(); // ws, подписанные на список лобби
    wss.on("connection", (ws) => this._onConnection(ws));
  }

  _send(ws, obj) {
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  }

  _playerName(playerId) {
    return this.names.get(playerId) || playerId || "Игрок";
  }

  _onConnection(ws) {
    ws.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      // Ошибка обработчика не должна ронять сервер на одном некорректном сообщении.
      try {
        this._route(ws, msg);
      } catch {
        this._send(ws, { type: "error", error: "bad-request" });
      }
    });
    ws.on("close", () => this._onClose(ws));
    ws.on("error", () => this._onClose(ws));
  }

  _route(ws, msg) {
    const v = validateMessage(msg);
    if (!v.ok) {
      this._send(ws, { type: "error", error: v.error });
      return;
    }
    const handler = ROUTES[msg.type];
    if (!handler) {
      this._send(ws, { type: "error", error: `unknown-type: ${msg.type}` });
      return;
    }
    return this[handler](ws, msg);
  }

  // ===================== МАТЧ (существующее) =====================

  _onJoin(ws, { matchId, playerId, team, sessionId, name, cartridgeFingerprint }) {
    const room = this.rooms.getRoom(matchId);
    if (!room) {
      this._send(ws, { type: "error", error: "room-not-found", matchId });
      return;
    }
    if (!room.acceptFingerprint(cartridgeFingerprint)) {
      this._send(ws, { type: "error", error: "cartridge-mismatch", matchId });
      return;
    }
    const res = room.join(playerId, team, sessionId, ws);
    if (!res.ok) {
      this._send(ws, { type: "error", error: res.error });
      return;
    }
    if (name) { this.store.upsertPlayer(playerId, name); this.names.set(playerId, name); }
    this.sockets.set(playerId, ws);
    ws.playerId = playerId;
    ws.matchId = matchId;
    this._send(ws, { type: "joined", matchId, port: res.port, reconnected: !!res.reconnected, room: this._roomState(room) });
    if (res.reconnected && room.state === "playing") {
      // возврат игрока в идущий матч — партнёры снимают паузу и пере-сопрягаются
      this._broadcastToRoom(room, { type: "peer.reconnected", playerId });
      // история чата матча (SQLite + память)
      if (this.chat) {
        this._send(ws, { type: "chat.history", scope: "match", id: matchId, messages: chatHistory(this.chat, "match", matchId) });
      }
    }
    this._broadcastRoom(room);
  }

  _roomState(room) {
    const def = room.teams[TEAM_DEF].map((p) => p.playerId);
    const att = room.teams[TEAM_ATT].map((p) => p.playerId);
    const players = [...room.players.values()].map((p) => ({
      playerId: p.playerId,
      team: p.team,
      online: !p.disconnectedAt,
    }));
    return { matchId: room.id, state: room.state, teams: { [TEAM_DEF]: def, [TEAM_ATT]: att }, players };
  }

  _broadcastRoom(room) {
    const state = this._roomState(room);
    for (const entry of [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]]) {
      this._send(this.sockets.get(entry.playerId) || entry.socket, { type: "room", room: state });
    }
  }

  // Рассылка произвольного события всем участникам комнаты (игроки + наблюдатели).
  _broadcastToRoom(room, payload) {
    for (const entry of [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]]) {
      const ws = this.sockets.get(entry.playerId) || entry.socket;
      this._send(ws, { ...payload, matchId: room.id });
    }
    for (const s of room.spectators.values()) {
      this._send(s.socket || this.sockets.get(s.playerId), { ...payload, matchId: room.id });
    }
  }

  // --- наблюдатели ---
  _onSpectate(ws, { matchId, playerId }) {
    const id = playerId || ws.playerId;
    if (!id) return this._send(ws, { type: "error", error: "playerId required" });
    const room = this.rooms.getRoom(matchId);
    if (!room) return this._send(ws, { type: "error", error: "match-not-found" });
    room.spectate(id, ws);
    ws.playerId = id;
    ws.matchId = matchId;
    ws.spectating = true;
    this.sockets.set(id, ws);
    this._send(ws, { type: "spectate.start", matchId, room: this._roomState(room) });
  }

  // Данные для наблюдателей шлёт только игрок комнаты (авторитет) — снапшоты состояния.
  _onSpectateData(ws, { matchId, frame, data }) {
    const room = this.rooms.getRoom(matchId);
    if (!room || !room.players.has(ws.playerId)) return;
    if (typeof data !== "string" || data.length > MAX_PAYLOAD) return;
    if (!room.spectators.size) return;
    for (const s of room.spectators.values()) {
      this._send(s.socket || this.sockets.get(s.playerId), { type: "spectate.data", matchId, frame, data });
    }
  }

  _onSpectateLeave(ws, { matchId }) {
    const room = this.rooms.getRoom(matchId || ws.matchId);
    if (room && ws.playerId) room.unspectate(ws.playerId);
    ws.spectating = false;
  }

  _onSignal(ws, { to, matchId, data }) {
    const room = this.rooms.getRoom(matchId);
    if (!room || !room.players.has(ws.playerId) || !room.players.has(to)) return;
    const size = JSON.stringify(data ?? null)?.length ?? 0;
    if (size > MAX_SIGNAL) return;
    const target = this.sockets.get(to);
    if (target) this._send(target, { type: "signal", from: ws.playerId, to, matchId, data });
  }

  _onRelayData(ws, { to, matchId, data }) {
    const room = this.rooms.getRoom(matchId);
    if (!room || !room.players.has(ws.playerId) || !room.players.has(to)) return;
    if (typeof data !== "string" || data.length > MAX_PAYLOAD) return;
    const target = this.sockets.get(to);
    if (target) this._send(target, { type: "relay.data", from: ws.playerId, matchId, data });
  }

  _onStart(ws, { matchId }) {
    const room = this.rooms.getRoom(matchId);
    if (!room) return;
    if (room.start()) {
      this._broadcastRoom(room);
      this.store.ensureMatch(room.id, [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]]);
    }
  }

  _onFinish(ws, { matchId, winner }) {
    const room = this.rooms.getRoom(matchId);
    if (!room) return;
    finishMatch(room, winner, { store: this.store });
    // согласованный конец матча: оба клиента получают победителя и возвращаются в лобби
    this._broadcastToRoom(room, { type: "match.finished", winner });
    this._broadcastRoom(room);
  }

  // Пауза матча (напр., вкладка игрока ушла в фон — rAF встал). Рассылаем всем
  // участникам комнаты, чтобы оба остановили симуляцию и не разъехались.
  _onPause(ws, { matchId }) {
    const room = this.rooms.getRoom(matchId || ws.matchId);
    if (!room) return;
    const payload = { type: "paused", matchId: room.id, by: ws.playerId };
    for (const entry of [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]]) {
      this._send(this.sockets.get(entry.playerId) || entry.socket, payload);
    }
  }

  _onResume(ws, { matchId }) {
    const room = this.rooms.getRoom(matchId || ws.matchId);
    if (!room) return;
    const payload = { type: "resumed", matchId: room.id, by: ws.playerId };
    for (const entry of [...room.teams[TEAM_DEF], ...room.teams[TEAM_ATT]]) {
      this._send(this.sockets.get(entry.playerId) || entry.socket, payload);
    }
  }

  // ===================== ЛОББИ =====================

  _lobbyState(lobby) { return lobby.toState(); }

  _broadcastLobby(lobby) {
    const state = this._lobbyState(lobby);
    for (const p of lobby.players.values()) this._send(p.socket, { type: "lobby", lobby: state });
  }

  _lobbyListPayload() {
    return { type: "lobbies", lobbies: this.lobbies.listOpen().map((l) => l.toState()) };
  }

  _broadcastLobbyList() {
    const payload = this._lobbyListPayload();
    for (const ws of this.lobbySubscribers) this._send(ws, payload);
  }

  _onLobbySubscribe(ws, { chatHistory: withChatHistory = true } = {}) {
    this.lobbySubscribers.add(ws);
    this._send(ws, this._lobbyListPayload());
    if (withChatHistory && this.chat) {
      this._send(ws, { type: "chat.history", scope: "global", id: null, messages: chatHistory(this.chat, "global", null) });
    }
  }

  _onLobbyCreate(ws, { playerId, name, lobbyName, settings, cartridgeFingerprint }) {
    if (!playerId) return this._send(ws, { type: "error", error: "playerId required" });
    const playerName = name || playerId;
    const lobby = this.lobbies.create({ hostPlayerId: playerId, name: lobbyName || `${playerName} — игра`, settings });
    const res = lobby.join({ playerId, name: playerName, team: TEAM_DEF, sessionId: null, socket: ws, fingerprint: cartridgeFingerprint });
    if (!res.ok) { this.lobbies.remove(lobby.id); return this._send(ws, { type: "error", error: res.error }); }
    this.names.set(playerId, playerName);
    if (name) this.store.upsertPlayer(playerId, playerName);
    ws.playerId = playerId;
    ws.lobbyId = lobby.id;
    this.sockets.set(playerId, ws);
    this._send(ws, { type: "lobby.joined", lobbyId: lobby.id, code: lobby.code, port: res.port, team: res.team });
    this._broadcastLobby(lobby);
    this._broadcastLobbyList();
  }

  _onLobbyJoin(ws, { lobbyId, code, playerId, name, team, sessionId, cartridgeFingerprint }) {
    if (!playerId) return this._send(ws, { type: "error", error: "playerId required" });
    const lobby = lobbyId ? this.lobbies.get(lobbyId) : this.lobbies.getByCode(code);
    if (!lobby) return this._send(ws, { type: "error", error: "lobby-not-found" });
    const res = lobby.join({ playerId, name, team, sessionId, socket: ws, fingerprint: cartridgeFingerprint });
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    this.names.set(playerId, name || this._playerName(playerId));
    if (name) this.store.upsertPlayer(playerId, name);
    ws.playerId = playerId;
    ws.lobbyId = lobby.id;
    this.sockets.set(playerId, ws);
    this._send(ws, { type: "lobby.joined", lobbyId: lobby.id, code: lobby.code, port: res.port, team: res.team });
    if (this.chat) {
      this._send(ws, { type: "chat.history", scope: "lobby", id: lobby.id, messages: chatHistory(this.chat, "lobby", lobby.id) });
    }
    this._broadcastLobby(lobby);
    this._broadcastLobbyList();
  }

  _onLobbyLeave(ws, { lobbyId }) {
    const id = lobbyId || ws.lobbyId;
    const lobby = this.lobbies.get(id);
    if (!lobby) return;
    lobby.leave(ws.playerId);
    ws.lobbyId = null;
    if (lobby.state === "closed") {
      if (this.chat) this.chat.clear(lobby.id);
      this.lobbies.remove(lobby.id);
    } else {
      this._broadcastLobby(lobby);
    }
    this._broadcastLobbyList();
  }

  _onLobbyTeam(ws, { lobbyId, team }) {
    const lobby = this.lobbies.get(lobbyId || ws.lobbyId);
    if (!lobby) return;
    const res = lobby.setTeam(ws.playerId, team);
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    this._broadcastLobby(lobby);
    this._broadcastLobbyList();
  }

  _onLobbyReady(ws, { lobbyId, ready }) {
    const lobby = this.lobbies.get(lobbyId || ws.lobbyId);
    if (!lobby) return;
    const res = lobby.setReady(ws.playerId, ready);
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    this._broadcastLobby(lobby);
    this._maybeAutoStart(lobby);
  }

  _onLobbySettings(ws, { lobbyId, settings }) {
    const lobby = this.lobbies.get(lobbyId || ws.lobbyId);
    if (!lobby) return;
    const res = lobby.setSettings(ws.playerId, settings);
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    this._broadcastLobby(lobby);
    this._broadcastLobbyList();
    this._maybeAutoStart(lobby);
  }

  _onLobbyKick(ws, { lobbyId, playerId }) {
    const lobby = this.lobbies.get(lobbyId || ws.lobbyId);
    if (!lobby) return;
    const res = lobby.kick(ws.playerId, playerId);
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    const kicked = this.sockets.get(playerId);
    if (kicked) { this._send(kicked, { type: "lobby.kicked", lobbyId: lobby.id }); kicked.lobbyId = null; }
    this._broadcastLobby(lobby);
    this._broadcastLobbyList();
  }

// Старт: создать Match (Room), перенести игроков, разослать match.start, закрыть лобби.
  _onLobbyStart(ws, { lobbyId }) {
    const lobby = this.lobbies.get(lobbyId || ws.lobbyId);
    if (!lobby) return this._send(ws, { type: "error", error: "lobby-not-found" });
    if (!lobby.canStart(ws.playerId)) return this._send(ws, { type: "error", error: "cannot-start" });
    this._startLobby(lobby);
  }

  // Общий запуск: используется ручным стартом хоста и авто-стартом.
  _startLobby(lobby) {
    const res = startMatch(lobby, { rooms: this.rooms, store: this.store, chat: this.chat });
    if (!res.ok) {
      lobby.state = "open";
      return this._send(this.sockets.get(lobby.hostPlayerId), { type: "error", error: res.error });
    }
    const { room, peers, stage, defStars, defPistol } = res;
    for (const p of lobby.players.values()) this.sockets.set(p.playerId, p.socket || this.sockets.get(p.playerId));

    const payload = { type: "match.start", matchId: room.id, peers, stage, defStars, defPistol };
    for (const p of lobby.players.values()) this._send(p.socket, payload);

    this.lobbies.remove(lobby.id);
    this._broadcastLobbyList();
  }

  // Авто-старт, если настройки и готовность это позволяют.
  _maybeAutoStart(lobby) {
    if (lobby && lobby.shouldAutoStart()) this._startLobby(lobby);
  }

  // ===================== ЧАТ =====================

  _onChatSend(ws, { scope = "lobby", id, text }) {
    if (!this.chat) return;
    const playerId = ws.playerId;
    if (!playerId) return this._send(ws, { type: "error", error: "not-joined" });

    // Чат матча: рассылаем всем участникам комнаты (в бою лобби уже не существует).
    if (scope === "match") {
      const matchId = id || ws.matchId;
      const room = this.rooms.getRoom(matchId);
      if (!room) return this._send(ws, { type: "error", error: "match-not-found" });
      const res = sendChat(this.chat, { scope: "match", id: matchId, playerId, name: this._playerName(playerId), text });
      if (!res.ok) return this._send(ws, { type: "error", error: res.error });
      this._broadcastToRoom(room, { type: "chat", ...res.message });
      return;
    }

    const lobbyId = id || ws.lobbyId;
    let name = this._playerName(playerId);
    if (scope !== "global") {
      const lobby = this.lobbies.get(lobbyId);
      if (!lobby) return this._send(ws, { type: "error", error: "lobby-not-found" });
      name = lobby.players.get(playerId)?.name || name;
    }
    const res = sendChat(this.chat, { scope, id: scope === "global" ? null : lobbyId, playerId, name, text });
    if (!res.ok) return this._send(ws, { type: "error", error: res.error });
    const payload = { type: "chat", ...res.message };
    if (scope === "global") {
      for (const client of this.wss.clients) this._send(client, payload);
    } else {
      const lobby = this.lobbies.get(lobbyId);
      if (lobby) for (const p of lobby.players.values()) this._send(p.socket, payload);
    }
  }

  // ===================== ЗАКРЫТИЕ =====================

  _onClose(ws) {
    this.lobbySubscribers.delete(ws);
    const playerId = ws.playerId;
    if (!playerId) return;
    // лобби
    if (ws.lobbyId) {
      const lobby = this.lobbies?.get(ws.lobbyId);
      if (lobby) {
        lobby.disconnect(playerId);
        this._broadcastLobby(lobby);
        this._broadcastLobbyList();
      }
    }
    // матч
    this.sockets.delete(playerId);
    for (const room of this.rooms.rooms.values()) {
      if (room.isSpectator(playerId)) room.unspectate(playerId);
      if (room.players.has(playerId)) {
        room.disconnect(playerId);
        if (room.state === "playing") {
          this._broadcastToRoom(room, { type: "peer.left", playerId });
        }
        this._broadcastRoom(room);
      }
    }
  }
}

export default RelayServer;
