// rollforward.js — predicting the future ON THE REAL EMULATOR (not on the JS model).
//
// Idea "B" from the plan: instead of a second source of truth (sim/*) for the lookahead prediction,
// use the emulator itself — save the state, roll forward N frames with the given
// inputs, and read the result/hashes. This guarantees the prediction matches the game.
//
// The clone is created via saveState/loadState, so determinism is preserved.
// Relative path: ./emulator-core/ai/rollforward.js
import PvPNes from "../pvp.ts";

export class EmulatorPredictor {
  romBytes: any;
  opts: any;
  emu: any;
  /**
   * @param {Uint8Array} romBytes — the original ROM (the patch is applied inside PvPNes)
   * @param {object} opts — PvPNes options (patchSet, etc.)
   */
  constructor(romBytes: any, opts: any = { patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 }) {
    this.romBytes = romBytes;
    this.opts = opts;
    this.emu = new PvPNes(opts);
    this.emu.loadROM(romBytes);
  }

  /**
   * Roll forward `steps` frames from the `stateBytes` state with inputs `inputsAt(i)`.
   * @returns {{hashes: string[], finalHash: string}}
   */
  predict(stateBytes: any, steps: any, inputsAt: (i: any) => any = () => []) {
    this.emu.loadState(stateBytes);
    const hashes: any[] = [];
    for (let i = 0; i < steps; i++) hashes.push(this.emu.stepFrame(inputsAt(i)));
    return { hashes, finalHash: hashes[hashes.length - 1] ?? this.emu.getFrameHash() };
  }
}

export default EmulatorPredictor;
