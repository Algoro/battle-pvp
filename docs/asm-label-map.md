# Карта меток ASM (Battle City, банк FF)

Источник: дизассемблер `vendor/nes-disasm/Battle City` (bank_FF.asm / bank_ram.inc /
bank_val.inc), BZK 6502 Disassembler — сабмодуль `cyneprepou4uk/NES-Games-Disassembly`.
Копия asm в наше репо не коммитится; генерируемый `rom/disasm/` (`.gitignore`) служит для
тестов. Полный анализ — `docs/dev/reports/agent-reversing.md`.

## Векторы / поток
- NMI `vec_D400_NMI` — каждый кадр: чтение джойстиков, счётчик кадров.
- RESET `vec_C070_RESET`.
- Главный цикл раунда: stage-start `loc_C1C5` → gameplay `bra_C1F9_loop` →
  stage-end `bra_C238_loop`.

## Контроллеры
- `sub_D689_read_joy_regs` (D689) — чтение $4016/$4017, 2 порта.
- `sub_E451_convert_Dpad_buttons` — байт кнопок → направление (0=Up,1=Left,2=Down,3=Right).

## RNG
- `sub_D44D_generate_random_number` (D44D) — детерминированный PRNG.
- Регистры: `ram_random` $0F, `ram_index_for_random` $10.

## Enemy AI (заменён сетевым вводом — патч P2)
- `sub_DDA2` — выбор направления врага (хук: `JMP sub_net_enemy_dir`).
- `sub_DE72` (DE84) — направление базового врага (хук: `JMP sub_net_enemy_dir_store`).
- Цели: `ofs_000_DD7E_D0_follow_p1` / `_p2` / `_HQ`.
- Флаги танков: 0xA0 basic, 0xB0/0xC0/0xD0 follow-HQ/p2/p1, 0xE0/F0 respawn, 0x70/0x80 explosion.

## Спавн / round state
- `sub_E363_tank_spawn_handler`, `sub_DB48_enemy_spawn_handler`.
- `sub_C728_check_condition_for_stage_ending` — win/loss (кандидат для P3).
- `sub_E2A9_HQ_handler` — база/орёл; `ram_game_over_flag` $68.

## HUD
- `sub_C7C8_print_lives_handler`, `sub_C830_draw_Ip_IIp_icons`,
  `sub_C8A2_draw_enemy_icon`, `sub_C8B1_erase_enemy_icon`.

## RAM (выборочно)
| Регистр | Адрес | Назначение |
|---------|-------|------------|
| ram_btn_hold | $06 | ввод порт0,1 |
| ram_random | $0F | RNG-регистр |
| ram_p1_score | $15 | счёт P1 |
| ram_lives | $51 | жизни |
| ram_game_over_flag | $68 | $80=игра, 0=конец |
| ram_stage | $85 | уровень |
| ram_enemies_left_cnt | $80 | остаток ATT |
| ram_tank_pos_X | $90 | позиции танков |
| ram_net_enemy_dir | $01DB | сетевой ввод врагов (PvP) |

## Адреса сетевой зоны (PvP, bank_ram.inc)
- `ram_net_enemy_dir` $01DB, `ram_net_enemy_fire` $01E1, `ram_net_enemy_respawn` $01E7,
  `ram_net_match_state` $01ED.

## Сборка патчей
Патчи равного размера (JMP+NOP-пады), новая логика в «bzk garbage» EF75-EFFF.
Пересборка + byte-diff-регрессия: `bash rom/tests/test-p2-ai-netinput.sh`.
