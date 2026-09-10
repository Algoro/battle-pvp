// server.js — HTTP API + WebSocket (signaling relay) для Battle City PvP.
// Без Docker: прямой Node-процесс + SQLite. Пути относительные от ./backend.
//
// HTTP:
//   GET  /health        -> { ok: true }
//   GET  /rooms         -> список открытых лобби
//   GET  /matches       -> история матчей (SQLite)
//   POST /matchmake     -> { playerId, team, name? } -> { room } | { queued: true }
//   GET  /matches/:id   -> один матч (опционально)
// WS (path /ws)          -> RelayServer (signaling + data relay)
//
// Относительный путь: ./backend/server.js
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { RoomManager, TEAM_DEF, TEAM_ATT } from "./matchmaking/rooms.js";
import { Matchmaker } from "./matchmaking/matchmaker.js";
import { RelayServer } from "./signaling/relay.js";
import { Store } from "./persistence/store.js";
import { LobbyManager, startLobbyMatch } from "./lobby/lobby.js";
import { ChatManager } from "./lobby/chat.js";
import { readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, "..", "frontend", "dist");
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".nes": "application/octet-stream",
};

// Отдаёт собранный SPA-фронт (frontend/dist) с fallback на index.html.
function serveStatic(req, res) {
  if (!existsSync(DIST)) return json(res, 404, { error: "frontend not built (npm run build)" });
  const urlPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = urlPath === "/" ? "index.html" : urlPath;
  let abs = join(DIST, file);
  // SPA fallback: неизвестные пути -> index.html
  if (!existsSync(abs) || !statSync(abs).isFile()) abs = join(DIST, "index.html");
  const ext = extname(abs);
  const headers = { "content-type": MIME[ext] || "application/octet-stream" };
  // index.html не кэшируем, чтобы после пересборки браузер всегда получал ссылки на
  // свежие хешированные бандлы (иначе старая вкладка может грузить устаревший JS).
  if (abs.endsWith("index.html")) headers["cache-control"] = "no-cache, no-store, must-revalidate";
  res.writeHead(200, headers);
  res.end(readFileSync(abs));
}

export function createApp({ dbPath } = {}) {
  const store = new Store(dbPath);
  const rooms = new RoomManager();
  const matchmaker = new Matchmaker(rooms);
  const lobbies = new LobbyManager();
  const chat = new ChatManager({ store });
  const http = createServer((req, res) => handleHttp(req, res, { store, rooms, matchmaker, lobbies, chat }));
  const wss = new WebSocketServer({ server: http, path: "/ws" });
  new RelayServer(wss, rooms, store, lobbies, chat);

  const cleanupTimer = setInterval(() => {
    rooms.cleanup();
    lobbies.cleanup();
  }, 30_000);
  cleanupTimer.unref?.();

  return {
    http,
    wss,
    store,
    rooms,
    matchmaker,
    lobbies,
    chat,
    close() {
      clearInterval(cleanupTimer);
      for (const c of wss.clients) c.terminate();
      wss.close();
      return new Promise((r) => http.close(() => r()));
    },
  };
}

function json(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch {
        resolve(null);
      }
    });
  });
}

