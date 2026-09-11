// PvPNes — детерминированное PvP-ядро поверх форка jsnes.
//
// Расширения сверх оригинала:
//  1. Программный мультиплексор виртуальных джойстик-портов (до 8 логических).
//     Порт 0,1 -> аппаратные $4016/$4017 (команда DEF);
//     Порт 2..7 -> резервная RAM-зона ram_net_* (команда ATT, сетевые танки).
//  2. Детерминированный save/load state (Uint8Array) — включает полный образ RAM
//     (регистр RNG $0F, $10), фазы APU, PPU scanline, состояние контроллеров.
//  3. stepFrame / saveState / loadState / getFrameHash.
//  4. Без Date.now/performance.now/Math.random внутри игрового цикла (детерминизм).
//
// Формат входов stepFrame(inputs): inputs = [{port, buttons}, ...],
//   где buttons — битовая маска как у con_btn в ROM:
//   A=$01 B=$02 Select=$04 Start=$08 Up=$10 Down=$20 Left=$40 Right=$80.
import NES from "./src/nes.js";
import ROM from "./src/rom.js";
import BattleCityPPU from "./ppu-ext.js";
import BattleCityPAPU from "./papu-ext.js";
import { applyPatchSet } from "./patching/apply.js";
import { encodeState, decodeState } from "./io/state-codec.js";
import { readStage, readStageBlocks, STAGE_COUNT, normalizeStage } from "./io/stage-data.js";
import { stepTank, runtimePassable, DX as TANK_DX, DY as TANK_DY } from "./io/tank-driver.js";
import { plan, planDefense, resetDefState } from "./ai/tactical-ai.js";
import { scanPlan } from "./ai/scan-ai.js";
import { lookaheadPlan } from "./ai/lookahead-ai.js";
import { strategyDefense } from "./ai/defender-strategy.js";
import { attackerPlan } from "./ai/attacker-strategy.js";
import { RAM, ROM as ROM_ADDR, BTN } from "./rom-contract.js";
import { DIR_BTN, movingFlag, standingFlag, isTankAlive, isTankActive, tankPassable, isBrick, isRoad, isEagleTile, TANK_RESPAWN_FLAG, BULLET, PISTOL_BEAM_HALF } from "./domain.js";
import { createStartup, assertRomContract } from "./startup.js";
import { Tracer } from "./io/trace.js";
export { BTN };

// Кнопка направления по индексу dir (0=Up,1=Left,2=Down,3=Right) — как con_btn.
// Позиции спавна DEF-танков (player1, player2) — как tbl_E47A/E47C.
const PLAYER_SPAWN_X = [0x58, 0x98];
const PLAYER_SPAWN_Y = [0xd8, 0xd8];

// Режимы ИИ атакующих, управляемые JS-мозгом (остальные — ASM или "off").
const ATT_AI_MODES = new Set(["js", "plan", "scan", "lookahead", "strategy-att"]);

export const NUM_PLAYERS = 8; // логических портов
export const DEF_PORTS = 2; // 0,1 -> $4016/$4017


// Сторожевой статус пули для ЧЕЛОВЕЧЕСКИХ танков, чтобы блокировать RNG-огонь ASM
// (sub_E162 -> sub_E08C проверяет «слот пули свободен?»: если статус != 0 — не стреляет).
// Значение 0x01 безопасно: в sub_E02E диспетчер `(status>>3)&0xFE = 0` -> RTS (no-op),
// sub_E604/sub_E910/sub_E70C обрабатывают только `(status&0xf0)==0x40`, т.е. маркер не
// двигается, не сталкивается и не рендерится как пуля. При нажатии A (RAM.NET_FIRE) слот
// освобождается, чтобы ASM выстрелил по кнопке.
const HUMAN_BULLET_BUSY = BULLET.BUSY;

// Тайлы анимации взрыва (как у танка): sub_DEE2 даёт 0xF1/0xF5/0xF9 для статусов 0x70/0x60/0x50.
const BEAM_FX_TILES = [0xf1, 0xf5, 0xf9];

// Строгий шаг человеческого танка. ASM (`sub_DC97`) проверяет только 2 УГЛА передней
// кромки (±8 от центра по перпендикуляру) — поэтому, когда центр танка НЕ на границе
// тайла (x%8!=0 / y%8!=0), кирпич ровно впереди по центру не проверяется и танк
// проникает в него. Добавляем 3-ю точку — центр передней кромки — чтобы человеческий
// танк не заезжал в стены.
function stepTankStrict(field, pos, dir) {
  const dx = TANK_DX[dir], dy = TANK_DY[dir];
  const cx = pos.x + dx, cy = pos.y + dy;
  const clamp = (v, c) => (v >= c ? v - 1 : v);
  const px = clamp(cx + dx * 8, cx);
  const py = clamp(cy + dy * 8, cy);
  const tc = Math.floor(px / 8), tr = Math.floor(py / 8);
  if (tc < 0 || tc >= 32 || tr < 0 || tr >= 32) return null;
  if (!runtimePassable(field[tr * 32 + tc])) return null;
  return stepTank(pos, dir, field, runtimePassable);
}

// Солидна ли КОНКРЕТНАЯ пиксельная суб-клетка (с учётом квадрантов кирпича).
// Кирпич 0x01..0x0F кодирует занятые квадранты: bit0=TL, bit1=TR, bit2=BL, bit3=BR.
function solidPixel(mem, x, y) {
  if (x < 0 || y < 0 || x > 255 || y > 255) return true;
  const c = x >> 3, r = y >> 3;
  const v = mem[RAM.FIELD + r * 32 + c];
  if (tankPassable(v)) return false;
  if (isBrick(v)) {
    const bit = 2 * ((y & 4) ? 1 : 0) + ((x & 4) ? 1 : 0);
    return (v & (1 << bit)) !== 0;
  }
  return true; // сталь / вода
}

