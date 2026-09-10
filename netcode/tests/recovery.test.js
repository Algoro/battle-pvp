// recovery.test.js — связь: избыточность ввода, задержка (ping/pong), реконнект
// (rebindTransport) и desync-recovery (снапшот). Проверяем, что rollback-сессия
// восстанавливается после потери пакета, обрыва транспорта и расхождения состояний.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../../emulator-core/pvp.js";
import { RollbackSession } from "../rollback/session.js";
import { LocalEndpoint, makeRng } from "../transport/local.js";
import { MultiTransport } from "../transport/multi.js";
import { encodeFrameBatch } from "../protocol/frame.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..", "..");
const ROM = readFileSync(join(root, "rom", "disasm", "_battle_city.nes"));

function makeGames() {
  const a = new PvPNes();
  const b = new PvPNes();
  a.loadROM(ROM);
  b.loadROM(ROM);
  return { a, b };
}

// Обёртка: дропает N-й по счёту send (детерминированно) — имитация потери пакета.
class SelectiveDrop {
  constructor(inner, dropAt) {
    this.inner = inner;
    this.dropAt = dropAt;
    this.count = 0;
  }
  onMessage(cb) { this.inner.onMessage(cb); }
  onClose(cb) { this.inner.onClose(cb); }
  isOpen() { return this.inner.isOpen(); }
  send(buf) {
    this.count++;
    if (this.count === this.dropAt) return;
    this.inner.send(buf);
  }
}

function drive(sa, sb, ta, tb, frames, makeInput) {
  for (let f = 0; f < frames; f++) {
    sa.advanceFrame(makeInput("A", f));
    sb.advanceFrame(makeInput("B", f));
    ta.flush();
    tb.flush();
  }
  let safety = frames * 4;
  while ((ta.sent > ta.delivered || tb.sent > tb.delivered) && safety-- > 0) {
    ta.flush();
    tb.flush();
  }
}

test("избыточность ввода: потерянный пакет восстанавливается без desync", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 3, jitter: 1 }, { delay: 3, jitter: 1 }, makeRng(0xbeef));
  // дропаем 6-й send со стороны A (примерно frame 5) — избыточность дошлёт его позже
  const taDrop = new SelectiveDrop(ta, 6);
  const evA = [], evB = [];
  const sa = new RollbackSession({ game: a, transport: taDrop, myPorts: [0], remotePorts: [2], onEvent: (e) => evA.push(e) });
  const sb = new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: (e) => evB.push(e) });

  const mi = (side, f) => [{ port: side === "A" ? 0 : 2, buttons: (f * 7 + (side === "A" ? 1 : 2)) & 0x0f }];
  drive(sa, sb, ta, tb, 80, mi);

  assert.strictEqual(sa.desyncCount, 0, "A: desync после потери пакета");
  assert.strictEqual(sb.desyncCount, 0, "B: desync после потери пакета");
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "состояния не сошлись после потери пакета");
  assert.ok(sa.rollbackCount > 0, "rollback должен был компенсировать потерю");
});

test("задержка: ping/pong измеряется и публикуется событием latency", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 1 }, { delay: 1 }, makeRng(0x77));
  const evA = [];
  const sa = new RollbackSession({ game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: (e) => evA.push(e), pingInterval: 5 });
  new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: () => {}, pingInterval: 5 });

  for (let f = 0; f < 20; f++) {
    sa.advanceFrame([{ port: 0, buttons: 0 }]);
    tb.flush(); // доставить ping к B (создаёт pong)
    ta.flush(); // доставить pong к A
  }
  const lat = evA.filter((e) => e.type === "latency");
  assert.ok(lat.length > 0, "событие latency не пришло");
  assert.ok(sa.getLatency() >= 0 && sa.getLatency() < 60000);
});

