// tower-defence.ts — JS-рантайм режима tower defence.
//
// Соло-режим: игрок DEF в фазе BUILD покупает и расставляет неподвижные танки-башни,
// затем запускает волну ИИ-атакующих. Башни сами целятся/стреляют, враги идут к базе
// и расстреливают башни. Экономика — очки за убийства. Победа — пережить все волны,
// поражение — уничтожена база (или кончились жизни мобильного танка).
//
// Авторитетное состояние — ctx.state (соло, rollback не нужен). В RAM — только фаза
// TD_STATE (её читает ROM-хук завершения стадии) и штатные счётчики спавна/врагов.
// Управление приходит через startOptions.tdOrders (см. PvPNes.tdOrder), статус для UI —
// через startOptions.tdStatus (PvPNes.getTowerDefence).
//
// Относительный путь: ./emulator-core/features/tower-defence.ts
import { RAM } from "../rom-contract.ts";
import { DEF_PORTS, blocksBullet, isTankActive } from "../domain.ts";
import type { FeatureContext, FeatureRuntime } from "../patching/runtime.ts";
import { damageEnemy } from "./enemy-damage.ts";
import { DOT_TILE } from "./pacman-maze.ts";
import { tdMapById, tdBuildableCells } from "./td-levels.ts";
import {
  TD_DEFAULT_CONFIG,
  TD_PHASE,
  TD_WAVES,
  difficultyById,
  pointsForTankType,
  TD_SELL_RATIO,
  towerById,
  towerStats,
  type TdConfig,
} from "../../shared/tower-defence.ts";

const ENEMY_FIRST = DEF_PORTS; // 2
const ENEMY_LAST = 7;
const HIT_RADIUS = 0x0a;
const PROJ_TTL = 180;
// Направления (0=Up,1=Left,2=Down,3=Right) — без аллокаций в горячем пути.
const DIR_DX = [0, -1, 0, 1];
const DIR_DY = [-1, 0, 1, 0];

interface Tower {
  cell: number; // r*13+c
  type: string;
  level: number;
  hp: number;
  maxHp: number;
  cd: number;
  dir: number;
}
interface Proj {
  x: number;
  y: number;
  dir: number;
  speed: number;
  damage: number;
  pierce: boolean;
  ttl: number;
}
interface TdOrder {
  type: string;
  [k: string]: unknown;
}

interface TdState {
  phase: number;
  config: TdConfig;
  points: number;
  wave: number;
  intermission: number;
  gameStarted: boolean;
  towers: Tower[];
  projs: Proj[];
  prevFlags: number[];
  prevTypes: number[];
  typeQueue: number[];
  drawn: Set<number>;
  buildable: Set<number>;
}

function st(ctx: FeatureContext): TdState {
  return ctx.state.td as TdState;
}

function blockCellOff(r: number, c: number): number {
  return (2 + 2 * r) * 32 + (2 + 2 * c);
}
function cellR(cell: number): number {
  return (cell / 13) | 0;
}
function cellC(cell: number): number {
  return cell % 13;
}
// Верхний-левый пиксель блока; центр блока = +8,+8.
function cellTopLeft(cell: number): { x: number; y: number } {
  return { x: 16 + 16 * cellC(cell), y: 16 + 16 * cellR(cell) };
}

function applyConfig(ctx: FeatureContext, patch: Record<string, unknown>): void {
  const s = st(ctx);
  const difficulty = (patch.difficulty as TdConfig["difficulty"]) ?? s.config.difficulty;
  s.config = {
    map: (patch.map as string) ?? s.config.map,
    difficulty,
    startPoints: (patch.startPoints as number) ?? s.config.startPoints,
    waves: (patch.waves as number) ?? s.config.waves,
    mobileTank: (patch.mobileTank as boolean) ?? s.config.mobileTank,
  };
  s.buildable = new Set(tdBuildableCells(tdMapById(s.config.map)));
  s.points = s.config.startPoints;
}

