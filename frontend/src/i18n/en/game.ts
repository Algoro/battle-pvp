// en/game.ts — English translations (source Russian string -> English).
// Filled by localization; keep keys exactly as the Russian source strings.
const messages: Record<string, string> = {
  // GameCanvas
  "WASD/стрелки — движение, Z — огонь, Enter — старт": "WASD/arrows — move, Z — fire, Enter — start",

  // GameUi — HUD
  "Вы: {team}": "You: {team}",
  "DEF жизни: {livesDef}/{livesDef2}": "DEF lives: {livesDef}/{livesDef2}",
  "ATT танков: {count}": "ATT tanks: {count}",
  "режим: {mode}": "mode: {mode}",
  "ping: {latency} мс": "ping: {latency} ms",

  // GameUi — overlays
  "Соединение с соперником…": "Connecting to opponent…",
  "Ожидание соперника…": "Waiting for opponent…",
  "Переподключение…": "Reconnecting…",
  "Связь потеряна. Обновите страницу.": "Connection lost. Refresh the page.",
  "⏸ ПАУЗА — подождите соперника": "⏸ PAUSED — waiting for opponent",
  "Победа!": "Victory!",
  "Поражение.": "Defeat.",
  "Матч завершён.": "Match finished.",
  "Победила команда {team}": "The {team} win",
  "защитников": "defenders",
  "атакующих": "attackers",

  // TracePanel
  "Трейс ИИ": "AI trace",
  "сбор": "collect",
  "лимит строк": "row limit",
  "очистить": "clear",
  "все стороны": "all sides",
  "все события": "all events",
  "все танки": "all tanks",
  "все цели": "all goals",
  "поиск…": "search…",
  "нет событий": "no events",

  // AudioControl
  "Музыка": "Music",
  "Эффекты": "Effects",
  "включить": "unmute",
  "выключить": "mute",

  // AIControls
  "ИИ на лету": "Live AI",
  "Атакующие (враги)": "Attackers (enemies)",
  "Защитники (союзник)": "Defenders (ally)",
  "plan (тактический)": "plan (tactical)",
  "scan (сканирование)": "scan (scanning)",
  "lookahead (предсказание)": "lookahead (prediction)",
  "strategy-att (слой)": "strategy-att (layer)",
  "asm (родной)": "asm (native)",
  "выкл (заморозить)": "off (freeze)",
  "scan (защита)": "scan (defense)",
  "lookahead (защита)": "lookahead (defense)",
  "strategy (стратегический)": "strategy (strategic)",
  "выкл (стоять)": "off (hold)",
  "Смена применится со следующего кадра. Состояние выбранного ИИ сбрасывается (холодный старт).":
    "The change applies from the next frame. The selected AI's state is reset (cold start).",

  // SpectateView
  "Режим: наблюдатель": "Mode: spectator",
  "кадр: {frame}": "frame: {frame}",
  "Просмотр матча (без управления)": "Watching the match (no control)",
  'Стадия {stage}': 'Stage {stage}',
};
export default messages;
