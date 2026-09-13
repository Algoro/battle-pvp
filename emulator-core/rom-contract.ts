// rom-contract.js — SINGLE source of truth for Battle City RAM/ROM addresses.
//
// All addresses used by the core (`pvp.js`), the AI model
// (`model/*`), the simulator (`sim/*`), patching (`patching/*`), and stage data live here.
// Previously the addresses were scattered across files (thousands of "magic" numbers) and duplicated —
// this is the main source of hard-to-find bugs. Now an address changes in one place.
//
// Cross-check with ROM: vendor/nes-disasm/Battle City/bank_ram.inc (RAM) and bank_FF.asm (ROM).
// Relative path: ./emulator-core/rom-contract.js

// --- Memory ---
export const RAM = {
  // zero page
  FRM_CNT_HI: 0x0a, // ram_frm_cnt_hi
  FRM_CNT_LO: 0x0b, // ram_frm_cnt_lo
  RANDOM: 0x0f, // ram_random
  PAUSE: 0x6d, // ram_pause_flag
  BONUS_TIMER: 0x62, // bonus timer
  FORTIFIED: 0x45, // ram_shovel_timer: >0 — base fortified with steel
  GAME_OVER: 0x68, // ram_game_over_flag (0x80 = game in progress)
  STUN: 0x6f, // ram_plr_stun_timer (+i, DEF only)
  ENEMIES_LEFT: 0x80, // ram_enemies_left_cnt (0xFF — game not started)
  SPAWN_CNT: 0x7f, // ram_enemy_spawn_cnt: how many enemies have yet to appear
  SPAWN_TIMER: 0x82, // ram_enemy_timer_before_spawn
  SPAWN_INTERVAL: 0x84, // ram_enemy_spawn_interval
  STAGE: 0x85, // ram_stage
  PRIZE_X: 0x86,
  PRIZE_Y: 0x87,
  PRIZE_ID: 0x88, // 0xFF — no prize
  HELMET: 0x89, // ram_helmet_timer (+i, DEF only)
  TANK_X: 0x90, // ram_tank_pos_X (+i)
  TANK_Y: 0x98, // +i
  TANK_FLAG: 0xa0, // ram_tank_flags (+i)
  TANK_TYPE: 0xa8, // ram_tank_type (+i)
  TANK_WHEELS: 0xb0, // ram_tank_wheels (+i)
  BULLET_X: 0xb8, // (+i)
  BULLET_Y: 0xc2, // (+i)
  BULLET_STATUS: 0xcc, // (+i)
  LIVES: 0x51, // ram_lives (+port)
  CLOCK_TIMER: 0x0100, // ram_clock_timer: >0 — enemies frozen
  TANK_UPGRADE: 0x0101, // ram_tank_upgrade (+port), steps 0x20: 0x00/0x20/0x40/0x60
  FIELD: 0x0400, // field buffer 32x32 tiles (0x0400..0x07FF)
  SFX_BONUS_PICKUP: 0x0306, // ram_sfx_bonus_pickup
  SFX_BONUS_APPEAR: 0x0309, // ram_sfx_bonus_appear
  SFX_BULLET_HIT_TANK: 0x030e, // ram_sfx_bullet_hit_tank
  SFX_EXPLOSION_PLAYER: 0x0307, // ram_sfx_explosion_player
  SFX_EXPLOSION_ENEMY: 0x030a, // ram_sfx_explosion_enemy
  SFX_EXPLOSION_HQ: 0x030b, // ram_sfx_explosion_hq
  SFX_SHOT: 0x030f, // ram_sfx_shot

  // PvP network RAM area (see patching/patches/base-nrom.ts)
  NET_DIR: 0x01db, // 6 bytes: ATT direction (0=Up,1=Left,2=Down,3=Right, FF=none)
  NET_FIRE: 0x01e1, // 6 bytes: fire edge
  NET_RESPAWN: 0x01e7, // 6 bytes: respawn edge
  NET_STATE: 0x01ed, // 1 byte: match state
  // super-weapon "pistol" (rom patch pistol, 2 DEF players)
  PISTOL: 0x01ee, // 2 bytes: 1 = owns the super-weapon
  PISTOL_AMMO: 0x01f0, // 2 bytes: remaining super-shots
  // feature enemy-prizes: effects of enemies that picked up a prize (see patching/patches/enemy-prizes)
  ENEMY_PISTOL_AMMO: 0x01f2, // 6 bytes: enemy super-weapon ammo (tanks 2..7), 0 = none
  ENEMY_PRIZE_IDX: 0x01f8, // 1 byte: index of the enemy that took the prize (0xFF — none)
  ENEMY_PRIZE_ID: 0x01f9, // 1 byte: id of the taken prize
  PRIZE_FREEZE: 0x01fa, // 2 bytes: DEF tank freeze timer (enemy clock)
  DOTS_LEFT: 0x01fc, // 2 bytes: dots remaining (pacman mode); 0 — field cleared
  PACMAN_WIN: 0x01fe, // 1 byte: 1 — DEF cleared the field (match victory)
  // tower-defence mode: TD phase (0=off,1=BUILD,2=WAVE,3=INTERMISSION,4=VICTORY,5=DEFEAT)
  TD_STATE: 0x01ff, // 1 byte: read by the ROM stage-end hook (sub_C728)
  // feature friendly-fire-att: bit mask of enemy bullet slots (2..7) that have
  // already left the shooter's "barrel" (the bullet spawns in its hitbox, so self-damage is allowed
  // only after it leaves the barrel). Free RAM after the sound engine (031C-03FB).
  FF_ATT_CLEARED: 0x03fc, // 1 byte
  // feature enemy-prizes: bit mask of prizes (bit id) that an enemy may take.
  // 0xFF — all allowed. Read by the ROM pickup hook; written by the runtime from settings.
  ENEMY_PRIZE_ALLOW: 0x03fd, // 1 byte
};

export const FIELD_SIZE = 32;

// --- ROM (CPU addresses, bank $C000) ---
export const ROM = {
  DRAW_STAGE: 0xf000, // sub_F000_draw_stage (input: A = stage number)
  STAGE_TABLE: 0xf07a, // tbl_F07A_stage_data
  STAGE_STRIDE: 91, // bytes per stage
  BLOCK_ATTR: 0xdabb, // tbl_DABB_nametable_attribute
  BLOCK_TILES: 0xdacb, // tbl_DACB_block_data
  RANDOM_FN: 0xd44d, // sub_D44D_generate_random_number
  RANDOM_RET: 0xd466, // RTS sub_D44D (return address for RNG injection)
};

// --- Buttons (input mask bits; match con_btn_*) ---
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

// Field address by index (convenience helper).
export const ram = (base: number, i = 0): number => base + i;

// Read-set that must match between the emulator and the JS model (contract test).
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
