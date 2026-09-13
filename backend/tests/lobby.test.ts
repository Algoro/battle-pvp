// lobby.test.js — tests for the lobby (Lobby/LobbyManager), chat, and integration (HTTP + WS).
// Run: node --test tests/lobby.test.js
import { test } from "node:test";
import assert from "node:assert";
import { Lobby, LobbyManager, normalizeSettings } from "../domain/lobby.ts";
import { ChatManager } from "../domain/chat.ts";
import { Store } from "../persistence/store.ts";
import { SqliteChatRepository } from "../persistence/chat-repository.ts";
import { TEAM_DEF, TEAM_ATT } from "../domain/room.ts";
import { createApp } from "../server.ts";
import { WebSocket } from "ws";

const J = (x) => JSON.parse(x.toString());

test("Lobby: create, join, configurable slots, ports, reconnect, leave, host transfer", () => {
  const lm = new LobbyManager();
  const lobby = lm.create({ hostPlayerId: "host", name: "Моя игра", settings: { defSlots: 1, attSlots: 3 } });
  assert.strictEqual(lobby.playerCount, 0);
  assert.strictEqual(lobby.toState().settings.defSlots, 1);
  assert.strictEqual(lobby.toState().settings.attSlots, 3);

  // host -> DEF, port 0
  const h = lobby.join({ playerId: "host", name: "Host", team: TEAM_DEF, sessionId: null, socket: null });
  assert.strictEqual(h.ok, true);
  assert.strictEqual(h.port, 0);
  // DEF is already occupied (defSlots=1)
  assert.strictEqual(lobby.join({ playerId: "d2", name: "D2", team: TEAM_DEF, sessionId: null, socket: null }).ok, false);
  // ATT: ports 2,3,4
  assert.strictEqual(lobby.join({ playerId: "a1", name: "A1", team: TEAM_ATT, sessionId: null, socket: null }).port, 2);
  assert.strictEqual(lobby.join({ playerId: "a2", name: "A2", team: TEAM_ATT, sessionId: null, socket: null }).port, 3);
  assert.strictEqual(lobby.join({ playerId: "a3", name: "A3", team: TEAM_ATT, sessionId: null, socket: null }).port, 4);
  // the 4th ATT does not fit (attSlots=3)
  assert.strictEqual(lobby.join({ playerId: "a4", name: "A4", team: TEAM_ATT, sessionId: null, socket: null }).ok, false);

  // reconnection
  const rc = lobby.join({ playerId: "a1", name: "A1", team: TEAM_ATT, sessionId: null, socket: null });
  assert.strictEqual(rc.reconnected, true);
  assert.strictEqual(lobby.playerCount, 4);

  // ready / team
  assert.strictEqual(lobby.setReady("a1", true).ready, true);
  assert.strictEqual(lobby.setTeam("a1", TEAM_DEF).ok, false, "DEF переполнен");

  // leave + host transfer
  lobby.leave("a1");
  lobby.leave("host");
  assert.strictEqual(lobby.hostPlayerId, "a2", "хост передан первому оставшемуся");
  assert.strictEqual(lobby.players.get("a2").host, true);
});

test("Lobby: настройки клэмпятся в допустимые границы (DEF 1-2, ATT 1-6)", () => {
  assert.deepStrictEqual(normalizeSettings({ defSlots: 5, attSlots: 99 }), { defSlots: 2, attSlots: 6, autoStart: false, requireReady: false, fillBots: true, stage: 1, defStars: 0, defPistol: false, features: [], featureOptions: {} });
  assert.deepStrictEqual(normalizeSettings({ defSlots: 0, attSlots: -3 }), { defSlots: 1, attSlots: 1, autoStart: false, requireReady: false, fillBots: true, stage: 1, defStars: 0, defPistol: false, features: [], featureOptions: {} });
  assert.strictEqual(normalizeSettings({ requireReady: true }).requireReady, true);
  assert.strictEqual(normalizeSettings({ stage: 42 }).stage, 35);
  assert.strictEqual(normalizeSettings({ stage: 0 }).stage, 1);
  assert.strictEqual(normalizeSettings({ defStars: 9 }).defStars, 3);
  assert.strictEqual(normalizeSettings({ defStars: -1 }).defStars, 0);
  // setSettings cannot shrink below the occupied count
  const lobby = new Lobby({ hostPlayerId: "h" });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  lobby.join({ playerId: "d2", name: "D2", team: TEAM_DEF, sessionId: null, socket: null });
  const r = lobby.setSettings("h", { defSlots: 1 });
  assert.strictEqual(r.ok, false, "2 игрока в DEF, сжать до 1 нельзя");
  assert.strictEqual(lobby.setSettings("h", { attSlots: 4 }).ok, true);
  assert.strictEqual(lobby.setSettings("x", { attSlots: 4 }).ok, false, "не хост");
});

