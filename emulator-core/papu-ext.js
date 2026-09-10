// papu-ext.js — РАСШИРЕНИЕ APU без правок jsnes.
//
// Подкласс PAPU с раздельным миксом на две группы:
//   music = pulse1 + pulse2 + triangle
//   sfx   = noise + dmc
// jsnes остаётся неизменным; метод sample() скопирован из upstream и адаптирован.
// Наружу отдаёт `onAudioSampleGroup(group, L, R)`; если он не задан — падает обратно
// на `onAudioSample(L, R)` с суммарным миксом (обратная совместимость).
//
// Относительный путь: ./emulator-core/papu-ext.js
import PAPU from "./src/papu/index.js";

const clampIdx = (i, len) => (i >= len ? len - 1 : i < 0 ? 0 : i);

export class BattleCityPAPU extends PAPU {
  constructor(nes) {
    super(nes);
    // Отдельные DC-removal состояния для двух групп (фильтр линеен, сумма ≈ оригинал).
    this.gMusicPrevL = 0; this.gMusicAccL = 0; this.gMusicPrevR = 0; this.gMusicAccR = 0;
    this.gSfxPrevL = 0; this.gSfxAccL = 0; this.gSfxPrevR = 0; this.gSfxAccR = 0;
  }

  sample() {
    // --- нормализация накопленных значений каналов (как в upstream) ---
    if (this.accCount > 0) {
      this.smpSquare1 = Math.floor((this.smpSquare1 << 4) / this.accCount);
      this.smpSquare2 = Math.floor((this.smpSquare2 << 4) / this.accCount);
      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);
      this.smpDmc = Math.floor((this.smpDmc << 4) / this.accCount);
      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }
    const smpNoise = Math.floor((this.noise.accValue << 4) / this.noise.accCount);
    this.noise.accValue = smpNoise >> 4;
    this.noise.accCount = 1;

    const sq = this.square_table;
    const tnd = this.tnd_table;
    const dc = this.dcValue;

    const dsp = this; // eslint-disable-line
    const dcBlock = (value, prevKey, accKey) => {
      const diff = value - dsp[prevKey];
      dsp[prevKey] += diff;
      dsp[accKey] += diff - (dsp[accKey] >> 10);
      return dsp[accKey];
    };

    // --- левый канал: музыка ---
    let sqL = (this.smpSquare1 * this.stereoPosLSquare1 + this.smpSquare2 * this.stereoPosLSquare2) >> 8;
    let triL = (3 * this.smpTriangle * this.stereoPosLTriangle) >> 8;
    let musicL = sq[clampIdx(sqL, sq.length)] + tnd[clampIdx(triL, tnd.length)] - dc;
    musicL = dcBlock(musicL, "gMusicPrevL", "gMusicAccL");
    // --- левый канал: эффекты ---
    let ndL = ((smpNoise << 1) * this.stereoPosLNoise + this.smpDmc * this.stereoPosLDMC) >> 8;
    let sfxL = tnd[clampIdx(ndL, tnd.length)];
    sfxL = dcBlock(sfxL, "gSfxPrevL", "gSfxAccL");

    // --- правый канал: музыка ---
    let sqR = (this.smpSquare1 * this.stereoPosRSquare1 + this.smpSquare2 * this.stereoPosRSquare2) >> 8;
    let triR = (3 * this.smpTriangle * this.stereoPosRTriangle) >> 8;
    let musicR = sq[clampIdx(sqR, sq.length)] + tnd[clampIdx(triR, tnd.length)] - dc;
    musicR = dcBlock(musicR, "gMusicPrevR", "gMusicAccR");
    // --- правый канал: эффекты ---
    let ndR = ((smpNoise << 1) * this.stereoPosRNoise + this.smpDmc * this.stereoPosRDMC) >> 8;
    let sfxR = tnd[clampIdx(ndR, tnd.length)];
    sfxR = dcBlock(sfxR, "gSfxPrevR", "gSfxAccR");

    const opts = this.nes.opts;
    if (opts.onAudioSampleGroup) {
      opts.onAudioSampleGroup("music", musicL / 32768, musicR / 32768);
      opts.onAudioSampleGroup("sfx", sfxL / 32768, sfxR / 32768);
    } else if (opts.onAudioSample) {
      opts.onAudioSample((musicL + sfxL) / 32768, (musicR + sfxR) / 32768);
    }

    // --- сброс накопленных значений каналов (как в upstream) ---
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }
}

export default BattleCityPAPU;