function fnv1a32(buf) {
  let h = 0x811c9dc5;
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i];
    h = Math.imul(h, 0x01000193) >>> 0; // 32-bit multiply (без потери точности)
  }
  return h;
}

class PvPNes extends NES {
  constructor(opts) {
    // Звук по умолчанию выключен (headless/детерминизм). Включается опциями
    // sampleRate (напр. 48000) + onAudioSample. Аудио не влияет на getFrameHash.
    super({ emulateSound: false, sampleRate: 0, onAudioSample: null, ...opts });
    // Гейт аудио: во время отката/resync переигровка кадров не должна повторно
    // эмитить сэмплы (иначе дубли/щелчки). Управляется из RollbackSession.
    this._audioSuppressed = false;
    const rawAudio = this.opts.onAudioSample;
    this.opts.onAudioSample = rawAudio
      ? (l, r) => { if (!this._audioSuppressed) rawAudio(l, r); }
      : rawAudio;
    const rawGroup = this.opts.onAudioSampleGroup;
    this.opts.onAudioSampleGroup = rawGroup
      ? (g, l, r) => { if (!this._audioSuppressed) rawGroup(g, l, r); }
      : rawGroup;
    // Декларативные стартовые опции (стадия/звёзды) — см. startup.js
    this._startup = createStartup(this);
    this.prevButtons = new Uint8Array(NUM_PLAYERS);
    this.humanTanks = new Set(); // танки, управляемые человеком (AI отключён, JS двигает)
    this.humanDefTanks = new Set(); // DEF-танки за живым игроком (ИИ не играет за них)
    this._tacticalState = new Map(); // состояние тактического ИИ (роли+скорости) между кадрами
    this._playerHumanTanks = new Set(); // танки за ЖИВЫМ игроком (setHumanTank) — их нельзя трогать при смене ИИ
    this._frame = 0; // счётчик кадров (для ритма респавна/ИИ)
    this._jsPrev = []; // прошлая позиция человеческого танка в кадре
    this._lastPlayerDir = {}; // последнее направление ввода игрока по танку (для удержания без AI-поворота)
    this._bulletBefore = {}; // состояние пули человеческого танка до кадра (подавление RNG-выстрела)
    this._playerFire = {}; // нажал ли игрок A в текущем кадре
    this._jsDir = []; // направление ввода человеческого танка в кадре
    this._frameHash = "00000000";
    this._beamFx = []; // очередь визуальных взрывов луча: {x,y,age} (только рендер, не RAM)
    // Режим ИИ атакующих (ATT 2..7): "lookahead" — предсказание будущего (A+D,
    // по умолчанию), "scan" — полное сканирование, "js" — тактический,
    // "asm" — родной ASM-ИИ (JS не пишет RAM.NET_DIR/RAM.NET_FIRE для атакующих).
    this._attAI = opts?.attAI ?? "lookahead"; // "js"|"plan"=tactical plan, "scan", "lookahead", "asm"=native
    // Режим защитников (DEF 0,1): "active" — полный ИИ (по умолчанию),
    // "stationary" — только огонь, "none" — без управления.
    this._defMode = opts?.defMode ?? "active";
    // aiEvery: вызывать мозг атакующих раз в N кадров (кэш решения) — ускорение
    // headless-тестов; 1 = каждый кадр (точное поведение).
    this._aiEvery = Math.max(1, opts?.aiEvery ?? 1);
    this._aiDecisions = null;
    // Инжекция предсказуемого RNG: подменяет sub_D44D (генерирует случайное число)
    // на фиксированное значение/последовательность, чтобы эмулятор и симулятор
    // совпадали. value: число (фикс.) или массив (цикл). null — выключено.
    this._rngInjection = null;
    this._rngIdx = 0;
    // Мозг защитников: "plan" — planDefense (по умолчанию), "scan" / "lookahead" —
    // те же движки, что и у атакующих, но с ролью "def".
    this._defAI = opts?.defAI ?? "plan";
    this._defState = new Map();
    // Трейс ИИ вынесен в отдельный класс (io/trace.js).
    this.tracer = new Tracer(opts?.traceCap ?? 500);
  }

  // Загрузка ROM как расширение (jsnes.loadROM не трогаем): грузим ОРИГИНАЛ,
  // применяем набор патчей к образу PRG в памяти ДО createMapper(), затем собираем
  // систему. Патчится только in-memory-образ, файл/эмулятор не меняются.
  loadROM(data) {
    this.rom = new ROM(this);
    this.rom.load(data);
    if (this.opts.patchSet && !assertRomContract(this.rom)) {
      // Предупреждение: образ не соответствует ожидаемому контракту Battle City.
      if (typeof console !== "undefined") console.warn("[PvPNes] ROM не соответствует rom-contract");
    }
    this.patching = null;
    if (this.opts.patchSet) {
      this.patching = applyPatchSet(this.rom, this.opts.patchSet);
    }
    this.reset();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
  }

  // После штатного reset() (jsnes создаёт новый PPU) устанавливаем наш PPU-подкласс
  // с исправлением 8x16-спрайтов и headless-режимом. Прочие компоненты — апстрим.
  reset() {
    super.reset();
    this.ppu = new BattleCityPPU(this);
    this.papu = new BattleCityPAPU(this);
    this._startup?.reinstall();
  }

