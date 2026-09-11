import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.ts";
const emu = new PvPNes(); emu.loadROM(readFileSync("/home/am.krepkov/git/network_battle/rom/disasm/_battle_city.nes"));
// перехватим stepFrame: задаём всем живым врагам follow_HQ (0xB0) + направление вниз,
// оставляя NET_DIR=FF (ASM ведёт через bra_DDE4)
const origStep = emu.stepFrame.bind(emu);
let started=false; const all=()=>[{port:0,buttons:0},{port:1,buttons:0}];
for(let i=0;i<120;i++) origStep(all());
for(let f=0;f<4000&&!started;f++){ origStep(f%30===0?[{port:0,buttons:BTN.Start},{port:1,buttons:0}]:all()); if(emu.cpu.mem[0x80]!==0xff) started=true; }
for(let f=0; f<50000; f++){
  // задаём follow_HQ живым врагам
  for(let t=2;t<8;t++){ const flag=emu.cpu.mem[0xa0+t]; const hi=flag&0xf0; if(hi>=0x90&&hi<=0xd0){ emu.cpu.mem[0xa0+t]=0xb0|(flag&3); } }
  origStep(all());
  if(emu.cpu.mem[0x68]===0){ console.log("БАЗА РАЗРУШЕНА на кадре", f); break; }
}
console.log("gameOver", emu.cpu.mem[0x68], "enemiesLeft", emu.cpu.mem[0x80]);
