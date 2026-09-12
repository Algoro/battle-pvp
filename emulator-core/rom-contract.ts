// rom-contract.js — ЕДИНЫЙ источник правды по адресам RAM/ROM Battle City.
//
// Сюда вынесены все адреса, которые используют ядро (`pvp.js`), модель ИИ
// (`model/*`), симулятор (`sim/*`), патчинг (`patching/*`) и данные стадий.
// Раньше адреса были рассыпаны по файлам (тысячи «магических» чисел) и дублировались —
// это главный источник трудноуловимых ошибок. Теперь адрес меняется в одном месте.
//
// Сверка с ROM: vendor/nes-disasm/Battle City/bank_ram.inc (RAM) и bank_FF.asm (ROM).
// Относительный путь: ./emulator-core/rom-contract.js

// --- Память ---
export const RAM = {
  // нулевая страница
  FRM_CNT_HI: 0x0a, // ram_frm_cnt_hi
  FRM_CNT_LO: 0x0b, // ram_frm_cnt_lo
  RANDOM: 0x0f, // ram_random
  PAUSE: 0x6d, // ram_pause_flag
  BONUS_TIMER: 0x62, // таймер бонуса
  FORTIFIED: 0x45, // ram_shovel_timer: >0 — база укреплена сталью
  GAME_OVER: 0x68, // ram_game_over_flag (0x80 = игра идёт)
  STUN: 0x6f, // ram_plr_stun_timer (+i, только DEF)
  ENEMIES_LEFT: 0x80, // ram_enemies_left_cnt (0xFF — игра не начата)
  SPAWN_CNT: 0x7f, // ram_enemy_spawn_cnt: сколько врагов ещё выйдет
  SPAWN_TIMER: 0x82, // ram_enemy_timer_before_spawn
  SPAWN_INTERVAL: 0x84, // ram_enemy_spawn_interval
  STAGE: 0x85, // ram_stage
  PRIZE_X: 0x86,
  PRIZE_Y: 0x87,
  PRIZE_ID: 0x88, // 0xFF — приза нет
  HELMET: 0x89, // ram_helmet_timer (+i, только DEF)
  TANK_X: 0x90, // ram_tank_pos_X (+i)
  TANK_Y: 0x98, // +i
  TANK_FLAG: 0xa0, // ram_tank_flags (+i)
  TANK_TYPE: 0xa8, // ram_tank_type (+i)
  TANK_WHEELS: 0xb0, // ram_tank_wheels (+i)
  BULLET_X: 0xb8, // (+i)
  BULLET_Y: 0xc2, // (+i)
  BULLET_STATUS: 0xcc, // (+i)
  LIVES: 0x51, // ram_lives (+port)
  CLOCK_TIMER: 0x0100, // ram_clock_timer: >0 — враги заморожены
  TANK_UPGRADE: 0x0101, // ram_tank_upgrade (+port), шаги 0x20: 0x00/0x20/0x40/0x60
  FIELD: 0x0400, // буфер поля 32x32 тайлов (0x0400..0x07FF)
  SFX_BONUS_PICKUP: 0x0306, // ram_sfx_bonus_pickup
  SFX_BONUS_APPEAR: 0x0309, // ram_sfx_bonus_appear
  SFX_BULLET_HIT_TANK: 0x030e, // ram_sfx_bullet_hit_tank
  SFX_EXPLOSION_PLAYER: 0x0307, // ram_sfx_explosion_player
  SFX_EXPLOSION_ENEMY: 0x030a, // ram_sfx_explosion_enemy
  SFX_EXPLOSION_HQ: 0x030b, // ram_sfx_explosion_hq
  SFX_SHOT: 0x030f, // ram_sfx_shot

  // сетевая RAM-зона PvP (см. patching/patches/base-nrom.ts)
  NET_DIR: 0x01db, // 6 байт: направление ATT (0=Up,1=Left,2=Down,3=Right, FF=нет)
  NET_FIRE: 0x01e1, // 6 байт: edge выстрела
  NET_RESPAWN: 0x01e7, // 6 байт: edge респавна
  NET_STATE: 0x01ed, // 1 байт: состояние матча
  // супер-оружие «пистолет» (rom-патч pistol, 2 игрока DEF)
  PISTOL: 0x01ee, // 2 байта: 1 = владеет супер-оружием
  PISTOL_AMMO: 0x01f0, // 2 байта: остаток супер-выстрелов
  // фича enemy-prizes: эффекты врагов, подобравших приз (см. patching/patches/enemy-prizes)
  ENEMY_PISTOL_AMMO: 0x01f2, // 6 байт: боезапас супер-оружия врагов (танки 2..7), 0 = нет
  ENEMY_PRIZE_IDX: 0x01f8, // 1 байт: индекс врага, забравшего приз (0xFF — нет)
  ENEMY_PRIZE_ID: 0x01f9, // 1 байт: id забранного приза
  PRIZE_FREEZE: 0x01fa, // 2 байта: таймер заморозки DEF-танков (clock у врага)
  DOTS_LEFT: 0x01fc, // 2 байта: остаток точек (режим pacman); 0 — поле зачищено
  PACMAN_WIN: 0x01fe, // 1 байт: 1 — DEF зачистили поле (победа в матче)
  // режим tower-defence: фаза TD (0=off,1=BUILD,2=WAVE,3=INTERMISSION,4=VICTORY,5=DEFEAT)
  TD_STATE: 0x01ff, // 1 байт: читается ROM-хуком завершения стадии (sub_C728)
};

