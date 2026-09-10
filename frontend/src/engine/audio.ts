// audio.ts — аудио-вывод из APU ядра в браузере с раздельными группами music/sfx.
// Сэмплы приходят из onAudioSampleGroup (см. EmulatorDriver) и складываются в
// кольцевые буферы AudioWorklet. Для каждой группы — своя громкость и mute.
// Autoplay policy: контекст поднимается после первого жеста. Аудио не влияет на детерминизм.
// @ts-nocheck

const WORKLET = `
class NesAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.cap = 32768;
    const ring = () => ({ bufL: new Float32Array(this.cap), bufR: new Float32Array(this.cap), read: 0, write: 0, count: 0 });
    this.music = ring();
    this.sfx = ring();
    this.mGain = 1; this.sGain = 1;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.type === "gains") { this.mGain = d.m; this.sGain = d.s; return; }
      if (d.type !== "samples") return;
      const r = d.group === "music" ? this.music : this.sfx;
      const l = d.left, rr = d.right;
      if (r.count + l.length > this.cap) {
        const drop = r.count + l.length - this.cap;
        r.read = (r.read + drop) % this.cap; r.count -= drop;
      }
      for (let i = 0; i < l.length; i++) {
        r.bufL[r.write] = l[i]; r.bufR[r.write] = rr[i];
        r.write = (r.write + 1) % this.cap;
      }
      r.count += l.length;
    };
  }
  _pull(r, outL, outR, i) {
    if (r.count > 0) {
      outL[i] += r.bufL[r.read] * (r === this.music ? this.mGain : this.sGain);
      outR[i] += r.bufR[r.read] * (r === this.music ? this.mGain : this.sGain);
      r.read = (r.read + 1) % this.cap; r.count--;
    }
  }
  process(inputs, outputs) {
    const out = outputs[0];
    if (!out || out.length < 2) return true;
    const outL = out[0], outR = out[1], n = outL.length;
    for (let i = 0; i < n; i++) { outL[i] = 0; outR[i] = 0; this._pull(this.music, outL, outR, i); this._pull(this.sfx, outL, outR, i); }
    return true;
  }
}
registerProcessor("nes-audio", NesAudioProcessor);
`;

const FLUSH_SAMPLES = 512;
const LS = {
  musicVol: "bcpvp.music.volume",
  sfxVol: "bcpvp.sfx.volume",
  musicMuted: "bcpvp.music.muted",
  sfxMuted: "bcpvp.sfx.muted",
  legacyVol: "bcpvp.volume",
  legacyMuted: "bcpvp.muted",
};

function loadNum(key, def) {
  const v = parseFloat(localStorage.getItem(key) ?? "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def;
}

export class AudioOutput {
  private ctx: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private ready = false;
  private starting = false;
  private buffers = { music: { l: [], r: [] }, sfx: { l: [], r: [] } };
  private counters = { music: 0, sfx: 0, postedMusic: 0, postedSfx: 0, flushes: 0 };

  musicVolume: number;
  sfxVolume: number;
  musicMuted: boolean;
  sfxMuted: boolean;

  constructor() {
    const legacyVol = localStorage.getItem(LS.legacyVol);
    const legacyMuted = localStorage.getItem(LS.legacyMuted) === "1";
    this.musicVolume = loadNum(LS.musicVol, legacyVol != null ? loadNum(LS.legacyVol, 0.5) : 0.5);
    this.sfxVolume = loadNum(LS.sfxVol, legacyVol != null ? loadNum(LS.legacyVol, 0.5) : 0.6);
    this.musicMuted = (localStorage.getItem(LS.musicMuted) ?? (legacyMuted ? "1" : "0")) === "1";
    this.sfxMuted = (localStorage.getItem(LS.sfxMuted) ?? (legacyMuted ? "1" : "0")) === "1";
    const unlock = () => this.start();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
  }

  async start() {
    if (this.ready || this.starting) return;
    this.starting = true;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx({ latencyHint: "interactive" });
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      this.node = new AudioWorkletNode(this.ctx, "nes-audio", { outputChannelCount: [2] });
      this.node.connect(this.ctx.destination);
      this._pushGains();
      await this.ctx.resume();
      this.ready = true;
    } catch {
      this.ready = false;
    } finally {
      this.starting = false;
    }
  }

  private _gain(g) {
    return g === "music" ? (this.musicMuted ? 0 : this.musicVolume) : (this.sfxMuted ? 0 : this.sfxVolume);
  }

  private _pushGains() {
    if (this.node) this.node.port.postMessage({ type: "gains", m: this._gain("music"), s: this._gain("sfx") });
  }

  pushGroup(group: "music" | "sfx", l: number, r: number) {
    if (!this.ready) return;
    if (group === "music" ? this.musicMuted || this.musicVolume <= 0 : this.sfxMuted || this.sfxVolume <= 0) return;
    const b = this.buffers[group];
    b.l.push(l); b.r.push(r);
    this.counters[group]++;
    if (b.l.length >= FLUSH_SAMPLES) this._flush(group);
  }

  private _flush(group: "music" | "sfx") {
    if (!this.node) return;
    const b = this.buffers[group];
    if (!b.l.length) return;
    const left = Float32Array.from(b.l);
    const right = Float32Array.from(b.r);
    const len = left.length;
    b.l.length = 0; b.r.length = 0;
    try {
      this.node.port.postMessage({ type: "samples", group, left, right }, [left.buffer, right.buffer]);
    } catch { return; }
    this.counters[group === "music" ? "postedMusic" : "postedSfx"] += len;
    this.counters.flushes++;
  }

  setMusicVolume(v: number) { this.musicVolume = Math.min(1, Math.max(0, v)); localStorage.setItem(LS.musicVol, String(this.musicVolume)); this._pushGains(); }
  setSfxVolume(v: number) { this.sfxVolume = Math.min(1, Math.max(0, v)); localStorage.setItem(LS.sfxVol, String(this.sfxVolume)); this._pushGains(); }
  setMusicMuted(m: boolean) { this.musicMuted = !!m; localStorage.setItem(LS.musicMuted, this.musicMuted ? "1" : "0"); this._pushGains(); }
  setSfxMuted(m: boolean) { this.sfxMuted = !!m; localStorage.setItem(LS.sfxMuted, this.sfxMuted ? "1" : "0"); this._pushGains(); }

  async suspend() { try { await this.ctx?.suspend(); } catch { /* ignore */ } }
  async resume() { try { await this.ctx?.resume(); } catch { /* ignore */ } }

  stats() {
    return {
      ready: this.ready, state: this.ctx?.state ?? "none",
      music: { samples: this.counters.music, posted: this.counters.postedMusic, volume: this.musicVolume, muted: this.musicMuted },
      sfx: { samples: this.counters.sfx, posted: this.counters.postedSfx, volume: this.sfxVolume, muted: this.sfxMuted },
      posted: this.counters.postedMusic + this.counters.postedSfx,
      flushes: this.counters.flushes,
    };
  }
}

export default AudioOutput;
