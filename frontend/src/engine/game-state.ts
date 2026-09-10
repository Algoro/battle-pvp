// game-state.ts — чистая логика игрового состояния на границе RAM.
// Без DOM/React/эмулятора: принимает значения из RAM и возвращает решения.
// Единый источник истины для фронта (GameCanvas) и тестов (qa, unit).
// Относительный путь: ./frontend/src/engine/game-state.ts
export type Team = "DEF" | "ATT";

export interface FrameInput {
  port: number;
  buttons: number;
}

// con_btn Start (совпадает с ROM).
export const BTN_START = 0x08;

// Жив ли танк: активные флаги 0x90-0xD0; 0xE0/F0 — респавн, 0x70/0x80 — взрыв.
export function isTankAlive(flag: number): boolean {
  const hi = flag & 0xf0;
  return hi >= 0x90 && hi <= 0xd0;
}

// Игра началась, когда enemies_left инициализирован (не 0xFF).
export function isGameplayStarted(enemiesLeft: number): boolean {
  return enemiesLeft !== 0xff;
}

// Победитель по состоянию (только в реальной игре, stage 1..35):
// ATT побеждает при уничтожении штаба DEF (game_over -> 0),
// DEF — при уничтожении всех танков ATT (enemies_left -> 0).
export function determineWinner(
  stage: number,
  gameOver: number,
  enemiesLeft: number,
): Team | null {
  if (stage < 1 || stage > 35) return null;
  if (gameOver === 0) return "ATT";
  if (enemiesLeft === 0) return "DEF";
  return null;
}

export interface SoloInputsArgs {
  port: number; // порт игрока (0 = DEF, 2 = ATT)
  team: Team;
  frame: number;
  started: boolean; // gameplay началась (enemies_left != 0xFF)
  userButtons: number;
  attTankAlive: boolean; // жив ли танк игрока (для ATT)
}

// Построение входов соло-цикла (детерминированно):
//  - порт 0 (DEF) подаётся КАЖДЫЙ кадр: 0 в норме, Start на автостарте (корректные
//    кромки Start — иначе кнопка залипает и не проходит выбор игроков);
//  - порт игрока — ввод с клавиатуры;
//  - для ATT — авто-респавн танка (Start edge на порту игрока), пока он не жив.
export function buildSoloInputs(a: SoloInputsArgs): FrameInput[] {
  const autoStart = !a.started && a.frame % 30 === 0;
  const autoRespawn = a.team === "ATT" && a.started && !a.attTankAlive && a.frame % 30 === 0;
  if (a.port === 0) {
    return [{ port: 0, buttons: a.userButtons | (autoStart ? BTN_START : 0) }];
  }
  return [
    { port: 0, buttons: autoStart ? BTN_START : 0 },
    { port: a.port, buttons: a.userButtons | (autoRespawn ? BTN_START : 0) },
  ];
}