function liveEnemies(mem: Uint8Array | number[]): number[] {
  const out: number[] = [];
  for (let t = ENEMY_FIRST; t <= ENEMY_LAST; t++) {
    const flag = mem[RAM.TANK_FLAG + t];
    if (flag & 0x80 && flag < 0xe0) out.push(t);
  }
  return out;
}

function aliveEnemiesForKill(mem: Uint8Array | number[]): number[] {
  return liveEnemies(mem).filter((t) => isTankActive(mem[RAM.TANK_FLAG + t]));
}

function startWave(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  // Матч должен реально начаться: иначе ROM при старте стадии перезапишет счётчики волны.
  if (!s.gameStarted) return;
  if (s.phase !== TD_PHASE.BUILD && s.phase !== TD_PHASE.INTERMISSION) return;
  if (s.wave >= s.config.waves) return;
  const def = TD_WAVES[Math.min(s.wave, TD_WAVES.length - 1)];
  const scale = difficultyById(s.config.difficulty).countScale;
  const count = Math.max(1, Math.round(def.count * scale));
  s.wave += 1;
  mem[RAM.SPAWN_CNT] = count;
  mem[RAM.ENEMIES_LEFT] = count;
  mem[RAM.SPAWN_TIMER] = 30;
  mem[RAM.SPAWN_INTERVAL] = def.interval;
  s.prevFlags = [];
  s.prevTypes = [];
  const types = def.types && def.types.length ? def.types : [0x80];
  s.typeQueue = Array.from({ length: count }, (_, i) => types[i % types.length]);
  s.phase = TD_PHASE.WAVE;
  mem[RAM.TD_STATE] = TD_PHASE.WAVE;
}

function placeTower(ctx: FeatureContext, cell: number, typeId: string): void {
  const s = st(ctx);
  if (s.phase !== TD_PHASE.BUILD) return;
  if (!s.buildable.has(cell)) return;
  if (s.towers.some((t) => t.cell === cell)) return;
  const type = towerById(typeId);
  if (!type) return;
  if (s.points < type.cost) return;
  const stats = towerStats(type, 0);
  s.points -= type.cost;
  s.towers.push({ cell, type: type.id, level: 0, hp: stats.hp, maxHp: stats.hp, cd: 0, dir: 0 });
}

function sellTower(ctx: FeatureContext, cell: number): void {
  const s = st(ctx);
  if (s.phase !== TD_PHASE.BUILD) return;
  const i = s.towers.findIndex((t) => t.cell === cell);
  if (i < 0) return;
  const tw = s.towers[i];
  const type = towerById(tw.type);
  if (!type) return;
  const invested = type.cost + type.upgradeCost * tw.level;
  s.points += Math.round(invested * TD_SELL_RATIO);
  s.towers.splice(i, 1);
}

function upgradeTower(ctx: FeatureContext, cell: number): void {
  const s = st(ctx);
  if (s.phase !== TD_PHASE.BUILD) return;
  const tw = s.towers.find((t) => t.cell === cell);
  if (!tw) return;
  const type = towerById(tw.type);
  if (!type || tw.level >= 2) return;
  if (s.points < type.upgradeCost) return;
  s.points -= type.upgradeCost;
  tw.level += 1;
  const stats = towerStats(type, tw.level);
  tw.maxHp = stats.hp;
  tw.hp = stats.hp;
}

function processOrders(ctx: FeatureContext): void {
  const opts = ctx.startOptions as { tdOrders?: TdOrder[] };
  const orders = opts.tdOrders;
  if (!orders || orders.length === 0) return;
  while (orders.length) {
    const o = orders.shift()!;
    switch (o.type) {
      case "configure":
        applyConfig(ctx, o);
        break;
      case "place":
        placeTower(ctx, o.cell as number, o.towerType as string);
        break;
      case "sell":
        sellTower(ctx, o.cell as number);
        break;
      case "upgrade":
        upgradeTower(ctx, o.cell as number);
        break;
      case "startWave":
        startWave(ctx);
        break;
      default:
        break;
    }
  }
}

