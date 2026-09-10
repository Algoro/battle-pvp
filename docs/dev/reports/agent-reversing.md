# Agent-Reversing — карта меток и верификация дизассемблера

Дата: 2026-08-23
Результат health-check окружения: OK. Пересборка базы: OK.

## 1. Импорт и верификация
- Дизассемблер импортирован: `vendor/nes-disasm/Battle City/` → `./rom/disasm/`
  (bank_FF.asm, bank_ram.inc, bank_val.inc, CHR_ROM.chr, header.bin, incbin/stages,
  preparations.lua, assemble.sh). Общие скрипты сборки — в `./rom/_scripts/`
  (assemble.sh ожидает их в `../_scripts`).
- Сборочный скрипт: `./rom/build/build.sh` (самодостаточен, использует cc65 из `~/.local`).
- **Пересборка подтверждена:** `_battle_city.nes`, 24592 байт,
  **SHA-1 `E1061C9241B06A965FB7845CB951D921ACA010EF`**, **CRC32 `f599a07e`**,
  совпадает с эталонной ревизией дизассемблера ("Original SHA-1 checksum detected").
- **Расхождение с предоставленным ROM:** `./BattleCity (Japan).nes` имеет SHA-1
  `941ad7ca…` / CRC32 `b9c34f28` — это **другая ревизия** того же NROM-образа.
  Базой для всех патчей принимаем компилируемую ревизию дизассемблера (e1061c92).
  Byte-diff regression-тесты должны сверяться с `f599a07e`, а не с b9c34f28.
- **Формат:** BZK-дизассемблер. В каждой строке: флаг, ROM-смещение (`0x00xxxx`),
  CPU-адрес (`CPU:xxxx`), hex-дамп, мнемоника с символьными метками. Метки вида
  `sub_XXXX_имя:` / `bra_XXXX_имя:` / `tbl_XXXX_имя:` / `ram_XXXX_имя`.

## 2. Векторы и общий поток
- NMI: `vec_D400_NMI` (CPU D400) — каждый кадр: sprite DMA, запись PPU-буфера,
  палитра, scroll, **`sub_D689_read_joy_regs` (чтение джойстиков)**, скрытие
  неиспользуемых спрайтов, `sub_EA7E_sound_driver`, инкремент счётчика кадров.