  // Гейт аудио: true — onAudioSample не вызывается (переигровка при откате/resync).
  setAudioSuppressed(v) {
    this._audioSuppressed = !!v;
  }

  getAudioSuppressed() {
    return this._audioSuppressed;
  }

  // Задать стартовую стадию партии (1..35). Стадия внедряется один раз — на входе
  // sub_F000_draw_stage, до выбора данных (см. _installStartStageHook).
  setStartStage(stage) {
    this._startup.setStage(normalizeStage(stage));
    return this;
  }

  // Стартовое количество звёзд (апгрейд танка) для команды DEF, 0..3.
  // Пишется в ram_tank_upgrade (порт 0 -> $0101, порт 1 -> $0102) на старте партии.
  setStartStars(stars) {
    this._startup.setStars(stars);
    return this;
  }

  // Стартовое супер-оружие «пистолет» для DEF (аналог 4-й звезды). См. startup.js.
  setStartPistol(on) {
    this._startup.setPistol(on);
    return this;
  }


  getStageCount() {
    return STAGE_COUNT;
  }

  getStageBlocks(stage) {
    return Array.from(readStageBlocks(this.rom, stage));
  }

  getStage(stage) {
    return readStage(this.rom, stage);
  }

  // ---- input mux (edge detection для портов 2..7; порты 0,1 идут через аппарат) ----
  _setDefController(port, hold) {
    const ctl = this.controllers[port + 1];
    for (let b = 0; b < 8; b++) {
      ctl.state[b] = (hold >> b) & 1 ? 0x41 : 0x40;
    }
  }

  _injectNet(port, hold, press) {
    const idx = port - DEF_PORTS; // 0..5
    const mem = this.cpu.mem;
    const d = hold & (BTN.Right | BTN.Left | BTN.Down | BTN.Up);
    let dir = 0xff; // нет нажатия
    if (d) {
      if (hold & BTN.Up) dir = 0;
      else if (hold & BTN.Left) dir = 1;
      else if (hold & BTN.Down) dir = 2;
      else if (hold & BTN.Right) dir = 3;
    }
    mem[RAM.NET_DIR + idx] = dir;
    mem[RAM.NET_FIRE + idx] = (press & BTN.A) ? 1 : 0;
    mem[RAM.NET_RESPAWN + idx] = (press & BTN.Start) ? 1 : 0;
  }

  // ---- public API ----
  // inputs: [{port, buttons}, ...]. Прогоняет один кадр, возвращает hash кадра.
  stepFrame(inputs) {
    this._frame++;
    const mem = this.cpu.mem;
    this._resetNetZone(mem);
    const received = new Set(); // порты, получившие любой ввод (вкл. авто-старт)
    const humanControlled = new Set(); // порты с реальным управлением (направление/огонь)
    this._playerFire = {};
    this._readInputs(inputs, received, humanControlled);
    this._applyAttAIDecisions(mem, received);
    this._applyDefAIDecisions(mem, humanControlled);
    this._applyHumanPreFrame(mem);
    this._applyPistolPreFrame(mem);
    this.frame();
    // Пауза: снимаем, если её запустил Start респавна DEF-танка (а не игрок),
    // и логируем окружение вокруг причины. Вся логика паузы — в JS.
    this.handlePauseAfterFrame();
    this._applyHumanPostFrame(mem);
    this._applyPistolPostFrame(mem);
    this._renderBeamFx();
    this._unstuckTanks(mem);
    this._frameHash = this.getFrameHash();
    // Детект убийств по переходам alive->мертв (для трейса с фильтрами).
    this._detectDeaths();
    return this._frameHash;
  }

  // ==== трейс ИИ (лог решений/убийств с фильтрами во фронте) ====
  _traceEvent(ev) {
    this.tracer.event(this._frame, ev);
  }
  _isAlive(mem, t) {
    return isTankAlive(mem[RAM.TANK_FLAG + t]);
  }
  // Человеческий танк «активен на поле» (0x80..0xd0), включая состояние 0x80..0x8f
  // (крутятся гусеницы/поворот) — иначе JS бросает танк, и ASM-ИИ врага дёргает его
  // (анимация гусениц у стоящего танка). Танк мёртв (0x00) или в респавне (0xe0..0xff)
  // сюда не попадает.
  _humanTankActive(flag) {
    return isTankActive(flag);
  }
  _detectDeaths() {
    this.tracer.detectDeaths(this._frame, this.cpu.mem);
  }

  // Респавн мёртвых DEF-танков (как в planDefense, напрямую, без Start) — вынесен,
  // чтобы работал и при "off"-режиме защитников (иначе человек/союзник не возродится).
  _defRespawn(mem, def) {
    for (let t = 0; t < DEF_PORTS; t++) {
      if (mem[RAM.TANK_FLAG + t] === 0 && this._frame % 30 === 0) {
        mem[RAM.TANK_TYPE + t] = 0; // тип
        mem[RAM.TANK_X + t] = PLAYER_SPAWN_X[t]; // X
        mem[RAM.TANK_Y + t] = PLAYER_SPAWN_Y[t]; // Y
        mem[RAM.STUN + t] = 0; // стан
        mem[RAM.TANK_FLAG + t] = TANK_RESPAWN_FLAG; // флаг респавна
        def.respawn.add(t);
      }
    }
  }

