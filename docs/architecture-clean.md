# Чистая архитектура: целевая модель

Документ описывает идеальную (clean) архитектуру Battle City PvP. Главный принцип — **правило зависимостей**: внутренние слои не знают
о внешних; все связи идут через порты (интерфейсы), реализуемые адаптерами.

## 1. Особенность проекта

Игровые правила (коллизии, ИИ врагов, физика) живут **в оригинальном ROM** и исполняются
эмулятором jsnes. Это осознанное ограничение: мы не переносим правила в код. Поэтому
«сущности» в классическом смысле — это не физика, а **домен матча/лобби/сетевой
синхронизации**, а эмулятор — это *фреймворк/драйвер* за портом `GameCore`.

```
        ┌────────────────────────────────────────────────────────────┐
        │ Frameworks & Drivers (внешний слой, заменяемый)             │
        │  jsnes, WebRTC, WebSocket, React, Vite, SQLite, Audio, DOM  │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ реализуют порты           │ управляют
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Interface Adapters (преобразование I/O <-> use cases)       │
        │  WS-роутеры, React-хуки/компоненты, транспортные адаптеры,  │
        │  репозитории (SQLite), презентеры (HUD, лобби, чат)         │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ вызывают                  │ читают
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Application / Use Cases (сценарии, без I/O)                 │
        │  CreateLobby, JoinLobby, StartMatch, FinishMatch,           │
        │  SendChat, Reconnect, RebindTransport, RequestResync,       │
        │  SelectStage, SetDefenderStars, EnterSpectate               │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ зависят только от          │
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Domain (сущности и правила, ноль зависимостей)              │
        │  Match, Room, Lobby, Player, ChatMessage, StageSpec,        │
        │  CartridgeFingerprint, RollbackPolicy, InputFrame, ports    │
        └────────────────────────────────────────────────────────────┘
```

## 2. Слои и порты

### Domain (`*/domain/`)
- Сущности: `Match`, `Room`, `Lobby`, `Player`, `ChatMessage`, `StageSpec`, `InputFrame`,
  `RollbackPolicy`, `CartridgeFingerprint`.
- Никаких импортов jsnes/ws/react/fs. Только чистые функции и инварианты.

### Application (`*/application/`)
- Use cases, оркестрирующие домен через порты: `startMatch`, `finishMatch`,
  `createLobby`, `joinLobby`, `sendChat`, `reconnect`, `rebindTransport`, `requestResync`.
- Возвращают результат/DTO; **не** пишут в сокеты/БД напрямую — это делают адаптеры.

### Ports (`netcode/ports.ts`, `backend/ports.ts`, `frontend/src/ports.ts`)
- `GameCore`: `stepFrame`, `saveState`, `loadState`, `getFrameHash`, `setStartStage`,
  `setStartStars`, `setAudioSuppressed`, `cartridgeFingerprint`.
- `Transport`: `send`, `onMessage`, `onClose`, `isOpen`.
- `Clock`: `now()` — детерминируемое время для ping/pong (инъекция).
- `EventSink`: `emit(event)`.
- `Logger`: `warn`, `error`.
- `RoomRepository`, `ChatRepository`, `PlayerRepository` — хранение состояния.
- `SignalingPort` (отправка SDP/ICE/relay.data), `ChatPort`.

### Interface Adapters
- Backend: WS-роутер (`signaling/relay.ts`) → вызывает use cases; репозитории SQLite;
  signaling-адаптер.
- Frontend: React-хуки (`use-lobby`) и компоненты → вызывают клиенты-шлюзы
  (`LobbyClient`, `NetClient`) и `EmulatorDriver` (адаптер `GameCore`).
- Netcode: `RollbackSession` зависит только от портов `GameCore`/`Transport`/`Clock`/`EventSink`.

### Frameworks & Drivers
- jsnes (неизменный сабмодуль), WebRTC, WebSocket/ws, React/Vite, SQLite, Web Audio, DOM.

## 3. Правило зависимостей (enforcement)

