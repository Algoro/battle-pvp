# Карта меток ASM (Battle City, банк FF)

Справочник по оригинальному ROM для понимания точек патчинга. Источник — дизассемблер
`vendor/nes-disasm/Battle City` (bank_FF.asm / bank_ram.inc / bank_val.inc),
сабмодуль `cyneprepou4uk/NES-Games-Disassembly`. Копия asm в репозиторий не коммитится;
`rom/disasm/` — генерируемый артефакт (`.gitignore`).

## Векторы и поток

- NMI `vec_D400_NMI` — каждый кадр: чтение джойстиков, счётчик кадров.
- RESET `vec_C070_RESET`.
- Главный цикл раунда: stage-start `loc_C1C5` → gameplay `bra_C1F9_loop` → stage-end `bra_C238_loop`.

## Контроллеры

- `sub_D689_read_joy_regs` (`$D689`) — чтение `$4016/$4017`, 2 порта.
- `sub_E451_convert_Dpad_buttons` — байт кнопок → направление (0=Up 1=Left 2=Down 3=Right).

## RNG

- `sub_D44D_generate_random_number` (`$D44D`) — генератор случайного числа.
- Регистры: `ram_random` `$0F`, `ram_index_for_random` `$10`.
- **Патч `pvp`**: хук `$D45A` заменяет зависимость от zero-page `$10`/`$00,X` на
  `random = (random*7 + frm_hi + frm_lo) & 0xFF` (детерминизм).

## Enemy AI (хуки набора `pvp`)

| Оригинал | Адрес хука | Новый код |
|---|---|---|
| `sub_DDA2` (выбор направления) | `$DDD4` | `sub_net_enemy_dir` |
| `sub_DE72` (направление базового врага) | `$DE72` | `sub_DE72_patched` |
| `$DE84` | `$DE84` | `sub_net_enemy_dir_store` |
| огонь врага (`$E171`) | `$E171` | `sub_net_enemy_fire_check` |
| спавн (`sub_DB48_enemy_spawn_handler`) | `$DB48` | `sub_DB48_patched` + `sub_net_respawn_check` |

- Цели: `ofs_000_DD7E_D0_follow_p1` / `_p2` / `_HQ`.
- Флаги танков: `0xA0` basic, `0xB0/0xC0/0xD0` follow-HQ/p2/p1, `0xE0/0xF0` respawn,
  `0x70/0x80` explosion.

## Спавн и состояние раунда

- `sub_E363_tank_spawn_handler`, `sub_DB48_enemy_spawn_handler`.
- `sub_C728_check_condition_for_stage_ending` — условие конца раунда (win/loss).
- `sub_E2A9_HQ_handler` — база/орёл; `ram_game_over_flag` `$68`.

## HUD

- `sub_C7C8_print_lives_handler`, `sub_C830_draw_Ip_IIp_icons`,
  `sub_C8A2_draw_enemy_icon`, `sub_C8B1_erase_enemy_icon`.

## RAM (выборочно)

| Метка | Адрес | Назначение |
|---|---|---|
| ram_btn_hold | `$06` | ввод портов 0,1 |
| ram_random | `$0F` | RNG-регистр |
| ram_p1_score | `$15` | счёт P1 |
| ram_lives | `$51` | жизни |
| ram_game_over_flag | `$68` | `$80`=игра, 0=конец |
| ram_enemies_left_cnt | `$80` | остаток ATT |
| ram_stage | `$85` | уровень |
| ram_tank_pos_X | `$90` | позиции танков |
| ram_tank_flags | `$A0` | флаги/направление танков |

## Сетевая RAM-зона PvP

| Метка | Адрес | Назначение |
|---|---|---|
| ram_net_enemy_dir | `$01DB` | направление ATT (0..3, FF=нет) |
| ram_net_enemy_fire | `$01E1` | edge выстрела |
| ram_net_enemy_respawn | `$01E7` | edge респавна |
| ram_net_match_state | `$01ED` | состояние матча |

## Патчи

Хуки строго равного размера (`JMP`/`JSR` + NOP-пады), новый код — в неиспользуемой зоне
`$EF75–$EFFF`. Дескрипторы и линкер — `emulator-core/patching/` (`patches/pvp.js`).
Проверка воспроизведения: `node scripts/extract-patches.mjs --check`.