async function handleHttp(req, res, ctx) {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;

  if (req.method === "GET" && path === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && path === "/rooms") {
    return json(res, 200, ctx.rooms.listLobbies().map((r) => ({
      matchId: r.id, state: r.state, players: r.playerCount,
    })));
  }
  if (req.method === "GET" && path === "/matches") return json(res, 200, ctx.store.listMatches());
  if (req.method === "POST" && path === "/matchmake") {
    const body = await readBody(req);
    if (!body || !body.playerId || !body.team) return json(res, 400, { error: "playerId,team required" });
    if (body.name) ctx.store.upsertPlayer(body.playerId, body.name);
    const res2 = ctx.matchmaker.add(body.playerId, body.team, body.playerId, body.cartridgeFingerprint);
    if (res2.queued) return json(res, 202, { queued: true });
    return json(res, 200, { room: res2.room.id, port: res2.port, opponent: res2.opponent });
  }

  // --- лобби (Lobby): create/list/detail/join/leave/team/ready/settings/kick/start ---
  if (req.method === "GET" && path === "/lobbies") {
    return json(res, 200, ctx.lobbies.listOpen().map((l) => l.toState()));
  }
  if (req.method === "POST" && path === "/lobbies") {
    const body = await readBody(req);
    if (!body || !body.playerId) return json(res, 400, { error: "playerId required" });
    const playerName = body.name || body.playerId;
    const lobby = ctx.lobbies.create({ hostPlayerId: body.playerId, name: body.lobbyName || `${playerName} — игра`, settings: body.settings });
    const r = lobby.join({ playerId: body.playerId, name: playerName, team: TEAM_DEF, sessionId: null, socket: null, fingerprint: body.cartridgeFingerprint });
    if (!r.ok) { ctx.lobbies.remove(lobby.id); return json(res, 400, { error: r.error }); }
    if (body.name) ctx.store.upsertPlayer(body.playerId, playerName);
    return json(res, 201, { lobbyId: lobby.id, code: lobby.code, port: r.port, lobby: lobby.toState() });
  }
  const lobbyMatch = path.match(/^\/lobbies\/([^/]+)(?:\/([a-z]+))?$/);
  if (lobbyMatch) {
    const id = decodeURIComponent(lobbyMatch[1]);
    const action = lobbyMatch[2];
    const lobby = ctx.lobbies.get(id) || ctx.lobbies.getByCode(id);
    if (!lobby) return json(res, 404, { error: "lobby-not-found" });
    if (req.method === "GET" && !action) return json(res, 200, lobby.toState());
    const body = await readBody(req);
    if (req.method === "POST" && action === "join") {
      const r = lobby.join({ playerId: body.playerId, name: body.name, team: body.team, sessionId: null, socket: null, fingerprint: body.cartridgeFingerprint });
      if (!r.ok) return json(res, 400, { error: r.error });
      if (body.name) ctx.store.upsertPlayer(body.playerId, body.name);
      return json(res, 200, { port: r.port, lobby: lobby.toState() });
    }
    if (req.method === "POST" && action === "leave") {
      lobby.leave(body.playerId);
      if (lobby.state === "closed") ctx.lobbies.remove(lobby.id);
      return json(res, 200, { ok: true, lobby: lobby.state === "closed" ? null : lobby.toState() });
    }
    if (req.method === "POST" && action === "team") {
      const r = lobby.setTeam(body.playerId, body.team);
      return r.ok ? json(res, 200, { lobby: lobby.toState() }) : json(res, 400, { error: r.error });
    }
    if (req.method === "POST" && action === "ready") {
      const r = lobby.setReady(body.playerId, body.ready);
      return r.ok ? json(res, 200, { lobby: lobby.toState() }) : json(res, 400, { error: r.error });
    }
    if (req.method === "POST" && action === "settings") {
      const r = lobby.setSettings(body.playerId, body.settings);
      return r.ok ? json(res, 200, { lobby: lobby.toState() }) : json(res, 400, { error: r.error });
    }
    if (req.method === "POST" && action === "kick") {
      const r = lobby.kick(body.playerId, body.target || body.targetPlayerId);
      return r.ok ? json(res, 200, { lobby: lobby.toState() }) : json(res, 400, { error: r.error });
    }
    if (req.method === "POST" && action === "start") {
      if (!lobby.canStart(body.playerId)) return json(res, 400, { error: "cannot-start" });
      const r = startLobbyMatch(lobby, ctx.rooms);
      if (!r.ok) return json(res, 400, { error: r.error });
      ctx.store.ensureMatch(r.room.id, [...r.room.teams[TEAM_DEF], ...r.room.teams[TEAM_ATT]]);
      ctx.chat.clear(lobby.id);
      ctx.lobbies.remove(lobby.id);
      return json(res, 200, { matchId: r.room.id, peers: r.peers, stage: lobby.settings.stage || 1, defStars: lobby.settings.defStars || 0 });
    }
    return json(res, 404, { error: "unknown-action" });
  }
  // Всё остальное — статический SPA-фронт (один контейнер, один порт).
  return serveStatic(req, res);
}

// Запуск при прямом исполнении (npm start)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 8080);
  const app = createApp();
  app.http.listen(port, () => console.log(`backend on :${port}`));
}

export default createApp;
