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
import { RAM, ROM } from "./rom-contract.ts";
import { starsToUpgrade, UPGRADE, PISTOL_SHOTS } from "./domain.ts";

export function normalizeStars(n: number): number {
  const v = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(3, v));
}

// Проверка контрольных байтов ROM (защита от неверной ревизии/патча).
export function assertRomContract(rom: any): boolean {
  if (!rom || !rom.rom || !rom.rom[0]) return false;
  const b = rom.rom[0];
  const at = (cpuAddr: number) => b[cpuAddr & 0x3fff];
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
  emu: any;
  stage: number | null = null;
  stars: number | null = null;
  pistol: boolean | null = null;
  _installed: boolean = false;

  constructor(emu: any) {
    this.emu = emu;
    this.stage = null; // 1..35 или null
    this.stars = null; // 0..3 или null
    this.pistol = null; // true/false или null (супер-оружие на старте)
  }

  setStage(stage: number | null): this {
    this.stage = stage == null ? null : Math.max(1, Math.min(35, Math.floor(stage) || 1));
    this.install();
    return this;
  }

  setStars(stars: number | null): this {
    this.stars = stars == null ? null : normalizeStars(stars);
    this.install();
    return this;
  }

  // Стартовое супер-оружие для DEF (аналог «4-й звезды»). true включает,
  // false/null — выключает (значение применяется на старте партии вместе со звёздами).
  setPistol(on: boolean | null): this {
    this.pistol = on == null ? null : !!on;
    this.install();
    return this;
  }

  // Установить хук (идемпотентно; безопасно вызывать после reset()).
  install(): this {
    if (this.stage == null && this.stars == null && this.pistol == null) return this;
    if (this._installed) return this; // хук уже стоит на текущем CPU
    this._installed = true;
    // REG_PC в этом ядре указывает на опкод+1, поэтому DRAW_STAGE -> DRAW_STAGE+1.
    this.emu.setPcHook(ROM.DRAW_STAGE + 1, (cpu: any) => this._apply(cpu));
    return this;
  }

  // Сброс привязки к CPU (после reset() ядра) — хук нужно поставить заново.
  reinstall(): this {
    this._installed = false;
    return this.install();
  }

  _apply(cpu: any): void {
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
    if (this.pistol != null) {
      if (this.pistol) {
        // «4-я звезда»: максимальный апгрейд + супер-оружие для обоих DEF-танков.
        cpu.mem[RAM.TANK_UPGRADE] = UPGRADE.MAX;
        cpu.mem[RAM.TANK_UPGRADE + 1] = UPGRADE.MAX;
        cpu.mem[RAM.PISTOL] = 1;
        cpu.mem[RAM.PISTOL + 1] = 1;
        cpu.mem[RAM.PISTOL_AMMO] = PISTOL_SHOTS;
        cpu.mem[RAM.PISTOL_AMMO + 1] = PISTOL_SHOTS;
      }
      this.pistol = null;
    }
  }
}

export function createStartup(emu: any): StartupInjector {
  return new StartupInjector(emu);
}

export default createStartup;
