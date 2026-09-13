// ppu-ext.test.js — verification of the PPU extension (without modifying jsnes):
//  1) fixing the top-tile index of 8x16 sprites;
//  2) the headless noRender mode does not draw pixels but preserves side-effects.
// Run: node --test tests/ppu-ext.test.js
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import PvPNes from "../pvp.ts";
import PPU from "../src/ppu/index.js";
import BattleCityPPU from "../ppu-ext.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROM = readFileSync(join(__dirname, "..", "..", "rom", "original", "_battle_city.nes"));

function spyTile() {
  const t = { calls: 0, render() { t.calls++; } };
  return t;
}

function setupSprite16() {
  const nes = new PvPNes();
  nes.loadROM(ROM);
  const ppu = nes.ppu;
  const spies = {};
  const arr = new Array(512);
  for (let i = 0; i < 512; i++) arr[i] = { render() {} };
  for (const idx of [0x1af, 0x1b0, 0x1b1]) { spies[idx] = spyTile(); arr[idx] = spies[idx]; }
  ppu.ptTile = arr;

  ppu.f_spVisibility = 1;
  ppu.f_spriteSize = 1; // 8x16
  // one sprite: tile $B1 (odd -> pattern table $1000, top = $1B0), scan 10, sprY=2
  ppu.scanlineSpriteCount[10] = 1;
  const base = 10 * 32;
  ppu.scanlineSecondaryOAM[base + 0] = 2; // sprY
  ppu.scanlineSecondaryOAM[base + 1] = 0xb1; // sprTile
  ppu.scanlineSecondaryOAM[base + 2] = 0; // attr
  ppu.scanlineSecondaryOAM[base + 3] = 10; // sprX
  return { nes, ppu, spies };
}

test("PPU-расширение: 8x16 спрайт использует top=$1B0, а не $1AF", () => {
  const { ppu, spies } = setupSprite16();
  ppu.renderSpritesPartially(10, 1, 0); // fineY=7 -> top half
  assert.strictEqual(spies[0x1b0].calls, 1, "верхний тайл должен быть $B0");
  assert.strictEqual(spies[0x1af].calls, 0, "баг: использован $AF");

  spies[0x1b0].calls = 0;
  // the same OAM entry for scan 12 (bottom half, fineY=9)
  ppu.scanlineSpriteCount[12] = 1;
  const b2 = 12 * 32;
  ppu.scanlineSecondaryOAM[b2 + 0] = 2;
  ppu.scanlineSecondaryOAM[b2 + 1] = 0xb1;
  ppu.scanlineSecondaryOAM[b2 + 2] = 0;
  ppu.scanlineSecondaryOAM[b2 + 3] = 10;
  ppu.renderSpritesPartially(12, 1, 0); // fineY=9 -> bottom half (+1)
  assert.strictEqual(spies[0x1b1].calls, 1, "нижний тайл должен быть $B1");
});

test("PPU-расширение: noRender пропускает пиксели, но сохраняет side-effects", () => {
  const { nes, ppu, spies } = setupSprite16();
  nes.opts.noRender = true;
  ppu.renderFramePartially(0, 240);
  assert.strictEqual(spies[0x1b0].calls, 0, "при noRender пиксели не рисуются");
  assert.strictEqual(ppu._inRendering, false, "_inRendering должен быть сброшен");
});

test("PPU-расширение: подкласс переопределяет методы, но не меняет jsnes", () => {
  assert.notStrictEqual(BattleCityPPU.prototype.renderSpritesPartially, PPU.prototype.renderSpritesPartially);
  assert.notStrictEqual(BattleCityPPU.prototype.renderFramePartially, PPU.prototype.renderFramePartially);
  const nes = new PvPNes();
  nes.loadROM(ROM);
  assert.ok(nes.ppu instanceof BattleCityPPU, "PvPNes должен ставить BattleCityPPU");
});
