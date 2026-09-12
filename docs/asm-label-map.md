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
| ram_pistol | `$01EE` | 2 байта: 1 = DEF-игрок владеет супер-оружием |
| ram_pistol_ammo | `$01F0` | 2 байта: остаток супер-выстрелов |

Зона `$01DB–$01F7` свободна: `ram_ppu_buffer` (`$0180`) заканчивается на `$01DA`
(максимальный `ram_buffer_index` = `$5A` по замерам геймплея).

## Призы (bonus)

| id | Метка | Эффект |
|---|---|---|
| 0 | ofs_bonus_E9F0_00_helmet | каска |
| 1 | ofs_bonus_E9F5_01_clock | заморозка |
| 2 | ofs_bonus_E9FB_02_shovel | укрепление базы |
| 3 | ofs_bonus_EA07_03_star | апгрейд (4-я звезда = супер-оружие) |
| 4 | ofs_bonus_EA17_04_grenade | взрыв врагов |
| 5 | ofs_bonus_EA3E_05_tank | жизнь |
| 6 | ofs_bonus_EA48_06_RTS → sub_grant_super_weapon | **пистолет** (супер-оружие) |

Графика призов: тайны `0x81 + id*4`; пистолет — `0x99–0x9C`. Таблица выпадения
`tbl_E8FA_bonus` (`$E8FA`), подбор — `sub_E972_try_to_pick_up_bonus` (`$E972`).
Фича `enemy-prizes` хукает вход `sub_E972` и добавляет проверку танков 2..7 (враги):
при наезде приз забирается (`ram_bonus_timer=0x32` + SFX), индекс/`id` пишутся в RAM,
а эффект исполняет JS-рантайм (`features/enemy-prizes.ts`): clock — заморозка DEF,
shovel — снять защиту базы, star — броня врага, grenade — взрыв DEF, tank — подкрепление,
pistol — супер-оружие врагу (при фиче `pistol`); helmet — без эффекта.

## Патчи

Хуки строго равного размера (`JMP`/`JSR` + NOP-пады), новый код — в неиспользуемых зонах
`$EF75–$EFFF` (pvp) и `$FF50–$FFF9` (pistol). Дескрипторы и линкер —
`emulator-core/patching/` (`patches/pvp.js`, `patches/pistol.js`).
Проверка воспроизведения: `node scripts/extract-patches.mjs --check`.