  // Включить/выключить сбор трейса (по умолчанию выключен — не тратим память).
  // Обнулить сетевую RAM-зону ATT (непереданные порты = «нет ввода»).
  _resetNetZone(mem) {
    for (let i = 0; i < 6; i++) {
      mem[RAM.NET_DIR + i] = 0xff;
      mem[RAM.NET_FIRE + i] = 0;
      mem[RAM.NET_RESPAWN + i] = 0;
    }
  }

  // Прочитать входы кадров в контроллеры/сетевую зону, собрать множества received/humanControlled.
  _readInputs(inputs, received, humanControlled) {
    if (!inputs) return;
    for (const { port, buttons } of inputs) {
      if (port < 0 || port >= NUM_PLAYERS) continue;
      received.add(port);
      if (buttons & (BTN.Up | BTN.Down | BTN.Left | BTN.Right | BTN.A)) humanControlled.add(port);
      const hold = buttons & 0xff;
      const press = hold & ~this.prevButtons[port];
      this.prevButtons[port] = hold;
      if (press & BTN.A) this._playerFire[port] = true; // edge огня (DEF и ATT)
      if (port < DEF_PORTS) this._setDefController(port, hold);
      else this._injectNet(port, hold, press);
    }
  }

  // Мозг атакующих: рулит врагами (ATT 2..7) без сетевого/человеческого ввода.
  // Пишет RAM.NET_DIR/NET_FIRE; движение/коллизии/спавн исполняет ASM.
  _applyAttAIDecisions(mem, received) {
    if (!ATT_AI_MODES.has(this._attAI)) return;
    if (this._aiDecisions === null || this._frame % this._aiEvery === 0) {
      const brain = this._attAI === "scan" ? scanPlan
        : this._attAI === "lookahead" ? lookaheadPlan
        : this._attAI === "strategy-att" ? attackerPlan
        : plan;
      const tac = brain(mem, this._tacticalState);
      this._tacticalState = tac.state;
      this._aiDecisions = tac.decisions;
    }
    for (const [t, decision] of this._aiDecisions) {
      if (received.has(t) || this.humanTanks.has(t)) continue;
      this._traceEvent({ side: "att", tank: t, event: "decision", goal: decision.goal, dir: decision.dir, fire: !!decision.fire });
      if (decision.dir !== null) mem[RAM.NET_DIR + (t - DEF_PORTS)] = decision.dir;
      if (decision.fire) mem[RAM.NET_FIRE + (t - DEF_PORTS)] = 1;
    }
  }

  // Защитный ИИ DEF-танков (plan/strategy/scan/lookahead/off) + жизнь DEF-слотов.
  _applyDefAIDecisions(mem, humanControlled) {
    const startedGame = mem[RAM.ENEMIES_LEFT] !== 0xff;
// Защитный ИИ: DEF-танки (0,1) без РЕАЛЬНОГО управления игрока активно защищают
// базу. Применяется ТОЛЬКО после старта игры — во время титула/меню нельзя
// перезаписывать DEF-контроллер (затирается Start, которым стартуют игру).

let def;
if (this._defAI === "plan") {
  def = planDefense(mem, this._frame, this._defState);
} else if (this._defAI === "strategy") {
  def = strategyDefense(mem, this._frame, this._defState);
} else if (this._defAI === "off") {
  // ИИ защитников ВЫКЛЮЧЕН: ни движения, ни огня (def.buttons пуст). Респавн мёртвых
  // DEF-танков сохраняем — иначе человек/союзник после смерти не возродится.
  def = { buttons: new Map(), respawn: new Set() };
  if (startedGame) this._defRespawn(mem, def);
} else {
  // scan/lookahead защитники: те же движки, роль "def" (цель — позиция у базы,
  // враги — ATT). Решения конвертируем в кнопки контроллера.
  const brain = this._defAI === "scan" ? scanPlan : lookaheadPlan;
  const res = brain(mem, this._defState, "def");
  this._defState = res.state;
  def = { buttons: new Map(), respawn: new Set() };
  for (const [t, d] of res.decisions) {
    let b = 0;
    if (d.dir !== null) b |= DIR_BTN[d.dir];
    if (d.fire) b |= BTN.A;
    def.buttons.set(t, b);
  }
  // респавн мёртвых DEF-танков (как в planDefense, напрямую, без Start)
  if (startedGame) this._defRespawn(mem, def);
}
if (startedGame) {
  for (const [port, buttons] of def.buttons) {
    // Не трогаем танк, за которым закреплён живой игрок (в т.ч. когда он
    // бездействует) — ИИ играет только за компьютерных игроков.
    if (humanControlled.has(port) || this.humanDefTanks.has(port)) continue;
    let b = buttons;
    // Режимы защитников для экспериментов (только для planDefense):
    //  "active"     — полный planDefense (патруль+огонь),
    //  "stationary" — только огонь, без движения (стоят у базы),
    //  "none"       — без управления (базовая линия «нет защиты»).
    if (this._defMode === "stationary") b &= BTN.A | BTN.Start;
    if (this._defMode === "none") b = 0;
    let dir = null; for (let d = 0; d < 4; d++) if (b & DIR_BTN[d]) { dir = d; break; }
    this._traceEvent({ side: "def", tank: port, event: "decision", goal: "control", dir, fire: !!(b & BTN.A) });
    this._setDefController(port, b);
  }
}
// Если игрок не управляет DEF-танками, даём DEF-слотам жизни, чтобы они
// спавнились и защищали базу.
const playerOnDef = this.humanDefTanks.has(0) || this.humanDefTanks.has(1);
if (!playerOnDef) {
  for (let t = 0; t < 2; t++) {
    if (!this.humanTanks.has(t) && mem[RAM.LIVES + t] === 0) mem[RAM.LIVES + t] = 3;
  }
}
  }

