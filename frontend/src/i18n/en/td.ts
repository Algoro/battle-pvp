// en/td.ts — English translations (source Russian string -> English).
// Filled by localization; keep keys exactly as the Russian source strings.
const messages: Record<string, string> = {
  // --- Manifest: towers (shared/tower-defence.ts) -------------------------------
  "Пушка": "Gun",
  "Сбалансированная башня.": "Balanced tower.",
  "Пулемёт": "Machine gun",
  "Частый огонь, малая дальность.": "Rapid fire, short range.",
  "Снайпер": "Sniper",
  "Дальний выстрел, пробивает броню.": "Long-range shot, pierces armor.",
  "Орудие": "Cannon",
  "Медленный, но мощный.": "Slow but powerful.",

  // --- Manifest: maps and difficulties ---------------------------------------------
  "Змейка": "Snake",
  "Коридоры": "Lanes",
  "Зигзаг": "Zigzag",
  "Легко": "Easy",
  "Норма": "Normal",
  "Сложно": "Hard",

  // --- Setup screen (TowerDefenceSetup) -------------------------------------
  "Покупайте неподвижные танки-башни на очки от уничтожения врагов. Не дайте волнам ATT добраться до базы.":
    "Buy stationary tower tanks with points earned from destroying enemies. Don't let the ATT waves reach the base.",
  "Сложность:": "Difficulty:",
  "очков: {points} · волн: {waves}": "points: {points} · waves: {waves}",
  "Мобильный танк-командир (управление с клавиатуры)": "Mobile command tank (keyboard control)",
  "В бой": "Into battle",
  "Отмена": "Cancel",

  // --- Game screen (TowerDefenceView) ----------------------------------------
  "Очки:": "Points:",
  "Волна: {wave}/{total}": "Wave: {wave}/{total}",
  "Фаза:": "Phase:",
  "сборка": "build",
  "бой": "battle",
  "передышка": "intermission",
  "победа": "victory",
  "поражение": "defeat",
  "В лобби": "To lobby",
  "Башни": "Towers",
  "ЛКМ по клетке — поставить (или улучшить башню), ПКМ — продать.":
    "LMB on a cell — place (or upgrade a tower), RMB — sell.",
  "▶ В бой": "▶ Into battle",
  "Загрузка…": "Loading…",
  "Победа! База устояла.": "Victory! The base held.",
  "Поражение. База пала.": "Defeat. The base has fallen.",
  "Вернуться в лобби": "Back to lobby",
  'Соло-режим обороны: покупка и расстановка неподвижных танков-башен, волны врагов.': 'Solo defence mode: buy and place stationary turret-tanks; waves of enemies.',
};
export default messages;
