// reconnect.test.js — реконнект в идущем матче: обрыв игрока -> peer.left,
// возврат с тем же playerId -> joined{reconnected}, peer.reconnected партнёру.
import { test } from "node:test";
import assert from "node:assert";
import { createApp } from "../server.js";
import { TEAM_ATT, TEAM_DEF } from "../domain/room.js";
import { WebSocket } from "ws";

const J = (x) => JSON.parse(x.toString());

function waitMsg(ws, type, pred = () => true, timeout = 3000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout " + type)), timeout);
    const h = (d) => {
      const m = J(d);
      if (m.type === type && pred(m)) { clearTimeout(t); ws.off("message", h); resolve(m); }
    };
    ws.on("message", h);
  });
}

test("реконнект в идущем матче: peer.left -> повторный join -> peer.reconnected", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;

  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  // host создаёт лобби
  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } }));
  const jh = await joinedHost;
  const lobbyId = jh.lobbyId;

  // att присоединяется и стартует матч
  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const joinedAtt = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await joinedAtt;

  const ms1 = waitMsg(c1, "match.start");
  const ms2 = waitMsg(c2, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1;
  await ms2;
  assert.ok(s1.matchId);

  // обрыв att1 -> host получает peer.left
  const leftP = waitMsg(c1, "peer.left", (m) => m.playerId === "att1");
  c2.close();
  const left = await leftP;
  assert.strictEqual(left.matchId, s1.matchId);

  // возврат att1 тем же playerId -> host получает peer.reconnected
  const c2b = new WebSocket(wsBase);
  await new Promise((r) => c2b.on("open", r));
  const reconnP = waitMsg(c1, "peer.reconnected", (m) => m.playerId === "att1");
  const joinedP = waitMsg(c2b, "joined");
  c2b.send(JSON.stringify({ type: "join", matchId: s1.matchId, playerId: "att1", team: TEAM_ATT, name: "Att" }));
  const j2 = await joinedP;
  assert.strictEqual(j2.reconnected, true, "сервер должен распознать реконнект");
  assert.strictEqual(j2.port, 2);
  const rc = await reconnP;
  assert.strictEqual(rc.matchId, s1.matchId);

  c1.close(); c2b.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("room state отражает online-статус игроков", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));

  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } }));
  const jh = await joinedHost;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const joinedAtt = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId: jh.lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await joinedAtt;

  const ms1 = waitMsg(c1, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId: jh.lobbyId }));
  await ms1;

  // после обрыва host получает room, где att1 offline
  const roomP = waitMsg(c1, "room", (m) => m.room.players?.some((p) => p.playerId === "att1" && p.online === false));
  c2.close();
  const room = await roomP;
  const att = room.room.players.find((p) => p.playerId === "att1");
  assert.strictEqual(att.online, false);
  assert.strictEqual(room.room.players.find((p) => p.playerId === "host").online, true);

  c1.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("конец матча: finish рассылает match.finished с победителем обоим", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));

  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } }));
  const jh = await joinedHost;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const joinedAtt = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId: jh.lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await joinedAtt;

  const ms1 = waitMsg(c1, "match.start");
  const ms2 = waitMsg(c2, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId: jh.lobbyId }));
  const s1 = await ms1;
  await ms2;

  const fin1 = waitMsg(c1, "match.finished", (m) => m.winner === "DEF");
  const fin2 = waitMsg(c2, "match.finished", (m) => m.winner === "DEF");
  c1.send(JSON.stringify({ type: "finish", matchId: s1.matchId, winner: "DEF" }));
  const f1 = await fin1;
  const f2 = await fin2;
  assert.strictEqual(f1.matchId, s1.matchId);
  assert.strictEqual(f2.winner, "DEF");

  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("старт 1 DEF + 3 ATT создаёт матч с 4 пирами (лимиты команд движка)", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 3 } }));
  const jh = await joinedHost;

  const clients = [];
  for (let i = 1; i <= 3; i++) {
    const c = new WebSocket(wsBase);
    await new Promise((r) => c.on("open", r));
    const joined = waitMsg(c, "lobby.joined");
    c.send(JSON.stringify({ type: "lobby.join", lobbyId: jh.lobbyId, playerId: "att" + i, name: "Att" + i, team: TEAM_ATT }));
    const j = await joined;
    assert.strictEqual(j.port, 1 + i, "порт ATT");
    clients.push(c);
  }

  const ms1 = waitMsg(c1, "match.start");
  const msAtt = clients.map((c) => waitMsg(c, "match.start"));
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId: jh.lobbyId }));
  const s1 = await ms1;
  await Promise.all(msAtt);
  assert.strictEqual(s1.peers.length, 4, "должны стартовать 4 игрока");
  const teams = s1.peers.map((p) => p.team).sort();
  assert.deepStrictEqual(teams, ["ATT", "ATT", "ATT", "DEF"]);

  c1.close(); for (const c of clients) c.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("чат матча: scope=match рассылается всем участникам комнаты", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  const joinedHost = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 2, attSlots: 2 } }));
  const jh = await joinedHost;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const joinedAtt = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId: jh.lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await joinedAtt;

  const ms1 = waitMsg(c1, "match.start");
  const ms2 = waitMsg(c2, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId: jh.lobbyId }));
  const s1 = await ms1;
  await ms2;

  const chat1 = waitMsg(c1, "chat", (m) => m.scope === "match" && m.text === "привет");
  const chat2 = waitMsg(c2, "chat", (m) => m.scope === "match" && m.text === "привет");
  c2.send(JSON.stringify({ type: "chat.send", scope: "match", id: s1.matchId, text: "привет" }));
  const m1 = await chat1, m2 = await chat2;
  assert.strictEqual(m1.id, s1.matchId);
  assert.strictEqual(m2.name, "Att");

  c1.close(); c2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("реконнект в матче: возвращается история чата матча", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  const jh = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 1 } }));
  const lobbyId = (await jh).lobbyId;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const ja = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await ja;

  const ms1 = waitMsg(c1, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1;

  // сообщение в чат матча
  const chatP = waitMsg(c2, "chat", (m) => m.scope === "match");
  c1.send(JSON.stringify({ type: "chat.send", scope: "match", id: s1.matchId, text: "держим базу" }));
  await chatP;

  // обрыв и возврат att1
  c2.close();
  await waitMsg(c1, "peer.left");
  const c2b = new WebSocket(wsBase);
  await new Promise((r) => c2b.on("open", r));
  const histP = waitMsg(c2b, "chat.history", (m) => m.scope === "match");
  c2b.send(JSON.stringify({ type: "join", matchId: s1.matchId, playerId: "att1", team: TEAM_ATT, name: "Att" }));
  const hist = await histP;
  assert.ok(hist.messages.some((m) => m.text === "держим базу"), "история матча не вернулась");

  c1.close(); c2b.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("spectator: включается в комнату и получает данные от игроков", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  const jh = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 1 } }));
  const lobbyId = (await jh).lobbyId;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const ja = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT }));
  await ja;

  const ms1 = waitMsg(c1, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1;

  // наблюдатель
  const spec = new WebSocket(wsBase);
  await new Promise((r) => spec.on("open", r));
  const startP = waitMsg(spec, "spectate.start");
  spec.send(JSON.stringify({ type: "spectate", matchId: s1.matchId, playerId: "spec" }));
  const st = await startP;
  assert.strictEqual(st.matchId, s1.matchId);

  // игрок шлёт снапшот -> наблюдатель получает
  const dataP = waitMsg(spec, "spectate.data", (m) => m.frame === 10);
  c1.send(JSON.stringify({ type: "spectate.data", matchId: s1.matchId, frame: 10, data: "AAAA" }));
  const d = await dataP;
  assert.strictEqual(d.data, "AAAA");

  // посторонний (не игрок комнаты) не может слать спектатор-данные
  const spec2 = new WebSocket(wsBase);
  await new Promise((r) => spec2.on("open", r));
  let leaked = false;
  spec.on("message", (raw) => { const m = J(raw); if (m.type === "spectate.data" && m.frame === 99) leaked = true; });
  spec2.send(JSON.stringify({ type: "spectate.data", matchId: s1.matchId, frame: 99, data: "ZZZZ" }));
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(leaked, false, "данные от постороннего дошли до наблюдателя");

  c1.close(); c2.close(); spec.close(); spec2.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });

