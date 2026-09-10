// log-desyncs.js — мониторинг/логирование десинков rollback.
// Прогоняет sync-сессию (qa/sync-mode.js) и пишет десинки в reports/desyncs.log
// (JSON-строки с меткой времени) + итог в stdout.
// Относительный путь: ./scripts/log-desyncs.js
// Использование: node scripts/log-desyncs.js [frames]
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import runSync from "../qa/sync-mode.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, "..", "reports", "desyncs.log");
const ROM = join(__dirname, "..", "rom", "disasm", "_battle_city.nes");
const frames = Number(process.argv[2] || 180);
const opts = {
  romPath: ROM,
  frames,
  delayA: 6,
  delayB: 6,
  jitter: 1,
  loss: Number(process.argv[3] || 0),
};

const r = runSync(opts);
const stamp = new Date().toISOString();
const rec = {
  ts: stamp,
  ...opts,
  converged: r.converged,
  desyncA: r.desyncA,
  desyncB: r.desyncB,
  rollbacks: r.rollbacks,
  hashA: r.hashA,
  hashB: r.hashB,
  desyncFrames: r.desyncEvents,
};
appendFileSync(LOG, JSON.stringify(rec) + "\n");

console.log(`frames=${frames} loss=${opts.loss} converged=${r.converged}`);
console.log(`hashA=${r.hashA} hashB=${r.hashB} desyncA=${r.desyncA} desyncB=${r.desyncB} rollbacks=${r.rollbacks}`);
console.log(`desyncFrames=${JSON.stringify(r.desyncEvents)}`);
console.log(`logged -> reports/desyncs.log`);
if (!r.converged) process.exitCode = 1;