- RESET: `vec_C070_RESET` (CPU C070). IRQ не используется (вектор = C070).
- Счётчик кадров: `ram_frm_cnt_lo` ($0B) инкремент каждый кадр; `ram_frm_cnt_hi` ($0A)
  каждые 64 кадра (при AND #$3F = 0).
- Главный цикл раунда: stage-start `loc_C1C5` → gameplay `bra_C1F9_loop` →
  stage-end `bra_C238_loop`. В gameplay-цикле: `sub_C2E6_main_battle_script`,
  танки `sub_DEA6_tanks_handler`, пули `sub_E0D8_bullets_status_handler`, пауза,
  `sub_C728_check_condition_for_stage_ending` (условие конца раунда).

## 3. Карта меток по подсистемам

### 3.1 Контроллеры (критично для >2 портов)
- `sub_D689_read_joy_regs` (D689): стробирует $4016, читает 8 бит с порта
  $4016,X (X=1 затем X=0) → 2 логических порта. Пишет:
  - `ram_btn_hold` ($0006=порт0, $0007=порт1)
  - `ram_btn_press` ($0008=порт0, $0009=порт1)
- Вызывается из NMI каждый кадр. **Это функция, которую расширяет Agent-Patcher**
  (программный мультиплексор виртуальных портов сверх 2). Маска кнопок — в bank_val.inc
  (`con_btn_*`: Right=$80, Left=$40, Down=$20, Up=$10, Start=$08, Select=$04, B=$02, A=$01).
- `sub_E451_convert_Dpad_buttons` (E451): байт кнопок → одно направление
  (0=Up,1=Left,2=Down,3=Right, FF=нет). Используется и игроком, и AI.

### 3.2 RNG (для Agent-RNG-Audit)
- `sub_D44D_generate_random_number` (D44D):
  ```
  new = (ram_random<<3) - ram_random + ram_frm_cnt_hi + zero_page[ram_index_for_random]
  ram_index_for_random++
  ```
- Регистры: `ram_random` ($000F), `ram_index_for_random` ($0010).
- **Детерминизм подтверждён:** RNG зависит от счётчика кадров (`ram_frm_cnt_hi`)
  и zero-page — **НЕ от wall-clock**. Оба регистра лежат в RAM → автоматически
  входят в save/load state (целый образ RAM).
- Точки вызова (10 шт., CPU адреса): DC8C, DD17, DD48, DD4F, DDD4 (вражеский AI,
  выбор направления), DE84, E171, E8C3, E8CD, E8E6 (спавн/бонусы).
- АЛГОРИТМ LFSR НЕ трогаем — патентуем только точки вызова (см. Agent-RNG-Audit).

### 3.3 Enemy AI (заменяется на сетевой ввод)
- `sub_DDA2` (DDA2): выбор `tank_flags` (направление/поведение) из
  `tbl_E486_tank_flags`. Для врагов (X>=2) использует RNG (DD D4) `AND #1` + смещение 9 —
  случайное отклонение на перекрёстках.
- Целеуказание: `ofs_000_DD7E_D0_follow_p1` (цель = танк P1),
  `ofs_000_DD89_C0_follow_p2` (цель = P2), `ofs_000_DD94_B0_follow_HQ` (цель = база).
  Пишут `ram_enemy_destination_X/Y` ($0071/$0072).
- Флаги танков (bank_val.inc): A0=базовый, B0=follow_HQ, C0=follow_p2, D0=follow_p1,
  E0, F0=respawn, 90, 80, 70=explosion.
- Демо-AI: `sub_C642_demo_players_ai_handler` (вызывается только в демо/титуле).

### 3.4 Спавн / respawn
- `sub_E363_tank_spawn_handler` — спавн одного танка (X = индекс).
- `sub_DB48_enemy_spawn_handler` — вражеский спавн по таймеру.
- `sub_E42B_prepare_enemy_tanks_for_stage` — подготовка врагов на старт раунда.
- Таблицы: `tbl_E474_enemy_spawn_pos_X` (18/78/D8), `tbl_E477_enemy_spawn_pos_Y` (18),
  `tbl_E47A_player_spawn_pos_X` (58/98), `tbl_E47C_player_spawn_pos_Y` (D8).
- **Per-player respawn** (для патча): условие спавна игрока — `ram_lives` ($51,$52).

### 3.5 State machine раунда (жизни/победа/поражение)
- `sub_C2E6_main_battle_script` — пофреймовая логика раунда (движение, пули, HQ,
  спавн врагов, HUD, пауза).
- `sub_C728_check_condition_for_stage_ending` — **условие конца раунда (главный хук)**:
  - `ram_game_over_flag` ($68) == 0 → game over;
  - `ram_enemies_left_cnt` ($80) == 0 → все 20 врагов убиты → победа (конец раунда);
  - `ram_lives`+`ram_lives+1` == 0 → game over.
  Текущая победа = "убить 20 врагов". Для PvP требуется симметричное условие
  ("потеряны жизни команды" ИЛИ "уничтожен штаб") — правка в этой функции.
- `sub_E2A9_HQ_handler` — база/орёл: `ram_game_over_flag`=$80 норма; $01-$7F →
  таймер взрыва базы; показ взрыва в спрайтах X=0x78, Y=0xD8. Уничтожение базы
  (подрыв орла) → game over.
- `sub_CCD4_score_after_stage_handler` / `sub_CEF7_draw_screen_with_score_count` —
  экран начисления очков после раунда.

### 3.6 HUD
- `sub_C7C8_print_lives_handler` — счётчик жизней.
- `sub_C830_draw_Ip_IIp_icons` — иконки I-player/II-player.
- `sub_CA91_print_word_stage_and_number` — "STAGE" + номер.
- `sub_D951_draw_huge_hiscore` — крупный счёт/рекорд.
- `sub_C859_draw_flag_above_stage_number`, `sub_C894_calculate_enemy_icon_pos`,
  `sub_C8A2_draw_enemy_icon`, `sub_C8B1_erase_enemy_icon` — значки оставшихся врагов.
- HUD-патч (две команды вместо счётчика волн): перекрыть/доработать `sub_C7C8`,
  `sub_C830`, `sub_C8A2/C8B1` (значки врагов → индикаторы команды).

### 3.7 Уровни / арены
- `sub_F000_draw_stage` (F000) + `tbl_F07A_stage_data` (ROM 0x00308A) —
  `.incbin "incbin/stages/stage_NN.bin"`, N = 01..35 + FF (демо). 35 уровней.
- `sub_C9B0_create_default_stage_field`, `sub_D7CC_create_default_stage_field`,
  `sub_CC08_draw_destroyed_eagle`, `sub_CB5D_draw_default_eagle`, `sub_CAF5_draw_default_base`.
- `ram_stage` ($85) — номер уровня. `ram_stage_data` ($0400) — буфер поля.

## 4. RAM-раскладка (bank_ram.inc)
Полная карта (выборочно, значимые регистры):
- Zero page: temp $00-$04; `ram_btn_hold`=$06, `ram_btn_press`=$08;
  `ram_frm_cnt_hi`=$0A, `ram_frm_cnt_lo`=$0B; `ram_random`=$0F, `ram_index_for_random`=$10;
  счёта `ram_p1_score`=$15, `ram_p2_score`=$1D, `ram_hi_score`=$3D;
  `ram_lives`=$51 (и $52 для P2); `ram_bg_palette_id`=$4D, `ram_scroll_Y`=$4F;
  `ram_game_over_flag`=$68; `ram_pause_flag`=$6D; `ram_stage`=$85;
  `ram_enemy_destination_X/Y`=$71/$72; `ram_enemy_limit`=$6C; `ram_enemy_spawn_cnt`=$7F;
  `ram_enemies_left_cnt`=$80; `ram_enemy_timer_before_spawn`=$82; `ram_enemy_spawn_interval`=$84.
- Объекты танков (stride 8): `ram_tank_pos_X`=$90, `ram_tank_pos_Y`=$98,
  `ram_tank_flags`=$A0, `ram_tank_type`=$A8, `ram_tank_wheels`=$B0.
- Пули (stride 8): `ram_bullet_pos_X`=$B8, `ram_2nd_bullet_pos_X`=$C0, и т.д.
- `ram_ppu_buffer`=$0180, `ram_oam`=$0200 (sprite DMA), звуки $0300+, `ram_stage_data`=$0400,
  `ram_nmt_attr_buffer`=$07C0.

## 5. Свободные ресурсы (критично для патчей)
- **Код: банк FF заполнен на 100%** (`Free bytes in bank FF: 0x0000 [0]`).
  Новый код вставлять НЕКУДА без замены. Доступные резервы:
  - скрытый debug-режим `sub_C755` ("bzk garbage", 0x000765) — можно переиспользовать;
  - блоки `$FF` ("bzk garbage", 0x002F85..0x003000 = CPU EF75..EFFF) — ~139 байт
    неиспользуемого заполнения;
  - регион кандзи 0x003D60..0x003F58 — используется как титульные данные (не трогать).
- **RAM:** блок `$01DB..$01FF` (37 байт) полностью не используется кодом (0 ссылок) —
  **кандидат №1** для зарезервированной зоны состояния сетевого ввода (Block 3.1).
  Дополнительно резерв в `$010A..$017F` (требует проверки по чтениям/записям).
- `bank_val.inc` — константы (`con_max_players=$01` [2 игрока], `con_max_tanks=$07`
  [2 игрока + 6 врагов], `con_not_game_over=$80`, `con_tank_flag_*`).
  Методология патча констант/таблиц (как community-хак 0x71BE) применима здесь к
  `tbl_E486_tank_flags`, таблицам спавна и жизни.

## 6. Рекомендации downstream-агентам
- **Agent-RNG-Audit:** RNG детерминирован (зависит от счётчика кадров). Безопасно
  патчить вызовы на DD D4 (вражеское направление) и точки спавна; `ram_random` ($0F) и
  `ram_index_for_random` ($10) обязательны в save state.
- **Agent-ASM-Architect/Patcher:** для сетевого ввода врагов — заменить ветку
  `sub_DDA2` (RNG-выбор направления врага) на чтение байта из RAM-зоны `$01DB..$01FF`,
  заполняемой эмулятором. Расширить `sub_D689_read_joy_regs` на N логических портов.
  Симметричный win/loss — в `sub_C728_check_condition_for_stage_ending`.
  HUD — `sub_C7C8`/`sub_C830`/`sub_C8A2`. Per-player respawn — `sub_E363`.
- Новый код умещать в вырезанные/резервные места (debug-режим C755, $FF-блоки),
  иначе пересборка выйдет за пределы банка.

## 7. Выходные артефакты
- `./rom/disasm/` — импортированный и пересобираемый дизассемблер.
- `./rom/build/build.sh` — детерминированная сборка + сверка с базой.
- `./rom/disasm/_battle_city.nes` — эталонная (базовая) пересборка, CRC32 `f599a07e`.
