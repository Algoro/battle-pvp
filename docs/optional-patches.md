# Опциональные патч-фичи

Механизм, позволяющий включать/выключать игровые ROM-патчи (первый — «пистолет»),
не ломая совместимость netcode и сохраняя детерминизм.

## Модель

- **База** (`patchSet: "pvp"`) — обязательная совместимая основа: ROM-контракт +
  сетевой PvP-патч. Её fingerprint (`94cb0636`) — предмет netcode-совместимости,
  его обменивают при join/matchmaking.
- **Фичи** (`features: ["pistol"]`) — опциональные игровые патчи поверх базы.
  Включаются списком, собираются в ROM детерминированно; fingerprint зависит от набора
  (`pvp` без фич = `94cb0636`, `pvp+pistol` = `d370108f`).
- Набор фич выбирает **хост** в настройках лобби (`features`) или игрок в соло; набор
  передаётся в `match.start` и применяется всеми клиентами **до старта симуляции**,
  поэтому образ у всех одинаков.

## Ядро: реестр и API (`emulator-core/patching/`)

- `registry.js`:
  - `registerPatchSet(name, set)` — именованные базовые наборы (`pvp`, `base`);
  - `registerFeature({ id, title, description, patch })` — опциональные фичи;
  - `canonicalFeatures(list)` — уникальные отсортированные id (детерминизм);
  - `resolvePatchSet(name | descriptor | { base, features })` — собирает набор;
  - `listFeatures()` — метаданные для UI/валидации.
- `applyPatchSet(rom, "pvp")` или `applyPatchSet(rom, { base: "pvp", features: ["pistol"] })`.
  Отчёт содержит `features`, `fingerprint`, `applied`, `routines`.
- Композиция кэшируется неявно (на лету), порядок/дубли фич не влияют на результат.

## Проброс по слоям

| Слой | Что | Где |
|---|---|---|
| Ядро | `opts.features`, `hasFeature()`, `getFeatures()` | `emulator-core/pvp.js` |
| Драйвер | `setPatchFeatures()`, `getPatchFeatures()` | `frontend/src/engine/emulator.ts` |
| Application | `startSolo(..., features)`, `beginOnlineMatch({ features })` | `frontend/src/application/match-controller.ts` |
| Лобби/бэкенд | `settings.features` (валидация `SUPPORTED_FEATURES`) | `backend/domain/features.js`, `domain/lobby.js` |
| Handoff в бой | `match.start.features` | `backend/application/match-lifecycle.ts`, `signaling/relay.ts`, `server.ts` |
| UI | чекбоксы фич + гейт опций (4★ только при `pistol`) | `frontend/src/features.ts`, `components/*` |

`defPistol` (старт с оружием) имеет смысл только при включённой фиче `pistol`; UI
показывает «4★» лишь тогда, а `setStartPistol` — no-op без фичи.

## Инварианты

- **Совместимость**: fingerprint базы проверяется при join (как раньше). Фичи
  применяются после join по host-набору; неизвестная фича → отказ (`PATCH_BAD_SET`).
- **Детерминизм**: набор фич одинаков у всех клиентов матча (host-authoritative);
  новые RAM-байты фич входят в `saveState`/rollback.
- **Слои**: `backend` не импортирует `emulator-core`; списки фич трёх слоёв совпадают —
  стережёт `qa/tests/features.test.ts`.
- **Возврат в лобби** сбрасывает фичи к базе (`MatchController.clear`) — чтобы
  fingerprint для последующих join/quick-match оставался базовым.

## Как добавить новую опциональную фичу

1. `emulator-core/patching/patches/<new>.js` — дескриптор (routines/writes).
2. `registerFeature({ id, title, description, patch })` в `registry.js`.
3. `SUPPORTED_FEATURES.push(id)` в `backend/domain/features.js`.
4. `OPTIONAL_FEATURES.push({...})` в `frontend/src/features.ts`.
5. Гейт JS-эффектов: `if (!this.hasFeature(id)) return;` в `pvp.js`.
6. Тесты: патчинг (fingerprint с фичей ≠ база), headless-поведение, `features.test.ts`
   (совпадение списков), при необходимости — golden-пересбор.
7. Документация: этот файл + `rom-patching.md`.

## Тесты

- `emulator-core/tests/patching.test.ts` — фичи меняют fingerprint; канонизация;
  неизвестная фича отвергается.
- `emulator-core/tests/pistol.test.ts` — фича `pistol` включена (`features: ["pistol"]`).
- `qa/tests/features.test.ts` — списки backend/core/frontend совпадают.
- `qa/golden`, `golden-replay` — база `pvp` (без фич).
