// golden-state.test.js — regression of "no side effects" over deterministic
// state. If golden is missing — it is created; otherwise any shift of game state
// (from an ASM patch or JS logic) will produce a mismatch and fail the test.
// Run: node --test tests/golden-state.test.js
import { test } from "node:test";
import assert from "node:assert";
import { runGolden } from "../golden-state.ts";

test("golden-state соло-ATT: состояние воспроизводится (без побочных эффектов)", () => {
  const r = runGolden("battle-city.solo-att", { frames: 1800, snapshotEvery: 60 });
  if (r.created) {
    console.log("[golden] эталон создан (первый запуск)");
  }
  assert.deepStrictEqual(r.diffs, [], `состояние игры изменилось: ${r.diffs.join("; ")}`);
});

test("golden-state детерминирован: два прогона дают одинаковый хэш", async () => {
  const { runScript, ROM } = await import("../golden-state.ts");
  const { readFileSync } = await import("node:fs");
  const PvPNes = (await import("../../emulator-core/pvp.ts")).default;
  const a = new PvPNes(); a.loadROM(readFileSync(ROM));
  const b = new PvPNes(); b.loadROM(readFileSync(ROM));
  const ra = runScript(a, { frames: 600, snapshotEvery: 60 });
  const rb = runScript(b, { frames: 600, snapshotEvery: 60 });
  assert.strictEqual(ra.finalHash, rb.finalHash, "два прогона одного скрипта разошлись");
});
