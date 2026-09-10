// schema.test.js — валидация WS-сообщений.
import { test } from "node:test";
import assert from "node:assert";
import { validateMessage, knownTypes } from "../signaling/schema.js";

test("schema: валидные сообщения проходят", () => {
  assert.strictEqual(validateMessage({ type: "join", matchId: "m", playerId: "p", team: "DEF" }).ok, true);
  assert.strictEqual(validateMessage({ type: "chat.send", text: "hi" }).ok, true);
  assert.strictEqual(validateMessage({ type: "lobby.subscribe" }).ok, true);
  assert.strictEqual(validateMessage({ type: "relay.data", to: "p", matchId: "m", data: "AAAA" }).ok, true);
});

test("schema: отклоны — неизвестный тип и нехватка/тип полей", () => {
  assert.strictEqual(validateMessage({ type: "nope" }).ok, false);
  assert.strictEqual(validateMessage({ type: "join", matchId: "m" }).ok, false);
  assert.strictEqual(validateMessage({ type: "join", matchId: "m", playerId: "p", team: "XXX" }).ok, false);
  assert.strictEqual(validateMessage({ type: "chat.send" }).ok, false);
  assert.strictEqual(validateMessage(null).ok, false);
});

test("schema: все типы из switch известны", () => {
  for (const t of ["join","signal","relay.data","start","finish","pause","resume","spectate","spectate.data","spectate.leave","lobby.subscribe","lobby.create","lobby.join","lobby.leave","lobby.team","lobby.ready","lobby.settings","lobby.kick","lobby.start","chat.send"]) {
    assert.ok(knownTypes().includes(t), `нет схемы для ${t}`);
  }
});

test("schema: каждому типу есть маршрут в relay", async () => {
  const { routeIsComplete } = await import("../signaling/relay.js");
  assert.strictEqual(routeIsComplete(), true);
});
