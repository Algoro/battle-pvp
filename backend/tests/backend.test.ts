// backend.test.js — unit + integration тесты backend (rooms, matchmaker, store, relay).
// Запуск: node --test tests/backend.test.js
import { test } from "node:test";
import assert from "node:assert";
import { RoomManager, TEAM_DEF, TEAM_ATT } from "../domain/room.ts";
import { Matchmaker } from "../domain/matchmaker.ts";
import { Store } from "../persistence/store.ts";
import { createApp } from "../server.ts";
import { WebSocket } from "ws";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("RoomManager: join, full team, port assignment, leave, TTL", () => {
  const rm = new RoomManager({ ttlMs: 1000 });
  const room = rm.createRoom();
  room.join("p1", TEAM_DEF, "s1", null);
  room.join("p2", TEAM_DEF, "s2", null);
  // третьему в DEF места нет
  assert.strictEqual(room.join("p3", TEAM_DEF, "s3", null).ok, false);
  // ATT
  const r4 = room.join("p4", TEAM_ATT, "s4", null);
  assert.strictEqual(r4.ok, true);
  assert.strictEqual(r4.port, 2); // первый ATT -> порт 2
  assert.strictEqual(room.portFor("p1"), 0);
  assert.strictEqual(room.portFor("p2"), 1);
  // реконнект
  const rc = room.join("p1", TEAM_DEF, "s1", null);
  assert.strictEqual(rc.reconnected, true);
  assert.strictEqual(room.playerCount, 3);
  // leave
  room.leave("p2");
  assert.strictEqual(room.playerCount, 2);
  // TTL
  assert.strictEqual(room.isActive(Date.now()), true);
  assert.strictEqual(room.isActive(Date.now() + 5000), false);
});

test("Matchmaker: парyет DEF + ATT в комнату", () => {
  const rooms = new RoomManager();
  const mm = new Matchmaker(rooms);
  const first = mm.add("def1", TEAM_DEF, "s1");
  assert.strictEqual(first.queued, true);
  const second = mm.add("att1", TEAM_ATT, "s2");
  assert.strictEqual(second.queued, undefined);
  assert.ok(second.room);
  assert.strictEqual(second.room.playerCount, 2);
  assert.strictEqual(rooms.rooms.size, 1);
});

test("Store: create/finish/list матча в SQLite", () => {
  const store = new Store(":memory:");
  store.upsertPlayer("p1", "Player One");
  const mid = "m_test1";
  store.createMatch(mid, [
    { playerId: "p1", team: TEAM_DEF },
    { playerId: "p2", team: TEAM_ATT },
  ]);
  store.finishMatch(mid, TEAM_DEF);
  const matches = store.listMatches();
  const m = matches.find((x) => x.id === mid);
  assert.ok(m, "матч должен быть в истории");
  assert.strictEqual(m.winner_team, TEAM_DEF);
  assert.strictEqual(m.state, "finished");
  store.close();
});

test("интеграция: HTTP + WS signaling relay передаёт сигнал между пирами", async () => {
  try {
    await integrationBody();
  } catch (e) {
    console.error("INTEGRATION ERR:", e && (e.stack || e));
    throw e;
  }
}, { timeout: 15000 });

async function integrationBody() {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const port = app.http.address().port;
  const base = `http://127.0.0.1:${port}`;
  const wsBase = `ws://127.0.0.1:${port}/ws`;

  // матчмейкинг: def1 + att1 -> комната
  const rDef = await fetch(`${base}/matchmake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: "def1", team: TEAM_DEF, name: "Def" }),
  }).then((r) => r.json());
  const rAtt = await fetch(`${base}/matchmake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: "att1", team: TEAM_ATT, name: "Att" }),
  }).then((r) => r.json());
  const matchId = rAtt.room;
  assert.ok(matchId);

  // два ws-клиента входят в комнату (ждём открытие КАЖДОГО)
  const c1 = new WebSocket(wsBase);
  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  await new Promise((r) => c2.on("open", r));

  const waitMsg = (ws, type) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout " + type)), 3000);
      ws.on("message", function h(d) {
        const m = JSON.parse(d.toString());
        if (m.type === type) { clearTimeout(t); ws.off("message", h); resolve(m); }
      });
    });

  const joined1 = waitMsg(c1, "joined");
  const joined2 = waitMsg(c2, "joined");
  c1.send(JSON.stringify({ type: "join", matchId, playerId: "def1", team: TEAM_DEF }));
  c2.send(JSON.stringify({ type: "join", matchId, playerId: "att1", team: TEAM_ATT }));
  const j1 = await joined1;
  const j2 = await joined2;
  assert.strictEqual(j1.port, 0);
  assert.strictEqual(j2.port, 2);

  // сигналинг: def1 -> att1 (SDP/ICE relay)
  const gotSignal = waitMsg(c2, "signal");
  c1.send(JSON.stringify({ type: "signal", to: "att1", matchId, data: { type: "offer", sdp: "fake" } }));
  const sig = await gotSignal;
  assert.strictEqual(sig.from, "def1");
  assert.strictEqual(sig.data.sdp, "fake");

  // finish -> персистентность
  c1.send(JSON.stringify({ type: "finish", matchId, winner: TEAM_DEF }));
  await new Promise((r) => setTimeout(r, 100));
  const matches = await fetch(`${base}/matches`).then((r) => r.json());
  assert.ok(matches.some((m) => m.id === matchId && m.winner_team === TEAM_DEF));

  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}