  // Человеческие танки: задать направление до кадра (пули летят верно).
  _applyHumanPreFrame(mem) {
// Человеческие танки: AI отключается. JS задаёт направление (до кадра, чтобы
// пули летели верно) и позицию (после кадра — оверрайд движения ASM; при
// отсутствии ввода танк удерживается на месте и НЕ разворачивается ИИ).
// Действует ТОЛЬКО на АКТИВНО живой танк (флаг 0x90-0xD0).
for (const t of this.humanTanks) {
  const flagAddr = RAM.TANK_FLAG + t;
  const flag = mem[flagAddr];
  // 0x80..0xd0 (вкл. 0x80..0x8f «гусеницы крутятся»): управляем танком всегда,
  // чтобы ASM-ИИ врага не дёргал анимацию у стоящего человеческого танка.
  const active = this._humanTankActive(flag);
  if (!active) { this._jsPrev[t] = null; continue; } // мёртв/респавн — не трогаем
  const idx = t - DEF_PORTS;
  const dir = mem[RAM.NET_DIR + idx];
  this._jsPrev[t] = { x: mem[RAM.TANK_X + t], y: mem[RAM.TANK_Y + t] };
  this._jsDir[t] = dir;
  this._bulletBefore[t] = mem[RAM.BULLET_STATUS + t];
  // Блокируем RNG-огонь ASM для человеческого танка: sub_E162 в ветке «без RAM.NET_FIRE»
  // стреляет по RNG, и пуля успевала сталкиваться с кирпичом ДО удаления (баг:
  // самопроизвольный выстрел в упор сносил кирпич). Держим слот занятым маркером,
  // пока игрок не жмёт A; при A — освобождаем, чтобы ASM выстрелил по кнопке.
  const firing = mem[RAM.NET_FIRE + idx] === 1;
  if (firing) {
    if (mem[RAM.BULLET_STATUS + t] === HUMAN_BULLET_BUSY) mem[RAM.BULLET_STATUS + t] = 0;
  } else if (mem[RAM.BULLET_STATUS + t] === 0) {
    mem[RAM.BULLET_STATUS + t] = HUMAN_BULLET_BUSY;
  }
  if (dir !== 0xff) {
    mem[flagAddr] = movingFlag(dir);
    this._lastPlayerDir[t] = dir;
  } else if (this._lastPlayerDir[t] !== undefined) {
    // Нет ввода — держим танк в состоянии 0x80|dir (не переходное 0x88..0x8f).
    // Оно НЕ крутит гусеницы (ofs_DC52 просто декрементит флаг без EOR wheels),
    // в отличие от 0xa0 (ofs_DC7C -> движение -> EOR wheels). Спрайт тот же
    // (флаг даёт только направление), но гусеницы не анимируются у стоящего танка.
    mem[flagAddr] = standingFlag(this._lastPlayerDir[t]);
  }
}
  }

  // После кадра: движение/удержание человеческого танка (оверрайд ASM).
  _applyHumanPostFrame(mem) {
// после кадра: движение/удержание человеческого танка (JS), оверрайд ASM
for (const t of this.humanTanks) {
  const prev = this._jsPrev[t];
  if (!prev) continue;
  // Если после кадра танк НЕ активен (мёртв/респавн) — не вмешиваемся.
  const flagNow = mem[RAM.TANK_FLAG + t];
  const activeNow = this._humanTankActive(flagNow);
  if (!activeNow) { this._jsPrev[t] = null; continue; }
  const dir = this._jsDir[t];
  const field = mem.subarray(RAM.FIELD, RAM.FIELD + 32 * 32);
  let next;
  if (dir !== 0xff) {
    next = stepTankStrict(field, prev, dir) ?? prev;
    mem[RAM.TANK_FLAG + t] = movingFlag(dir);
  } else {
    next = prev; // нет ввода — удержать позицию (AI отключён)
    // Держим последнее направление в состоянии 0x80|dir (без анимации гусениц у
    // стоящего танка), чтобы ASM не развернул танк и не крутил гусеницы.
    const keep = this._lastPlayerDir[t];
    if (keep !== undefined) mem[RAM.TANK_FLAG + t] = standingFlag(keep);
  }
  mem[RAM.TANK_X + t] = next.x;
  mem[RAM.TANK_Y + t] = next.y;
  // Подавление самопроизвольного (RNG) выстрела ASM: если игрок не нажимал A,
  // а пуля танка появилась именно в этом кадре — убираем её (танк стреляет
  // только по кнопке). Свой выстрел (игрок нажал A) не трогаем.
  const playerFired = !!this._playerFire[t];
  const appeared = this._bulletBefore[t] === 0 && mem[RAM.BULLET_STATUS + t] !== 0;
  if (!playerFired && appeared) {
    mem[RAM.BULLET_STATUS + t] = 0; // снять пулю
    mem[0xba + t] = 0; // pos_X пули
    mem[0xc4 + t] = 0; // pos_Y пули
  }
}
  }

  // ==== супер-оружие «пистолет» (правила получения — ROM-патч pistol) ====
  // Запомнить состояние пули DEF-слотов до кадра (для подавления обычного выстрела).
  _applyPistolPreFrame(mem) {
    this._pistolBulletBefore = [mem[RAM.BULLET_STATUS], mem[RAM.BULLET_STATUS + 1]];
  }

