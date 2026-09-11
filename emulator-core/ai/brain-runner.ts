// brain-runner.js — D: единая точка запуска любого ИИ-движка (развязана от
// game-view, чтобы не было циклических импортов).
//
// runBrain(stateOrMem, prev, mode, role, frame):
//   mode: "js" | "scan" | "lookahead" (att) | "plan" (def); role: "att" | "def".
//   Возвращает { decisions: Map<idx, {dir, fire, goal} | buttons>, state }.
//   `state` — ПРОДОЛЖАЕМОЕ состояние ИИ (для planDefense/scan/lookahead с памятью между
//   кадрами). Вызывающий обязан передавать его на каждый кадр и сохранять возвращённое.
//   Каждый экземпляр ИИ (эмулятор vs симулятор) должен иметь СВОЁ состояние, чтобы
//   решения были изолированы и сопоставимы (контрактный тест verify-toMem).
import { DIR_BTN } from "../model/game-view.ts";
import { plan, planDefense } from "./tactical-ai.ts";
import { scanPlan } from "./scan-ai.ts";
import { lookaheadPlan } from "./lookahead-ai.ts";
import { strategyDefense } from "./defender-strategy.ts";
import { attackerPlan } from "./attacker-strategy.ts";

export function runBrain(stateOrMem: any, prev: any, mode: any, role: any, frame = 0) {
  const mem = stateOrMem.mem ?? stateOrMem;
  if (role === "def") {
    if (mode === "scan" || mode === "lookahead") {
      const brain = mode === "scan" ? scanPlan : lookaheadPlan;
      const res = brain(mem, prev, "def");
      const decisions = new Map();
      for (const [t, d] of res.decisions) {
        let b = 0;
        if (d.dir !== null) b |= DIR_BTN[d.dir];
        if (d.fire) b |= 0x01;
        decisions.set(t, b);
      }
      return { decisions, state: res.state };
    }
    if (mode === "strategy") {
      const res: any = strategyDefense(mem, frame, prev);
      return { decisions: res.buttons, state: prev ?? res.state ?? new Map() };
    }
    // planDefense: stateful (модульный defState по умолчанию). Передаём `prev` как состояние
    // (если задано), чтобы изолировать экземпляры ИИ; иначе — дефолтный defState.
    const res: any = planDefense(mem, frame, prev);
    return { decisions: res.buttons, state: prev ?? res.state ?? new Map() };
  }
  if (mode === "strategy-att") return attackerPlan(mem, prev);
  const brain = mode === "scan" ? scanPlan : mode === "lookahead" ? lookaheadPlan : plan;
  return brain(mem, prev, "att");
}
