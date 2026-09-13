// match-start.test.js — verifies synchronous match start and lockstep (online Phases 1-2).
// Two "clients": identical deterministic reset + identical auto-start of the match
// (port 0 Start every 30 frames), then rollback-lockstep with "human" ports 0 and 2.
// Expectation: the states converge, desync=0.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../../emulator-core/pvp.ts";
import { RollbackSession, type SessionEvent } from "../rollback/session.ts";
import { LocalEndpoint, makeRng } from "../transport/local.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const ROM = readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));
const START = 0x08;
const INPUT_MASK = 0x01 | 0x10 | 0x20 | 0x40 | 0x80; // A + directions (without Start — so as not to pause)

// Deterministic auto-start (like App.beginOnlineMatch): port 0 Start every 30 frames.
function preloadStart(game: any): boolean {
  let started = false;
  for (let f = 1; f <= 1200 && !started; f++) {
    game.stepFrame([{ port: 0, buttons: f % 30 === 0 ? START : 0 }]);
    if (game.cpu.mem[0x80] !== 0xff) started = true;
  }
  return started;
}

test("синхронный старт + lockstep: два клиента сходятся (desync=0)", () => {
  const a = new PvPNes({ attAI: "lookahead", defAI: "plan", defMode: "active" });
  const b = new PvPNes({ attAI: "lookahead", defAI: "plan", defMode: "active" });
  a.loadROM(ROM);
  b.loadROM(ROM);
  // human tanks: A — DEF(0), enemy ATT(2); B — ATT(2), enemy DEF(0)
  a.setHumanDefTank(0); a.setHumanTank(2);
  b.setHumanDefTank(0); b.setHumanTank(2);

  assert.strictEqual(preloadStart(a), true, "A: партия не началась");
  assert.strictEqual(preloadStart(b), true, "B: партия не началась");
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "состояние после синхронного старта разошлось");

  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 4, jitter: 1 }, { delay: 4, jitter: 1 }, makeRng(0x1234));
  const evA: SessionEvent[] = [], evB: SessionEvent[] = [];
  const sa = new RollbackSession({ game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: (e) => evA.push(e), window: 120 });
  const sb = new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: (e) => evB.push(e), window: 120 });

  let s = 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  const frames = 180;
  for (let f = 0; f < frames; f++) {
    sa.advanceFrame([{ port: 0, buttons: rnd() & INPUT_MASK }]);
    sb.advanceFrame([{ port: 2, buttons: rnd() & INPUT_MASK }]);
    ta.flush();
    tb.flush();
  }
  let safety = frames * 3;
  while ((ta.sent > ta.delivered || tb.sent > tb.delivered) && safety-- > 0) { ta.flush(); tb.flush(); }

  assert.strictEqual(sa.desyncCount, 0, "A: desync");
  assert.strictEqual(sb.desyncCount, 0, "B: desync");
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "финальные состояния не сходятся");
  assert.ok(sa.rollbackCount > 0, "rollback должен был сработать при задержке");
  assert.strictEqual(sa.currentFrame, sb.currentFrame);
});

test("детерминизм: одинаковый сброс + одинаковые входы → одинаковый хэш", () => {
  const a = new PvPNes();
  const b = new PvPNes();
  a.loadROM(ROM);
  b.loadROM(ROM);
  for (let f = 0; f < 60; f++) {
    a.stepFrame([{ port: 0, buttons: 0 }]);
    b.stepFrame([{ port: 0, buttons: 0 }]);
  }
  assert.strictEqual(a.getFrameHash(), b.getFrameHash());
});
