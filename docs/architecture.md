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

## Контракт ROM и сертификация

- **`rom-contract.js`** — единый источник правды по адресам RAM/ROM (было разбросано
  тысячи «магических» чисел). Используется ядром, моделью ИИ, симом, патчингом.
  Контрольные байты проверяются `assertRomContract()` (`startup.js`).
- **`domain.js`** — семантика домена: направления (`DIR_VEC`, `DIR_BTN`, `btnToDir`),
  флаги танков (`isTankAlive/Active`, `movingFlag`), тайлы (`isBrick/Steel`, `tankPassable`),
  пули (`isBulletFlying`), апгрейд (`starsToUpgrade`). Убирает дубли и «магию» вида `0xa0|dir`.
- **Enforcement** (`tests/no-magic-addresses.test.js`): запрет сырых RAM/ROM-адресов вне
  `rom-contract/domain/startup` — регрессии «магии» ловятся в CI.
- **`startup.js`** — декларативный boot/apply API стартовых опций (стадия, звёзды,
  супер-оружие `setStartPistol`): один проверяемый хук на вход `sub_F000_draw_stage` вместо ad-hoc.
- **`patching/patches/pistol.js`** — приз «пистолет» (выпадение/подбор/4-я звезда/сброс);
  эффект луча — в JS (`pvp.js`, `_fireRailgun`/`_renderBeamFx`). См. `docs/pistol-powerup-plan.md`.
- **`io/trace.js`** — трейс ИИ вынесен из `PvPNes` (декомпозиция god-объекта);
  `stepFrame` разбит на `_resetNetZone/_readInputs/_applyAttAIDecisions`.
- **`ai/rollforward.js`** — предсказание будущего на **реальном эмуляторе** (saveState +
  прокрутка), сертифицировано тестом; основа для отказа от отдельной JS-модели (`sim/*`).
- **Golden-сертификация** (`tests/golden-replay.test.js`): golden-хэш ядра, сходимость
  двух инстансов, эквивалентность save/load, детерминизм стартовых опций.
- **Валидация WS** (`backend/signaling/schema.js`) — декларативная схема сообщений.

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
- **Frontend**: лобби-логика вынесена в хук `use-lobby.ts` (App — экраны/матч);
  `relay` использует диспетчер-таблицу вместо большого `switch`.
