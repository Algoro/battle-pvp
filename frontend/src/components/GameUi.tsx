// GameUi.tsx — HUD и оверлеи игрового экрана (вынесено из GameCanvas).
import AudioControl from "./AudioControl";
import type { Team } from "../engine/net";
import type { AudioOutput } from "../engine/audio";

export interface ConnectionInfo {
  status: "solo" | "connecting" | "online" | "reconnecting" | "offline";
  mode: string;
  latency: number;
  desyncs: number;
  rollbacks: number;
  peerOffline: boolean;
}

export function GameHud(
  { team, hud, audio, online, status }: {
    team: Team;
    hud: { livesDef: number; livesDef2: number; enemiesLeft: number };
    audio?: AudioOutput;
    online?: boolean;
    status: { mode: string; latency: number; rollbacks: number; desyncs: number };
  },
) {
  return (
    <div className="hud">
      <span className={team === "DEF" ? "ok" : "bad"}>Вы: {team === "DEF" ? "Защитники" : "Атакующие"}</span>
      <span>DEF жизни: {hud.livesDef}/{hud.livesDef2}</span>
      <span>ATT танков: {hud.enemiesLeft}</span>
      {audio && <AudioControl audio={audio} />}
      {online && (
        <>
          <span>режим: {status.mode || "—"}</span>
          <span>ping: {status.latency} мс</span>
          <span>rollbacks: {status.rollbacks}</span>
          <span className={status.desyncs > 0 ? "bad" : "ok"}>
            {status.desyncs > 0 ? `DESYNC ×${status.desyncs}` : "sync"}
          </span>
        </>
      )}
    </div>
  );
}

export function GameOverlays(
  { online, conn, paused, result, team, onExit }: {
    online?: boolean;
    conn?: ConnectionInfo;
    paused?: boolean;
    result?: string | null;
    team: Team;
    onExit?: () => void;
  },
) {
  return (
    <>
      {online && conn?.status === "connecting" && <div className="game__pause">Соединение с соперником…</div>}
      {online && conn?.status === "reconnecting" && (
        <div className="game__pause">{conn.peerOffline ? "Ожидание соперника…" : "Переподключение…"}</div>
      )}
      {online && conn?.status === "offline" && <div className="game__pause">Связь потеряна. Обновите страницу.</div>}
      {online && paused && conn?.status !== "reconnecting" && conn?.status !== "connecting" && (
        <div className="game__pause">⏸ ПАУЗА — подождите соперника</div>
      )}
      {result && (
        <div className="result">
          <h2>
            {result === team ? "Победа! " : "Поражение. "}
            Победила команда {result === "DEF" ? "защитников" : "атакующих"}
          </h2>
          <button onClick={() => (onExit ? onExit() : location.reload())}>Вернуться в лобби</button>
        </div>
      )}
    </>
  );
}
