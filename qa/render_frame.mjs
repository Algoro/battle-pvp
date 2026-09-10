import { writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import PvPNes, { BTN } from "../emulator-core/pvp.js";
const ROM = "/home/am.krepkov/git/network_battle/rom/disasm/_battle_city.nes";
const emu = new PvPNes();
emu.loadROM(readFileSync(ROM));
for (let i = 0; i < 60; i++) emu.stepFrame([{ port: 0, buttons: 0 }]);
for (let a = 0; a < 12; a++) { emu.stepFrame([{ port: 0, buttons: BTN.Start }]); for (let i = 0; i < 30; i++) emu.stepFrame([{ port: 0, buttons: 0 }]); if (emu.cpu.mem[0x80] === 20) break; }
emu.setHumanTank(2);
let tx,ty;
for (let f=0; f<1500; f++){
  emu.stepFrame([{ port: 0, buttons: 0 }, { port: 1, buttons: 0 }, { port: 2, buttons: 0 }]);
  tx=emu.cpu.mem[0x92]; ty=emu.cpu.mem[0x9a];
  const hi=emu.cpu.mem[0xa2]&0xf0;
  if (hi>=0x90&&hi<=0xd0 && ty>40 && ty<220 && tx>16 && tx<240) break;
}
// экспорт в PNG (PPM, простой формат) через Python
const buf = emu.ppu.buffer;
const W=256,H=240;
let rows = `P6\n${W} ${H}\n255\n`;
const bytes=[];
for (let i=0;i<W*H;i++){ const c=buf[i]; bytes.push((c>>16)&0xff, (c>>8)&0xff, c&0xff); }
writeFileSync("/tmp/kilo/frame.ppm", Buffer.concat([Buffer.from("P6\n"+W+" "+H+"\n255\n"), Buffer.from(bytes)]));
console.log("tank2 at", tx, ty);
// ASCII-карта танка (по непустым пикселям) в ограничивающем боксе 17x17
console.log("tank region ASCII (grey-scale):");
for (let dy=-2; dy<15; dy++){
  let row="";
  for (let dx=-2; dx<15; dx++){
    const y=ty+dy, x=tx+dx;
    if(y<0||y>=240||x<0||x>=256){ row+=" "; continue; }
    const c=buf[y*256+x];
    const lum=((c>>16)&0xff)*0.3+((c>>8)&0xff)*0.59+(c&0xff)*0.11;
    row += lum>200?"#":lum>120?"+":lum>40?".":" ";
  }
  console.log(row);
}
