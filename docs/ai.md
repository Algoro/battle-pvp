# ИИ

ИИ управляет танками, за которые не играет человек (пустые слоты, соло-режим).
Код — `emulator-core/ai/`, работает поверх детерминированного состояния через
`emulator-core/model/` (perception, pathfind, steer, game-view).

## Режимы

Атакующие (`attAI`):
- `lookahead` — MPC-предсказание (по умолчанию, лучше всех ломает штаб);
- `scan` — полное сканирование поля;
- `plan` / `js` — тактический планировщик;
- `strategy-att` — стратегический слой;
- `asm` — родной ASM-ИИ ROM (JS не вмешивается);
- `off` — без управления.

Защитники (`defAI`):
- `plan` — `planDefense` (по умолчанию, доживает до таймаута);
- `scan`, `lookahead` — те же движки с ролью `def`;
- `strategy` — стратегический слой;
- `off` — только огонь / без управления.

## Модули

| Файл | Роль |
|---|---|
| `lookahead-ai.ts` | предсказание будущего (MPC), основной ATT |
| `scan-ai.ts` | полное сканирование |
| `tactical-ai.ts` | тактический план (`plan`, `planDefense`) |
| `attacker-strategy.ts` | стратегия атакующих |
| `defender-strategy.ts` | стратегия защитников |
| `brain-runner.ts` | запуск мозга с кэшем решений (`aiEvery`) |

## API

Управление режимами — через опции ядра/методы `PvPNes`:
`setAttAI(mode)`, `setDefAI(mode)`, `getAttModes()`, `getDefModes()`.
Человеческие танки помечаются `setHumanTank(port)` / `setHumanDefTank(port)` — за них ИИ не играет.