test("ChatManager: санитизация, история, rate-limit", () => {
  const cm = new ChatManager({ maxHistory: 3, rateCount: 2, rateWindowMs: 1000 });
  const a = cm.send("global", null, { playerId: "p1", name: "P1", text: "  привет\u0001  ", ts: 0 });
  assert.strictEqual(a.message.text, "привет");
  cm.send("global", null, { playerId: "p1", name: "P1", text: "второе", ts: 1 });
  const third = cm.send("global", null, { playerId: "p1", name: "P1", text: "третье", ts: 2 });
  assert.strictEqual(third.error, "rate-limit", "третье сообщение в окне — лимит");
  assert.strictEqual(cm.send("global", null, { playerId: "p1", name: "P1", text: "   ", ts: 3 }).error, "empty");
  // history is bounded by maxHistory
  cm.send("global", null, { playerId: "p2", name: "P2", text: "x", ts: 10 });
  cm.send("global", null, { playerId: "p2", name: "P2", text: "y", ts: 11 });
  cm.send("global", null, { playerId: "p2", name: "P2", text: "z", ts: 12 });
  assert.strictEqual(cm.getHistory("global", null).length, 3);
  // the lobby scope is separate (ts outside the rate-limit window so p1 can write again)
  cm.send("lobby", "l1", { playerId: "p1", name: "P1", text: "лобби", ts: 5000 });
  assert.strictEqual(cm.getHistory("lobby", "l1").length, 1);
});

test("интеграция HTTP: create -> list -> join -> start", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const base = `http://127.0.0.1:${app.http.address().port}`;
  const post = (p, b) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json());

  const created = await post("/lobbies", { playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } });
  assert.ok(created.lobbyId);
  assert.strictEqual(created.port, 0);

  const list = await fetch(base + "/lobbies").then((r) => r.json());
  assert.ok(list.some((l) => l.id === created.lobbyId && l.slots.DEF === 1));

  const joined = await post(`/lobbies/${created.lobbyId}/join`, { playerId: "att1", name: "Att", team: TEAM_ATT });
  assert.strictEqual(joined.port, 2);

  // switching teams in the lobby is available if there is a slot
  const started = await post(`/lobbies/${created.lobbyId}/start`, { playerId: "host" });
  assert.ok(started.matchId, "старт лобби создаёт матч");
  assert.strictEqual(started.peers.length, 2);
  // the lobby is closed and removed
  const list2 = await fetch(base + "/lobbies").then((r) => r.json());
  assert.ok(!list2.some((l) => l.id === created.lobbyId));

  await app.close();
}, { timeout: 15000 });

