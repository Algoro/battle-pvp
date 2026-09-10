# Архитектура

Battle City PvP — надстройка над классической Battle City (NES). Команда **DEF**
(2 танка) защищает штаб, команда **ATT** (до 6) играет за бывшие enemy-танки.
Эмулятор и ROM — неизменные компоненты; всё остальное — расширения вокруг них.

## Слои

```
frontend/       React/TS SPA: canvas-рендер, лобби, чат, spectator, HUD
netcode/        rollback-netcode: протокол, RollbackSession, транспорты
emulator-core/  ядро: PvPNes (extends jsnes NES), BattleCityPPU, patching/, ai/, sim/, model/, io/
backend/        Node: HTTP + WS, matchmaking, лобби/комнаты, signaling relay, SQLite
rom/            original/ (ваш ROM), patches/, disasm/ (asm-референс), сборочные утилиты
vendor/jsnes/   git-сабмодуль: неизменный апстрим jsnes
```

## Неизменные компоненты

- **jsnes** — сабмодуль `vendor/jsnes`. Не редактируется. Копия `emulator-core/src`
  генерируется из него (`scripts/prepare.mjs`); guard-тест `jsnes-pristine.test.js`.
  Расширения: `PvPNes extends NES`, `BattleCityPPU extends PPU` (`ppu-ext.js`).
- **ROM** — файл не меняется. PvP-патчи применяются к in-memory образу PRG
  (`emulator-core/patching/`). Подробно — `docs/rom-patching.md`.

## Поток матча

1. Игрок выбирает команду (лобби или быстрый матч) → backend выдаёт комнату и порт.
2. WS-сигналинг сопрягает WebRTC (SDP/ICE, STUN/TURN), при неудаче — relay через backend.
3. `RollbackSession` оборачивает `PvPNes`: каждый кадр клиент шлёт свой ввод, предсказывает
   ввод соперников (2v2/N — через `MultiTransport`), при позднем вводе — откат и переигровка.
4. Рендер: `nes.ppu.buffer` → canvas. Сверка `getFrameHash()` детектит desync;
   при расхождении — resync по снапшоту.

## Потоки данных и детерминизм

- Вводы: DEF-порты `0,1` → `$4016/$4017`; ATT-порты `2..7` → RAM-зона `ram_net_*` (`$01DB+`).
- PRNG (`sub_D44D`) детерминирован — зависит только от собственного регистра и счётчиков кадров.
- `stepFrame(inputs)` детерминирован: одинаковый вход → одинаковый `getFrameHash()`;
  `saveState/loadState` включает полный образ RAM.

## Ключевые решения

- **Equal-size патчи**: хуки строго равного размера (JMP/JSR + NOP), новый код — в
  неиспользуемой зоне `$EF75–$EFFF`; адреса оригинального кода не сдвигаются.
- **Отпечаток картриджа** (`cartridgeFingerprint`) в handshake — матч только с идентичными патчами.
- **Транспорт**: WebRTC (P2P) с relay-fallback; полносвязная сеть для N игроков.

## Внутренние материалы

Рабочий журнал и отчёты — `docs/dev/` (не часть публичной документации).
