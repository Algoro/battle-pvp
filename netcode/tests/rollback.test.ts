// rollback.test.js — интеграционный тест netcode (критерий №4).
// Два клиента играют через локальный транспорт с задержкой 50-150 мс (~3-9 кадров);
// rollback должен свести оба к идентичному состоянию без desync-событий.
// Запуск: node --test tests/rollback.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../../emulator-core/pvp.ts";
import { RollbackSession, type SessionEvent } from "../rollback/session.ts";
import { LocalEndpoint, makeRng } from "../transport/local.ts";
import type { Input } from "../ports.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");

function loadRom() {
  return readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));
}

// Детерминированная генерация входов: A управляет портами 0,1; B — портами 2,3.
function makePeerInputs(seed: number, frames: number, ports: number[]): Input[][] {
  let s = seed >>> 0;
  const next = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0));
  const seq: Input[][] = [];
  for (let f = 0; f < frames; f++) {
    const inputs: Input[] = [];
    for (const port of ports) inputs.push({ port, buttons: next() & 0xff });
    seq.push(inputs);
  }
  return seq;
}

function runMatch({
  delayA = 0,
  delayB = 0,
  lossA = 0,
  lossB = 0,
  jitter = 0,
  frames = 200,
  checkpointInterval,
}: {
  delayA?: number;
  delayB?: number;
  lossA?: number;
  lossB?: number;
  jitter?: number;
  frames?: number;
  checkpointInterval?: number;
} = {}) {
  const rom = loadRom();
  const gameA = new PvPNes();
  const gameB = new PvPNes();
  gameA.loadROM(rom);
  gameB.loadROM(rom);

  const { a: ta, b: tb } = LocalEndpoint.pair(
    { delay: delayA, loss: lossA, jitter },
    { delay: delayB, loss: lossB, jitter },
    makeRng(0xdeadbeef),
  );

  const eventsA: SessionEvent[] = [];
  const eventsB: SessionEvent[] = [];
  const sessA = new RollbackSession({
    game: gameA, transport: ta, myPorts: [0, 1], remotePorts: [2, 3],
    onEvent: (e) => eventsA.push(e), window: 120, checkpointInterval,
  });
  const sessB = new RollbackSession({
    game: gameB, transport: tb, myPorts: [2, 3], remotePorts: [0, 1],
    onEvent: (e) => eventsB.push(e), window: 120, checkpointInterval,
  });

  const inA = makePeerInputs(0xaaaa, frames, [0, 1]);
  const inB = makePeerInputs(0x5555, frames, [2, 3]);

  for (let f = 0; f < frames; f++) {
    sessA.advanceFrame(inA[f]);
    sessB.advanceFrame(inB[f]);
    ta.flush();
    tb.flush();
  }
  // drain: доставить оставшиеся сообщения, давая rollback'ам довести оба до согласованного состояния
  let safety = frames * 2;
  while ((ta.sent > ta.delivered || tb.sent > tb.delivered) && safety-- > 0) {
    ta.flush();
    tb.flush();
  }

  return { sessA, sessB, gameA, gameB, eventsA, eventsB };
}

test("два клиента с задержкой ~100 мс сходятся без desync (критерий №4)", () => {
  // 6 кадров задержки ~ 100 мс при 60fps (в диапазоне 50-150 мс)
  const { sessA, sessB, gameA, gameB } = runMatch({
    delayA: 6, delayB: 6, jitter: 1, frames: 120,
  });

  assert.strictEqual(sessA.desyncCount, 0, "A: возникли desync-события");
  assert.strictEqual(sessB.desyncCount, 0, "B: возникли desync-события");
  assert.strictEqual(gameA.getFrameHash(), gameB.getFrameHash(), "финальные состояния не сходятся");
  assert.ok(sessA.rollbackCount > 0, "rollback должен был сработать при задержке");
  assert.strictEqual(sessA.currentFrame, sessB.currentFrame);
});

test("без задержки оба клиента идентичны с первого кадра", () => {
  const { gameA, gameB, sessA, sessB } = runMatch({ frames: 120 });
  assert.strictEqual(gameA.getFrameHash(), gameB.getFrameHash());
  assert.strictEqual(sessA.desyncCount, 0);
  // даже при delay=0 есть задержка в 1 кадр (send после симуляции -> flush соперника),
  // поэтому rollback происходит на каждом кадре; главное — сходимость.
  assert.strictEqual(sessA.rollbackCount, 120);
  assert.strictEqual(sessA.currentFrame, sessB.currentFrame);
});

test("детект десинка: расхождение состояния фиксируется сверкой хэша", () => {
  // checkpointInterval=1: искусственная порча game не воспроизводится реплеем из
  // чекпоинта (sparse-откат её сотрёт), поэтому здесь нужен покадровый чекпоинт.
  const { sessA, sessB } = runMatch({ delayA: 6, delayB: 6, frames: 60, checkpointInterval: 1 });
  assert.strictEqual(sessA.desyncCount, 0);
  assert.strictEqual(sessB.desyncCount, 0);

  // Искусственно портим состояние B — хэши разойдутся.
  sessB.game.stepFrame([{ port: 0, buttons: 0xff }]);

  const eventsB: SessionEvent[] = [];
  const origOnEvent = sessB.onEvent;
  sessB.onEvent = (e) => { eventsB.push(e); origOnEvent(e); };

  // Играем дальше; периодические hash-check должны зафиксировать расхождение.
  for (let f = 0; f < 90; f++) {
    sessA.advanceFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }]);
    sessB.advanceFrame([{ port: 2, buttons: 0 }, { port: 3, buttons: 0 }]);
    (sessA.transport as LocalEndpoint).flush();
    (sessB.transport as LocalEndpoint).flush();
  }
  assert.ok(eventsB.some((e) => e.type === "desync"), "десинк не был зафиксирован");
  assert.ok(sessB.desyncCount > 0, "desyncCount не увеличился");
});