// Линия огня свободна: все тайлы между башней и целью не блокируют пулю.
function losClear(mem: Uint8Array | number[], col: number, row: number, dir: number, steps: number): boolean {
  const dx = DIR_DX[dir];
  const dy = DIR_DY[dir];
  let c = col;
  let r = row;
  for (let i = 0; i < steps; i++) {
    c += dx;
    r += dy;
    if (c < 0 || c > 31 || r < 0 || r > 31) return false;
    if (blocksBullet(mem[RAM.FIELD + r * 32 + c])) return false;
  }
  return true;
}

function tickTowers(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  const enemies = liveEnemies(mem);
  for (const tw of s.towers) {
    const type = towerById(tw.type);
    if (!type) continue;
    const stats = towerStats(type, tw.level);
    if (tw.cd > 0) tw.cd -= 1;
    if (tw.cd > 0) continue;
    if (enemies.length === 0) continue;
    const c = cellTopLeft(tw.cell);
    const tcx = c.x + 8;
    const tcy = c.y + 8;
    const tc = tcx >> 3;
    const tr = tcy >> 3;
    const rangePx = stats.range * 16;
    let best: { t: number; dir: number; d: number } | null = null;
    for (const t of enemies) {
      const ex = mem[RAM.TANK_X + t] + 8;
      const ey = mem[RAM.TANK_Y + t] + 8;
      const dx = ex - tcx;
      const dy = ey - tcy;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d > rangePx) continue;
      let dir = -1;
      if (Math.abs(dx) <= 6) dir = dy < 0 ? 0 : 2;
      else if (Math.abs(dy) <= 6) dir = dx < 0 ? 1 : 3;
      if (dir < 0) continue;
      const ec = ex >> 3;
      const er = ey >> 3;
      const steps = dir === 0 || dir === 2 ? Math.abs(er - tr) : Math.abs(ec - tc);
      if (!losClear(mem, tc, tr, dir, steps)) continue;
      if (!best || d < best.d) best = { t, dir, d };
    }
    if (!best) continue;
    tw.dir = best.dir;
    tw.cd = stats.fireInterval;
    const dx = DIR_DX[best.dir];
    const dy = DIR_DY[best.dir];
    s.projs.push({
      x: tcx + dx * 6,
      y: tcy + dy * 6,
      dir: best.dir,
      speed: type.projectileSpeed,
      damage: stats.damage,
      pierce: type.id === "sniper",
      ttl: PROJ_TTL,
    });
    mem[RAM.SFX_SHOT] = 1;
  }
}

function tickProjectiles(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  const next: Proj[] = [];
  for (const p of s.projs) {
    const dx = DIR_DX[p.dir];
    const dy = DIR_DY[p.dir];
    p.x += dx * p.speed;
    p.y += dy * p.speed;
    p.ttl -= 1;
    if (p.ttl <= 0 || p.x < 0 || p.x > 255 || p.y < 0 || p.y > 255) continue;
    const tile = mem[RAM.FIELD + (p.y >> 3) * 32 + (p.x >> 3)];
    if (blocksBullet(tile)) {
      mem[RAM.SFX_BULLET_HIT_TANK] = 1;
      continue;
    }
    let hit = false;
    for (let t = ENEMY_FIRST; t <= ENEMY_LAST && !hit; t++) {
      const flag = mem[RAM.TANK_FLAG + t];
      if (!(flag & 0x80) || flag >= 0xe0) continue;
      if (Math.abs(p.x - (mem[RAM.TANK_X + t] + 8)) >= HIT_RADIUS) continue;
      if (Math.abs(p.y - (mem[RAM.TANK_Y + t] + 8)) >= HIT_RADIUS) continue;
      damageEnemy(ctx, t, p.damage, p.pierce);
      hit = true;
    }
    if (!hit) next.push(p);
  }
  s.projs = next;
}

