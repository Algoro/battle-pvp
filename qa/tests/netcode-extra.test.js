// netcode-extra.test.js — sync-test режим + jitter/потери + нагрузка комнат.
// Запуск: node --test tests/netcode-extra.test.js
import { test } from "node:test";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import runSync from "../sync-mode.js";
import { RoomManager, TEAM_DEF, TEAM_ATT } from "../../backend/matchmaking/rooms.js";
import { Matchmaker } from "../../backend/matchmaking/matchmaker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = join(__dirname, "..", "..", "rom", "disasm", "_battle_city.nes");

test("sync-mode: клиенты с задержкой ~100мс сходятся без desync", () => {
  const r = runSync({ romPath: ROM, frames: 150, delayA: 6, delayB: 6, jitter: 1 });
  assert.strictEqual(r.converged, true, "состояния не сошлись");
  assert.strictEqual(r.desyncA, 0);
  assert.strictEqual(r.desyncB, 0);
  assert.ok(r.rollbacks > 0, "rollback не срабатывал");
});

test("sync-mode: избыточность ввода скрывает потери пакетов (без desync)", () => {
  // с избыточностью (по умолчанию redundancy=4) кадр шлётся 4 раза —
  // потеря 10% одиночных пакетов восстанавливается без необратимого desync
  const r = runSync({ romPath: ROM, frames: 200, loss: 0.1, jitter: 1 });
  assert.strictEqual(r.converged, true, "состояния не сошлись при потере 10%");
  assert.strictEqual(r.desyncA, 0, "desyncA");
  assert.strictEqual(r.desyncB, 0, "desyncB");
});

test("sync-mode: без избыточности потеря пакетов приводит к desync", () => {
  // redundancy=1 — каждый кадр один раз; потери не восстанавливаются -> desync
  const r = runSync({ romPath: ROM, frames: 300, loss: 0.5, jitter: 1, redundancy: 1 });
  assert.ok(r.desyncA > 0 || r.desyncB > 0, "потеря пакетов не вызвала обнаружение desync");
});

test("sync-mode: отчёт содержит пофреймовые хэши (для отладки RNG/rollback)", () => {
  const r = runSync({ romPath: ROM, frames: 120, delayA: 4, delayB: 4 });
  assert.ok(r.hashes.length > 0);
  for (const h of r.hashes) {
    assert.strictEqual(h.a.length, 8);
    assert.strictEqual(h.b.length, 8);
  }
});

test("нагрузка комнат: массовое создание матчей и очистка TTL", () => {
  const rm = new RoomManager({ ttlMs: 100 });
  const mm = new Matchmaker(rm);
  // 500 пар -> 500 комнат
  for (let i = 0; i < 500; i++) {
    mm.add(`d${i}`, TEAM_DEF, `s${i}`);
    mm.add(`a${i}`, TEAM_ATT, `s${i}`);
  }
  assert.strictEqual(rm.rooms.size, 500);
  // завершаем матчи и чистим по TTL
  for (const room of rm.rooms.values()) room.finish(TEAM_DEF);
  rm.cleanup(Date.now() + 1000);
  assert.strictEqual(rm.rooms.size, 0, "завершённые комнаты не очищены");
  // очередь матчмейкера пуста после пар
  assert.strictEqual(mm.queue.length, 0);
});
