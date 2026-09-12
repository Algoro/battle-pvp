# План миграции JS → TypeScript

Документ описывает переход монорепозитория Battle City PvP с JavaScript на TypeScript
без изменения поведения, детерминизма и инвариантов (jsnes/ROM неизменяемы).

Статус: **выполнено**. Собственный код (`backend`, `netcode`, `emulator-core`, `frontend/src`, `qa`)
на TypeScript (`.ts`/`.tsx`), Node исполняет его через type stripping; ниже сохранён исходный
план. Фактические отличия: `qa/` без `tsconfig.json` (тесты гоняются node напрямую, в
`npm run typecheck` не входят); `draw()`/`cartridgeFingerprint()` — методы `EmulatorDriver`,
а не `PvPNes`; `engines.node` = `>=23.6` (`.nvmrc` = 24).

## 1. Цель и принципы

Цель — весь **собственный** код на TypeScript (`.ts`/`.tsx`), с проверкой типов в CI,
без потери скорости итераций и без build-шага для node-пакетов.

Незыблемые принципы:

1. `vendor/jsnes` и сгенерированный `emulator-core/src` остаются JS без единой правки
   (guard `emulator-core/tests/jsnes-pristine.test.ts` обязан остаться зелёным).
2. Детерминизм: golden-тесты (`golden-replay`, `golden-state`) должны давать те же
   хэши; миграция — рефакторинг типов, а не логики.
3. Каждая фаза — атомарный коммит с зелёным `bash scripts/ci.sh`.
4. Не типизировать «насильно»: там, где тип честно неизвестен (внутренности jsnes,
   сырые RAM-массивы), допускается локальный `any`/`unknown` на границе, но не
   `noImplicitAny: false` и не глобальный `@ts-nocheck`.

## 2. Ключевые технические решения

### 2.1 Runtime: нативный type stripping Node, без сборки

Node 23.6+ выполняет `.ts` напрямую (type stripping включён по умолчанию), в Node 24.12
это стабильная функция. Проверено локально на Node 23.9:

```
$ node mod.ts                 # OK
$ node --disable-warning=ExperimentalWarning --test 'tests/*.test.ts'   # OK
```

Поэтому для `backend`, `netcode`, `emulator-core`, `qa` **не нужен** `tsc`-build:
исходники запускаются как есть, а `tsc --noEmit` используется только для проверки типов.
Это сохраняет текущую модель «нет артефактов сборки, нет dist».

Требования нативного запуска (их проверяет `erasableSyntaxOnly`):

- **никаких `enum`, `namespace` с рантайм-кодом, parameter properties, `import =`**;
- относительные импорты — с **явным расширением `.ts`** (`./foo.ts`);
- типы — только `import type` (`verbatimModuleSyntax`);
- декораторов — нет.

Единственное исключение — `frontend`: он и сейчас работает через Vite/tsc с
extensionless-импортами. Node-тесты фронта уже используют resolve-hook
(`frontend/tests/resolve-ts.mjs`), его сохраняем.

### 2.2 Версии

- **Node**: поднять до **24 LTS** везде — `Dockerfile` (`node:24-slim`), GitHub Actions
  (`node-version: 24`), добавить `.nvmrc` и `engines.node` в корневой `package.json`.
  Local 23.9 тоже совместим.
- **TypeScript**: `^5.9` (нужен ≥5.8 для `erasableSyntaxOnly`). В `frontend` уже 5.9.3.
- **`@types/node`**: `^24`; `@types/ws` для backend; `typescript-eslint` для линта.

### 2.3 Расширения импортов

| Зона | Стиль импорта | Кто резолвит |
|---|---|---|
| `backend/`, `netcode/`, `emulator-core/`, `qa/`, тесты | явное `.ts` | Node (runtime) + tsc (`allowImportingTsExtensions`) |
| `emulator-core/*.ts` → `./src/*.js` (jsnes) | `.js` (как есть) | Node загружает JS; tsc берёт `*.d.ts` или `allowJs` |
| `frontend/src/**` внутри себя | extensionless (как сейчас) | Vite + resolve-hook в тестах |
| `frontend` → `netcode`/`emulator-core` | явное `.ts` | Vite (умеет) + tsc |