// Вражеские пули бьют башни: башня теряет 1 hp, пуля гаснет.
function tickEnemyFire(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  if (s.towers.length === 0) return;
  for (let b = ENEMY_FIRST; b <= ENEMY_LAST; b++) {
    if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== 0x40) continue;
    const bx = mem[RAM.BULLET_X + b];
    const by = mem[RAM.BULLET_Y + b];
    for (let i = s.towers.length - 1; i >= 0; i--) {
      const tw = s.towers[i];
      const c = cellTopLeft(tw.cell);
      if (Math.abs(bx - (c.x + 8)) >= HIT_RADIUS) continue;
      if (Math.abs(by - (c.y + 8)) >= HIT_RADIUS) continue;
      mem[RAM.BULLET_STATUS + b] = 0x33;
      tw.hp -= 1;
      mem[RAM.SFX_BULLET_HIT_TANK] = 1;
      if (tw.hp <= 0) s.towers.splice(i, 1);
      break;
    }
  }
}

function awardKills(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  for (let t = ENEMY_FIRST; t <= ENEMY_LAST; t++) {
    const prev = s.prevFlags[t] ?? 0;
    const now = mem[RAM.TANK_FLAG + t];
    const wasAlive = (prev & 0x80) !== 0 && prev < 0xe0;
    const nowAlive = (now & 0x80) !== 0 && now < 0xe0;
    if (wasAlive && !nowAlive) s.points += pointsForTankType(s.prevTypes[t] ?? 0x80);
    // Новый спавн волны: выдаём тип врага из очереди волны.
    if (!wasAlive && nowAlive && s.typeQueue.length) mem[RAM.TANK_TYPE + t] = s.typeQueue.shift()!;
    s.prevFlags[t] = now;
    s.prevTypes[t] = mem[RAM.TANK_TYPE + t];
  }
}