test("интеграция WS: subscribe -> create -> join -> ready -> chat -> start", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  const c2 = new WebSocket(wsBase);
  await Promise.all([new Promise((r) => c1.on("open", r)), new Promise((r) => c2.on("open", r))]);

  const waitMsg = (ws, type, pred = () => true) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout " + type)), 3000);
      ws.on("message", function h(d) {
        const m = J(d);
        if (m.type === type && pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
      });
    });

  // subscription to the list
  const lobbiesSnap = waitMsg(c1, "lobbies");
  c1.send(JSON.stringify({ type: "lobby.subscribe" }));
  assert.ok(Array.isArray((await lobbiesSnap).lobbies));

  // creation (host)
  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } }));
  const jh = await joinedHost;
  const lobbyId = jh.lobbyId;
  assert.strictEqual(jh.port, 0);

  // join (att)
  const lobbyState = waitMsg(c1, "lobby");
  const joinedAtt = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  const ja = await joinedAtt;
  assert.strictEqual(ja.port, 2);
  const st = await lobbyState;
  assert.ok(st.lobby.players.some((p) => p.id === "att1"));

  // ready
  const readyState = waitMsg(c1, "lobby", (m) => m.lobby.players.some((p) => p.id === "att1" && p.ready));
  c2.send(JSON.stringify({ type: "lobby.ready", lobbyId, ready: true }));
  await readyState;

  // lobby chat
  const chat1 = waitMsg(c1, "chat");
  const chat2 = waitMsg(c2, "chat");
  c2.send(JSON.stringify({ type: "chat.send", scope: "lobby", text: "привет" }));
  assert.strictEqual((await chat1).text, "привет");
  assert.strictEqual((await chat2).text, "привет");

  // start by the host -> match.start for both
  const ms1 = waitMsg(c1, "match.start");
  const ms2 = waitMsg(c2, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1, s2 = await ms2;
  assert.ok(s1.matchId);
  assert.strictEqual(s1.matchId, s2.matchId);
  assert.strictEqual(s1.peers.length, 2);

  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("Room: лимиты по командам — DEF максимум 2, ATT до 6", async () => {
  const { Room } = await import("../domain/room.ts");
  const room = new Room();
  for (let i = 0; i < 2; i++) assert.strictEqual(room.join("d" + i, TEAM_DEF, null, null).ok, true);
  assert.strictEqual(room.join("d2", TEAM_DEF, null, null).ok, false, "3-й DEF не должен влезать");
  for (let i = 0; i < 6; i++) assert.strictEqual(room.join("a" + i, TEAM_ATT, null, null).ok, true);
  assert.strictEqual(room.join("a6", TEAM_ATT, null, null).ok, false, "7-й ATT не должен влезать");
  assert.strictEqual(room.playerCount, 8);
});

test("Lobby: requireReady — хост не стартует, пока не-хост игроки не готовы", () => {
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1, requireReady: true } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  lobby.join({ playerId: "a", name: "A", team: TEAM_ATT, sessionId: null, socket: null });
  assert.strictEqual(lobby.canStart("h"), false, "без ready старт запрещён");
  assert.strictEqual(lobby.canStart("a"), false, "не хост");
  lobby.setReady("a", true);
  assert.strictEqual(lobby.canStart("h"), true, "после ready старт разрешён");
  // without requireReady there is no restriction
  const l2 = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1 } });
  l2.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  assert.strictEqual(l2.canStart("h"), true);
});

test("Lobby: shouldAutoStart — полное лобби + все ready", () => {
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1, autoStart: true } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  lobby.join({ playerId: "a", name: "A", team: TEAM_ATT, sessionId: null, socket: null });
  assert.strictEqual(lobby.shouldAutoStart(), false, "не все готовы");
  lobby.setReady("a", true);
  assert.strictEqual(lobby.isFull(), true);
  assert.strictEqual(lobby.shouldAutoStart(), true);
});

test("ChatManager: история чата персистится через порт ChatRepository (SQLite)", () => {
  const store = new Store(":memory:");
  const repository = new SqliteChatRepository(store);
  const cm = new ChatManager({ repository });
  cm.send("global", null, { playerId: "p1", name: "P1", text: "привет", ts: 1 });
  cm.send("match", "m1", { playerId: "p2", name: "P2", text: "в бой", ts: 2 });

  // a new manager (empty memory) reads history from the DB
  const cm2 = new ChatManager({ repository });
  const g = cm2.getHistory("global", null);
  assert.strictEqual(g.length, 1);
  assert.strictEqual(g[0].text, "привет");
  const m = cm2.getHistory("match", "m1");
  assert.strictEqual(m.length, 1);
  assert.strictEqual(m[0].id, "m1");
  store.close();
});

test("интеграция WS: авто-старт при полном лобби и готовности всех", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  const c2 = new WebSocket(wsBase);
  await Promise.all([new Promise((r) => c1.on("open", r)), new Promise((r) => c2.on("open", r))]);
  const waitMsg = (ws, type, pred = () => true) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout " + type)), 3000);
      const h = (d) => { const m = J(d); if (m.type === type && pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); } };
      ws.on("message", h);
    });

  const jh = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 1, autoStart: true } }));
  const lobbyId = (await jh).lobbyId;

  const ja = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await ja;

  // without lobby.start: ready from att1 starts the match automatically
  const ms1 = waitMsg(c1, "match.start");
  const ms2 = waitMsg(c2, "match.start");
  c2.send(JSON.stringify({ type: "lobby.ready", lobbyId, ready: true }));
  const s1 = await ms1, s2 = await ms2;
  assert.ok(s1.matchId);
  assert.strictEqual(s1.matchId, s2.matchId);
  assert.strictEqual(s1.peers.length, 2);

  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("Room.join: некорректная команда/playerId не роняет и не добавляет", async () => {
  const { Room } = await import("../domain/room.ts");
  const room = new Room();
  assert.strictEqual(room.join("x", "HACK", null, null).ok, false);
  assert.strictEqual(room.join("x", undefined, null, null).ok, false);
  assert.strictEqual(room.join("", TEAM_DEF, null, null).ok, false);
  assert.strictEqual(room.playerCount, 0);
});

