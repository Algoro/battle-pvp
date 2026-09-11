// ports.test.js — домен/application работают через порты: fake-репозитории, без SQLite/WS.
import { test } from "node:test";
import assert from "node:assert";
import { ChatManager } from "../domain/chat.ts";
import { Lobby, LobbyManager } from "../domain/lobby.ts";
import { RoomManager } from "../domain/room.ts";
import { TEAM_DEF, TEAM_ATT } from "../domain/teams.ts";
import { startMatch, finishMatch } from "../application/match-lifecycle.ts";
import { sendChat, chatHistory } from "../application/chat.ts";

// In-memory реализация порта ChatRepository (без node:sqlite).
function fakeChatRepository() {
  const rows = [];
  return {
    rows,
    insert(m) { rows.push(m); },
    list(scope, id, limit) {
      return rows.filter((m) => m.scope === scope && (m.id ?? null) === (id ?? null)).slice(-limit);
    },
  };
}

test("ChatManager: работает через порт ChatRepository (без SQLite)", () => {
  const repository = fakeChatRepository();
  const cm = new ChatManager({ repository });
  cm.send("global", null, { playerId: "p1", name: "P1", text: "привет", ts: 1 });
  assert.strictEqual(repository.rows.length, 1);

  // новый менеджер (пустая память) читает историю из порта
  const cm2 = new ChatManager({ repository });
  const history = chatHistory(cm2, "global", null);
  assert.deepStrictEqual(history.map((m) => m.text), ["привет"]);
});

test("application/sendChat: возвращает DTO или доменную ошибку", () => {
  const cm = new ChatManager({ repository: fakeChatRepository() });
  const ok = sendChat(cm, { scope: "lobby", id: "l1", playerId: "p", name: "P", text: "hi", ts: 1 });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.message.text, "hi");
  assert.strictEqual(ok.message.id, "l1");

  const bad = sendChat(cm, { scope: "lobby", id: "l1", playerId: "p", name: "P", text: "   ", ts: 2 });
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.error, "chat-empty");
});

test("application/startMatch: use case поверх домена и fake-портов", () => {
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1 } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null });
  lobby.join({ playerId: "a", name: "A", team: TEAM_ATT, sessionId: null, socket: null });

  const rooms = new RoomManager();
  const calls = { ensured: [], finished: [], cleared: [] };
  const store = {
    ensureMatch: (id, players) => calls.ensured.push([id, players]),
    finishMatch: (id, winner) => calls.finished.push([id, winner]),
  };
  const chat = { clear: (id) => calls.cleared.push(id) };

  const r = startMatch(lobby, { rooms, store, chat });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.stage, 1);
  assert.strictEqual(r.room.state, "playing");
  assert.strictEqual(calls.ensured.length, 1);
  assert.strictEqual(calls.ensured[0][1].length, 2);
  assert.deepStrictEqual(calls.cleared, [lobby.id]);

  finishMatch(r.room, TEAM_DEF, { store });
  assert.strictEqual(r.room.state, "finished");
  assert.deepStrictEqual(calls.finished, [[r.room.id, TEAM_DEF]]);
});

test("domain/Clock: TTL комнат и лобби считается по инъектированным часам", () => {
  const clock = { t: 1000, now() { return this.t; } };
  const rooms = new RoomManager({ ttlMs: 100, clock });
  const room = rooms.createRoom();
  assert.strictEqual(room.createdAt, 1000);
  assert.strictEqual(rooms.getRoom(room.id), room);
  clock.t = 1101;
  assert.strictEqual(rooms.getRoom(room.id), null, "комната должна истечь по инъектированным часам");

  const lobbies = new LobbyManager({ ttlMs: 100, clock });
  const lobby = lobbies.create({ hostPlayerId: "h" });
  assert.strictEqual(lobby.createdAt, 1101);
  clock.t = 1300;
  assert.strictEqual(lobbies.get(lobby.id), null, "лобби должно истечь по инъектированным часам");
});

test("domain/Clock: ChatManager берёт время из инъектированного Clock", () => {
  const clock = { t: 0, now() { return this.t; } };
  const cm = new ChatManager({ rateCount: 1, rateWindowMs: 100, clock });
  const first = cm.send("global", null, { playerId: "p", name: "P", text: "a" });
  assert.strictEqual(first.message.ts, 0);
  assert.strictEqual(cm.send("global", null, { playerId: "p", name: "P", text: "b" }).error, "rate-limit");
  clock.t = 200;
  const third = cm.send("global", null, { playerId: "p", name: "P", text: "c" });
  assert.strictEqual(third.message.ts, 200);
});

test("application/startMatch: отказ при рассинхроне картриджей (domain-правило)", () => {
  const lobby = new Lobby({ hostPlayerId: "h", settings: { defSlots: 1, attSlots: 1 } });
  lobby.join({ playerId: "h", name: "H", team: TEAM_DEF, sessionId: null, socket: null, fingerprint: "aaaa" });
  lobby.join({ playerId: "a", name: "A", team: TEAM_ATT, sessionId: null, socket: null, fingerprint: "bbbb" });
  const rooms = new RoomManager();
  const r = startMatch(lobby, {
    rooms,
    store: { ensureMatch() {}, finishMatch() {} },
    chat: { clear() {} },
  });
  assert.deepStrictEqual(r, { ok: false, error: "cartridge-mismatch" });
  assert.strictEqual(rooms.rooms.size, 0);
});