### 2.4 Инвентаризация (объём)

| Пакет | JS-файлов (src) | JS-файлов (tests) | ~строк |
|---|---|---|---|
| `netcode` | 9 | 5 | 1 055 |
| `backend` | 15 | 5 | 1 640 |
| `emulator-core` | 83 (вкл. `sim` 7) | 31 | 19 409 |
| `qa` | 5 | 9 | 247 + тесты |
| `frontend` | 2 (tests) | — | уже TS (17 ts/tsx) |
| `scripts` | 2 `.mjs` | — | импортируют core |
| **Итого** | | | **~29 000** |

Самые крупные точки: `emulator-core/sim/battle.js` (1001), `emulator-core/pvp.ts` (842),
`ai/tactical-ai.ts` (565), `ai/defender-strategy.ts` (510), `backend/signaling/relay.ts` (466),
`netcode/rollback/session.ts` (450).

## 3. Инфраструктура типов

### 3.1 Корневой `tsconfig.base.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "moduleDetection": "force",
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useDefineForClassFields": true,
    "types": ["node"]
  }
}
```

`noEmit: true` обязателен вместе с `allowImportingTsExtensions` — сборки нет.
`noUncheckedIndexedAccess` и `exactOptionalPropertyTypes` **не включаем** на первом проходе
(слишком много шума в числовом коде ядра); можно добавить точечно для `netcode`/`backend`
после стабилизации.

### 3.2 `tsconfig.json` по пакетам

`netcode/`, `backend/` (и отдельно `emulator-core/`, `frontend/`; у `qa/` своего
`tsconfig.json` нет — тесты исполняются node через type stripping):

```jsonc
{
  "extends": "../tsconfig.base.json",
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

`emulator-core/tsconfig.json` — с `allowJs` только для резолва неизменяемых jsnes-модулей
(у `ppu/index.js`, `papu/index.js`, `rom.js` нет `.d.ts`):

```jsonc
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "allowJs": true, "checkJs": false },
  "include": ["**/*.ts", "src/**/*.js"],
  "exclude": ["node_modules"]
}
```

`allowJs + checkJs:false` даёт: `nes.js` типизируется своим `nes.d.ts`; `ppu/papu/rom`
попадают в программу как слабо типизированные, отчего `extends PPU`/`extends PAPU`
компилируется. Отдельный ручной `.d.ts` для внутренностей jsnes — опционально (см. §5.1).

`frontend/tsconfig.json` — правки после перевода core/netcode:

```jsonc
{
  "compilerOptions": {
    /* как сейчас, но */
    "allowImportingTsExtensions": true,
    "allowJs": false,                 // src на JS больше нет
    "verbatimModuleSyntax": true
  },
  "include": ["src"],                 // убрать ../emulator-core/**/*.js и ../netcode/**/*.js
}
```

### 3.3 Пакетные скрипты

```jsonc
// netcode/package.json
"scripts": {
  "test": "node ../scripts/prepare.mjs && node --disable-warning=ExperimentalWarning --test tests/*.test.ts",
  "typecheck": "tsc --noEmit"
}
```

Аналогично `backend` (без `prepare`), `emulator-core`, `qa`.
Корневой `package.json`:

```jsonc
"scripts": {
  "lint": "eslint .",
  "typecheck": "tsc -p netcode && tsc -p backend && tsc -p emulator-core && tsc -p frontend"
}
```

### 3.4 ESLint

- Убрать `**/*.ts` и `**/*.tsx` из `ignores` в `eslint.config.mjs`.
- Добавить `typescript-eslint` (flat preset `recommended`, без type-aware — типы проверяет `tsc`).
- `.mjs` (scripts) и jsnes (`**/src/**`) оставить на текущем JS-конфиге.

`scripts/ci.sh` и `.github/workflows/ci.yml` получают отдельный stage `typecheck`.

## 4. Целевая типизация по слоям

### 4.1 Порты

- `netcode/ports.ts`: `export interface GameCore`, `Transport`, `Clock`, `EventSink`,
  `Logger`; `export type Input = { port: number; buttons: number }`; `systemClock`.
  JSDoc-typedef из `netcode/ports.ts` становится интерфейсами, `export {}`-заглушка уходит.
- `backend/ports.ts`: `ChatRepository`, `MatchRepository`, `PlayerRepository`, `Clock`.
  Интерфейсы, рантайм-кода нет (как и сейчас).
- `frontend/src/ports.ts` уже TS — только подтянуть общие типы (`Input`, `Team`).

### 4.2 Бинарный протокол (`netcode/protocol/frame.ts`)

Ввести discriminated union:

```ts
export type DecodedPacket =
  | { type: "input"; frame: number; inputs: Input[] }
  | { type: "batch"; headFrame: number; entries: InputEntry[] }
  | { type: "hash"; frame: number; hash: number }
  | { type: "ping"; seq: number; t: number }
  | { type: "pong"; seq: number; t: number }
  | { type: "snapReq"; frame: number }
  | { type: "snap"; frame: number; hash: number; seq: number; total: number; data: Uint8Array };
```

`decode*` возвращают `DecodedPacket | null`. `PKT` остаётся объектом-константой
(`as const`) — **не `enum`**.

### 4.3 Эмулятор

- `pvp.ts` — публичная поверхность (`PvPNes`): `stepFrame(inputs)`, `saveState()`,
  `loadState(bytes)`, `getFrameHash()`, `readMem(addr)`, `setStartStage`, `setStartStars`,
  `setStartPistol`, `setHumanTank`, `setHumanDefTank`, `tdOrder`, `getTowerDefence`,
  `getStage/getStageBlocks/getStageCount`, `getBlockTiles/getBlockAttribute`. Отпечаток —
  `patching.fingerprint`; `draw()`/`cartridgeFingerprint()` — на `EmulatorDriver`.
  Внутренние поля (`cpu`, `ppu`, `papu`, `mmap`) — по типам jsnes где возможно.
- `ppu-ext.ts` / `papu-ext.ts` — `extends PPU`/`extends PAPU`; переопределения
  аннотируются явно; доступ к неописанным полям — через точечный `any` на границе.
- `domain.ts`, `rom-contract.ts`, `startup.ts`, `io/*`, `patching/*` — полностью
  типизируются (чистые функции, `Uint8Array`, `DataView`).
- `model/*`, `ai/*` — типизируются; RAM читается как `Uint8Array`.
- `sim/*` — тест-онли JS-порт правил ROM (7 файлов, `battle.js` 1001 строка).
  Переводится последним, т.к. это числовая копия; при большом сопротивлении допустимы
  локальные `any` для массивов, но не `@ts-nocheck`.

### 4.4 Backend

- `node:sqlite` (`DatabaseSync`) — типы из `@types/node@24`.
- `ws` (`WebSocketServer`) — `@types/ws`.
- `server.ts` — `http`, `fs`, `path`, статика; сигнатуры use cases берутся из `domain/`.
- `application/*` остаётся без I/O (правило архитектуры сохраняется).

## 5. Границы и «сложные» типы

### 5.1 jsnes

- Используем готовые `vendor/jsnes/src/{nes,controller,gamegenie,browser}.d.ts`.
- `nes.d.ts` — immutable, не правим (лежит и в `src`). Дополнительные поля, которые
  использует наш код (`nes.opts.noRender`, `onAudioSampleGroup`), оборачиваем локальным
  типом:

  ```ts
  type BattleNesOpts = {
    noRender?: boolean;
    onAudioSample?: (l: number, r: number) => void;
    onAudioSampleGroup?: (group: "music" | "sfx", l: number, r: number) => void;
  };
  const opts = this.nes.opts as unknown as BattleNesOpts;
  ```

- Если понадобится типизировать `PPU/PAPU/ROM` сильнее — добавить вне
  `emulator-core/src` файл `emulator-core/jsnes-internals.d.ts` с ambient-объявлениями
  (`declare module "*/src/ppu/index.js" { ... }`). Это опциональный шаг; начинаем с
  `allowJs`.

### 5.2 Числовые/бинарные модули

`state-codec.ts`, `frame.ts`, `sim/*`: `Uint8Array`, `DataView`, `number[]`; индексация
без `noUncheckedIndexedAccess`, чтобы не плодить `!`.

### 5.3 Тесты

Тесты переводятся в `.ts` и типизируются (включая хелперы `qa/tests/test-utils.ts`).
Тестовые фейки (`fakeEmu`, `fakeGateway`) — через интерфейсы портов, что заодно
укрепляет контракт.

## 6. Пофазный план

Каждая фаза — отдельный коммит; после каждой `bash scripts/ci.sh` зелёный.

### Фаза 0. Инфраструктура (без изменения исходников)

- Поднять Node: `Dockerfile` → `node:24-slim` (обе стадии), `.github/workflows/ci.yml`
  → `node-version: 24`, добавить `.nvmrc` (24) и `engines.node >= 23.6` (фактически в `package.json`).
- Добавить `tsconfig.base.json`, `typescript@^5.9`, `@types/node@^24`,
  `typescript-eslint@^8` в корень.
- Обновить `eslint.config.mjs` (снять игнор `.ts`, подключить ts-eslint).
- Добавить в `scripts/ci.sh`/CI отдельный stage `typecheck` (пока пустой — нет `.ts` в
  пакетах, кроме frontend).
- **Проверка**: `ci.sh` зелёный, поведение не изменилось.

### Фаза 1. `netcode/` (пилот, ~1 055 строк)

Почему первым: маленький, чистые порты, нет jsnes, от него зависит frontend.

- `ports.ts → ports.ts` (интерфейсы + `systemClock`).
- `protocol/frame.ts → .ts` (типы пакетов, discriminated union).
- `rollback/session.js → .ts`, `transport/{transport,local,relay,webrtc,multi}.js → .ts`,
  `index.js → index.ts`.
- Все относительные импорты — на `.ts`.
- `tests/*.test.ts → .test.ts`, добавить `tsconfig.json` + `typecheck`.
- `frontend/src/engine/{net,lobby-client}.ts`: импорты `netcode/**.js` → `.ts`;
  удалить соответствующие строки из `frontend/src/engine/js-modules.d.ts`.
- Vite-alias (`^\.\.\/\.\.\/netcode`) уже матчит по префиксу — правок не требует.
- **Проверка**: `netcode npm test` (19/19), `tsc -p netcode`, frontend build.

### Фаза 2. `backend/` (~1 640 строк)

- `domain/*.js` (7) → `.ts` — чистые правила, JSDoc-typedef → интерфейсы.
- `ports.ts → .ts`.
- `application/{match-lifecycle,chat}.js → .ts`.
- `signaling/{relay,schema}.js → .ts` (schema — типы сообщений).
- `persistence/{store,chat-repository}.js → .ts` (`node:sqlite`, `@types/node`).
- `server.ts → server.ts`; `backend/package.json` `main`/`start`; `Dockerfile` CMD
  `node server.ts`; в runtime-stage ничего лишнего не нужно (type stripping в Node 24).
- `tests/*.test.ts → .test.ts`; добавить `tsconfig.json`, `@types/ws`.
- **Проверка**: backend 39/39, `tsc -p backend`, e2e доходят (лобби/чат).

### Фаза 3. `emulator-core/` (~19 400 строк) — разбить на подфазы

| Подфаза | Содержимое | Риск |
|---|---|---|
| 3a. Чистое ядро | `rom-contract`, `domain`, `startup`, `io/*`, `patching/*` (apply/descriptor/errors/index/linker/registry/rom-image/patches) | низкий |
| 3b. Адаптеры jsnes | `ppu-ext`, `papu-ext`, `pvp` + `allowJs` и типы границы | **высокий** |
| 3c. Модель/ИИ | `model/*`, `ai/*` (tactical, defender, attacker, scan, lookahead, rollforward, brain-runner) | средний |
| 3d. `sim/*` (тест-онли) | `battle`, `cycle`, `engine`, `observer`, `ram-addr`, `sim-model`, `tables` | средний |
| 3e. Тесты | `tests/*.test.ts → .test.ts`; обновить `no-magic-addresses.test.ts`; `jsnes-pristine` не трогать | средний |

Детали:

- 3a: `rom-contract` и `domain` обязаны остаться без внешних импортов (проверяет
  architecture-тест). `patching/patches/*` — типы `ApplyResult`/`PatchError`.
- 3b: `pvp.ts` — 842 строки, самый ответственный. Публичные методы аннотировать;
  внутренние `_beamFx`/`_renderBeamFx` не завязаны на сеть/hash (см. handoff §2).
- 3e: в `emulator-core/tests/no-magic-addresses.test.ts` заменить
  `name.endsWith(".js")` → `".ts"` и `SKIP_FILES` на `.ts`-имена
  (`rom-contract.ts`, `domain.ts`, `startup.ts`, `fine-grid.ts`).
- После 3b: `frontend/src/engine/emulator.ts` импорт `pvp.ts`, удалить `*pvp.ts` из
  `js-modules.d.ts`; `scripts/prepare.mjs` и `scripts/extract-patches.mjs` импорт
  `../emulator-core/patching/apply.ts` → `.ts`; `qa/tests/test-utils.js` — то же.
- **Проверка на 3b/3e**: `emulator-core npm test` 234/234, golden/determinism/pistol
  без изменений хэшей, `tsc -p emulator-core`.

### Фаза 4. `qa/` (~250 строк + тесты) и Playwright

- `tests/*.js → .ts`, `test-utils.js → test-utils.ts`.
- `qa/tests/architecture.test.ts → .ts`: фильтры `p.endsWith(".js")` → `".ts"`,
  пути `session.js`/`ports.ts`/`rom-contract.ts` → `.ts`, секция frontend уже `.ts`.
- `sync-mode.js → .ts`, `golden-state.js → .ts`, `followhq.mjs` — при желании `.mts`
  (или оставить `.mjs`, он запускаемый скрипт).
- `e2e/*.spec.js → .spec.ts`, `playwright*.config.js → .ts` (Playwright транспилирует TS).
- Обновить `scripts/ci.sh` и `qa/package.json` на `tests/*.test.ts`.
- **Проверка**: qa 42/42, `e2e:online` 2/2.

### Фаза 5. `frontend/` — зачистка

- `tsconfig.json`: `allowJs: false`, `include: ["src"]`,
  `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`.
- Удалить `frontend/src/engine/js-modules.d.ts` (JS-модулей больше нет).
- Развязать `any` в `App.tsx`/`engine/*`, которые были из-за нетипизированных JS-импортов.
- Опционально: перевести `frontend/tests/*.js → .ts`; resolve-hook
  (`resolve-ts.mjs`) сохранить, он легитимен из-за extensionless-импортов Vite.
- **Проверка**: `tsc --noEmit`, `vite build`, frontend tests 7/7.

### Фаза 6. Enforcement и документация

- Новый тест в `qa/tests/architecture.test.ts`: в `backend`, `netcode`,
  `emulator-core` (кроме `src`), `qa`, `frontend/src` **нет** исходных `.js`
  (исключения: `vendor/**`, `emulator-core/src/**`, `scripts/*.mjs`). Это фиксирует
  миграцию и запрещает откат.
- Правило «порты без импортов» расширить на `netcode/ports.ts` и `backend/ports.ts`
  (сейчас проверяются `netcode/ports.ts` и `frontend/src/ports.ts`).
- Обновить `docs/architecture.md`, `docs/getting-started.md`, `README.md`, `handoff.md`
  (новые команды `npm run typecheck`, версия Node, расширения импортов).
- **Проверка**: полный `ci.sh` + e2e + docker build/run.

## 7. Изменения в тестовой инфраструктуре (сводка)

| Файл | Что меняется |
|---|---|
| `emulator-core/tests/jsnes-pristine.test.ts` | **не меняется** (сравнивает `src` с vendor); остаётся `.js` или переводится в `.ts` без изменения логики |
| `emulator-core/tests/no-magic-addresses.test.ts` | фильтр расширений и `SKIP_FILES` → `.ts` |
| `qa/tests/architecture.test.ts` | фильтры `.js`→`.ts`, пути `session.ts`/`ports.ts`/`rom-contract.ts`, + новый тест «нет `.js`» |
| `qa/tests/features.test.ts` | импорты `backend/.../features.ts`, `emulator-core/.../registry.ts` |
| `frontend/tests/resolve-ts.mjs` | сохраняется (extensionless в `frontend/src`) |
| `scripts/ci.sh` | стадии на `.test.ts`, новый stage `typecheck` |

## 8. Риски и меры

| Риск | Вероятность | Мера |
|---|---|---|
| Несовместимость native strip-types с окружением | низкая | Node 24 LTS, `engines`, `--disable-warning`; fallback — компиляция `tsc` в `dist` (см. альтернативу) |
| Сопротивление типизации внутренностей jsnes | средняя | `allowJs`/точечный `any` на границе, не менять jsnes |
| Смена поведения при переводе `pvp.ts`/`sim` | средняя | golden/determinism-тесты как страховка; рефакторинг только синтаксиса, по коммитам |
| Тихо сломать архитектурные тесты (сканируют исходники) | высокая | обновлять их в том же коммите, что и переименование |
| Рост времени линта (type-aware) | низкая | ts-eslint `recommended` без type-aware; типы — `tsc` |
| Ломается frontend из-за `.ts`-импортов | низкая | Vite+alias уже поддерживают; проверять `vite build` в фазе 1 |
| TS-типы `node:sqlite`/`ws` неполные | низкая | `@types/node@24`, `@types/ws`; локальные алиасы |

### Альтернатива (fallback), если native runtime не подойдёт

Компилировать `backend`/`netcode`/`emulator-core` через `tsc` в `dist/*.js`, а тесты
запускать из `dist`. Тогда `allowImportingTsExtensions` и `erasableSyntaxOnly` не нужны,
доступен полный TS-синтаксис, но появляется build-шаг, `dist` в Docker/CI и правки
`jsnes-pristine` (исключить `dist`). Это дороже и ломает текущую беспроцессную модель,
поэтому выбирается только при реальном блоке.

## 9. Оценка

| Фаза | Состав | Оценка |
|---|---|---|
| 0 | инфраструктура (Node/TS/eslint/CI) | 0.5 дня |
| 1 | netcode | 1 день |
| 2 | backend | 1.5 дня |
| 3a | чистое ядро | 1.5 дня |
| 3b | pvp + jsnes-адаптеры | 2 дня |
| 3c | model/ai | 2 дня |
| 3d | sim | 1.5 дня |
| 3e | тесты ядра | 1 день |
| 4 | qa + e2e | 1 день |
| 5 | frontend зачистка | 1 день |
| 6 | enforcement + доки | 0.5 дня |
| | **Итого** | **~13–15 рабочих дней** |

Оценка без учёта возможных «засадных» мест в `pvp` и `sim`; при них +2–3 дня.

## 10. Definition of Done

- В `backend`, `netcode`, `emulator-core` (кроме `src`), `qa`, `frontend/src` нет
  исходных `.js`; остались только `.ts`/`.tsx` (+ `.d.ts`).
- `vendor/jsnes` и `emulator-core/src` не изменены; `jsnes-pristine` зелёный.
- `npm run typecheck` (все пакеты) и `npm run lint` — без ошибок.
- `bash scripts/ci.sh` — 8/8 + новый stage `typecheck`; e2e 2/2.
- Golden/determinism-хэши совпадают с состоянием до миграции.
- Docker `node:24-slim` собирается и запускается (`node server.ts`).
- CI (GitHub) на Node 24 зелёный; `handoff.md` и docs обновлены.
