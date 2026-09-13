// ports.test.ts — the Clock port in RollbackSession: time is injected (no direct Date.now).
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../../emulator-core/pvp.ts";
import { RollbackSession } from "../rollback/session.ts";
import { LocalEndpoint, makeRng } from "../transport/local.ts";
import { systemClock } from "../ports.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes"));

function game() {
  const g = new PvPNes();
  g.loadROM(ROM);
  return g;
}

class FakeClock {
  t = 0;
  now(): number {
    return this.t;
  }
}

test("ports: latency считается по инъектированному Clock", () => {
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 0 }, { delay: 0 }, makeRng(7));
  const clock = new FakeClock();
  const sa = new RollbackSession({
    game: game(),
    transport: ta,
    myPorts: [0],
    remotePorts: [2],
    onEvent: () => {},
    pingInterval: 5,
    clock,
  });
  const sb = new RollbackSession({
    game: game(),
    transport: tb,
    myPorts: [2],
    remotePorts: [0],
    onEvent: () => {},
    pingInterval: 5,
    clock: new FakeClock(),
  });
  sa.advanceFrame([{ port: 0, buttons: 0 }]);
  sb.advanceFrame([{ port: 2, buttons: 0 }]);
  tb.flush(); // ping delivered to B -> B sent pong (t = 0)
  clock.t = 100; // "100 ms elapsed"
  ta.flush(); // pong delivered to A -> RTT = now - t
  assert.strictEqual(sa.getLatency(), 100);
});

test("ports: systemClock — монотонная функция now()", () => {
  const a = systemClock.now();
  const b = systemClock.now();
  assert.ok(typeof a === "number" && b >= a);
});