test("desync-recovery: не-авторитет запрашивает снапшот и восстанавливается", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 2 }, { delay: 2 }, makeRng(0xabc));
  const evA = [], evB = [];
  const sa = new RollbackSession({
    game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: (e) => evA.push(e),
    playerId: "aaa", remotePeerId: "bbb",
  });
  const sb = new RollbackSession({
    game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: (e) => evB.push(e),
    playerId: "bbb", remotePeerId: "aaa",
  });

  const mi = (side, f) => [{ port: side === "A" ? 0 : 2, buttons: (f * 3) & 0x0f }];
  // прогреваем: hash на кадре 20 подтверждён (confirmDelay 20)
  drive(sa, sb, ta, tb, 60, mi);
  assert.strictEqual(evA.filter((e) => e.type === "desync").length, 0, "A: ложный desync на прогреве");
  assert.strictEqual(evB.filter((e) => e.type === "desync").length, 0, "B: ложный desync на прогреве");

  // вручную подаём чужой хэш: не-авторитет обязан зафиксировать desync и запросить снапшот.
  sb._onHashCheck({ frame: 20, hash: "00000000" });
  assert.ok(evB.some((e) => e.type === "desync"), "B: desync не зафиксирован");
  assert.ok(evB.some((e) => e.type === "resync-request"), "B: не запросил resync");

  drive(sa, sb, ta, tb, 80, mi);

  assert.ok(evA.some((e) => e.type === "snapshot-sent"), "A: снапшот не отправлен");
  assert.ok(evB.some((e) => e.type === "resync"), "B: resync не применён");

  // B после resync отстаёт на транспортную задержку — даём ему догнать A,
  // дославляя оставшиеся вводы (в реальной игре это делают последующие тики).
  drive(sa, sb, ta, tb, 4, mi);
  let guard = 0;
  while (sb.currentFrame < sa.currentFrame && guard++ < 300) {
    sb.advanceFrame(mi("B", sb.currentFrame));
    tb.flush();
    ta.flush();
  }
  assert.strictEqual(sb.currentFrame, sa.currentFrame, "B не догнал A");
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "после resync состояния не сошлись");
});

test("реконнект: rebindTransport продолжает матч на новом транспорте", () => {
  const { a, b } = makeGames();
  const pair1 = LocalEndpoint.pair({ delay: 2 }, { delay: 2 }, makeRng(0x11));
  const evA = [], evB = [];
  const sa = new RollbackSession({ game: a, transport: pair1.a, myPorts: [0], remotePorts: [2], onEvent: (e) => evA.push(e) });
  const sb = new RollbackSession({ game: b, transport: pair1.b, myPorts: [2], remotePorts: [0], onEvent: (e) => evB.push(e) });

  const mi = (side, f) => [{ port: side === "A" ? 0 : 2, buttons: (f * 5) & 0x0f }];
  drive(sa, sb, pair1.a, pair1.b, 30, mi);

  // обрыв: закрываем старый транспорт у обоих
  pair1.a.close();
  pair1.b.close();
  assert.ok(evA.some((e) => e.type === "transport-closed"), "A: нет события transport-closed");

  // новый транспорт (после реконнекта)
  const pair2 = LocalEndpoint.pair({ delay: 2 }, { delay: 2 }, makeRng(0x22));
  sa.rebindTransport(pair2.a);
  sb.rebindTransport(pair2.b);
  assert.ok(evA.some((e) => e.type === "transport-rebound"), "A: нет события transport-rebound");

  drive(sa, sb, pair2.a, pair2.b, 40, mi);
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "после реконнекта состояния не сошлись");
  assert.strictEqual(sa.desyncCount, 0, "A: desync после реконнекта");
  assert.strictEqual(sb.desyncCount, 0, "B: desync после реконнекта");
});

