// startup.js — декларативный «boot/apply» API стартовых опций партии.
//
// Раньше стартовые стадия/звёзды выставлялись ad-hoc PC-хуками прямо в PvPNes.
// Теперь это единый модуль: он ставит ОДИН проверяемый хук на вход sub_F000_draw_stage
// (см. rom-contract.js) и применяет опции один раз — на старте партии.
//
// Контракт ROM проверяется по контрольным байтам (assertRomContract): если образ не тот,
// лучше упасть сразу, чем получить необъяснимое поведение.
//
// Относительный путь: ./emulator-core/startup.js
import { RAM, ROM } from "./rom-contract.js";
import { starsToUpgrade } from "./domain.js";

export function normalizeStars(n) {
  const v = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(3, v));
}

// Проверка контрольных байтов ROM (защита от неверной ревизии/патча).
export function assertRomContract(rom) {
  if (!rom || !rom.rom || !rom.rom[0]) return false;
  const b = rom.rom[0];
  const at = (cpuAddr) => b[cpuAddr & 0x3fff];
  const checks = [
    // sub_F000_draw_stage: CMP #$FF (C9 FF)
    [ROM.DRAW_STAGE, 0xc9], [ROM.DRAW_STAGE + 1, 0xff],
    // stage_01 первый байт (0xDD)
    [ROM.STAGE_TABLE, 0xdd],
    // tbl_DACB_block_data для блока 0: 00 0F 00 0F
    [ROM.BLOCK_TILES, 0x00], [ROM.BLOCK_TILES + 1, 0x0f],
    [ROM.BLOCK_TILES + 2, 0x00], [ROM.BLOCK_TILES + 3, 0x0f],
  ];
  for (const [addr, val] of checks) if (at(addr) !== val) return false;
  return true;
}

export class StartupInjector {
  constructor(emu) {
    this.emu = emu;
    this.stage = null; // 1..35 или null
    this.stars = null; // 0..3 или null
  }

  setStage(stage) {
    this.stage = stage == null ? null : Math.max(1, Math.min(35, Math.floor(stage) || 1));
    this.install();
    return this;
  }

  setStars(stars) {
    this.stars = stars == null ? null : normalizeStars(stars);
    this.install();
    return this;
  }

  // Установить хук (идемпотентно; безопасно вызывать после reset()).
  install() {
    if (this.stage == null && this.stars == null) return this;
    if (this._installed) return this; // хук уже стоит на текущем CPU
    this._installed = true;
    // REG_PC в этом ядре указывает на опкод+1, поэтому DRAW_STAGE -> DRAW_STAGE+1.
    this.emu.setPcHook(ROM.DRAW_STAGE + 1, (cpu) => this._apply(cpu));
    return this;
  }

  // Сброс привязки к CPU (после reset() ядра) — хук нужно поставить заново.
  reinstall() {
    this._installed = false;
    return this.install();
  }

  _apply(cpu) {
    if (this.stage != null) {
      cpu.mem[RAM.STAGE] = this.stage;
      cpu.REG_ACC = this.stage; // draw_stage получает номер стадии в A
      this.stage = null;
    }
    if (this.stars != null) {
      const up = starsToUpgrade(this.stars); // 0x00/0x20/0x40/0x60
      cpu.mem[RAM.TANK_UPGRADE] = up;
      cpu.mem[RAM.TANK_UPGRADE + 1] = up;
      this.stars = null;
    }
  }
}

export function createStartup(emu) {
  return new StartupInjector(emu);
}

export default createStartup;
