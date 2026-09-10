# ROM и in-memory патчинг

## Принцип

Оригинальный ROM **не изменяется**. PvP-логика добавляется патчами к **образу PRG в памяти**
в момент загрузки, до того как маппер скопирует PRG в память CPU. Файл `rom/original/_battle_city.nes`
остаётся байт-в-байт оригиналом; патченый проект — производный.

```
оригинал (_battle_city.nes)
   │  load → ROM.rom[0] (Uint8Array 16 КБ)
   │  applyPatchSet(rom, "pvp")   ← правит только образ в памяти
   ▼
createMapper().loadROM()  → cpu.mem  → исполнение
```

## Что меняется

Патч `pvp` состоит из:
- **6 хуков равного размера** (JMP/JSR + NOP-пады), чтобы адреса оригинального кода не сдвигались:
  PRNG `$D45A`, спавн `$DB48`, направление `$DDD4`, цель `$DE72`, поворот `$DE84`, огонь `$E171`;
- **6 новых рутин** в неиспользуемой зоне `$EF75–$EFF6` (была заполнена `$FF`):
  сетевой ввод ATT, per-player респавн и обёртки;
- **сетевой RAM-зоны** `$01DB–$01ED` (`ram_net_enemy_dir/fire/respawn/state`).

Полный разбор — `docs/asm-label-map.md`; отпечаток пропатченного PRG — `94cb0636`.

## Модуль `emulator-core/patching/`

| Файл | Назначение |
|---|---|
| `rom-image.js` | доступ к PRG как к образу: `map(addr)`, read/write/verify, `isFill`, `fingerprint` |
| `descriptor.js` | валидация дескрипторов, токены (`jmp/jsr/abs/self`), `composeSets` |
| `linker.js` | таблица символов, размещение рутин, проверки `NO_SPACE`/`OVERLAP` |
| `apply.js` | `applyPatchSet(rom, "pvp")`: проверка базы, `expect`-байтов, атомарная запись |
| `errors.js` | типизированные коды ошибок |
| `patches/base-nrom.js` | база (mapper0, 1×16 КБ, FNV PRG `b8a818c1`, sha1 ROM) + символы + свободная зона |
| `patches/pvp.js` | сами патчи (рутины токенами + хуки) |
| `registry.js` | именованные наборы (`pvp`, `base`) |

## Инварианты и защита

- **Проверка базы**: mapper/число банков/отпечаток PRG; чужой ROM → `PATCH_BASE_MISMATCH`.
- **`expect`-байты** для каждого хука: неверная ревизия → `PATCH_EXPECT_FAILED`.
- **Свободная зона**: рутины размещаются только в «пустых» (`$FF`) диапазонах.
- **Пересечения/переполнение**: `PATCH_OVERLAP` / `PATCH_NO_SPACE`.
- **Атомарность**: пока все проверки не пройдены, ничего не пишется.
- **Guard-тест** `emulator-core/tests/jsnes-pristine.test.js` следит, что jsnes не тронут.

## Как добавить патч

1. Опишите байты/рутины в `patches/*.js` (по образцу `pvp.js`), используя токены для адресов.
2. Зарегистрируйте набор/добавьте в `composeSets` при необходимости.
3. Проверьте воспроизведение: `node scripts/extract-patches.mjs --check`.
4. Прогоните `cd emulator-core && npm test` (golden + детерминизм).

## Отпечаток картриджа

`nes.patching.fingerprint` (FNV-1a32 пропатченного PRG) передаётся в netcode-handshake,
чтобы матч играли только клиенты с одинаковыми патчами (см. `docs/multiplayer.md`).