  // После кадра: если игрок DEF с супер-оружием нажал огонь — исполнить луч.
  _applyPistolPostFrame(mem) {
    if (mem[RAM.ENEMIES_LEFT] === 0xff) return; // бой не начат
    const stage = mem[RAM.STAGE];
    if (stage < 1 || stage > 35) return;
    for (let t = 0; t < DEF_PORTS; t++) {
      if (mem[RAM.PISTOL + t] !== 1) continue; // ровно 1 (RAM инициализируется 0xFF)
      if (!this._playerFire[t]) continue;
      // Подавить обычную пулю, созданную ROM в этот кадр.
      if (this._pistolBulletBefore[t] === 0 && mem[RAM.BULLET_STATUS + t] !== 0) {
        mem[RAM.BULLET_STATUS + t] = 0;
      }
      this._fireRailgun(mem, t);
      const ammo = mem[RAM.PISTOL_AMMO + t] - 1;
      mem[RAM.PISTOL_AMMO + t] = ammo > 0 ? ammo : 0;
      if (ammo <= 0) mem[RAM.PISTOL + t] = 0;
    }
  }

  // Луч: прожигает линию до края поля, уничтожая тайлы, танки и пули.
  // Состояние (RAM) детерминировано и входит в saveState/rollback.
  _fireRailgun(mem, t) {
    const dir = mem[RAM.TANK_FLAG + t] & 3;
    const dx = [0, -1, 0, 1][dir];
    const dy = [-1, 0, 1, 0][dir];
    // Перпендикуляр к лучу: для вертикального выстрела — по X, для горизонтального — по Y.
    const px = dx === 0 ? 1 : 0;
    const py = dy === 0 ? 1 : 0;
    const H = PISTOL_BEAM_HALF; // ширина луча = 2*H+1 тайлов
    const originCol = mem[RAM.TANK_X + t] >> 3;
    const originRow = mem[RAM.TANK_Y + t] >> 3;
    let col = originCol;
    let row = originRow;
    for (let i = 0; i < 32; i++) {
      col += dx;
      row += dy;
      if (col < 0 || col > 31 || row < 0 || row > 31) break;
      let hitHq = false;
      for (let k = -H; k <= H; k++) {
        const c = col + px * k;
        const r = row + py * k;
        if (c < 0 || c > 31 || r < 0 || r > 31) continue;
        if (this._beamCell(mem, c, r)) hitHq = true;
      }
      if (hitHq) break;
    }
    mem[RAM.SFX_SHOT] = 1;
  }

  // Рендер взрывов луча в свободные OAM-спрайты (Y>=0xF0 — вне экрана).
  // Чистая визуализация: не пишет cpu.mem, поэтому не влияет на hash/сеть.
  // Анимация повторяет танковую: 8x16-пары тайлов 0xF1/0xF5/0xF9 (см. sub_DEE2).
  _renderBeamFx() {
    const sm = this.ppu.spriteMem;
    if (this._beamFx.length === 0) return;

    // Свободные слоты — те, что игра сама держит вне экрана (Y>=0xF0).
    // Их DMA перезаписывает каждый кадр, поэтому чистить за собой не нужно.
    const free = [];
    for (let i = 0; i < 64; i++) if (sm[i * 4] >= 0xf0) free.push(i);

    const next = [];
    let fi = 0;
    for (const fx of this._beamFx) {
      if (fi + 1 >= free.length) {
        next.push(fx); // нет места — покажем в следующих кадрах
        continue;
      }
      const T = BEAM_FX_TILES[Math.min(fx.age, BEAM_FX_TILES.length - 1)];
      const y = (fx.y - 8) & 0xff;
      const i0 = free[fi++];
      const i1 = free[fi++];
      sm[i0 * 4] = y; sm[i0 * 4 + 1] = T; sm[i0 * 4 + 2] = 0x03; sm[i0 * 4 + 3] = (fx.x - 8) & 0xff;
      sm[i1 * 4] = y; sm[i1 * 4 + 1] = (T + 2) & 0xff; sm[i1 * 4 + 2] = 0x03; sm[i1 * 4 + 3] = fx.x & 0xff;
      if (++fx.age < BEAM_FX_TILES.length) next.push(fx);
    }
    this._beamFx = next;
  }

  // Обработать одну клетку луча: тайл/танки/пули. true — попали в штаб.
  _beamCell(mem, col, row) {
    const off = row * 32 + col;
    const tile = mem[RAM.FIELD + off];
    if ((tile & 0xfc) === 0xc8) {
      this._destroyHq(mem);
      return true;
    }
    // Луч сносит всё, кроме пустого, дороги и штаба: кирпич, сталь, воду, лёд, кусты.
    if (tile !== 0 && !isEagleTile(tile) && !isRoad(tile)) {
      this._clearTile(mem, off);
      // Запустить взрыв (как у танка) на разрушенной клетке — визуальный слой.
      if (this._beamFx.length < 128) this._beamFx.push({ x: col * 8 + 4, y: row * 8 + 4, age: 0 });
    }
    this._killTanksAt(mem, col, row);
    this._clearBulletsAt(mem, col, row);
    return false;
  }

  // Уничтожить тайл: поле (коллизия) + nametable (рендер).
  _clearTile(mem, off) {
    mem[RAM.FIELD + off] = 0;
    for (const nt of this.ppu.nameTable) nt.tile[off] = 0;
  }

