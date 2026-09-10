# Agent-Frontend — React/TS SPA клиент

Дата: 2026-08-23
Вход: `reports/agent-emulator-core.md` (детерминированное ядро), `reports/agent-netcode.md`
(rollback), `reports/agent-backend.md` (matchmaking/signaling).
Статус: собирается (`vite build` OK), typecheck OK, чистые функции покрыты тестами.
Функциональная проверка в браузере — Agent-QA (Playwright).

## Структура (относительные пути)
```
./frontend/
  index.html
  vite.config.ts          Vite + React + алиасы на ../emulator-core и ../netcode
  tsconfig.json
  package.json            dev/build/typecheck/test
  public/rom/battle_city.nes   патченый ROM (эталон сборки)
  src/main.tsx, src/App.tsx, src/styles.css
  src/engine/emulator.ts  EmulatorDriver: загрузка ROM, шаг кадра, рендер в canvas
  src/engine/input.ts     клавиатура -> con_btn маска (чистая, тестируемая)
  src/engine/net.ts       NetClient: matchmaking + WS + WebRTC/relay + RollbackSession
  src/components/GameCanvas.tsx  canvas + HUD + rollback/desync индикатор
  src/components/Lobby.tsx       выбор команды/танка + запуск матча
  tests/input.test.js
```

## Реализовано (Блок 8)
- **canvas/WebGL-рендер эмулятора**: `EmulatorDriver` читает `nes.ppu.buffer`
  (Uint32Array 256×240), конвертирует `0xff000000 | buffer[i]` в `ImageData`
  и выводит в `<canvas>` (pixelated). Детерминированный `stepFrame(inputs)`.
- **UI лобби**: выбор команды DEF/ATT, имя игрока, запуск онлайн-матча или локального соло.
- **Выбор команды/танка**: команда определяет логические порты (DEF→0..1, ATT→2..3).
- **HUD команд**: жизни DEF (RAM $51/$52), остаток ATT ($80), game-over ($68),
  счётчики rollbacks/desync, индикатор sync/DESYNC.
- **Индикатор задержки/rollback**: счётчик rollback-событий от `RollbackSession.onEvent`.
- **Экран результата матча**: по `game_over_flag` (штаб уничтожен → победа ATT).
- **Сетевой клиент** (`net.ts`): matchmaking через backend, WS join, сопряжение
  WebRTC (SDP/ICE через signaling) с fallback на relay, создание `RollbackSession`.

## Сборка/запуск
- `npm run build` — `tsc --noEmit && vite build` → `dist/` (282 КБ js / 80 КБ gzip).
- `npm run dev` — dev-сервер на :5173 (proxy `/api`→:8080, `/ws`→ws://:8080).
- `npm test` — unit-тесты чистых функций ввода.
- Vite-алиасы маппят `../../emulator-core` и `../../netcode` (монорепо, вне каталога
  frontend) — без этого Vite не резолвит импорты вне корня проекта.

## Тесты
- `tests/input.test.js` (2/2 PASS): `keyToMask`, `maskFromCodes` (клавиатура→con_btn).

## Передача управления
**Agent-QA**: e2e Playwright по этому клиенту (лобби→матч), sync-тест через
`EmulatorDriver`/`RollbackSession` в браузере. **Agent-DevOps**: сборка фронта
(`npm run build`) как часть CI. **Agent-DocWriter**: API эмулятора/клиента.