test("батч ввода: дубликаты кадров дедуплицируются", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 0 }, { delay: 0 }, makeRng(0x55));
  const sb = new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: () => {} });
  const sa = new RollbackSession({ game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: () => {} });

  sa.advanceFrame([{ port: 0, buttons: 1 }]);
  sb.advanceFrame([{ port: 2, buttons: 0 }]);
  tb.flush(); // B получил кадр 0, откатился один раз
  const before = sb.rollbackCount;
  assert.ok(before >= 1);

  // повторно кормим батч, содержащий только уже применённый кадр 0 — дедуп не даёт rollback
  sb._onMessage(encodeFrameBatch([{ frame: 0, inputs: [{ port: 0, buttons: 1 }] }]));
  assert.strictEqual(sb.rollbackCount, before, "дубликат вызвал лишний rollback");
});

test("MultiTransport: три клиента (2v2/N) сходятся через мультиплекс", () => {
  const n = 3;
  const ports = [0, 2, 3];
  const games = [];
  for (let i = 0; i < n; i++) {
    const g = new PvPNes();
    g.loadROM(ROM);
    games.push(g);
  }
  const endpoints = [];
  const ch = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { a, b } = LocalEndpoint.pair({ delay: 2 }, { delay: 2 }, makeRng(0x100 + i * 10 + j));
      ch[i][j] = a;
      ch[j][i] = b;
      endpoints.push(a, b);
    }
  }
  const events = Array.from({ length: n }, () => []);
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const mt = new MultiTransport(ch[i].filter(Boolean));
    const myId = "p" + i;
    const others = [];
    for (let j = 0; j < n; j++) if (j !== i) others.push("p" + j);
    const authority = myId === [myId, ...others].sort()[0];
    sessions.push(new RollbackSession({
      game: games[i], transport: mt, myPorts: [ports[i]],
      remotePorts: ports.filter((_, k) => k !== i),
      onEvent: (e) => events[i].push(e), playerId: myId, authority,
    }));
  }

  const frames = 90;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) sessions[i].advanceFrame([{ port: ports[i], buttons: (f * (i + 3)) & 0x0f }]);
    for (const ep of endpoints) ep.flush();
  }
  let safety = frames * 6;
  while (endpoints.some((ep) => ep.sent > ep.delivered) && safety-- > 0) {
    for (const ep of endpoints) ep.flush();
  }

  for (let i = 0; i < n; i++) {
    assert.strictEqual(sessions[i].desyncCount, 0, `клиент ${i}: desync`);
    assert.strictEqual(sessions[i].currentFrame, sessions[0].currentFrame, `клиент ${i}: разный кадр`);
    assert.strictEqual(games[i].getFrameHash(), games[0].getFrameHash(), `клиент ${i}: хэш разошёлся`);
  }
});

