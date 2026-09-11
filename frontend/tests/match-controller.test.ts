// match-controller.test.js — application-контроллер матча на fake-портах (без jsnes/сети).
// Доказывает: оркестрация матча тестируема без React/DOM/эмулятора.
import { test } from "node:test";
import assert from "node:assert";
import { MatchController } from "../src/application/match-controller.ts";

function fakeEmu() {
  return {
    frames: 0,
    reset() { this.frames = 0; return this; },
    setStartStage() { return this; },
    setStartStars() { return this; },
    setHumanTank() {},
    setHumanDefTank() {},
    stepFrame() { this.frames++; return "hash"; },
    readMem() { return 0; }, // gameplay стартовал
    saveState() { return new Uint8Array([1]); },
    draw() {},
    cartridgeFingerprint() { return "fp"; },
  };
}

function fakeGateway() {
  const calls = { finish: [], rejoin: [], negotiate: [], sessions: 0 };
  const session = {
    currentFrame: 0,
    advanceFrame() { this.currentFrame++; },
    rebindTransport() { this.rebound = true; },
  };
  return {
    calls,
    session,
    rejoinMatch(matchId, team) { calls.rejoin.push([matchId, team]); },
    clearMatchContext() {},
    finishMatch(matchId, winner) { calls.finish.push([matchId, winner]); },
    async negotiate(peerId, matchId) { calls.negotiate.push([peerId, matchId]); return { transport: {}, mode: "webrtc" }; },
    async negotiateAll(peerIds, matchId) { calls.negotiate.push([peerIds, matchId]); return { transport: {}, mode: "webrtc" }; },
    createSession() { calls.sessions++; return session; },
    sendSpectateData() {},
    isOpen() { return true; },
  };
}

function makeController(emu, gateway = null) {
  const events = { net: null, paused: null, ready: null, winner: null, error: null };
  const controller = new MatchController({
    meId: "p1",
    backend: "",
    emu: () => emu,
    quickMatch: () => {
      throw new Error("quick match не используется в тесте");
    },
    lobby: () => gateway,
    onNet: (n) => { events.net = n; },
    onPaused: (p) => { events.paused = p; },
    onWinner: (w) => { events.winner = w; },
    onError: (e) => { events.error = e; },
    onReady: (i) => { events.ready = i; },
  });
  return { controller, events };
}

test("MatchController.startOnline: порты/команда/сессия из MatchStart", async () => {
  const emu = fakeEmu();
  const gateway = fakeGateway();
  const { controller, events } = makeController(emu, gateway);

  await controller.startOnline(gateway, {
    matchId: "m1",
    peers: [
      { playerId: "p1", team: "DEF", port: 0 },
      { playerId: "p2", team: "ATT", port: 2 },
    ],
    stage: 3,
    defStars: 1,
  });

  assert.deepStrictEqual(events.ready, { mode: "online", team: "DEF", port: 0, matchId: "m1" });
  assert.strictEqual(gateway.calls.sessions, 1);
  assert.deepStrictEqual(gateway.calls.rejoin[0], ["m1", "DEF"]);
  assert.strictEqual(events.net.status, "online");
  assert.strictEqual(events.net.mode, "webrtc");
});

test("MatchController.advance: шагает сессию, пауза останавливает", async () => {
  const emu = fakeEmu();
  const gateway = fakeGateway();
  const { controller } = makeController(emu, gateway);
  await controller.startOnline(gateway, {
    matchId: "m2",
    peers: [{ playerId: "p1", team: "DEF", port: 0 }, { playerId: "p2", team: "ATT", port: 2 }],
  });

  controller.advance(0x10);
  controller.advance(0x10);
  assert.strictEqual(gateway.session.currentFrame, 2);

  controller.setPaused(true);
  controller.advance(0x10);
  assert.strictEqual(gateway.session.currentFrame, 2, "на паузе кадры не идут");
});

test("MatchController: результат отправляется на сервер один раз", async () => {
  const emu = fakeEmu();
  const gateway = fakeGateway();
  const { controller } = makeController(emu, gateway);
  await controller.startOnline(gateway, {
    matchId: "m3",
    peers: [{ playerId: "p1", team: "DEF", port: 0 }, { playerId: "p2", team: "ATT", port: 2 }],
  });
  controller.reportResult("DEF");
  controller.reportResult("ATT");
  assert.deepStrictEqual(gateway.calls.finish, [["m3", "DEF"]]);
});

test("MatchController.handleNetEvent: rollback/desync/transport-closed -> net-статус", async () => {
  const emu = fakeEmu();
  const gateway = fakeGateway();
  const { controller, events } = makeController(emu, gateway);
  await controller.startOnline(gateway, {
    matchId: "m4",
    peers: [{ playerId: "p1", team: "DEF", port: 0 }, { playerId: "p2", team: "ATT", port: 2 }],
  });

  controller.handleNetEvent({ type: "rollback" });
  controller.handleNetEvent({ type: "rollback" });
  assert.strictEqual(events.net.rollbacks, 2);

  controller.handleNetEvent({ type: "desync" });
  assert.strictEqual(events.net.desyncs, 1);
  assert.strictEqual(events.net.status, "reconnecting");

  controller.handleNetEvent({ type: "resync" });
  assert.strictEqual(events.net.status, "online");

  controller.handleNetEvent({ type: "transport-closed" });
  assert.strictEqual(events.net.status, "reconnecting");
});

test("MatchController.startSolo и clear: solo-режим и сброс состояния", () => {
  const emu = fakeEmu();
  const { controller, events } = makeController(emu);

  controller.startSolo("ATT", 5, 2);
  assert.deepStrictEqual(events.ready, { mode: "solo", team: "ATT", port: 2 });
  assert.strictEqual(events.net.status, "solo");

  controller.clear();
  assert.strictEqual(events.net.status, "solo");
  assert.strictEqual(events.winner, null);
});
