// brain-runner.js — D: single entry point for launching any AI engine (decoupled from
// game-view so there are no circular imports).
//
// runBrain(stateOrMem, prev, mode, role, frame):
//   mode: "js" | "scan" | "lookahead" (att) | "plan" (def); role: "att" | "def".
//   Returns { decisions: Map<idx, {dir, fire, goal} | buttons>, state }.
//   `state` — PERSISTENT AI state (for planDefense/scan/lookahead with memory between
//   frames). The caller must pass it on every frame and keep the returned one.
//   Each AI instance (emulator vs simulator) must have ITS OWN state so that
//   decisions are isolated and comparable (contract test verify-toMem).
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
    // planDefense: stateful (modular defState by default). We pass `prev` as the state
    // (if provided) to isolate AI instances; otherwise — the default defState.
    const res: any = planDefense(mem, frame, prev);
    return { decisions: res.buttons, state: prev ?? res.state ?? new Map() };
  }
  if (mode === "strategy-att") return attackerPlan(mem, prev);
  const brain = mode === "scan" ? scanPlan : mode === "lookahead" ? lookaheadPlan : plan;
  return brain(mem, prev, "att");
}
