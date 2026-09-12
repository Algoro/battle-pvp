# Быстрый старт

## Требования

- Node.js ≥ 23.6 (Docker/CI — 24 LTS; нативный type stripping `.ts` без сборки), npm.
- git с поддержкой сабмодулей.
- Оригинальный ROM Battle City (Japan) — `rom/original/_battle_city.nes`
  (sha1 `941ad7ca825e3f86407472113aad00520cb45783`).
- Docker (опционально) — для запуска «одним контейнером».

Проверка окружения: `bash scripts/verify-environment.sh`.

## Первичная настройка

```bash
# обязателен только jsnes (неизменный эмулятор)
git submodule update --init vendor/jsnes

node scripts/prepare.mjs                  # emulator-core/src, ROM-артефакты, public/rom
```

Справочный дизассемблер (`vendor/nes-disasm`) для сборки и тестов **не нужен**.
При желании подключить его (sparse, только `Battle City`):

```bash
git submodule update --init vendor/nes-disasm
git -C vendor/nes-disasm sparse-checkout set "Battle City"
```

`scripts/prepare.mjs`:
1. генерирует `emulator-core/src` из сабмодуля `vendor/jsnes` (копия никогда не редактируется);
2. копирует оригинальный ROM в `frontend/public/rom/battle_city.nes`;
3. собирает `rom/disasm/_battle_city.nes` = оригинал + патчи `pvp` (эталон для тестов).

Скрипт идемпотентен и безопасен при параллельном запуске.

## Запуск (локально)

```bash
# backend (HTTP + WebSocket, отдаёт собранный фронт из frontend/dist, если он есть)
cd backend && npm install && npm start        # :8080

# frontend в dev-режиме (Vite, HMR)
cd frontend && npm install && npm run dev
```

Backend умеет раздавать SPA из `frontend/dist`. Для прод-подобного запуска без Docker:

```bash
cd frontend && npm run build      # prebuild сам вызовет prepare
cd ../backend && npm start
# http://localhost:8080
```

## Запуск (Docker)

```bash
# положите ROM в rom/original/_battle_city.nes
docker build -t battle-city-pvp .
docker run --rm -p 8080:8080 battle-city-pvp
```

Контейнер: один процесс backend, который раздаёт собранный SPA и обслуживает WS-сигналинг.

## Тесты

```bash
npm install                     # корневые dev-tools (ESLint/Prettier/TS)
npm run lint                    # статический анализ (ESLint, JS+TS)
npm run typecheck               # tsc --noEmit по netcode/backend/emulator-core/frontend

cd emulator-core && npm test
cd netcode       && npm test
cd backend       && npm test
cd qa            && npm test
cd frontend      && npm test

# браузерный e2e
cd qa && npx playwright install chromium && npm run e2e:online
```

Исходники на TypeScript исполняются Node напрямую (type stripping, без сборки);
относительные импорты указывают расширение `.ts`. jsnes (`emulator-core/src`) остаётся
неизменяемым JS.

Прогон CI: `bash scripts/ci.sh` — стадии gate, prepare, lint, typecheck,
emulator-core/netcode/qa/backend-тесты и сборка фронта (ROM-зависимые этапы без ROM
пропускаются). Юнит-тесты фронта (`cd frontend && npm test`) запускаются отдельно —
в `ci.sh` их нет.

## Частые проблемы

- **`vendor/jsnes не найден`** — не инициализирован сабмодуль: `git submodule update --init vendor/jsnes`.
- **`Не найден оригинальный ROM`** — положите файл в `rom/original/` (см. `rom/original/README.md`).
- **Тесты падают на ROM** — отсутствует или неверная ревизия ROM (сверьте sha1).
- **Порт занят** — задайте `PORT` (backend) или порт Vite.
