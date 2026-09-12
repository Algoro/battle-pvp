// tower-defence.test.ts — режим tower defence: каркас (фаза 0).
// Проверяем: патч применяется, хук завершения стадии активен (JMP на рутину),
// рутина имеет ожидаемую логику (байты), фаза TD_STATE инициализируется.
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";
import { RAM } from "../rom-contract.ts";
import { TD_PHASE } from "../../shared/tower-defence.ts";
import ROMClass from "../src/rom.js";
import { applyPatchSet } from "../patching/apply.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

test("tower-defence: ROM-патч меняет fingerprint, рутина и хук на месте", () => {
  const romBase = new ROMClass(null);
  romBase.load(ROM);
  const base = applyPatchSet(romBase, "pvp");
  assert.strictEqual(base.fingerprint, "94cb0636");

  const rom = new ROMClass(null);
  rom.load(ROM);
  const rep = applyPatchSet(rom, { base: "pvp", features: ["tower-defence"] });
  assert.deepStrictEqual(rep.features, ["tower-defence"]);
  assert.notStrictEqual(rep.fingerprint, base.fingerprint);

  const routine = rep.applied.find((a: any) => a.type === "routine" && a.symbol === "sub_td_stage_end_check");
  assert.ok(routine, "рутина sub_td_stage_end_check не размещена");
  assert.strictEqual(routine.at, 0xff50);

  const hook = rep.applied.find((a: any) => a.type === "write" && a.id === "td-stage-end-hook");
  assert.ok(hook, "хук завершения стадии не применён");
  assert.strictEqual(hook.at, 0xc728);

  // JMP $FF50 на входе sub_C728
  const bank = rom.rom[0];
  const off = 0xc728 & 0x3fff;
  assert.deepStrictEqual([bank[off], bank[off + 1], bank[off + 2]], [0x4c, 0x50, 0xff]);

  // Логика рутины: LDA TD_STATE; BEQ .orig; LDA game_over; CMP #$80; BNE .orig;
  // LDA #$00; RTS; NOP NOP; .orig: LDA game_over; BNE .continue; JMP $C737; JMP $C72C
  const r = 0xff50 & 0x3fff;
  const bytes = Array.from(bank.subarray(r, r + 27));
  assert.deepStrictEqual(
    bytes,
    [
      0xad, 0xff, 0x01, 0xf0, 0x0c, 0xad, 0x68, 0x00, 0xc9, 0x80, 0xd0, 0x05, 0xa9, 0x00, 0x60, 0xea, 0xea,
      0xa5, 0x68, 0xd0, 0x03, 0x4c, 0x37, 0xc7, 0x4c, 0x2c, 0xc7,
    ],
    "байты sub_td_stage_end_check не совпали",
  );
});

test("tower-defence: runtime активирован, фаза BUILD при загрузке ROM", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: ["tower-defence"] });
  emu.loadROM(ROM);
  assert.strictEqual(emu.hasFeature("tower-defence"), true);
  assert.strictEqual(emu.readMem(RAM.TD_STATE), TD_PHASE.BUILD);
  assert.strictEqual(emu.getFeatures().includes("tower-defence"), true);
});

test("tower-defence: без фичи фаза TD выключена, хук не установлен", () => {
  const emu = new PvPNes({ patchSet: "pvp", features: [] });
  emu.loadROM(ROM);
  assert.strictEqual(emu.hasFeature("tower-defence"), false);
  assert.notStrictEqual(emu.readMem(RAM.TD_STATE), TD_PHASE.BUILD);
  assert.notDeepStrictEqual(
    [emu.mmap.load(0xc728), emu.mmap.load(0xc729), emu.mmap.load(0xc72a)],
    [0x4c, 0x50, 0xff],
    "хук не должен стоять без фичи",
  );
});
