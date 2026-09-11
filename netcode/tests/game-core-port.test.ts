// game-core-port.test.ts — RollbackSession зависит ТОЛЬКО от порта GameCore.
// Здесь вместо jsnes подставлен fake-ядро: детерминированное состояние без эмулятора.
import { test } from "node:test";
import assert from "node:assert";
import { RollbackSession } from "../rollback/session.ts";
import { LocalEndpoint, makeRng } from "../transport/local.ts";
import type { GameCore, Input } from "../ports.ts";

// Минимальная реализация порта GameCore (не Battle City, а абстрактная игра).
class FakeCore implements GameCore {
  frame = 0;
  state = new Uint8Array([7]);
  hash = "00000000";
  saved = 0;
  loaded = 0;

  stepFrame(inputs: Input[]): string {
    let x = this.state[0];
    for (const i of inputs) x = (x + i.buttons + 1) & 0xff;
    this.state[0] = x;
    this.frame++;
    this.hash = ((x << 8) | (this.frame & 0xff)).toString(16).padStart(8, "0");
    return this.hash;
  }
  saveState(): Uint8Array {
    this.saved++;
    return Uint8Array.from(this.state);
  }
  loadState(bytes: Uint8Array): void {
    this.loaded++;
    this.state = Uint8Array.from(bytes);
  }
  getFrameHash(): string {
    return this.hash;
  }
}

function pairWithCores(delay: number) {
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay }, { delay }, makeRng(0x1234));
  const sa = new RollbackSession({
    game: new FakeCore(),
    transport: ta,
    myPorts: [0],
    remotePorts: [2],
    onEvent: () => {},
  });
  const sb = new RollbackSession({
    game: new FakeCore(),
    transport: tb,
    myPorts: [2],
    remotePorts: [0],
    onEvent: () => {},
  });
  return { sa, sb, ta, tb };
}

test("port GameCore: rollback-сессия работает с произвольным ядром (без jsnes)", () => {
  const { sa, sb, ta, tb } = pairWithCores(4);
  let s = 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  for (let f = 0; f < 120; f++) {
    sa.advanceFrame([{ port: 0, buttons: rnd() }]);
    sb.advanceFrame([{ port: 2, buttons: rnd() }]);
    ta.flush();
    tb.flush();
  }
  let safety = 600;
  while (ta.sent > ta.delivered || tb.sent > tb.delivered) {
    ta.flush();
    tb.flush();
    if (safety-- < 0) break;
  }
  assert.ok(sa.rollbackCount > 0, "rollback не срабатывал");
  assert.strictEqual(sa.game.getFrameHash(), sb.game.getFrameHash(), "ядра-порты разошлись");
});

test("port GameCore: save/load вызываются ядром через порт", () => {
  const { sa, ta, tb } = pairWithCores(0);
  for (let f = 0; f < 10; f++) {
    sa.advanceFrame([{ port: 0, buttons: 1 }]);
    ta.flush();
    tb.flush();
  }
  const snap = sa.game.saveState();
  sa.game.loadState(snap);
  const core = sa.game as FakeCore;
  assert.ok(core.saved > 0 && core.loaded > 0);
});
