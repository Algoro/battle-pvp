# Agent-DocWriter — техническая документация

Дата: 2026-08-23
Результат: полный комплект документации в `./docs/` + корневой `README.md`.

## Документы
- **`docs/architecture.md`** — архитектура: слои (frontend/netcode/emulator/backend/rom),
  поток матча, детерминизм, ключевые решения (равноразмерные патчи, backend без Docker,
  WASM-миграция).
- **`docs/asm-label-map.md`** — карта меток ASM: векторы, контроллеры, RNG, enemy-AI
  (+хуки P2), спавн/round-state, HUD, RAM-раскладка, сетевая RAM-зона PvP.
- **`docs/emulator-api.md`** — API ядра `PvPNes`: stepFrame/saveState/loadState/
  getFrameHash/readMem, порты и `ram_net_*`, детерминизм, рендер.
- **`docs/netcode-protocol.md`** — бинарный формат фрейма ввода, пакет hash-check,
  rollback-сессия, транспорты (local/webrtc/relay), backend-сигналинг.
- **`README.md`** — структура, окружение, сборка, тесты, запуск, критерии приёмки.

## Соответствие требованиям (Блок 11)
- Техническая документация архитектуры — `docs/architecture.md`.
- Карта меток ASM — `docs/asm-label-map.md`.
- API эмулятора — `docs/emulator-api.md`.
- Протокол сетевого сообщения (frame format) — `docs/netcode-protocol.md`.

## Полная трассируемость (критерий №6)
- Каждый ASM-патч имеет тест (`rom/tests`, `qa/tests/asm-patch.test.js`).
- Каждый агент имеет отчёт (`reports/agent-*.md`, 11 шт.).
- Каждый компонент имеет README/документацию (root README + docs/ + отчёты).
- Все пути — относительные от корня проекта.