function iconPalette(ctx: FeatureContext): number {
  const v = ctx.kernel.ppuVram;
  const spr2 = [1, 2, 3].map((k) => v[0x3f18 + k] & 0x3f);
  let best = 0;
  let bestScore = -1;
  for (let j = 0; j < 4; j++) {
    const bg = [1, 2, 3].map((k) => v[0x3f00 + 4 * j + k] & 0x3f);
    const score = bg.reduce((acc, c, i) => acc + (c === spr2[i] ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = j;
    }
  }
  return (best << 2) & 0x0c;
}

// BG-overlay: башни 2×2 (квадранты иконки приза base=0x81+icon*4), снаряды 1 тайл.
function renderOverlay(ctx: FeatureContext): void {
  const s = ctx.state.td as TdState | undefined;
  if (!s) return;
  const nts = ctx.kernel.ppuNameTable;
  const pal = iconPalette(ctx);
  const next = new Map<number, { tile: number; pal: number }>();

  for (const tw of s.towers) {
    const type = towerById(tw.type);
    if (!type) continue;
    const r = cellR(tw.cell);
    const c = cellC(tw.cell);
    const off = blockCellOff(r, c);
    const base = 0x81 + type.icon * 4;
    const tiles = [base - 1, base + 1, base, base + 2];
    const cells = [off, off + 1, off + 32, off + 33];
    for (let k = 0; k < 4; k++) next.set(cells[k], { tile: tiles[k] & 0xff, pal });
  }
  for (const p of s.projs) {
    const off = (p.y >> 3) * 32 + (p.x >> 3);
    next.set(off, { tile: DOT_TILE, pal });
  }

  for (const cell of s.drawn) {
    if (next.has(cell)) continue;
    for (const nt of nts) {
      nt.tile[cell] = 0;
      nt.attrib[cell] = 0;
    }
  }
  for (const [cell, v] of next) {
    for (const nt of nts) {
      nt.tile[cell] = v.tile;
      nt.attrib[cell] = v.pal;
    }
  }
  s.drawn = new Set(next.keys());
}

function publishStatus(ctx: FeatureContext): void {
  const s = st(ctx);
  const mem = ctx.kernel.mem;
  (ctx.startOptions as { tdStatus?: unknown }).tdStatus = {
    phase: s.phase,
    started: s.gameStarted,
    map: s.config.map,
    difficulty: s.config.difficulty,
    points: s.points,
    wave: s.wave,
    totalWaves: s.config.waves,
    mobileTank: s.config.mobileTank,
    enemiesLeft: mem[RAM.ENEMIES_LEFT],
    spawnLeft: mem[RAM.SPAWN_CNT],
    gameOver: mem[RAM.GAME_OVER],
    projectiles: s.projs.length,
    towers: s.towers.map((t) => ({
      cell: t.cell,
      type: t.type,
      level: t.level,
      hp: t.hp,
      maxHp: t.maxHp,
      dir: t.dir,
    })),
  };
}

export const towerDefenceRuntime: FeatureRuntime = {
  init(ctx) {
    const s: TdState = {
      phase: TD_PHASE.BUILD,
      config: { ...TD_DEFAULT_CONFIG },
      points: TD_DEFAULT_CONFIG.startPoints,
      wave: 0,
      intermission: 0,
      gameStarted: false,
      towers: [],
      projs: [],
      prevFlags: [],
      prevTypes: [],
      typeQueue: [],
      drawn: new Set<number>(),
      buildable: new Set<number>(tdBuildableCells(tdMapById(TD_DEFAULT_CONFIG.map))),
    };
    ctx.state.td = s;
    ctx.kernel.mem[RAM.TD_STATE] = TD_PHASE.BUILD;
  },

  preFrame(ctx) {
    const s = st(ctx);
    processOrders(ctx);
    const mem = ctx.kernel.mem;
    if (mem[RAM.GAME_OVER] === 0x80) s.gameStarted = true;
    // В BUILD враги не спавнятся (ROM-хук при этом не даёт стадии завершиться).
    // До старта матча RAM не трогаем — иначе ломается детект старта игры.
    if (s.gameStarted && s.phase === TD_PHASE.BUILD) {
      mem[RAM.SPAWN_CNT] = 0;
      mem[RAM.ENEMIES_LEFT] = 0;
    }
  },

  postFrame(ctx) {
    const s = st(ctx);
    const mem = ctx.kernel.mem;

    // Поражение: уничтожена база (game over) или, при мобильном танке, кончились жизни.
    const baseDestroyed = mem[RAM.GAME_OVER] !== 0x80;
    const commanderDead = s.config.mobileTank && mem[RAM.LIVES] === 0;
    if (s.gameStarted && (baseDestroyed || commanderDead)) {
      s.phase = TD_PHASE.DEFEAT;
      mem[RAM.TD_STATE] = TD_PHASE.DEFEAT;
      publishStatus(ctx);
      return;
    }

    if (s.phase === TD_PHASE.WAVE) {
      awardKills(ctx);
      tickTowers(ctx);
      tickProjectiles(ctx);
      tickEnemyFire(ctx);
      const spawnsDone = mem[RAM.SPAWN_CNT] === 0;
      const killsDone = mem[RAM.ENEMIES_LEFT] === 0;
      if (spawnsDone && killsDone && aliveEnemiesForKill(mem).length === 0) {
        if (s.wave >= s.config.waves) {
          s.phase = TD_PHASE.VICTORY;
          mem[RAM.TD_STATE] = TD_PHASE.VICTORY;
        } else {
          s.phase = TD_PHASE.INTERMISSION;
          mem[RAM.TD_STATE] = TD_PHASE.INTERMISSION;
          s.intermission = 90;
        }
      }
    } else if (s.phase === TD_PHASE.INTERMISSION) {
      if (s.intermission > 0) s.intermission -= 1;
      if (s.intermission === 0) {
        s.phase = TD_PHASE.BUILD;
        mem[RAM.TD_STATE] = TD_PHASE.BUILD;
      }
    }

    publishStatus(ctx);
  },

  render(ctx) {
    renderOverlay(ctx);
  },

  onLoadState(ctx) {
    const s = st(ctx);
    s.projs = [];
    s.phase = TD_PHASE.BUILD;
    ctx.kernel.mem[RAM.TD_STATE] = TD_PHASE.BUILD;
  },
};

export default towerDefenceRuntime;
