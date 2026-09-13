// features.test.js — контракт опциональных фич между слоями:
// backend (валидация лобби), emulator-core (реестр патчей), frontend (UI).
// Все три списка id обязаны совпадать.
import { test } from "node:test";
import assert from "node:assert";
import { SUPPORTED_FEATURES } from "../../backend/domain/features.ts";
import { listFeatures } from "../../emulator-core/patching/registry.ts";
import { FEATURE_IDS } from "../../frontend/src/features.ts";
import {
  FEATURE_MANIFEST,
  normalizeFeatureOptions,
  effectiveFeatureOptions,
} from "../../shared/features.ts";

test("features: списки фич в backend/core/frontend совпадают", () => {
  const core = listFeatures().map((f) => f.id).sort();
  const backend = [...SUPPORTED_FEATURES].sort();
  const frontend = [...FEATURE_IDS].sort();
  assert.deepStrictEqual(backend, core, "backend vs core");
  assert.deepStrictEqual(frontend, core, "frontend vs core");
});

test("features: схема настроек манифеста корректна", () => {
  for (const f of FEATURE_MANIFEST) {
    const fields = f.settings?.fields ?? [];
    const ids = new Set<string>();
    for (const field of fields) {
      assert.ok(!ids.has(field.id), `${f.id}: дубль настройки ${field.id}`);
      ids.add(field.id);
      if (field.type === "range") {
        assert.strictEqual(typeof field.default, "number", `${f.id}.${field.id}: default не число`);
        assert.ok(field.min !== undefined && field.max !== undefined, `${f.id}.${field.id}: нет min/max`);
        assert.ok(field.default >= field.min! && field.default <= field.max!, `${f.id}.${field.id}: default вне диапазона`);
      } else if (field.type === "toggle") {
        assert.strictEqual(typeof field.default, "boolean", `${f.id}.${field.id}: default не boolean`);
      } else if (field.type === "select") {
        const opts = field.options ?? [];
        assert.ok(opts.length > 0, `${f.id}.${field.id}: нет options`);
        assert.ok(opts.some((o) => o.value === field.default), `${f.id}.${field.id}: default не из options`);
        const values = new Set(opts.map((o) => String(o.value)));
        assert.strictEqual(values.size, opts.length, `${f.id}.${field.id}: дубли в options`);
      }
    }
  }
});

test("features: нормализация и значения по умолчанию настроек", () => {
  const norm = normalizeFeatureOptions({
    pistol: { beamHalf: 99, nope: 1, terrain: 0 },
    ghost: { x: 1 },
    "wrap-borders": { wrapX: false },
  });
  assert.deepStrictEqual(norm, {
    pistol: { beamHalf: 3, terrain: false },
    "wrap-borders": { wrapX: false },
  });

  const eff = effectiveFeatureOptions("wrap-borders", { wrapX: false });
  assert.strictEqual(eff.wrapX, false);
  assert.strictEqual(eff.wrapY, true, "незаданное поле берёт default");

  assert.deepStrictEqual(effectiveFeatureOptions("ghost"), {}, "у неизвестной фичи нет настроек");
});
