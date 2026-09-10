# Сторонние компоненты

## jsnes — `vendor/jsnes` (git-сабмодуль)
- Источник: https://github.com/bfirsh/jsnes
- Лицензия: Apache-2.0 (см. `vendor/jsnes/LICENSE`)
- Используется **без изменений**. Наш код подключает его через подклассы
  (`PvPNes extends NES`, `BattleCityPPU extends PPU`) и собственные модули.
- Копия `emulator-core/src` генерируется из сабмодуля (`scripts/prepare.mjs`) и не редактируется.

## ROM Battle City
- Оригинальный ROM (`Battle City (Japan)`, NROM) **не входит в репозиторий**.
- Пользователь предоставляет его самостоятельно: `rom/original/_battle_city.nes`
  (sha1 `941ad7ca825e3f86407472113aad00520cb45783`).
- PvP-логика добавляется патчами **только в памяти** процесса; файл ROM не изменяется.

## Прочее
- Node.js, React, Vite, `ws` — согласно их лицензиям (MIT/Apache-2.0).
