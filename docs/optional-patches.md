# Опциональные патч-фичи

Механизм, позволяющий включать/выключать игровые ROM-патчи («пистолет»,
«враги берут призы»), не ломая совместимость netcode и сохраняя детерминизм.

## Модель

- **База** (`patchSet: "pvp"`) — обязательная совместимая основа: ROM-контракт +
  сетевой PvP-патч. Её fingerprint (`94cb0636`) — предмет netcode-совместимости,
  его обменивают при join/matchmaking.
- **Фичи** (`features: ["pistol"]`) — опциональные игровые патчи поверх базы.
  Включаются списком, собираются в ROM детерминированно; fingerprint зависит от ROM-части
  набора: `pvp` без фич = `94cb0636`, `pvp+pistol` = `d370108f`, `pvp+enemy-prizes` = `b1940f80`,
  `pvp+pistol+enemy-prizes` = `0f0d445d`. Фичи, реализованные только JS-рантаймом
  (`friendly-fire-def`, `friendly-fire-att`), ROM не меняют — их fingerprint совпадает с
  базой, а совместимость обеспечивается списком фич (неизвестная фича отвергается).

Фича = ROM-дескриптор (`patching/patches/*`) + опциональный JS-рантайм
(`features/*`, `FeatureRuntime`), который ядро вызывает вокруг ROM-кадра
(`preFrame → frame() → postFrame → render`). Рантаймы не зависят от `pvp.ts`,
авторитетное состояние держат в RAM (rollback), визуал — в `ctx.state`. Производный
визуал (например, nametable-overlay имён) снимается хуками `beforeSaveState` и
возвращается `afterSaveState`, чтобы не попадать в снапшот/rollback.
- Набор фич выбирает **хост** в настройках лобби (`features`) или игрок в соло; набор
  передаётся в `match.start` и применяется всеми клиентами **до старта симуляции**,
  поэтому образ у всех одинаков.

## Ядро: реестр и API (`emulator-core/patching/`)

- `registry.ts`:
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
| Ядро | `opts.features`, `hasFeature()`, `getFeatures()` | `emulator-core/pvp.ts` |
| Драйвер | `setPatchFeatures()`, `getPatchFeatures()` | `frontend/src/engine/emulator.ts` |
| Application | `startSolo(..., features)`, `beginOnlineMatch({ features })` | `frontend/src/application/match-controller.ts` |
| Лобби/бэкенд | `settings.features` (валидация `SUPPORTED_FEATURES`) | `backend/domain/features.ts`, `domain/lobby.ts` |
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

Метаданные фич (`id/title/description`) живут в едином манифесте **`shared/features.ts`**.
Из него автоматически выводятся UI-чекбоксы (`frontend OPTIONAL_FEATURES`) и валидация
бэкенда (`backend SUPPORTED_FEATURES`) — править UI/backend не нужно. Реестр патчей
сверяется с манифестом на старте (`assertFeaturesConsistent`).

1. `emulator-core/patching/patches/<new>.ts` — ROM-дескриптор (routines/writes/free или пустой).
2. `emulator-core/features/<new>.ts` — JS-рантайм (`FeatureRuntime`), если нужен.
3. `registerFeature({ id, patch, runtime? })` в `registry.ts` — только проводка.
4. Строка в `shared/features.ts` (`FEATURE_MANIFEST`).
5. Гейт JS-эффектов — рантайм присутствует только у активной фичи (`hasFeature` не нужен).
6. Тесты: патчинг (fingerprint, если ROM меняется), headless-поведение,
   согласованность манифеста/реестра (`qa/tests/features.test.ts`, `architecture.test.ts`).
7. Документация: этот файл + `rom-patching.md`.

## Тесты

- `emulator-core/tests/patching.test.ts` — фичи меняют fingerprint; канонизация;
  неизвестная фича отвергается.
- `emulator-core/tests/pistol.test.ts` — фича `pistol` включена (`features: ["pistol"]`).
- `emulator-core/tests/enemy-prizes.test.ts` — `enemy-prizes`: враг забирает приз и
  получает эффект (clock/shovel/grenade/tank/star/pistol), без фичи — нет; игрок
  подбирает как раньше; комбинация с `pistol` собирается без перекрытий.
- `emulator-core/tests/friendly-fire.test.ts` — `friendly-fire-def` (свой убивает своего)
  и `friendly-fire-att` (урон союзнику с бронёй и выпадением приза), без фич — нет.
- `emulator-core/tests/player-names.test.ts` — имя над танком (глифы/центровка/движение),
  нет имён/фичи — ничего, хэш не меняется, overlay не попадает в `saveState`.
- `emulator-core/tests/pacman.test.ts` — режим `pacman`: ROM-лабиринт (стадия 1), замуровка
  базы бетоном, точки/сбор DEF-танками, счётчик, победа по зачистке, бомбы-призы; без фичи —
  обычный Battle City.
- `qa/tests/architecture.test.ts` — рантаймы `features/**` не зависят от `pvp.ts` и
  детерминированы (без `Date.now/performance.now/Math.random`).
- `qa/tests/features.test.ts` — списки backend/core/frontend совпадают.
- `qa/golden`, `golden-replay` — база `pvp` (без фич).

## Tower Defence (соло-режим)

Фича `tower-defence` (`hidden: true` — включается не чекбоксом, а кнопкой
«Tower Defence» в лобби):

- **ROM-часть** (`patches/tower-defence.ts`): пишет 3 TD-карты в стадии 1..3
  (геометрия — `shared/tower-defence.ts`, упаковка 91 байт) и хукает завершение
  стадии `sub_C728` рутиной `sub_td_stage_end_check` в свободной зоне `$FF50..$FFF9`.
  Пока `TD_STATE != 0`, стадия не завершается по `enemies_left == 0` (волнами рулит
  рантайм); поражение (base destroyed) проходит всегда.
- **RAM**: `RAM.TD_STATE` (`0x01FF`) — фаза: 0 off, 1 BUILD, 2 WAVE, 3 INTERMISSION,
  4 VICTORY, 5 DEFEAT. Остальное состояние TD — `ctx.state` (соло, rollback не нужен).
- **JS-рантайм** (`features/tower-defence.ts`): экономика (очки за убийства),
  расстановка (`configure/place/sell/upgrade/startWave` через `PvPNes.featureCommand(id, order)`),
  таргетинг/снаряды, урон по башням, волны, победа/поражение. Снимок для UI —
  `PvPNes.getFeatureState(id)`. Ядро при этом не знает конкретных фич — канал обобщённый.
- **Общий урон**: `features/enemy-damage.ts` (броня/приз/смерть) используется и
  friendly-fire, и башнями.
- **Рендер**: 2D — блендинг спрайтов танка/пуль прямо в пиксельный буфер PPU (render-хук); 3D (`topdown-3d`/`mc-voxel`) —
  башни из `SceneState.towers` как неподвижные DEF-танки (звёзды = уровень).
- **Типы врагов**: `TD_WAVES[].types` — очередь `ram_tank_type` по порядку спавна
  (базовый/быстрая пуля/быстрый/бронированный); рантайм переопределяет тип на спавне.

Ограничение: TD — только соло; `saveState/loadState` в TD не поддерживаются;
HP базы не добавлен (база выдерживает одно попадание, как в оригинале).
