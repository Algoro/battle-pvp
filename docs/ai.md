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
| `lookahead-ai.js` | предсказание будущего (MPC), основной ATT |
| `scan-ai.js` | полное сканирование |
| `tactical-ai.js` | тактический план (`plan`, `planDefense`) |
| `attacker-strategy.js` | стратегия атакующих |
| `defender-strategy.js` | стратегия защитников |
| `brain-runner.js` | запуск мозга с кэшем решений (`aiEvery`) |

## API

Управление режимами — через опции ядра/методы `PvPNes`:
`setAttAI(mode)`, `setDefAI(mode)`, `getAttModes()`, `getDefModes()`.
Человеческие танки помечаются `setHumanTank(port)` / `setHumanDefTank(port)` — за них ИИ не играет.