  // Убить живые танки, стоящие в клетке (col,row). Союзники тоже гибнут.
  _killTanksAt(mem, col, row) {
    for (let tt = 0; tt < NUM_PLAYERS; tt++) {
      const flag = mem[RAM.TANK_FLAG + tt];
      if (!(flag & 0x80) || flag >= 0xe0) continue; // только «на поле»
      if ((mem[RAM.TANK_X + tt] >> 3) !== col || (mem[RAM.TANK_Y + tt] >> 3) !== row) continue;
      mem[RAM.TANK_FLAG + tt] = 0x73; // con_tank_flag_explosion + 3
      mem[RAM.TANK_TYPE + tt] = 0;
      if (tt < DEF_PORTS) {
        mem[RAM.TANK_UPGRADE + tt] = 0;
        mem[RAM.PISTOL + tt] = 0;
        mem[RAM.PISTOL_AMMO + tt] = 0;
      }
      mem[RAM.SFX_EXPLOSION_ENEMY] = 1;
    }
  }

  // Убрать пули, находящиеся в клетке (col,row).
  _clearBulletsAt(mem, col, row) {
    for (let b = 0; b < 10; b++) {
      if ((mem[RAM.BULLET_STATUS + b] & 0xf0) !== 0x40) continue;
      if ((mem[RAM.BULLET_X + b] >> 3) !== col || (mem[RAM.BULLET_Y + b] >> 3) !== row) continue;
      mem[RAM.BULLET_STATUS + b] = 0;
    }
  }

  // Разрушить штаб (своя база тоже): тайлы разрушенного орла + поражение.
  _destroyHq(mem) {
    const base = 26 * 32 + 14; // фиксированная позиция базы (см. sub_CC08)
    const tiles = [[0, 0xcc], [1, 0xce], [32, 0xcd], [33, 0xcf]];
    for (const [d, v] of tiles) {
      mem[RAM.FIELD + base + d] = v;
      for (const nt of this.ppu.nameTable) nt.tile[base + d] = v;
    }
    mem[RAM.GAME_OVER] = 0x27; // таймер поражения (как обычная пуля по орлу)
    mem[RAM.SFX_EXPLOSION_HQ] = 1;
    mem[RAM.SFX_EXPLOSION_PLAYER] = 1;
  }

  // Анти-застревание в стене (слепая зона 2-точечной коллизии ASM).
  _unstuckTanks(mem) {
// Анти-застревание в стене (слепая зона 2-точечной коллизии ASM: центр передней
// кромки не проверяется). Если центр живого танка оказался в солидной суб-клетке —
// детерминированно выталкиваем его назад по направлению взгляда. Одинаково у обоих
// клиентов (читает только RAM), поэтому не нарушает синхронизацию.
for (let t = 0; t < NUM_PLAYERS; t++) {
  const flag = mem[RAM.TANK_FLAG + t];
  if (!isTankActive(flag)) continue; // только «на поле»
  const dir = flag & 0x03;
  for (let it = 0; it < 4; it++) {
    const x = mem[RAM.TANK_X + t], y = mem[RAM.TANK_Y + t];
    if (!solidPixel(mem, x, y)) break;
    const nx = x - TANK_DX[dir], ny = y - TANK_DY[dir];
    if (nx < 0 || nx > 255 || ny < 0 || ny > 255) break;
    mem[RAM.TANK_X + t] = nx;
    mem[RAM.TANK_Y + t] = ny;
  }
}
  }
  setTraceEnabled(v) { this.tracer.setEnabled(v); return this; }
  // Ограничить число хранимых событий (кольцевой сдвиг, первые вытесняются).
  setTraceCap(n) { this.tracer.setCap(n); return this; }
  // Копия событий трейса (id, frame, side, tank, event, goal, dir, fire).
  getTrace() { return this.tracer.get(); }
  clearTrace() { this.tracer.clear(); return this; }
  // Режимы ИИ для переключения на лету. "off" — ИИ выключен (враги заморожены,
  // союзник-защитник стоит; респавн DEF сохраняется).
  getAttModes() { return ["plan", "scan", "lookahead", "strategy-att", "asm", "off"]; }
  getDefModes() { return ["plan", "scan", "lookahead", "strategy", "off"]; }
  getAttAI() { return this._attAI; }
  getDefAI() { return this._defAI; }
  // Переключить ИИ АТАКУЮЩИХ на лету. Сбрасывает состояние мозга (иначе новый режим
  // стартует с чужим prev-состоянием и принимает случайные решения).
  setAttAI(mode) {
    if (!this.getAttModes().includes(mode)) throw new Error(`Неизвестный режим атакующих: ${mode}`);
    // Управляем ТОЛЬКО ИИ-танками (ATT 2..7), но НЕ трогаем танк живого игрока
    // (_playerHumanTanks): иначе смена режима «разчеловечивает» танк игрока, и его
    // начинает рулить атакующий ИИ (самопроизвольные выстрелы/движение).
    for (let t = 2; t < 8; t++) {
      if (this._playerHumanTanks.has(t)) continue;
      this.humanTanks.delete(t); // снять заморозку с ИИ-врагов
    }
    this._attAI = mode;
    this._aiDecisions = null;
    this._tacticalState = new Map();
    if (mode === "off") {
      // заморозить ИИ-врагов (не человеческий танк игрока)
      for (let t = 2; t < 8; t++) {
        if (this._playerHumanTanks.has(t)) continue;
        this.humanTanks.add(t);
      }
      this._traceEvent({ side: "game", event: "attAI", detail: "off" });
    } else {
      this._traceEvent({ side: "game", event: "attAI", detail: mode });
    }
    return this;
  }
  // Переключить ИИ ЗАЩИТНИКОВ на лету (сбрасывает состояние соответствующего мозга).
  setDefAI(mode) {
    if (!this.getDefModes().includes(mode)) throw new Error(`Неизвестный режим защитников: ${mode}`);
    this._defAI = mode;
    this._defState = new Map();
    if (mode === "plan") resetDefState(); // план работает с модульным defState
    this._traceEvent({ side: "game", event: "defAI", detail: mode });
    return this;
  }

