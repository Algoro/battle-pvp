// strategy-bench.mjs — быстрый точечный A/B: конкретные конфиги на диапазоне уровней.
// Запуск: node scripts/strategy-bench.mjs [configs] [levels] [frames] [attAI] [workers]
//   configs: через запятую имена PRESETS или "balanced"/"all". Пример: balanced,stable,aggro
//   levels:  "1-10" | "11,13,15". frames по умолч. 4000.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { PRESETS } from "../emulator-core/ai/defender-strategy.js";

const WORKER = fileURLToPath(new URL("./strategy-eval-worker.mjs", import.meta.url));
const namesArg = process.argv[2] ?? "balanced";
const levelsArg = process.argv[3] ?? "1-10";
const MAX = parseInt(process.argv[4] ?? "4000", 10);
const ATT_AI = process.argv[5] ?? "plan";
const WORKERS = Math.min(parseInt(process.argv[6] ?? "10", 10), 12);

function parseLevels(s) {
  if (s.includes("-")) { const [a, b] = s.split("-").map(Number); const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  return s.split(",").map(Number);
}
const LEVELS = parseLevels(levelsArg);

const variants = namesArg === "all"
  ? Object.keys(PRESETS).map((n) => ({ name: n, cfg: n === "balanced" ? {} : PRESETS[n] }))
  : namesArg.split(",").map((n) => ({ name: n, cfg: n === "balanced" ? {} : (PRESETS[n] ?? {}) }));

console.log(`A/B: конфигов=${variants.length} (${variants.map((v) => v.name).join(",")}); уровни ${LEVELS.join(",")}; frames=${MAX}; att=${ATT_AI}; workers=${WORKERS}`);

const jobs = [];
for (const v of variants) for (const lv of LEVELS) jobs.push({ variant: v, level: lv });
const results = new Map(); // name -> Map(level -> r)
let jobIdx = 0;
function startWorker() {
  if (jobIdx >= jobs.length) return null;
  const job = jobs[jobIdx++];
  const w = new Worker(WORKER, { workerData: { variant: job.variant, level: job.level, max: MAX, attAI: ATT_AI, defMode: "active" } });
  w.on("message", (r) => {
    if (!results.has(r.variant)) results.set(r.variant, new Map());
    results.get(r.variant).set(r.level, r);
    w.terminate(); startWorker();
  });
  w.on("error", (e) => { console.error(`err ${job.variant.name}/L${job.level}: ${e.message}`); w.terminate(); startWorker(); });
  w.on("exit", (c) => { if (c !== 0) startWorker(); });
}
for (let i = 0; i < WORKERS; i++) startWorker();

function allDone() { for (const v of variants) for (const lv of LEVELS) if (!(results.get(v.name)?.has(lv))) return false; return true; }
const timer = setInterval(() => { if (allDone()) { clearInterval(timer); finalize(); } }, 400);

function finalize() {
  console.log("\nconfig".padEnd(12) + "| убийств | HQ цел | clear | timeout | game_over | средн.кадры | 1-я потеря HQ");
  console.log("-".repeat(90));
  const rows = variants.map((v) => {
    const m = results.get(v.name) || new Map();
    let kills = 0, hq = 0, clear = 0, timeout = 0, go = 0, total = 0, firstHQ = null;
    for (const lv of LEVELS) {
      const r = m.get(lv); if (!r) continue;
      kills += r.kills; if (r.hq) hq++;
      if (r.outcome === "stage_clear") clear++;
      if (r.outcome === "timeout") timeout++;
      if (r.outcome === "game_over") { go++; if (firstHQ === null) firstHQ = lv; }
      total += r.frames;
    }
    return { name: v.name, kills, hq, clear, timeout, go, avg: Math.round(total / LEVELS.length), firstHQ };
  }).sort((a, b) => b.kills - a.kills || b.hq - a.hq || b.clear - a.clear);
  for (const r of rows) console.log(`${r.name.padEnd(12)}| ${String(r.kills).padEnd(7)} | ${String(r.hq).padEnd(6)} | ${String(r.clear).padEnd(5)} | ${String(r.timeout).padEnd(7)} | ${String(r.go).padEnd(9)} | ${String(r.avg).padEnd(11)} | ${r.firstHQ ?? "-"}`);
}