Автотест `qa/tests/architecture.test.ts` проверяет:
1. `emulator-core/rom-contract.ts` и `emulator-core/domain.ts` — чистые (только друг из друга).
2. `netcode/**` не импортирует `emulator-core/**`, `frontend/**`, `backend/**`.
3. `backend/**` не импортирует `emulator-core/**`, `frontend/**`.
4. `frontend/**` не импортирует `backend/**` напрямую (только сеть).

Нарушение правила — падение CI (как `no-magic-addresses`).

## 4. Целевая раскладка

```
netcode/ports.ts   порты netcode (GameCore/Transport/Clock/EventSink) — без импортов
netcode/rollback/  RollbackSession (application-ядро поверх портов)
emulator-core/     адаптер GameCore (PvPNes, патчинг, домен-хелперы)
backend/
  domain/          teams/room/lobby/matchmaker/chat — чистые правила (без I/O)
  ports.ts         контракты (ChatRepository/MatchRepository/PlayerRepository)
  application/     use cases: match-lifecycle.ts, chat.ts (без I/O)
  signaling/       WS-адаптер (тонкий роутер) + schema.ts
  persistence/     SQLite-адаптеры (store.ts, chat-repository.ts)
frontend/src/
  ports.ts         порты фронта (GameCore/Transport/Clock/EventSink/MatchGateway) — без импортов
  engine/          шлюзы-адаптеры (LobbyClient/NetClient/EmulatorDriver/AudioOutput)
  application/     контроллеры (use-match/use-spectate/use-lobby, MatchController)
  components/      презентеры (лобби, HUD, чат) — без сети
  App.tsx          composition root: только маршрутизация экранов
```

## 5. Тестовая стратегия

- Golden/детерминизм (`golden-replay`, `patching`, `domain`) — контракт ядра, не менять.
- Use cases — юнит-тесты с fake-портами (in-memory репозитории, fake Clock/Transport).
- Architecture test — правило зависимостей.
- E2E — сквозной сценарий (лобби→матч→чат→spectator).

## 6. Что не переносим

- Правила игры в коде — остаются в ROM (исполняются jsnes). Это не «грязная»
  архитектура, а осознанная граница: ROM+jsnes = внешний драйвер за портом `GameCore`.
- jsnes не редактируем (immutable), патчинг ROM — адаптер в `emulator-core/patching`.

## 7. Текущее состояние

| Область | Состояние |
|---|---|
| Порты netcode (`ports.ts`, Clock/Logger) | ✅ сделано: `RollbackSession` берёт время из порта `Clock` |
| Enforcement (правило зависимостей) | ✅ `qa/tests/architecture.test.ts` (18 проверок, включая `shared/tower-defence.ts` без импортов и слои рендера) |
| Backend application (use cases матча/чата) | ✅ `backend/application/{match-lifecycle,chat}.ts`; relay/HTTP — тонкие адаптеры |
| Frontend application (контроллеры) | ✅ `frontend/src/application/{use-lobby,use-match,use-spectate}.ts` + `MatchController`; `App.tsx` — композиция экранов |
| Domain-сущности (Room/Lobby/Matchmaker/Chat) | ✅ `backend/domain/` (чистые классы), SQLite за портом `ChatRepository` |
| Порт `GameCore` | ✅ контракт в `netcode/ports.ts`; тест `game-core-port.test.ts` на fake-ядре |
| Полный свод (нулевые нарушения) | ✅ `architecture.test.ts` стережёт слои domain←application←adapters и frontend engine←application←components |

`netcode/ports.ts` и `frontend/src/ports.ts` — самодостаточные контракты без импортов
(это тоже проверяет `architecture.test.ts`). Backend-порты описаны в `backend/ports.ts`
(`ChatRepository`/`MatchRepository`/`PlayerRepository`), реализация чата — в
`persistence/chat-repository.ts`.

Правило зависимостей зафиксировано автотестом: любое нарушение слоёв ломает CI.
