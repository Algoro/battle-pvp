import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
import { loadAndStart } from "./tests/test-utils.js";
const ROM = "/home/am.krepkov/git/network_battle/rom/disasm/_battle_city.nes";
const emu = loadAndStart(ROM);
let startEvents=0;
for(let f=0; f<6000; f++){
  emu.stepFrame([{port:0,buttons:0},{port:1,buttons:0}]);
  const bp = emu.cpu.mem[0x08];
  if(bp & 0x08){ // Start bit
    startEvents++;
    if(startEvents<=8) console.log(`f=${f} ram_btn_press=0x${bp.toString(16)} (Start set) pause=0x${emu.cpu.mem[0x6d].toString(16)}`);
  }
}
console.log("кадров со Start в btn_press:", startEvents);