test("cartridgeFingerprint: join в комнату с чужим картриджем отклоняется", async () => {
  const app = createApp({ dbPath: ":memory:" });
  await new Promise((r) => app.http.listen(0, r));
  const wsBase = `ws://127.0.0.1:${app.http.address().port}/ws`;
  const c1 = new WebSocket(wsBase);
  await new Promise((r) => c1.on("open", r));
  const jh = waitMsg(c1, "lobby.joined");
  c1.send(JSON.stringify({ type: "lobby.create", playerId: "host", name: "Host", settings: { defSlots: 1, attSlots: 1 }, cartridgeFingerprint: "AAAA" }));
  const lobbyId = (await jh).lobbyId;

  const c2 = new WebSocket(wsBase);
  await new Promise((r) => c2.on("open", r));
  const ja = waitMsg(c2, "lobby.joined");
  c2.send(JSON.stringify({ type: "lobby.join", lobbyId, playerId: "att1", name: "Att", team: TEAM_ATT, cartridgeFingerprint: "AAAA" }));
  await ja;

  const ms1 = waitMsg(c1, "match.start");
  c1.send(JSON.stringify({ type: "lobby.start", lobbyId }));
  const s1 = await ms1;

  const c3 = new WebSocket(wsBase);
  await new Promise((r) => c3.on("open", r));
  const errP = waitMsg(c3, "error", (m) => m.error === "cartridge-mismatch");
  c3.send(JSON.stringify({ type: "join", matchId: s1.matchId, playerId: "intruder", team: TEAM_DEF, cartridgeFingerprint: "BBBB" }));
  const err = await errP;
  assert.strictEqual(err.error, "cartridge-mismatch");

  c1.close(); c2.close(); c3.close();
  await new Promise((r) => setTimeout(r, 50));
  await app.close();
}, { timeout: 15000 });
