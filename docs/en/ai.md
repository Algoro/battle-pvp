> 🌐 **English** · [Русский](../ai.md)

# AI

The AI controls tanks that no human plays (empty slots, solo mode).
The code lives in `emulator-core/ai/` and runs on top of the deterministic state via
`emulator-core/model/` (perception, pathfind, steer, game-view).

## Modes

Attackers (`attAI`):
- `lookahead` — MPC prediction (default, breaks the HQ better than anything else);
- `scan` — full field scan;
- `plan` / `js` — tactical planner;
- `strategy-att` — strategic layer;
- `asm` — native ROM ASM AI (JS does not interfere);
- `off` — no control.

Defenders (`defAI`):
- `plan` — `planDefense` (default, survives until the timeout);
- `scan`, `lookahead` — the same engines with the `def` role;
- `strategy` — strategic layer;
- `off` — fire only / no control.

## Modules

| File | Role |
|---|---|
| `lookahead-ai.ts` | future prediction (MPC), the main ATT |
| `scan-ai.ts` | full scan |
| `tactical-ai.ts` | tactical plan (`plan`, `planDefense`) |
| `attacker-strategy.ts` | attacker strategy |
| `defender-strategy.ts` | defender strategy |
| `brain-runner.ts` | brain runner with a decision cache (`aiEvery`) |

## API

Mode control — via core options/`PvPNes` methods:
`setAttAI(mode)`, `setDefAI(mode)`, `getAttModes()`, `getDefModes()`.
Human tanks are marked with `setHumanTank(port)` / `setHumanDefTank(port)` — the AI does not play them.
