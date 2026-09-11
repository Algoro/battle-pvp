// ports.test.js — порт Clock в RollbackSession: время инъектируется (нет прямого Date.now).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../../emulator-core/pvp.js";
import { RollbackSession } from "../rollback/session.js";
import { LocalEndpoint, makeRng } from "../transport/local.js";
import { systemClock } from "../ports.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes"));

function game() { const g = new PvPNes(); g.loadROM(ROM); return g; }

class FakeClock { constructor() { this.t = 0; } now() { return this.t; } }

test("ports: latency считается по инъектированному Clock", () => {
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 0 }, { delay: 0 }, makeRng(7));
  const clock = new FakeClock();
  const sa = new RollbackSession({
    game: game(), transport: ta, myPorts: [0], remotePorts: [2],
    onEvent: () => {}, pingInterval: 5, clock,
  });
  const sb = new RollbackSession({
    game: game(), transport: tb, myPorts: [2], remotePorts: [0],
    onEvent: () => {}, pingInterval: 5, clock: new FakeClock(),
  });
  sa.advanceFrame([{ port: 0, buttons: 0 }]);
  sb.advanceFrame([{ port: 2, buttons: 0 }]);
  tb.flush();          // ping доставлен B -> B отправил pong (t = 0)
  clock.t = 100;       // «прошло» 100 мс
  ta.flush();          // pong доставлен A -> RTT = now - t
  assert.strictEqual(sa.getLatency(), 100);
});

test("ports: systemClock — монотонная функция now()", () => {
  const a = systemClock.now();
  const b = systemClock.now();
  assert.ok(typeof a === "number" && b >= a);
});
