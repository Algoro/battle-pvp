// sync-mode.js — sync-test режим: прогон двух клиентов (rollback) и отчёт.
// Проверяет детерминизм RNG/rollback: при задержке/джитре клиенты должны
// сойтись к одинаковым хэшам без desync.
//
// Относительный путь: ./qa/sync-mode.js
import { readFileSync } from "node:fs";
import PvPNes from "../emulator-core/pvp.ts";
import { RollbackSession } from "../netcode/rollback/session.ts";
import { LocalEndpoint, makeRng } from "../netcode/transport/local.ts";

/**
 * Прогон двух клиентов. Возвращает sync-отчёт.
 * @param {object} opts {romPath, frames, delayA, delayB, jitter, loss, seed}
 */
export function runSync(opts = {}) {
  const {
    romPath = "rom/disasm/_battle_city.nes",
    frames = 180,
    delayA = 6,
    delayB = 6,
    jitter = 1,
    loss = 0,
    redundancy,
    seed = 0xdeadbeef,
  } = opts;

  const rom = readFileSync(romPath);
  const gameA = new PvPNes();
  const gameB = new PvPNes();
  gameA.loadROM(rom);
  gameB.loadROM(rom);

  const { a: ta, b: tb } = LocalEndpoint.pair(
    { delay: delayA, loss, jitter },
    { delay: delayB, loss, jitter },
    makeRng(seed),
  );

  const eventsA = [];
  const sessA = new RollbackSession({
    game: gameA, transport: ta, myPorts: [0, 1], remotePorts: [2, 3],
    window: 120, onEvent: (e) => eventsA.push(e), redundancy,
  });
  const sessB = new RollbackSession({
    game: gameB, transport: tb, myPorts: [2, 3], remotePorts: [0, 1],
    window: 120, redundancy,
  });

  // детерминированные входы
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0));
  const hashes = [];
  for (let f = 0; f < frames; f++) {
    const inA = [{ port: 0, buttons: next() & 0xff }, { port: 1, buttons: next() & 0xff }];
    const inB = [{ port: 2, buttons: next() & 0xff }, { port: 3, buttons: next() & 0xff }];
    sessA.advanceFrame(inA);
    sessB.advanceFrame(inB);
    ta.flush();
    tb.flush();
    // hash сходимости в моменте
    if (f % 30 === 0) hashes.push({ frame: f, a: gameA.getFrameHash(), b: gameB.getFrameHash() });
  }
  // drain
  let safety = frames * 4;
  while ((tb.sent > ta.delivered || ta.sent > tb.delivered) && safety-- > 0) {
    ta.flush();
    tb.flush();
  }

  return {
    frames,
    delayA, delayB, jitter, loss,
    hashA: gameA.getFrameHash(),
    hashB: gameB.getFrameHash(),
    converged: gameA.getFrameHash() === gameB.getFrameHash(),
    desyncA: sessA.desyncCount,
    desyncB: sessB.desyncCount,
    rollbacks: sessA.rollbackCount,
    hashes,
    desyncEvents: eventsA.filter((e) => e.type === "desync").map((e) => e.frame),
  };
}

export default runSync;
