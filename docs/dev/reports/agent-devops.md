# Agent-DevOps — CI/CD, мониторинг, логирование десинков

Дата: 2026-08-23
Результат: **CI-pipeline полностью зелёный (8/8 этапов PASS)**.

## Что сделано
- **`./scripts/ci.sh`** — локальная CI-оркестрация (замена GitHub CI для окружения
  без CI-хостинга). Гейт → сборка → тесты всех модулей, с постадийным статусом:
  1. `gate:verify-environment` (health-check окружения)
  2. `rom:build+regression` (пересборка ROM + byte-diff-регрессия патчей)
  3. `emulator-core:test` (детерминизм + WASM)
  4. `netcode:test` (rollback, критерий №4)
  5. `backend:test` (rooms/matchmaker/store/интеграция)
  6. `qa:test` (ASM-патчи + sync-mode + нагрузка комнат)
  7. `frontend:build` (tsc --noEmit + vite build)
  8. `wasm:build` (emcc hash.wasm)
  Итог `pass/fail`; при любом fail → exit 1.
- **`.github/workflows/ci.yml`** — GitHub Actions-зеркало того же пайплайна
  (гейт, ROM, модульные тесты, frontend build, emsdk WASM, e2e Playwright).
- **`./scripts/log-desyncs.js`** — мониторинг/логирование десинков rollback:
  прогоняет sync-сессию и пишет JSON-строки в `./reports/desyncs.log`
  (timestamp, converged, desync counts, desyncFrames, hashA/hashB). Exit 1 при
  рассинхроне (можно использовать как health-проба).

## Прогон
```
bash scripts/ci.sh            # полный пайплайн (exit 0 = успех)
node scripts/log-desyncs.js 180 [loss]   # мониторинг десинка
```

## Итоговый прогон
```
[gate:verify-environment] OK
[rom:build+regression]     OK
[emulator-core:test]       OK
[netcode:test]             OK
[backend:test]             OK
[qa:test]                  OK
[frontend:build]           OK
[wasm:build]               OK
CI итог: pass=8 fail=0 → ВСЕ ЭТАПЫ ПРОЙДЕНЫ
```

## Передача управления
**Agent-DocWriter**: задокументировать архитектуру, карту меток, API эмулятора,
протокол netcode, структуру репозитория и сборку (см. `./docs/`).
