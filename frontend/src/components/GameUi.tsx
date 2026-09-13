// GameUi.tsx — HUD и оверлеи игрового экрана (вынесено из GameCanvas).
import AudioControl from "./AudioControl";
import type { Team } from "../engine/net";
import type { AudioOutput } from "../engine/audio";
import { useT } from "../i18n/index.tsx";

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
  const t = useT();
  return (
    <div className="hud">
      <span className={team === "DEF" ? "ok" : "bad"}>
        {t("Вы: {team}", { team: team === "DEF" ? t("Защитники") : t("Атакующие") })}
      </span>
      <span>{t("DEF жизни: {livesDef}/{livesDef2}", { livesDef: hud.livesDef, livesDef2: hud.livesDef2 })}</span>
      <span>{t("ATT танков: {count}", { count: hud.enemiesLeft })}</span>
      {audio && <AudioControl audio={audio} />}
      {online && (
        <>
          <span>{t("режим: {mode}", { mode: status.mode || "—" })}</span>
          <span>{t("ping: {latency} мс", { latency: status.latency })}</span>
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
  const t = useT();
  return (
    <>
      {online && conn?.status === "connecting" && <div className="game__pause">{t("Соединение с соперником…")}</div>}
      {online && conn?.status === "reconnecting" && (
        <div className="game__pause">{conn.peerOffline ? t("Ожидание соперника…") : t("Переподключение…")}</div>
      )}
      {online && conn?.status === "offline" && <div className="game__pause">{t("Связь потеряна. Обновите страницу.")}</div>}
      {online && paused && conn?.status !== "reconnecting" && conn?.status !== "connecting" && (
        <div className="game__pause">{t("⏸ ПАУЗА — подождите соперника")}</div>
      )}
      {result && (
        <div className="result">
          <h2>
            {result === team ? t("Победа!") : t("Поражение.")}{" "}
            {t("Победила команда {team}", { team: result === "DEF" ? t("защитников") : t("атакующих") })}
          </h2>
          <button onClick={() => (onExit ? onExit() : location.reload())}>{t("Вернуться в лобби")}</button>
        </div>
      )}
    </>
  );
}
