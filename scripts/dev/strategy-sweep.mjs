// strategy-sweep.mjs — перебор конфигураций весов/констант стратегического ИИ защитника
// (`emulator-core/ai/defender-strategy.js`) на ЭМУЛЯТОРЕ по уровням 1..10.
// Запуск: node scripts/strategy-sweep.mjs [levels] [frames] [attAI] [workers]
//   levels = "1,2,3" или "1-10"; frames по умолчанию 5000; workers по умолчанию 10.
// Печатает сводный отчёт + пишет scripts/strategy-sweep.csv.
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const WORKER = fileURLToPath(new URL("./strategy-eval-worker.mjs", import.meta.url));
const levelsArg = process.argv[2] ?? "1-10";
const MAX = parseInt(process.argv[3] ?? "5000", 10);
const ATT_AI = process.argv[4] ?? "plan";
const DEF_MODE = "active";
const WORKERS = Math.min(parseInt(process.argv[5] ?? "10", 10), 12);

function parseLevels(s) {
  if (s.includes("-")) { const [a, b] = s.split("-").map(Number); const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
  return s.split(",").map(Number);
}
const LEVELS = parseLevels(levelsArg);

// ---------------------------------------------------------------------------
// Варианты конфигурации (>=40). Каждый — { name, cfg } (cfg мёржится в defaults).
// ---------------------------------------------------------------------------
const T = (t) => ({ threat: t }); // компактный сеттер весов угрозы
const V = [];

// --- базовая линия ---
V.push({ name: "base", cfg: {} });

// --- веса угрозы базе (threatToBase) ---
V.push({ name: "threat_speed", cfg: T({ speed: 0.6, los: 0.2, dist: 0.15, power: 0.05, path: 0.0 }) });
V.push({ name: "threat_los", cfg: T({ speed: 0.2, los: 0.5, dist: 0.2, power: 0.05, path: 0.05 }) });
V.push({ name: "threat_dist", cfg: T({ speed: 0.2, los: 0.15, dist: 0.5, power: 0.1, path: 0.05 }) });
V.push({ name: "threat_path", cfg: T({ speed: 0.2, los: 0.15, dist: 0.15, power: 0.05, path: 0.45 }) });
V.push({ name: "threat_power", cfg: T({ speed: 0.15, los: 0.15, dist: 0.15, power: 0.5, path: 0.05 }) });
V.push({ name: "threat_balance", cfg: T({ speed: 0.25, los: 0.25, dist: 0.25, power: 0.15, path: 0.10 }) });

// --- радиус охоты от базы (maxLeash) ---
V.push({ name: "leash4", cfg: { maxLeash: 4 } });
V.push({ name: "leash6", cfg: { maxLeash: 6 } });
V.push({ name: "leash9", cfg: { maxLeash: 9 } });
V.push({ name: "leash13", cfg: { maxLeash: 13 } });
V.push({ name: "leash18", cfg: { maxLeash: 18 } });

// --- scoring цели (bestTarget) ---
V.push({ name: "hunt_aggro", cfg: { wThreat: 14, wTankDist: 0.15, wBaseDist: 0.1 } });
V.push({ name: "hunt_base", cfg: { wThreat: 10, wTankDist: 0.6, wBaseDist: 0.4 } });
V.push({ name: "hunt_flash", cfg: { wFlash: 12, wThreat: 6, wTankDist: 0.2, wBaseDist: 0.1 } });
V.push({ name: "hunt_near", cfg: { wTankDist: 1.0, wBaseDist: 0.1, wThreat: 6 } });
V.push({ name: "hunt_threat_only", cfg: { wThreat: 20, wTankDist: 0.0, wBaseDist: 0.0, wFlash: 0 } });
V.push({ name: "hunt_balanced", cfg: { wThreat: 8, wFlash: 4, wTankDist: 0.5, wBaseDist: 0.3 } });

// --- реактивность (гистерезис/стабильность) ---
V.push({ name: "react_low", cfg: { hysteresis: 0.05, holdFrames: 4, noProgressFrames: 10 } });
V.push({ name: "react_med", cfg: { hysteresis: 0.15, holdFrames: 12, noProgressFrames: 22 } });
V.push({ name: "react_high", cfg: { hysteresis: 0.35, holdFrames: 24, noProgressFrames: 40 } });
V.push({ name: "react_switchy", cfg: { hysteresis: 0.01, holdFrames: 2 } });
V.push({ name: "react_stable", cfg: { hysteresis: 0.5, holdFrames: 40, detourFrames: 40 } });

// --- анти-декой / радиус угрозы базе ---
V.push({ name: "decoy_small", cfg: { decoyRadius: 5 } });
V.push({ name: "decoy_big", cfg: { decoyRadius: 16 } });
V.push({ name: "threatrad_small", cfg: { baseThreatRadius: 4 } });
V.push({ name: "threatrad_big", cfg: { baseThreatRadius: 14 } });

// --- живучесть / отступление / уворот ---
V.push({ name: "dodge_off", cfg: { dodgeRadius: 2, retreatFire: 99 } });
V.push({ name: "dodge_wide", cfg: { dodgeRadius: 9, retreatFire: 1 } });
V.push({ name: "retreat_early", cfg: { retreatFire: 1, wRetreatIn: 4, wRetreatCover: 0.5 } });
V.push({ name: "retreat_late", cfg: { retreatFire: 4, wRetreatIn: 1 } });
V.push({ name: "tanky", cfg: { wRisk: 2.0, wRetreatIn: 3, wRetreatCover: 0.5, dodgeRadius: 8 } });
V.push({ name: "brave", cfg: { wRisk: 0.2, wRetreatIn: 0.5, dodgeRadius: 4, retreatFire: 5 } });

// --- призы / бонус ---
V.push({ name: "bonus_greedy", cfg: { wBonusPath: 0.1, wBonusBase: 0.0, wFlash: 10 } });
V.push({ name: "bonus_careful", cfg: { wBonusPath: 1.5, wBonusBase: 0.5, wFlash: 2 } });

// --- комбинации (целевые стратегии) ---
V.push({ name: "combo_defender", cfg: { maxLeash: 6, wThreat: 12, wBaseDist: 0.3, threat: { speed: 0.2, los: 0.35, dist: 0.25, power: 0.1, path: 0.1 }, wRisk: 1.5 } });
V.push({ name: "combo_killer", cfg: { maxLeash: 13, wThreat: 10, wTankDist: 0.3, wBaseDist: 0.2, wRisk: 0.6, threat: { speed: 0.3, los: 0.3, dist: 0.25, power: 0.15, path: 0.0 } } });
V.push({ name: "combo_basewall", cfg: { maxLeash: 5, baseThreatRadius: 12, wTankDist: 0.5, wBaseDist: 0.4, wRisk: 1.8, hysteresis: 0.3, holdFrames: 20 } });
V.push({ name: "combo_fast", cfg: { maxLeash: 11, hysteresis: 0.05, holdFrames: 4, noProgressFrames: 10, detourFrames: 14, wRisk: 0.4 } });
V.push({ name: "combo_hunter", cfg: { wFlash: 12, wThreat: 8, maxLeash: 14, wBaseDist: 0.15, wTankDist: 0.4 } });
V.push({ name: "combo_tank", cfg: { dodgeRadius: 9, wRisk: 2.5, retreatFire: 2, wRetreatIn: 4, wRetreatCover: 0.6, maxLeash: 7 } });
V.push({ name: "combo_aggro", cfg: { maxLeash: 16, wThreat: 16, wTankDist: 0.1, wBaseDist: 0.0, wRisk: 0.2, retreatFire: 6 } });
V.push({ name: "combo_guard", cfg: { maxLeash: 5, baseThreatRadius: 16, wBaseDist: 0.5, wTankDist: 0.6, wRisk: 2.0, hysteresis: 0.4, holdFrames: 30 } });
V.push({ name: "combo_sweep", cfg: { maxLeash: 15, wFlash: 15, wThreat: 12, wTankDist: 0.2, threat: { speed: 0.35, los: 0.25, dist: 0.2, power: 0.1, path: 0.1 }, wRisk: 0.5 } });
V.push({ name: "combo_eco", cfg: { maxLeash: 8, wThreat: 9, wTankDist: 0.5, wBaseDist: 0.35, wRisk: 1.2, wRetreatIn: 3 } });

console.log(`Вариантов конфигураций: ${V.length}; уровни ${LEVELS.join(",")}; frames=${MAX}; att=${ATT_AI}; workers=${WORKERS}`);

// ---------------------------------------------------------------------------
// Планировщик: пул воркеров, очередь job = (variant, level).
// ---------------------------------------------------------------------------
const jobs = [];
for (const v of V) for (const lv of LEVELS) jobs.push({ variant: v, level: lv });
const results = new Map(); // variant.name -> { level -> result }
let jobIdx = 0;
let nextId = 1;

function startWorker() {
  if (jobIdx >= jobs.length) return null;
  const job = jobs[jobIdx++];
  const w = new Worker(WORKER, { workerData: { variant: job.variant, level: job.level, max: MAX, attAI: ATT_AI, defMode: DEF_MODE } });
  const id = nextId++;
  w.on("message", (r) => {
    if (!results.has(r.variant)) results.set(r.variant, new Map());
    results.get(r.variant).set(r.level, r);
    w.terminate();
    startWorker();
  });
  w.on("error", (e) => { console.error(`[${job.variant.name}/L${job.level}] err: ${e.message}`); w.terminate(); startWorker(); });
  w.on("exit", (code) => { if (code !== 0) startWorker(); });
  return w;
}

for (let i = 0; i < WORKERS; i++) startWorker();

// Дождаться завершения всех jobs.
function allDone() { for (const v of V) for (const lv of LEVELS) if (!(results.get(v.name)?.has(lv))) return false; return true; }
const timer = setInterval(() => {
  if (allDone()) { clearInterval(timer); finalize(); }
}, 400);

// ---------------------------------------------------------------------------
// Отчёт
// ---------------------------------------------------------------------------
function agg(variantName) {
  const m = results.get(variantName) || new Map();
  let kills = 0, hqIntact = 0, stageClear = 0, timeout = 0, gameOver = 0, end = 0;
  let minFramesClear = Infinity, minFramesWin = Infinity, bestSurvive = 0;
  let totalFrames = 0, worstHQ = null;
  for (const lv of LEVELS) {
    const r = m.get(lv);
    if (!r) continue;
    kills += r.kills;
    if (r.hq) hqIntact++;
    if (r.outcome === "stage_clear") { stageClear++; minFramesClear = Math.min(minFramesClear, r.frames); }
    if (r.outcome === "timeout") timeout++;
    if (r.outcome === "game_over") { gameOver++; worstHQ = worstHQ === null ? lv : worstHQ; }
    if (r.outcome === "end") end++;
    // «победа»: уровень завершён досрочно (stage_clear) ИЛИ дожил до конца с целым HQ
    if ((r.outcome === "stage_clear" || r.outcome === "timeout") && r.hq) minFramesWin = Math.min(minFramesWin, r.frames);
    totalFrames += r.frames;
  }
  return { variantName, kills, hqIntact, stageClear, timeout, gameOver, end, minFramesClear, minFramesWin, avgFrames: Math.round(totalFrames / LEVELS.length), worstHQ };
}

function finalize() {
  const rows = V.map((v) => agg(v.name)).sort((a, b) => b.kills - a.kills || b.hqIntact - a.hqIntact || b.stageClear - a.stageClear);

  console.log("\n=== ОТЧЁТ: перебор конфигураций strategy-ИИ (уровни " + LEVELS.join(",") + ", att=" + ATT_AI + ") ===");
  console.log("Вариант".padEnd(20) + "| убийств | HQ цел | stage_clear | timeout | game_over | быстр.победа(фр) | быстр.clear(фр) | средн.кадры | 1-я потеря HQ");
  console.log("-".repeat(140));
  for (const r of rows) {
    console.log(
      r.variantName.padEnd(20) + "| " + String(r.kills).padEnd(7) + " | " + String(r.hqIntact).padEnd(6) + " | " +
      String(r.stageClear).padEnd(11) + " | " + String(r.timeout).padEnd(7) + " | " + String(r.gameOver).padEnd(9) + " | " +
      (r.minFramesWin === Infinity ? "-".padEnd(18) : String(r.minFramesWin).padEnd(18)) + " | " +
      (r.minFramesClear === Infinity ? "-".padEnd(17) : String(r.minFramesClear).padEnd(17)) + " | " +
      String(r.avgFrames).padEnd(11) + " | " + (r.worstHQ === null ? "-" : "L" + r.worstHQ)
    );
  }

  // топы по разным метрикам
  const byKills = [...rows].sort((a, b) => b.kills - a.kills);
  const byHQ = [...rows].sort((a, b) => b.hqIntact - a.hqIntact || b.kills - a.kills);
  const byClear = [...rows].sort((a, b) => b.stageClear - a.stageClear || a.minFramesClear - b.minFramesClear);
  const byWin = rows.filter((r) => r.minFramesWin !== Infinity).sort((a, b) => a.minFramesWin - b.minFramesWin);
  const bySurvive = rows.filter((r) => r.timeout > 0).sort((a, b) => b.hqIntact - a.hqIntact || b.timeout - a.timeout);

  const pct = (n) => Math.round(n / LEVELS.length * 100) + "%";
  console.log("\n=== ТОП: больше всего уничтожено танков (сумма по уровням) ===");
  for (const r of byKills.slice(0, 8)) console.log(`  ${r.variantName.padEnd(20)} -> ${r.kills} убийств (${pct(r.hqIntact)} HQ цел, ${r.stageClear} clear)`);

  console.log("\n=== ТОП: сохранение базы (HQ цел на N уровнях) ===");
  for (const r of byHQ.slice(0, 8)) console.log(`  ${r.variantName.padEnd(20)} -> ${r.hqIntact}/${LEVELS.length} HQ цел (${r.kills} убийств, ${r.stageClear} clear)`);

  console.log("\n=== ТОП: быстрая победа (мин. кадров до stage_clear/выживания с целым HQ) ===");
  if (byWin.length === 0) console.log("  нет досрочных побед (stage_clear/timeout с целым HQ) среди вариантов");
  else for (const r of byWin.slice(0, 8)) console.log(`  ${r.variantName.padEnd(20)} -> ${r.minFramesWin} фр`);

  console.log("\n=== ТОП: больше всего stage_clear (полное прохождение уровня) ===");
  for (const r of byClear.slice(0, 8)) console.log(`  ${r.variantName.padEnd(20)} -> ${r.stageClear}/${LEVELS.length} (самый быстрый clear: ${r.minFramesClear === Infinity ? "-" : r.minFramesClear + " фр"})`);

  // CSV
  const csv = ["variant,kills,hq_intact,stage_clear,timeout,game_over,min_win_frames,min_clear_frames,avg_frames,first_hq_loss"]
    .concat(rows.map((r) => [r.variantName, r.kills, r.hqIntact, r.stageClear, r.timeout, r.gameOver, r.minFramesWin === Infinity ? "" : r.minFramesWin, r.minFramesClear === Infinity ? "" : r.minFramesClear, r.avgFrames, r.worstHQ ?? ""].join(",")));
  const csvPath = join(process.cwd(), "scripts", "strategy-sweep.csv");
  writeFileSync(csvPath, csv.join("\n"));
  console.log("\nCSV сохранён: " + csvPath);
}