test("2v2: четыре клиента, человеческие танки, синхронный старт + мультиплекс", () => {
  const START = 0x08;
  const INPUT_MASK = 0x01 | 0x10 | 0x20 | 0x40 | 0x80;
  const ports = [0, 1, 2, 3]; // DEF 0,1; ATT 2,3
  const n = ports.length;

  const games = [];
  for (let i = 0; i < n; i++) {
    const g = new PvPNes({ attAI: "lookahead", defAI: "plan", defMode: "active" });
    g.loadROM(ROM);
    // как App.beginOnlineMatch: все живые танки помечены человеческими (одинаково у всех)
    g.setHumanDefTank(0);
    g.setHumanDefTank(1);
    g.setHumanTank(2);
    g.setHumanTank(3);
    // синхронный автостарт (порт 0 Start каждые 30 кадров)
    let started = false;
    for (let f = 1; f <= 1200 && !started; f++) {
      g.stepFrame([{ port: 0, buttons: f % 30 === 0 ? START : 0 }]);
      if (g.readMem(0x80) !== 0xff) started = true;
    }
    assert.strictEqual(started, true, `клиент ${i}: партия не началась`);
    games.push(g);
  }
  for (let i = 1; i < n; i++) {
    assert.strictEqual(games[i].getFrameHash(), games[0].getFrameHash(), `клиент ${i}: старт разошёлся`);
  }

  const endpoints = [];
  const ch = Array.from({ length: n }, () => new Array(n).fill(null));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { a, b } = LocalEndpoint.pair({ delay: 3, jitter: 1 }, { delay: 3, jitter: 1 }, makeRng(0x200 + i * 10 + j));
      ch[i][j] = a;
      ch[j][i] = b;
      endpoints.push(a, b);
    }
  }
  const sessions = [];
  for (let i = 0; i < n; i++) {
    const mt = new MultiTransport(ch[i].filter(Boolean));
    const myId = "p" + i;
    const others = ports.map((_, k) => "p" + k).filter((x) => x !== myId);
    sessions.push(new RollbackSession({
      game: games[i], transport: mt, myPorts: [ports[i]],
      remotePorts: ports.filter((_, k) => k !== i),
      onEvent: () => {}, playerId: myId, authority: myId === [myId, ...others].sort()[0],
    }));
  }

  let s = 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  const frames = 120;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < n; i++) sessions[i].advanceFrame([{ port: ports[i], buttons: rnd() & INPUT_MASK }]);
    for (const ep of endpoints) ep.flush();
  }
  let safety = frames * 8;
  while (endpoints.some((ep) => ep.sent > ep.delivered) && safety-- > 0) {
    for (const ep of endpoints) ep.flush();
  }

  for (let i = 0; i < n; i++) {
    assert.strictEqual(sessions[i].desyncCount, 0, `клиент ${i}: desync`);
    assert.strictEqual(sessions[i].currentFrame, sessions[0].currentFrame, `клиент ${i}: разный кадр`);
    assert.strictEqual(games[i].getFrameHash(), games[0].getFrameHash(), `клиент ${i}: хэш разошёлся`);
  }
});

test("оптимизация: постоянный ввод не вызывает лишних откатов (skip)", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 3 }, { delay: 3 }, makeRng(0x99));
  const sb = new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: () => {} });
  const sa = new RollbackSession({ game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: () => {} });
  // оба держат одну и ту же кнопку: предсказание совпадает с приходящим вводом
  for (let f = 0; f < 40; f++) {
    sa.advanceFrame([{ port: 0, buttons: 0x10 }]);
    sb.advanceFrame([{ port: 2, buttons: 0x20 }]);
    ta.flush();
    tb.flush();
  }
  assert.ok(sb.skippedRollbacks > 0, "нет пропущенных откатов при постоянном вводе");
  assert.ok(sb.rollbackCount < 40, `слишком много откатов: ${sb.rollbackCount}`);
  assert.strictEqual(a.getFrameHash(), b.getFrameHash());
});

test("оптимизация снапшотов: разреженные чекпоинты (окно/интервал состояний)", () => {
  const { a, b } = makeGames();
  const { a: ta, b: tb } = LocalEndpoint.pair({ delay: 6, jitter: 1 }, { delay: 6, jitter: 1 }, makeRng(0x199));
  const sb = new RollbackSession({ game: b, transport: tb, myPorts: [2], remotePorts: [0], onEvent: () => {}, window: 120, checkpointInterval: 8 });
  const sa = new RollbackSession({ game: a, transport: ta, myPorts: [0], remotePorts: [2], onEvent: () => {}, window: 120, checkpointInterval: 8 });
  let s = 1; const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) & 0xff);
  for (let f = 0; f < 150; f++) {
    sa.advanceFrame([{ port: 0, buttons: rnd() }]);
    sb.advanceFrame([{ port: 2, buttons: rnd() }]);
    ta.flush(); tb.flush();
  }
  let safety = 600; while (ta.sent > ta.delivered || tb.sent > tb.delivered) { ta.flush(); tb.flush(); if (safety-- < 0) break; }
  assert.ok(sb.rollbackCount > 0, "rollback не срабатывал");
  assert.ok(sb.states.size <= Math.ceil(120 / 8) + 2, `слишком много чекпоинтов: ${sb.states.size}`);
  assert.strictEqual(a.getFrameHash(), b.getFrameHash(), "sparse-чекпоинты нарушили сходимость");
});
