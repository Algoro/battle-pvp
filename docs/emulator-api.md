# API ядра (`emulator-core` / `PvPNes`)

`PvPNes` — подкласс **неизменного** `NES` из jsnes (сабмодуль `vendor/jsnes`).
Относительный путь: `./emulator-core/pvp.js`. Патчи Battle City применяются к
in-memory образу PRG (см. `docs/rom-patching.md`).

## Создание и загрузка ROM

```js
import PvPNes, { BTN } from "./emulator-core/pvp.js";

const emu = new PvPNes({ patchSet: "pvp", attAI: "lookahead", defAI: "plan" });
emu.loadROM(originalRomBytes);       // Uint8Array/ArrayBuffer — ОРИГИНАЛЬНЫЙ ROM
emu.patching;                        // отчёт применения патчей: { fingerprint, applied, routines }
```

Звук включается опциями `sampleRate: 48000` + `onAudioSample` (см. `docs/audio.md`).

Без `patchSet` ядро работает на ROM «как есть» (используется в тестах с уже пропатченным
образом). С `patchSet: "pvp"` грузится оригинал и патчится только в памяти.

## API

| Метод | Описание |
|---|---|
| `loadROM(data)` | Загрузка ROM. При `opts.patchSet` применяет патчи до `createMapper()`. |
| `stepFrame(inputs)` | Один кадр. `inputs = [{port, buttons}]`; `buttons` — битовая маска (A=$01 B=$02 Select=$04 Start=$08 Up=$10 Down=$20 Left=$40 Right=$80). Возвращает hash кадра. |
| `saveState()` / `loadState(bytes)` | Детерминированный бинарный снапшот состояния (включая полный образ RAM). |
| `getFrameHash()` | FNV-1a32 по `cpu.mem` — для детекта desync. |
| `readMem(addr)` | Чтение байта из памяти CPU. |
| `patching` | Отчёт применения патчей после `loadROM` при `patchSet`: `{ fingerprint, applied, routines }`. |
| `setStartStage(stage)` | Стартовая стадия партии (1..35), внедряется детерминированно. |
| `setStartStars(stars)` | Стартовые звёзды команды DEF (0..3) — апгрейд танка (`ram_tank_upgrade`). |
| `setStartPistol(on)` | Стартовое супер-оружие DEF (аналог 4-й звезды): максимум звёзд + пистолет (`ram_pistol`/`ram_pistol_ammo`). No-op без фичи `pistol`. |
| `setPatchFeatures(features)` | Включённые опциональные фичи-патчи (`["pistol"]`), применяются при следующем `reset()`. См. `docs/optional-patches.md`. |
| `getStage(stage)` / `getStageBlocks(stage)` | Данные стадии из ROM в памяти (блоки 13×13, тайлы CHR, атрибуты) для предпросмотра. |
| `setAudioSuppressed(bool)` | Гейт аудио: при `true` `onAudioSample` не вызывается (переигровка при откате). |
| `setHumanTank(port)` / `setHumanDefTank(port)` | Пометить танк человеческим (ИИ за него не играет). |
| `setAttAI(mode)` / `setDefAI(mode)` | Режим ИИ (см. `docs/ai.md`). |

## Входы (порты)

- Порты `0,1` (**DEF**) → аппаратные `$4016/$4017`.
- Порты `2..7` (**ATT**) → RAM-зона `ram_net_*` (пишет ядро):
  - `ram_net_enemy_dir` `$01DB` (6 б): 0=Up 1=Left 2=Down 3=Right, `FF`=нет ввода;
  - `ram_net_enemy_fire` `$01E1` (6 б): edge выстрела;
  - `ram_net_enemy_respawn` `$01E7` (6 б): edge респавна.
- Edge-детекция (`press = hold & ~prev`) выполняется внутри ядра для портов `2..7`.

## Детерминизм

- Игровой цикл не использует `Date.now`/`performance.now`/`Math.random`.
- PRNG (`$0F`) детерминирован и входит в save/load state.
- `getFrameHash()` одинаков у независимых инстансов при одинаковом вводе.
- WASM (`emulator-core/wasm/hash.c` → `hash.wasm`) — проверенный перенос FNV-1a hot-path
  (тест `wasm.test.js`); рантайм использует JS-реализацию.

## Рендер и интроспекция

- `emu.ppu.buffer` — `Uint32Array(256×240)` текущего кадра (в canvas: `0xff000000 | buf[i]`).
- `emu.cpu.mem` — полное адресное пространство CPU (RAM + ROM).
