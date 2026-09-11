// sim/observer.js — ПАССИВНЫЙ наблюдатель эмулятора.
// Читает mem до/после каждого кадра и эмитит ТЕ ЖЕ семантические события, что
// GameSim (tankMoved, bulletFired, bulletMoved, bulletHitBrick, brickDestroyed,
// bulletHitTank, tankDestroyed, bulletDestroyed). НЕ изменяет mem и НЕ влияет на
// поведение ИИ/игры — это чисто диагностический слой для сверки кадр-в-кадр.
//
// Использование:
//   const obs = new EmuObserver(emu);          // оборачивает emu.stepFrame
//   emu.stepFrame(inputs);                      // игра идёт как обычно
//   obs.events                                  // события за прошедшие кадры
import { FIELD, isBrick } from "../model/game-view.ts";

function alive(flag: number): boolean { const hi = flag & 0xf0; return hi >= 0x90 && hi <= 0xd0; }

export class EmuObserver {
  declare emu: any;
  declare events: any[];
  declare prev: any;
  declare cur: any;
  constructor(emu: any) {
    this.emu = emu;
    this.events = [];
    this.prev = null;
    this._wrap();
  }
  // Обёртка stepFrame: только читаем состояние, не пишем.
  _wrap(): void {
    const orig = this.emu.stepFrame.bind(this.emu);
    this.emu.stepFrame = (inputs: any) => {
      this.prev = this._read();
      const r = orig(inputs);
      this.cur = this._read();
      this._diff();
      return r;
    };
  }
  _read() {
    const m = this.emu.cpu.mem;
    const tanks = [];
    for (let t = 0; t < 8; t++) {
      tanks.push({ x: m[0x90 + t], y: m[0x98 + t], flag: m[0xa0 + t], type: m[0xa8 + t] });
    }
    const bullets = [];
    for (let t = 0; t < 8; t++) {
      const s = m[0xcc + t];
      if ((s & 0xf0) === 0x40) bullets.push({ owner: t, x: m[0xb8 + t], y: m[0xc2 + t], dir: s & 0x03 });
    }
    return { tanks, bullets, field: m.slice(0x400, 0x400 + FIELD * FIELD) };
  }
  _diff(): void {
    const p = this.prev, b = this.cur;
    if (!p) return;
    // поле: разрушения кирпичей (фильтруем «шум» частиц — только кирпичные тайлы)
    for (let i = 0; i < p.field.length; i++) {
      if (p.field[i] !== b.field[i] && (isBrick(p.field[i]) || b.field[i] === 0x00)) {
        const col = i % FIELD, row = Math.floor(i / FIELD);
        this.events.push({ type: "bulletHitBrick", col, row, tileBefore: p.field[i], tileAfter: b.field[i] });
        if (b.field[i] === 0x00) this.events.push({ type: "brickDestroyed", col, row });
      }
    }
    // танки: движение / смерть
    for (let t = 0; t < 8; t++) {
      const A = p.tanks[t], B = b.tanks[t];
      if (A.x !== B.x || A.y !== B.y) this.events.push({ type: "tankMoved", tank: t, x: B.x, y: B.y });
      if (alive(A.flag) && !alive(B.flag)) this.events.push({ type: "tankDestroyed", tank: t });
    }
    // пули: появление / движение / исчезновение
    const mapB = new Map<any, any>(b.bullets.map((x: any) => [x.owner, x]));
    const mapP = new Map<any, any>(p.bullets.map((x: any) => [x.owner, x]));
    for (const [owner, A] of mapP) {
      const Bb = mapB.get(owner);
      if (Bb) { if (A.x !== Bb.x || A.y !== Bb.y) this.events.push({ type: "bulletMoved", bullet: owner, x: Bb.x, y: Bb.y }); }
      else this.events.push({ type: "bulletDestroyed", bullet: owner });
    }
    for (const [owner, Bb] of mapB) {
      if (!mapP.has(owner)) this.events.push({ type: "bulletFired", tank: owner, x: Bb.x, y: Bb.y, dir: Bb.dir });
    }
  }
  reset(): void { this.events = []; this.prev = null; this.cur = null; }
  // События за последний кадр (для покадровой сверки) и очистка.
  flush(): any[] { const e = this.events; this.events = []; return e; }
}
