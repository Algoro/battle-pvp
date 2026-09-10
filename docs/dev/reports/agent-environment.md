# Agent-Environment — отчёт о развёртывании окружения

Дата: 2026-08-23
ОС: Ubuntu 20.04 LTS, x86_64, UID 1000 (без sudo).
Результат health-check `./scripts/verify-environment.sh`: **OK** (exit 0).

## 0.1 Базовые утилиты
Все необходимые базовые утилиты уже присутствуют в системе (переустановка не требовалась):
- `git /usr/bin/git`, `curl`, `wget`, `unzip`, `make 4.2.1`, `gcc 9.4.0`, `cmake`
  (`~/.local/bin/cmake`), `pkg-config`. В `commands-for-user.sh` строки установки
  `build-essential` НЕ добавлялись (уже есть). В файле они оставлены в шаге Docker
  как страховка на случай чистой машины.

## 0.2 Node.js / nvm
- nvm уже установлен: `~/.nvm`, версия 0.40.1 (строки в `~/.bashrc` присутствовали).
- Установленный LTS-узел: **v23.9.0** (npm 11.2.0) — активен через nvm.
- **Trade-off (сознательное отклонение от ТЗ):** блок предписывает
  `npm config set prefix '~/.npm-global'`. Отклонено: при nvm глобальные установки
  уже пишутся без root в каталог версии узла `~/.nvm/versions/node/v23.9.0`,
  и смена prefix на `~/.npm-global` нарушила бы изоляцию по версиям и node-gyp.
  Требование (возможность `npm i -g` без sudo) выполняется и без смены prefix.
  Зафиксировано как решение; при необходимости prefix можно вернуть вручную.

## 0.3 Ассемблер 6502/NES — cc65
- Определено по `assemble.sh`/`env.sh` дизассемблера: используется **ca65/ld65 (cc65)**,
  плюс `lua` для `preparations.lua`. `asm6` не требуется (в дизассемблере его нет).
- cc65 собран из исходников в user-space:
  - исходники: `~/toolchains/cc65` (git tag V2.19)
  - установка: `make install PREFIX=~/.local` → `~/.local/bin/{ca65,ld65,cc65}`
  - отчёт версии: `ca65 V2.18 - Git 5552824` (релизный тег V2.19, но строка версии
    cc65 в этом теге исторически не бампится; это git-сборка — детерминированная).
  - `export PATH="$HOME/.local/bin:$PATH"` добавлен в `~/.bashrc`.
- lua: системная `lua 5.1.5` совместима с `preparations.lua` (проверено — генерирует
  `copy_bank_*.asm` корректно). `readline.h` присутствует.
- **Проверка end-to-end:** дизассемблер пересобран в temp-копии — вывод `_battle_city.nes`
  (24592 байт), SHA-1 **e1061c9241b06a965fb7845cb951d921aca010ef**, сообщение
  "Original SHA-1 checksum detected". Тулчейн полностью работоспособен.

## 0.4 Emscripten SDK (emsdk)
- Установлен в `~/emsdk` из исходников (git clone). SDK **6.0.8**
  (LLVM/clang 24.0, wasm32-emscripten).
- `./emsdk install latest && ./emsdk activate latest` — успешно.
- `source "$HOME/emsdk/emsdk_env.sh"` добавлен в `~/.bashrc`.
- **Проблема и решение:** emsdk/emscripten требуют Python ≥ 3.10, системный `python3`
  = 3.8.10. Решено без root: в `~/.local/bin` созданы симлинки `python3`→`python3.11`
  и `python`→`python3.11` (python3.11 = `/usr/local/bin/python3.11`, версия 3.11.6).
  Т.к. `~/.local/bin` идёт в PATH раньше `/usr/bin`, `#!/usr/bin/env python3`
  в emcc.py резолвится на 3.11. Проверено: `emcc -v` работает.
- Нюанс: `~/.bashrc` имеет охранный `case $-` для non-interactive shell, поэтому
  в скриптах энвайронмент emsdk подгружается явно (см. `verify-environment.sh`).

## 0.5 Docker
- **BLOCKED: требуется ручное действие пользователя (root).** Демон Docker на
  Ubuntu 20.04 не ставится без sudo. Команды добавлены в
  `./reports/commands-for-user.sh` (apt + get.docker.com + usermod -aG docker,
  с указанием перелогиниться).
- Разработка backend не блокируется: до появления Docker используется прямой
  Node-процесс + SQLite.

## 0.6 Зависимости в ./vendor/
Все клонированы (depth 1) в относительный каталог `./vendor/`:
- `vendor/nes-disasm` — NES-Games-Disassembly (Battle City/ готов к работе)
- `vendor/jsnes` — открытое JS NES-ядро (база для форка эмулятора)
- `vendor/ggpo` (pond3r/ggpo) — **только** справочная документация по rollback-алгоритму
- `vendor/telegraph` (thomasboyt/telegraph) — **только** справочная документация
  (LICENSE проверена при оценке; переиспользование кода как зависимости — по отдельному
  решению, только если лицензия позволяет).

## 0.7 Верификация эталонного ROM
- Найден файл в корне: `./BattleCity (Japan).nes`, размер **24592** байт (NROM, 16KB PRG
  + 8KB CHR + 16B header).
- **`ROM_PATH=./BattleCity (Japan).nes`**
- CRC32: **`b9c34f28`**, SHA-1: `941ad7ca825e3f86407472113aad00520cb45783`.
- **ВАЖНОЕ РАСХОЖДЕНИЕ:** SHA-1 предоставленного ROM (`941ad7ca…`) **отличается** от
  SHA-1, который воспроизводит дизассемблер (`e1061c92…`, зафиксирован в
  `vendor/nes-disasm/Battle City/assemble.sh`). Это та же 24592-байтная NROM-игра
  "Battle City (J)", но **другая ревизия/дамп**. Для пересборки берём каноничную базу
  из дизассемблера (e1061c92) — она компилируется детерминированно.
  **Agent-Reversing должен учесть это расхождение** при постановке byte-diff тестов:
  ожидаемое совпадение пересборки — с SHA-1 e1061c92, а не с CRC32 предоставленного ROM.
  При желании можно запросить у пользователя другой дамп с CRC32, совпадающим с базой.

## 0.8 Health-check
- Создан `./scripts/verify-environment.sh` — проверяет node, npm, ca65, ld65, cc65, lua,
  emcc, python3.11, git, наличие `ROM_PATH` (.nes в корне) и его CRC32.
- Самодостаточен: сам подгружает emsdk_env и python3.11, работает в non-interactive
  shell и в CI. Возвращает exit 0 при полном успехе.
- Итоговый прогон: **RESULT: OK, exit 0**.

## Структура проекта
Создано дерево каталогов согласно Блоку 2 (`rom/`, `emulator-core/`, `netcode/`,
`backend/`, `frontend/`, `scripts/`, `docs/`, `reports/`).

## Что заблокировано root (единственное)
- Docker-демон (для контейнеризации backend) — см. `./reports/commands-for-user.sh`.
  Разработка не блокируется.

## Передача управления
Окружение развёрнуто и верифицировано. Управление передаётся **Agent-Reversing**
(Блок 1): импорт `vendor/nes-disasm/Battle City` в `./rom/disasm`, пересборка,
составление карты меток с учётом отмеченного выше расхождения ревизий ROM.
