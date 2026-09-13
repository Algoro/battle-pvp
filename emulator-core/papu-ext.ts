// papu-ext.js — APU EXTENSION without modifying jsnes.
//
// Subclass of PAPU with separate mixing into two groups:
//   music = pulse1 + pulse2 + triangle
//   sfx   = noise + dmc
// jsnes stays unchanged; sample() is copied from upstream and adapted.
// Exposes `onAudioSampleGroup(group, L, R)`; if it is not set, it falls back
// to `onAudioSample(L, R)` with the summed mix (backward compatibility).
//
// Relative path: ./emulator-core/papu-ext.js
import PAPU from "./src/papu/index.js";

const PAPUBase: any = PAPU;

const clampIdx = (i: number, len: number) => (i >= len ? len - 1 : i < 0 ? 0 : i);

export class BattleCityPAPU extends PAPUBase {
  declare gMusicPrevL: number;
  declare gMusicAccL: number;
  declare gMusicPrevR: number;
  declare gMusicAccR: number;
  declare gSfxPrevL: number;
  declare gSfxAccL: number;
  declare gSfxPrevR: number;
  declare gSfxAccR: number;

  constructor(nes: any) {
    super(nes);
    // Separate DC-removal states for the two groups (the filter is linear, sum ≈ original).
    this.gMusicPrevL = 0; this.gMusicAccL = 0; this.gMusicPrevR = 0; this.gMusicAccR = 0;
    this.gSfxPrevL = 0; this.gSfxAccL = 0; this.gSfxPrevR = 0; this.gSfxAccR = 0;
  }

  sample(): void {
    // --- normalization of accumulated channel values (as in upstream) ---
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

    const dsp: any = this;
    const dcBlock = (value: number, prevKey: string, accKey: string) => {
      const diff = value - dsp[prevKey];
      dsp[prevKey] += diff;
      dsp[accKey] += diff - (dsp[accKey] >> 10);
      return dsp[accKey];
    };

    // --- left channel: music ---
    const sqL = (this.smpSquare1 * this.stereoPosLSquare1 + this.smpSquare2 * this.stereoPosLSquare2) >> 8;
    const triL = (3 * this.smpTriangle * this.stereoPosLTriangle) >> 8;
    let musicL = sq[clampIdx(sqL, sq.length)] + tnd[clampIdx(triL, tnd.length)] - dc;
    musicL = dcBlock(musicL, "gMusicPrevL", "gMusicAccL");
    // --- left channel: effects ---
    const ndL = ((smpNoise << 1) * this.stereoPosLNoise + this.smpDmc * this.stereoPosLDMC) >> 8;
    let sfxL = tnd[clampIdx(ndL, tnd.length)];
    sfxL = dcBlock(sfxL, "gSfxPrevL", "gSfxAccL");

    // --- right channel: music ---
    const sqR = (this.smpSquare1 * this.stereoPosRSquare1 + this.smpSquare2 * this.stereoPosRSquare2) >> 8;
    const triR = (3 * this.smpTriangle * this.stereoPosRTriangle) >> 8;
    let musicR = sq[clampIdx(sqR, sq.length)] + tnd[clampIdx(triR, tnd.length)] - dc;
    musicR = dcBlock(musicR, "gMusicPrevR", "gMusicAccR");
    // --- right channel: effects ---
    const ndR = ((smpNoise << 1) * this.stereoPosRNoise + this.smpDmc * this.stereoPosRDMC) >> 8;
    let sfxR = tnd[clampIdx(ndR, tnd.length)];
    sfxR = dcBlock(sfxR, "gSfxPrevR", "gSfxAccR");

    const opts = this.nes.opts;
    if (opts.onAudioSampleGroup) {
      opts.onAudioSampleGroup("music", musicL / 32768, musicR / 32768);
      opts.onAudioSampleGroup("sfx", sfxL / 32768, sfxR / 32768);
    } else if (opts.onAudioSample) {
      opts.onAudioSample((musicL + sfxL) / 32768, (musicR + sfxR) / 32768);
    }

    // --- reset of accumulated channel values (as in upstream) ---
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }
}

export default BattleCityPAPU;
