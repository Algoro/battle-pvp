// features.test.js — контракт опциональных фич между слоями:
// backend (валидация лобби), emulator-core (реестр патчей), frontend (UI).
// Все три списка id обязаны совпадать.
import { test } from "node:test";
import assert from "node:assert";
import { SUPPORTED_FEATURES } from "../../backend/domain/features.js";
import { listFeatures } from "../../emulator-core/patching/registry.js";
import { FEATURE_IDS } from "../../frontend/src/features.ts";

test("features: списки фич в backend/core/frontend совпадают", () => {
  const core = listFeatures().map((f) => f.id).sort();
  const backend = [...SUPPORTED_FEATURES].sort();
  const frontend = [...FEATURE_IDS].sort();
  assert.deepStrictEqual(backend, core, "backend vs core");
  assert.deepStrictEqual(frontend, core, "frontend vs core");
});
