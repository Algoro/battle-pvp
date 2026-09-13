> 🌐 **English** · [Русский](../architecture-clean.md)

# Clean architecture: target model

This document describes the ideal (clean) architecture of Battle City PvP. The main principle is the **dependency rule**: inner layers do not know
about outer ones; all connections go through ports (interfaces) implemented by adapters.

## 1. Project specifics

Game rules (collisions, enemy AI, physics) live **in the original ROM** and are executed by
the jsnes emulator. This is a deliberate constraint: we do not move the rules into code. Therefore
"entities" in the classical sense are not physics but the **domain of match/lobby/network
synchronization**, and the emulator is a *framework/driver* behind the `GameCore` port.

```
        ┌────────────────────────────────────────────────────────────┐
        │ Frameworks & Drivers (outer layer, replaceable)             │
        │  jsnes, WebRTC, WebSocket, React, Vite, SQLite, Audio, DOM  │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ implement ports           │ manage
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Interface Adapters (converting I/O <-> use cases)           │
        │  WS routers, React hooks/components, transport adapters,    │
        │  repositories (SQLite), presenters (HUD, lobby, chat)       │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ call                      │ read
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Application / Use Cases (scenarios, no I/O)                 │
        │  CreateLobby, JoinLobby, StartMatch, FinishMatch,           │
        │  SendChat, Reconnect, RebindTransport, RequestResync,       │
        │  SelectStage, SetDefenderStars, EnterSpectate               │
        └───────────────▲───────────────────────────┬────────────────┘
                        │ depend only on            │
        ┌───────────────┴───────────────────────────▼────────────────┐
        │ Domain (entities and rules, zero dependencies)              │
        │  Match, Room, Lobby, Player, ChatMessage, StageSpec,        │
        │  CartridgeFingerprint, RollbackPolicy, InputFrame, ports    │
        └────────────────────────────────────────────────────────────┘
```

## 2. Layers and ports

### Domain (`*/domain/`)
- Entities: `Match`, `Room`, `Lobby`, `Player`, `ChatMessage`, `StageSpec`, `InputFrame`,
  `RollbackPolicy`, `CartridgeFingerprint`.
- No imports of jsnes/ws/react/fs. Only pure functions and invariants.

### Application (`*/application/`)
- Use cases orchestrating the domain through ports: `startMatch`, `finishMatch`,
  `createLobby`, `joinLobby`, `sendChat`, `reconnect`, `rebindTransport`, `requestResync`.
- Return a result/DTO; they do **not** write to sockets/DB directly — adapters do that.

### Ports (`netcode/ports.ts`, `backend/ports.ts`, `frontend/src/ports.ts`)
- `GameCore`: `stepFrame`, `saveState`, `loadState`, `getFrameHash`, `setStartStage`,
  `setStartStars`, `setAudioSuppressed`, `cartridgeFingerprint`.
- `Transport`: `send`, `onMessage`, `onClose`, `isOpen`.
- `Clock`: `now()` — determinizable time for ping/pong (injection).
- `EventSink`: `emit(event)`.
- `Logger`: `warn`, `error`.
- `RoomRepository`, `ChatRepository`, `PlayerRepository` — state storage.
- `SignalingPort` (sending SDP/ICE/relay.data), `ChatPort`.

### Interface Adapters
- Backend: WS router (`signaling/relay.ts`) → calls use cases; SQLite repositories;
  signaling adapter.
- Frontend: React hooks (`use-lobby`) and components → call gateway clients
  (`LobbyClient`, `NetClient`) and `EmulatorDriver` (the `GameCore` adapter).
- Netcode: `RollbackSession` depends only on the ports `GameCore`/`Transport`/`Clock`/`EventSink`.

### Frameworks & Drivers
- jsnes (immutable submodule), WebRTC, WebSocket/ws, React/Vite, SQLite, Web Audio, DOM.

## 3. Dependency rule (enforcement)

The automated test `qa/tests/architecture.test.ts` checks:
1. `emulator-core/rom-contract.ts` and `emulator-core/domain.ts` are pure (depend only on each other).
2. `netcode/**` does not import `emulator-core/**`, `frontend/**`, `backend/**`.
3. `backend/**` does not import `emulator-core/**`, `frontend/**`.
4. `frontend/**` does not import `backend/**` directly (only over the network).

Violating the rule fails CI (like `no-magic-addresses`).

## 4. Target layout

```
netcode/ports.ts   netcode ports (GameCore/Transport/Clock/EventSink) — no imports
netcode/rollback/  RollbackSession (application core on top of ports)
emulator-core/     GameCore adapter (PvPNes, patching, domain helpers)
backend/
  domain/          teams/room/lobby/matchmaker/chat — pure rules (no I/O)
  ports.ts         contracts (ChatRepository/MatchRepository/PlayerRepository)
  application/     use cases: match-lifecycle.ts, chat.ts (no I/O)
  signaling/       WS adapter (thin router) + schema.ts
  persistence/     SQLite adapters (store.ts, chat-repository.ts)
frontend/src/
  ports.ts         frontend ports (GameCore/Transport/Clock/EventSink/MatchGateway) — no imports
  engine/          gateway adapters (LobbyClient/NetClient/EmulatorDriver/AudioOutput)
  application/     controllers (use-match/use-spectate/use-lobby, MatchController)
  components/      presenters (lobby, HUD, chat) — no network
  App.tsx          composition root: screen routing only
```

## 5. Test strategy

- Golden/determinism (`golden-replay`, `patching`, `domain`) — core contract, do not change.
- Use cases — unit tests with fake ports (in-memory repositories, fake Clock/Transport).
- Architecture test — the dependency rule.
- E2E — end-to-end scenario (lobby→match→chat→spectator).

## 6. What we do not move

- Game rules in code — they remain in the ROM (executed by jsnes). This is not "dirty"
  architecture but a deliberate boundary: ROM+jsnes = an external driver behind the `GameCore` port.
- jsnes is not edited (immutable), ROM patching is an adapter in `emulator-core/patching`.

## 7. Current state

| Area | State |
|---|---|
| Netcode ports (`ports.ts`, Clock/Logger) | ✅ done: `RollbackSession` takes time from the `Clock` port |
| Enforcement (dependency rule) | ✅ `qa/tests/architecture.test.ts` (19 checks: layers, feature-agnostic core, `shared/tower-defence.ts` without imports, rendering) |
| Backend application (match/chat use cases) | ✅ `backend/application/{match-lifecycle,chat}.ts`; relay/HTTP — thin adapters |
| Frontend application (controllers) | ✅ `frontend/src/application/{use-lobby,use-match,use-spectate}.ts` + `MatchController`; `App.tsx` — screen composition |
| Domain entities (Room/Lobby/Matchmaker/Chat) | ✅ `backend/domain/` (pure classes), SQLite behind the `ChatRepository` port |
| `GameCore` port | ✅ contract in `netcode/ports.ts`; test `game-core-port.test.ts` on a fake core |
| Full set (zero violations) | ✅ `architecture.test.ts` guards the domain←application←adapters layers and frontend engine←application←components |

`netcode/ports.ts` and `frontend/src/ports.ts` are self-contained contracts without imports
(`architecture.test.ts` also checks this). Backend ports are described in `backend/ports.ts`
(`ChatRepository`/`MatchRepository`/`PlayerRepository`), the chat implementation is in
`persistence/chat-repository.ts`.

The dependency rule is fixed by an automated test: any layer violation breaks CI.
