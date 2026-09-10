# API эмулятора (emulator-core / PvPNes)

Форк jsnes, дополненный для PvP. Относительный путь: `./emulator-core/pvp.js`.

## Создание и загрузка ROM
```js
import PvPNes, { BTN } from "./emulator-core/pvp.js";
const emu = new PvPNes();
emu.loadROM(bytes); // Uint8Array/ArrayBuffer (патченый NROM)
```

## API
| Метод | Описание |
|-------|----------|
| `stepFrame(inputs)` | Прогнать один кадр. `inputs = [{port, buttons}]`, `buttons` — битовая маска con_btn (A=$01 B=$02 Select=$04 Start=$08 Up=$10 Down=$20 Left=$40 Right=$80). Возвращает hash кадра. |
| `saveState()` | Полный детерминированный state как компактный `Uint8Array` (бинарный state-codec). |
| `loadState(bytes)` | Восстановить state из бинарного снапшота (in-place). |
| `getFrameHash()` | FNV-1a 32 по полному `cpu.mem` — для desync detection и детерминизма. |
| `readMem(addr)` | Чтение байта из CPU-памяти (для тестов/интроспекции). |

## Входы (порты)
- Порт 0,1 (команда DEF) → аппаратные `$4016/$4017` (игроки).
- Порт 2..7 (команда ATT) → резервная RAM-зона `ram_net_*`:
  - `ram_net_enemy_dir`  $01DB (6 б): направление танка 2..7 (0=Up 1=Left 2=Down 3=Right, FF=нет)
  - `ram_net_enemy_fire` $01E1 (6 б): edge выстрела (0/1)
  - `ram_net_enemy_respawn` $01E7 (6 б): edge респавна (0/1)
- Edge-детекция (`press = hold & ~prev`) выполняется внутри ядра для портов 2..7.

## Детерминизм
- Внутри игрового цикла нет `Date.now`/`performance.now`/`Math.random`.
- Регистры RNG ($0F,$10) в RAM → автоматически входят в save/load state.
- WASM hot-path (`wasm/hash.c` → `hash.wasm`) даёт идентичный FNV-1a хэш.

## Свойства для рендера/интроспекции
- `emu.ppu.buffer` — Uint32Array(256×240) текущего кадра (рендер: `0xff000000 | buf[i]`).
- `emu.cpu.mem` — полное CPU-пространство (RAM + ROM).