export const FIELD_SIZE = 32;

// --- ROM (CPU-адреса, банк $C000) ---
export const ROM = {
  DRAW_STAGE: 0xf000, // sub_F000_draw_stage (вход: A = номер стадии)
  STAGE_TABLE: 0xf07a, // tbl_F07A_stage_data
  STAGE_STRIDE: 91, // байт на стадию
  BLOCK_ATTR: 0xdabb, // tbl_DABB_nametable_attribute
  BLOCK_TILES: 0xdacb, // tbl_DACB_block_data
  RANDOM_FN: 0xd44d, // sub_D44D_generate_random_number
  RANDOM_RET: 0xd466, // RTS sub_D44D (адрес возврата для инъекции RNG)
};

// --- Кнопки (биты маски ввода; совпадают с con_btn_*) ---
export const BTN = {
  A: 0x01,
  B: 0x02,
  Select: 0x04,
  Start: 0x08,
  Up: 0x10,
  Down: 0x20,
  Left: 0x40,
  Right: 0x80,
};

// Адрес поля по индексу (комфортный помощник).
export const ram = (base: number, i = 0): number => base + i;

// Read-set, который обязан совпадать у эмулятора и JS-модели (контрактный тест).
export const AI_READ_RANGES = [
  { base: RAM.ENEMIES_LEFT, len: 1, desc: "enemiesLeft" },
  { base: RAM.SPAWN_TIMER, len: 1, desc: "spawnTimer" },
  { base: RAM.FORTIFIED, len: 1, desc: "fortified (лопата)" },
  { base: RAM.CLOCK_TIMER, len: 1, desc: "clockTimer (часы)" },
  { base: RAM.TANK_X, len: 8, desc: "tank x" },
  { base: RAM.TANK_Y, len: 8, desc: "tank y" },
  { base: RAM.TANK_FLAG, len: 8, desc: "tank flag" },
  { base: RAM.TANK_TYPE, len: 8, desc: "tank type" },
  { base: RAM.HELMET, len: 2, desc: "helmet (защитники)" },
  { base: RAM.STUN, len: 2, desc: "stun (защитники)" },
  { base: RAM.BULLET_STATUS, len: 8, desc: "bullet status" },
  { base: RAM.BULLET_X, len: 8, desc: "bullet x" },
  { base: RAM.BULLET_Y, len: 8, desc: "bullet y" },
  { base: RAM.PRIZE_ID, len: 1, desc: "prize id" },
  { base: RAM.PRIZE_X, len: 1, desc: "prize x" },
  { base: RAM.PRIZE_Y, len: 1, desc: "prize y" },
  { base: RAM.FIELD, len: 1024, desc: "поле (буфер тайлов)" },
];

export default { RAM, ROM, BTN, FIELD_SIZE, AI_READ_RANGES, ram };
