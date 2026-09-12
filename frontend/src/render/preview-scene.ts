// preview-scene.ts — синтетическая сцена для предпросмотра драйверов рендера до старта
// матча. Не читает RAM и не трогает ядро: это демонстрационное поле Battle City.
//
// Относительный путь: ./frontend/src/render/preview-scene.ts
import { PLAY_BOUNDS } from "./scene-state.ts";
import type { SceneState, SceneTank } from "./types.ts";

function demoField(): Uint8Array {
  const b = PLAY_BOUNDS;
  const f = new Uint8Array(32 * 32);
  const set = (c: number, r: number, v: number) => {
    f[r * 32 + c] = v;
  };

  // Стальная рамка вокруг игровой зоны.
  const c0 = b.col0 - 1;
  const r0 = b.row0 - 1;
  for (let c = c0; c <= c0 + b.cols + 1; c++) {
    set(c, r0, 0x10);
    set(c, r0 + b.rows + 1, 0x10);
  }
  for (let r = r0; r <= r0 + b.rows + 1; r++) {
    set(c0, r, 0x10);
    set(c0 + b.cols + 1, r, 0x10);
  }

  const rel = (rc: number, rr: number, v: number) => set(b.col0 + rc, b.row0 + rr, v);
  const brickBlock = (rc: number, rr: number) => {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) rel(rc + i, rr + j, 0x0f);
  };

  // Кирпичные блоки.
  for (const [rc, rr] of [
    [3, 3], [9, 3], [15, 3], [21, 3],
    [6, 8], [18, 8], [3, 14], [21, 14],
    [6, 19], [18, 19], [12, 21],
  ]) {
    brickBlock(rc, rr);
  }
  // Полуразрушенный кирпич (показывает квадранты).
  rel(9, 3, 0x0c);
  rel(10, 3, 0x05);

  // Стальные башни, вода, лёд, деревья.
  set(b.col0 + 12, b.row0 + 5, 0x11);
  set(b.col0 + 13, b.row0 + 5, 0x10);
  set(b.col0 + 12, b.row0 + 15, 0x10);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) rel(4 + i, 11 + j, 0x12);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) rel(19 + i, 11 + j, 0x21);
  for (const [rc, rr] of [[8, 11], [8, 12], [17, 11], [17, 12]]) rel(rc, rr, 0x22);

  // Орёл (штаб DEF) 2×2.
  const ec = b.col0 + 12;
  const er = b.row0 + 24;
  f[er * 32 + ec] = 0xc8;
  f[er * 32 + ec + 1] = 0xca;
  f[(er + 1) * 32 + ec] = 0xc9;
  f[(er + 1) * 32 + ec + 1] = 0xcb;
  return f;
}

function tank(partial: Partial<SceneTank> & { index: number; team: "DEF" | "ATT"; x: number; y: number }): SceneTank {
  return {
    dir: 0,
    state: "alive",
    type: 0x80,
    moving: true,
    stars: 0,
    lives: null,
    helmet: false,
    stunned: false,
    onIce: false,
    flashing: false,
    armored: false,
    fast: false,
    ...partial,
  };
}

function demo(): SceneState {
  const b = PLAY_BOUNDS;
  const px = (rc: number) => (b.col0 + rc) * 8;
  const py = (rr: number) => (b.row0 + rr) * 8;
  const dead = (index: number, team: "DEF" | "ATT"): SceneTank =>
    tank({ index, team, x: 255, y: 255, state: "dead", moving: false, lives: team === "DEF" ? 2 : null });

  const tanks: SceneTank[] = [
    tank({ index: 0, team: "DEF", x: px(4), y: py(20), dir: 3, stars: 2, lives: 3 }),
    tank({ index: 1, team: "DEF", x: px(21), y: py(20), dir: 1, lives: 2, helmet: true }),
    tank({ index: 2, team: "ATT", x: px(9), y: py(1), dir: 2, type: 0xe2, armored: true }),
    tank({ index: 3, team: "ATT", x: px(15), y: py(1), dir: 2, type: 0xc0, fast: true }),
    tank({ index: 4, team: "ATT", x: px(21), y: py(5), dir: 1, type: 0x84, flashing: true }),
    dead(5, "ATT"),
    dead(6, "ATT"),
    dead(7, "ATT"),
  ];

  return {
    frame: 0,
    field: demoField(),
    bounds: b,
    tanks,
    bullets: [{ owner: 0, team: "DEF", dir: 3, x: px(6), y: py(20) + 4 }],
    prize: { id: 3, x: px(12), y: py(10) },
    eagle: { col: b.col0 + 12, row: b.row0 + 24, fortified: false, destroyed: false },
    effects: { freezeTimer: 0, dotsLeft: null },
    pixels: null,
  };
}

// Демо-сцена статична: строим один раз и переиспользуем в провайдере предпросмотра.
let cached: SceneState | null = null;
export function previewScene(): SceneState {
  if (!cached) cached = demo();
  return cached;
}

export default previewScene;
