// ppu-ext.js — РАСШИРЕНИЕ PPU без правок jsnes.
//
// jsnes (vendor/jsnes, pinned upstream) остаётся неизменным. Здесь — подкласс PPU,
// который переопределяет два поведения:
//   1. renderFramePartially: при opts.noRender пропускает дорогую пиксельную
//      композицию (headless/AI-тесты), сохраняя side-effects маппера и тайминг.
//   2. renderSpritesPartially: исправляет апстрим-баг индексации верхнего тайла
//      8x16-спрайтов. Метод скопирован ВЕРБАТИМ из upstream-коммита за исключением
//      одной строки (top = topTileNum - 1 + 256  ->  top = topTileNum + 256).
//      При обновлении jsnes этот override надо сверить с новой версией метода.
//
// Относительный путь: ./emulator-core/ppu-ext.js
import PPU from "./src/ppu/index.js";

export class BattleCityPPU extends PPU {
  // Headless-режим: не рисуем пиксели, но сохраняем latch/onSpriteRender/onBgRender.
  renderFramePartially(startScan, scanCount) {
    if (!this.nes.opts || !this.nes.opts.noRender) {
      return super.renderFramePartially(startScan, scanCount);
    }
    this._inRendering = true;
    this.nes.mmap.onSpriteRender();
    this.nes.mmap.onBgRender();
    this._inRendering = false;
    this.validTileData = false;
  }

  // Исправленная версия upstream renderSpritesPartially (см. комментарий выше).
  renderSpritesPartially(startscan, scancount, bgPri) {
    if (this.f_spVisibility !== 1) return;

    const mmap = this.nes.mmap;
    const ptTile = this.ptTile;
    const buffer = this.buffer;
    const sprPalette = this.sprPalette;
    const pixrendered = this.pixrendered;

    for (let scan = startscan; scan < startscan + scancount; scan++) {
      if (scan < 0 || scan >= 240) continue;

      const count = this.scanlineSpriteCount[scan];
      const oamBase = scan * 32;

      for (let i = 0; i < count; i++) {
        const sprY = this.scanlineSecondaryOAM[oamBase + i * 4 + 0];
        const sprTile = this.scanlineSecondaryOAM[oamBase + i * 4 + 1];
        const sprAttr = this.scanlineSecondaryOAM[oamBase + i * 4 + 2];
        const sprX = this.scanlineSecondaryOAM[oamBase + i * 4 + 3];

        const vertFlip = (sprAttr >> 7) & 1;
        const horiFlip = (sprAttr >> 6) & 1;
        const priority = (sprAttr >> 5) & 1;
        const palAdd = (sprAttr & 3) << 2;

        if (priority !== bgPri) continue;
        if (this.f_spriteSize === 0) {
          // 8x8 sprites
          const tileIndex = this.f_spPatternTable === 0 ? sprTile : sprTile + 256;
          const sprBaseAddr = this.f_spPatternTable === 0 ? 0x0000 : 0x1000;

          // Render only the one scanline row that falls on 'scan'
          const dy = sprY + 1; // +1 because sprite Y in OAM is display line - 1
          const fineY = scan - dy;
          if (fineY < 0 || fineY >= 8) continue;

          ptTile[tileIndex].render(
            buffer,
            0,
            fineY,
            8,
            fineY + 1,
            sprX,
            dy,
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i, // priority: lower index in secondary OAM = higher priority
            pixrendered,
          );

          // Mapper latch: simulate PPU's sprite pattern table fetch.
          mmap.latchAccess(sprBaseAddr + sprTile * 16 + 8);
        } else {
          // 8x16 sprites: tile index bit 0 selects pattern table ($0000/$1000),
          // top tile is (index & $FE), bottom tile is (index & $FE) + 1.
          const sprBaseAddr = (sprTile & 1) !== 0 ? 0x1000 : 0x0000;
          const topTileNum = sprTile & 0xfe;
          // FIX (было `topTileNum - 1 + 256`): верхний тайл = (index & $FE).
          const top = (sprTile & 1) !== 0 ? topTileNum + 256 : topTileNum;

          const dy = sprY + 1;
          const fineY = scan - dy;
          if (fineY < 0 || fineY >= 16) continue;

          // Determine which half (top/bottom) this scanline falls in
          let tileOffset, tileFineY;
          if (fineY < 8) {
            tileOffset = vertFlip ? 1 : 0;
            tileFineY = fineY;
          } else {
            tileOffset = vertFlip ? 0 : 1;
            tileFineY = fineY - 8;
          }

          ptTile[top + tileOffset].render(
            buffer,
            0,
            tileFineY,
            8,
            tileFineY + 1,
            sprX,
            dy + (fineY < 8 ? 0 : 8),
            palAdd,
            sprPalette,
            horiFlip,
            vertFlip,
            i,
            pixrendered,
          );

          // Mapper latch: simulate fetches for both halves of 8x16 sprite.
          mmap.latchAccess(sprBaseAddr + topTileNum * 16 + 8);
          mmap.latchAccess(sprBaseAddr + (topTileNum + 1) * 16 + 8);
        }
      }
    }
  }
}

export default BattleCityPPU;