test("cartridgeFingerprint: лобби не стартует при разных наборах патчей", async () => {
  const { startLobbyMatch } = await import("../domain/lobby.ts");
  const { RoomManager } = await import("../domain/room.ts");
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1 } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null, fingerprint: "aaaa" });
  lobby.join({ playerId: "a", name: "A", team: TEAM_ATT, sessionId: null, socket: null, fingerprint: "bbbb" });
  assert.strictEqual(lobby.fingerprintsAgree(), false);
  const rooms = new RoomManager();
  const r = startLobbyMatch(lobby, rooms);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, "cartridge-mismatch");
  assert.strictEqual(rooms.rooms.size, 0, "комната не должна создаваться при рассинхроне картриджей");

  // matching fingerprints — start is ok
  lobby.players.get("a").fingerprint = "aaaa";
  assert.strictEqual(lobby.fingerprintsAgree(), true);
  const r2 = startLobbyMatch(lobby, rooms);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(r2.room.cartridgeFingerprint, "aaaa");
});

test("matchmaker: пары только с одинаковым отпечатком картриджа", async () => {
  const { Matchmaker } = await import("../domain/matchmaker.ts");
  const { RoomManager } = await import("../domain/room.ts");
  const mm = new Matchmaker(new RoomManager());
  assert.strictEqual(mm.add("d1", TEAM_DEF, null, "A").queued, true);
  assert.strictEqual(mm.add("a1", TEAM_ATT, null, "B").queued, true, "разные картриджи не спариваются");
  const paired = mm.add("a2", TEAM_ATT, null, "A");
  assert.ok(paired.room, "одинаковый картридж должен спариться");
  assert.strictEqual(paired.room.cartridgeFingerprint, "A");
  assert.strictEqual(paired.opponent, "d1");
});

test("интеграция WS: выбранная стадия передаётся в match.start", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  const c2 = new WebSocket(wsBase);
  await Promise.all([new Promise((r) => c1.on("open", r)), new Promise((r) => c2.on("open", r))]);
  const waitMsg = (ws, type, pred = () => true) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout " + type)), 3000);
      const h = (d) => { const m = J(d); if (m.type === type && pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); } };
      ws.on("message", h);
    });
  const jh = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 1, stage: 7, defStars: 2 } }));
  const lobbyId = (await jh).lobbyId;
  const ja = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await ja;
  const ms1 = waitMsg(c1, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1;
  assert.strictEqual(s1.stage, 7);
  assert.strictEqual(s1.defStars, 2);
  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("Lobby.join: без явного team игрок идёт в ATT (регрессия DEF-full)", () => {
  // The DEF slot is taken by the host; a player without a team must land in ATT, not be rejected.
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1 } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  const r = lobby.join({ playerId: "a", name: "A", sessionId: null, socket: null });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.team, TEAM_ATT);
  assert.strictEqual(r.port, 2);

  // setTeam with an invalid value also lands in ATT (historical rule).
  const s = lobby.setTeam("a", undefined);
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.team, TEAM_ATT);
  assert.strictEqual(lobby.setTeam("h", "HACK").ok, false, "хост не может в переполненный ATT");
});

test("normalizeSettings: defPistol нормализуется в boolean", () => {
  assert.strictEqual(normalizeSettings({}).defPistol, false);
  assert.strictEqual(normalizeSettings({ defPistol: true }).defPistol, true);
  assert.strictEqual(normalizeSettings({ defPistol: 1 }).defPistol, true);
  assert.strictEqual(normalizeSettings({ defPistol: 0 }).defPistol, false);
});

test("normalizeSettings: features фильтруются и канонизируются", () => {
  assert.deepStrictEqual(normalizeSettings({ features: ["pistol", "pistol", "nope"] }).features, ["pistol"]);
  assert.deepStrictEqual(normalizeSettings({ features: "pistol" }).features, ["pistol"]);
  assert.deepStrictEqual(normalizeSettings({}).features, []);
});

test("lobby: featureOptions нормализуются по манифесту", () => {
  const s = normalizeSettings({
    featureOptions: {
      "friendly-fire-att": { damage: 9, nope: 1, selfDamage: 0 },
      "friendly-fire": { defenders: 0 },
      ghost: { a: 1 },
    },
  });
  // old split ids are folded into the merged `friendly-fire` (later values win)
  assert.deepStrictEqual(s.featureOptions, {
    "friendly-fire": { defenders: false, damage: 3, selfDamage: false },
  });
});
