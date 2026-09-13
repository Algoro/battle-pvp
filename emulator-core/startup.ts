// startup.js — declarative "boot/apply" API for match startup options.
//
// Previously the starting stage/stars were set ad-hoc by PC hooks right in PvPNes.
// Now it is a single module: it installs ONE verifiable hook at the sub_F000_draw_stage entry
// (see rom-contract.js) and applies the options once — at match start.
//
// The ROM contract is verified against reference bytes (assertRomContract): if the image is wrong,
// it is better to fail immediately than to get inexplicable behavior.
//
// Relative path: ./emulator-core/startup.js
import { RAM, ROM } from "./rom-contract.ts";
import { starsToUpgrade, UPGRADE, PISTOL_SHOTS } from "./domain.ts";

export function normalizeStars(n: number): number {
  const v = Math.floor(Number(n) || 0);
  return Math.max(0, Math.min(3, v));
}

// ROM reference-byte check (protection against a wrong revision/patch).
export function assertRomContract(rom: any): boolean {
  if (!rom || !rom.rom || !rom.rom[0]) return false;
  const b = rom.rom[0];
  const at = (cpuAddr: number) => b[cpuAddr & 0x3fff];
  const checks = [
    // sub_F000_draw_stage: CMP #$FF (C9 FF)
    [ROM.DRAW_STAGE, 0xc9], [ROM.DRAW_STAGE + 1, 0xff],
    // stage_01 first byte (0xDD)
    [ROM.STAGE_TABLE, 0xdd],
    // tbl_DACB_block_data for block 0: 00 0F 00 0F
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
    this.stage = null; // 1..35 or null
    this.stars = null; // 0..3 or null
    this.pistol = null; // true/false or null (super-weapon at start)
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

  // Starting super-weapon for DEF (analog of the "4th star"). true enables it,
  // false/null — disables it (the value is applied at match start together with the stars).
  setPistol(on: boolean | null): this {
    this.pistol = on == null ? null : !!on;
    this.install();
    return this;
  }

  // Install the hook (idempotent; safe to call after reset()).
  install(): this {
    if (this.stage == null && this.stars == null && this.pistol == null) return this;
    if (this._installed) return this; // hook is already installed on the current CPU
    this._installed = true;
    // REG_PC in this core points at opcode+1, so DRAW_STAGE -> DRAW_STAGE+1.
    this.emu.setPcHook(ROM.DRAW_STAGE + 1, (cpu: any) => this._apply(cpu));
    return this;
  }

  // Reset the binding to the CPU (after core reset()) — the hook must be installed again.
  reinstall(): this {
    this._installed = false;
    return this.install();
  }

  _apply(cpu: any): void {
    if (this.stage != null) {
      cpu.mem[RAM.STAGE] = this.stage;
      cpu.REG_ACC = this.stage; // draw_stage receives the stage number in A
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
        // "4th star": maximum upgrade + super-weapon for both DEF tanks.
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