  // Пометить танк как управляемый человеком: его AI отключается, движение/направление
  // задаёт JS по вводу. Остальные танки и база не меняются.
  setHumanTank(tank) {
    this.humanTanks.add(tank);
    this._playerHumanTanks.add(tank);
  }

  // Пометить DEF-танк (0..1) как танк ЖИВОГО игрока: защитный ИИ не управляет им
  // (даже когда игрок бездействует). ИИ играет только за компьютерных игроков.
  setHumanDefTank(tank) {
    this.humanDefTanks.add(tank);
  }

  // Отладка: вызвать fn при достижении PC == pc (перед исполнением инструкции по адресу).
  setPcHook(pc, fn) {
    this._pcHooks = this._pcHooks || new Map();
    this._pcHooks.set(pc, fn);
    const cpu = this.cpu;
    if (!cpu.__pcHookWrapped) {
      cpu.__pcHookWrapped = true;
      const orig = cpu.emulate.bind(cpu);
      cpu.emulate = () => {
        if (this._pcHooks && this._pcHooks.has(cpu.REG_PC)) this._pcHooks.get(cpu.REG_PC)(cpu);
        return orig();
      };
    }
    return this;
  }

  // Инжекция предсказуемого RNG (для тестов/сверки с симулятором). value — число
  // (всегда одно) или массив (циклическая последовательность). Выключает родной
  // ГСЧ эмулятора, делая вражеские решения детерминированными и сравнимыми.
  setRngInjection(value) {
    this._rngInjection = value;
    this._rngIdx = 0;
    const cpu = this.cpu;
    if (!cpu.__rngWrapped) {
      cpu.__rngWrapped = true;
      const orig = cpu.emulate.bind(cpu);
      cpu.emulate = () => {
        if (cpu.REG_PC === ROM_ADDR.RANDOM_FN) {
          const inj = this._rngInjection;
          if (inj !== null) {
            cpu.REG_ACC = Array.isArray(inj) ? inj[this._rngIdx++ % inj.length] : inj;
            cpu.REG_PC = ROM_ADDR.RANDOM_RET; // RTS: возврат из JSR sub_D44D с A = инжектированным
          }
        }
        return orig();
      };
    }
    return this;
  }

  // ТЕСТОВЫЙ ХУК: штатно активирует бонус в игре (id, позиция x/y в px).
  // Устанавливает ram_bonus_pos ($86/$87), ram_bonus_id ($88) и сбрасывает
  // ram_bonus_timer ($62)=0 — после этого игра САМА обработает появление и подбор
  // бонуса (как при штатном спавне). id: 0=каска,1=часы,2=лопата,3=звезда,4=граната,5=жизнь.
  spawnBonus(id, x, y) {
    const mem = this.cpu.mem;
    mem[RAM.PRIZE_X] = x; mem[RAM.PRIZE_Y] = y; mem[RAM.PRIZE_ID] = id; mem[RAM.BONUS_TIMER] = 0;
  }

  // ТЕСТОВЫЙ ХУК: текущий бонус на поле? (истина, если есть активный приз)
  hasBonus() {
    const mem = this.cpu.mem;
    return mem[RAM.PRIZE_ID] !== 0xff && mem[RAM.PRIZE_X] !== 0;
  }

  // Полный детерминированный state как компактный бинарный Uint8Array.
  saveState() {
    return encodeState(this);
  }

  // Восстановление состояния из бинарного снапшота (in-place, детерминированно).
  loadState(bytes) {
    decodeState(this, bytes);
    this._frameHash = this.getFrameHash();
  }

  // Хэш текущего состояния (FNV-1a по полному CPU-пространству) — для сверки
  // десинков и детерминизма. Включает RNG-регистр ($0F), т.к. он в RAM.
  getFrameHash() {
    return ("00000000" + fnv1a32(this.cpu.mem).toString(16)).slice(-8);
  }

  // Пауза в JS. Паузу (ram_pause_flag 0x6D) могут включать:
  //  1) демо/титульный экран (sub_C3B5_demo_settings ставит 1 после конца игры);
  //  2) реальный игрок на DEF нажал Start (легитимная пауза в геймплее).
  // Респавн DEF больше НЕ использует Start (прямой флаг 0xF0), поэтому паузу он
  // не тумблит. Снимаем паузу, когда игра НЕ в активном геймплее — это чисто
  // по RAM (детерминированно и rollback-безопасно).
  handlePauseAfterFrame() {
    const mem = this.cpu.mem;
    if (mem[RAM.PAUSE] === 0) return;
    const stage = mem[RAM.STAGE];
    const started = mem[RAM.ENEMIES_LEFT] !== 0xff;
    const activeGameplay = started && stage >= 1 && stage <= 35;
    if (!activeGameplay) {
      mem[RAM.PAUSE] = 0; // вне геймплея (демо/титул) — не показываем «ПАУЗА»
    }
  }

  // Доступ к RAM (для тестов/интроспекции).
  readMem(addr) {
    return this.cpu.mem[addr & 0xffff];
  }
}

export { PvPNes };
export const NET_DIR = RAM.NET_DIR, NET_FIRE = RAM.NET_FIRE, NET_RESPAWN = RAM.NET_RESPAWN, NET_STATE = RAM.NET_STATE;
export default PvPNes;
