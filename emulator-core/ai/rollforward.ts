// rollforward.js — предсказание будущего НА РЕАЛЬНОМ эмуляторе (не на JS-модели).
//
// Идея «B» из плана: вместо второго источника истины (sim/*) для lookahead-прогноза
// использовать сам эмулятор — сохранить состояние, прокрутить N кадров с заданными
// входами и прочитать результат/хэши. Это гарантирует, что прогноз совпадает с игрой.
//
// Клон создаётся через saveState/loadState, поэтому детерминизм сохраняется.
// Относительный путь: ./emulator-core/ai/rollforward.js
import PvPNes from "../pvp.ts";

export class EmulatorPredictor {
  romBytes: any;
  opts: any;
  emu: any;
  /**
   * @param {Uint8Array} romBytes — оригинальный ROM (патч применяется внутри PvPNes)
   * @param {object} opts — опции PvPNes (patchSet и т.п.)
   */
  constructor(romBytes: any, opts: any = { patchSet: "pvp", attAI: "off", defAI: "off", sampleRate: 0 }) {
    this.romBytes = romBytes;
    this.opts = opts;
    this.emu = new PvPNes(opts);
    this.emu.loadROM(romBytes);
  }

  /**
   * Прокрутить `steps` кадров от состояния `stateBytes` с входами `inputsAt(i)`.
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
