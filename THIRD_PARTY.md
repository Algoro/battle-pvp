# Лицензии и сторонние компоненты

## Проект
Код Battle City PvP распространяется под **Apache License 2.0** (см. `LICENSE`, `NOTICE`).
Поле `license` во всех `package.json` — `Apache-2.0`.

## Сабмодули

### `vendor/jsnes` — jsnes (Apache-2.0)
- https://github.com/bfirsh/jsnes
- Используется **без изменений**. Наш код оборачивает его (`PvPNes extends NES`,
  `BattleCityPPU extends PPU`); `emulator-core/src` генерируется из сабмодуля.
- При распространении сборки (frontend bundle) сохраняются уведомления Apache-2.0:
  `LICENSE`, `NOTICE`, `frontend/public/THIRD_PARTY.txt` (попадает в `dist`).

### `vendor/nes-disasm` — NES-Games-Disassembly
- https://github.com/cyneprepou4uk/NES-Games-Disassembly
- **Лицензия не указана** (все права у автора). Поэтому содержимое этого репозитория
  **не перепубликуется** в нашем: подключено сабмодулем (sparse, только `Battle City`)
  как справочный материал. Пользователь получает его из первоисточника на его условиях.
- Наши патч-дескрипторы (`emulator-core/patching/`) не содержат дизассемблера.

## ROM Battle City
- Оригинальный ROM **не входит** в репозиторий и не распространяется.
- Пользователь предоставляет свою копию: `rom/original/_battle_city.nes`
  (sha1 `941ad7ca825e3f86407472113aad00520cb45783`).
- Патчи применяются **только в памяти**; файл ROM не изменяется. Дескрипторы содержат лишь
  короткие `expect`-последовательности (5–7 байт) и собственный новый код — аналог ROM-hack
  patch (IPS/BPS), а не игру.
- `rom/disasm/` — генерируемый артефакт (`.gitignore`), не коммитится.

## Товарные знаки
«Battle City» — товарный знак Bandai Namco Entertainment Inc. Проект — неофициальная
некоммерческая фанатская работа, не связан с правообладателем и не одобрен им.

## Прочие зависимости (все пермиссивные)
| Компонент | Лицензия | Роль |
|---|---|---|
| React / react-dom | MIT | runtime frontend |
| ws | MIT | runtime backend |
| Vite / Rollup / esbuild | MIT | dev/build |
| TypeScript | Apache-2.0 | dev |
| @types/* | MIT | dev |
| @playwright/test | Apache-2.0 | dev (e2e) |

Copyleft-зависимостей (GPL/AGPL/LGPL) нет.

## Публикация Docker-образов
Docker-образ собирается с оригинальным ROM внутри. **Не публикуйте такие образы** в
открытые реестры — это распространение ROM. Для публичных образов монтируйте ROM томом
или собирайте без него.
