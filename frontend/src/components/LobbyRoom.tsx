// LobbyRoom.tsx — комната ожидания: слоты DEF/ATT, ready, host-контролы,
// инвайт-код, настройка слотов и чат комнаты.
import { useState } from "react";
import ChatPanel from "./ChatPanel";
import StageSelect from "./StageSelect";
import StarsSelect from "./StarsSelect";
import type { ChatMessage, LobbyState, LobbySettings, Team } from "../engine/lobby-client";
import type { EmulatorDriver } from "../engine/emulator";

interface Props {
  lobby: LobbyState;
  meId: string;
  emulator?: EmulatorDriver | null;
  onLeave: () => void;
  onTeam: (team: Team) => void;
  onReady: (ready: boolean) => void;
  onStart: () => void;
  onKick: (playerId: string) => void;
  onSettings: (settings: Partial<LobbySettings>) => void;
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  error?: string | null;
}

export default function LobbyRoom({
  lobby, meId, emulator, onLeave, onTeam, onReady, onStart, onKick, onSettings, chat, onSendChat, error,
}: Props) {
  const me = lobby.players.find((p) => p.id === meId);
  const isHost = !!me?.host;
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${location.origin}${location.pathname}?lobby=${lobby.code}`;

  const team = (t: Team) => lobby.players.filter((p) => p.team === t);
  const cap = (t: Team) => (t === "DEF" ? lobby.settings.defSlots : lobby.settings.attSlots);

  const copyInvite = () => {
    navigator.clipboard?.writeText(inviteUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  };

  const TeamColumn = ({ t, label, icon }: { t: Team; label: string; icon: string }) => {
    const players = team(t);
    const free = cap(t) - players.length;
    return (
      <div className={`room-team room-team--${t.toLowerCase()}`}>
        <div className="room-team__head">
          <span>{icon} {label}</span>
          <span className="room-team__count">{players.length}/{cap(t)}</span>
        </div>
        <div className="room-team__slots">
          {players.map((p) => (
            <div key={p.id} className="room-slot">
              <span className={`dot ${p.online ? "dot--on" : "dot--off"}`} />
              <span className="room-slot__name">{p.name}{p.host ? " 👑" : ""}</span>
              <span className={`room-slot__ready ${p.ready ? "is-ready" : ""}`}>{p.ready ? "готов" : "ждёт"}</span>
              {isHost && p.id !== meId && !p.host && (
                <button className="room-slot__kick" title="Кикнуть" onClick={() => onKick(p.id)}>✕</button>
              )}
            </div>
          ))}
          {Array.from({ length: Math.max(0, free) }).map((_, i) => (
            <div key={"e" + i} className="room-slot room-slot--empty">свободный слот (ИИ)</div>
          ))}
        </div>
        {me && me.team !== t && free > 0 && (
          <button className="btn btn--ghost room-team__switch" onClick={() => onTeam(t)}>Перейти сюда</button>
        )}
      </div>
    );
  };

  return (
    <div className="lobby">
      <header className="room-header">
        <div>
          <h1>{lobby.name}</h1>
          <div className="room-header__meta">код <b>{lobby.code}</b> · {lobby.players.length}/{lobby.capacity} игроков</div>
        </div>
        <div className="room-header__invite">
          <button className="btn btn--ghost" onClick={copyInvite}>{copied ? "✓ скопировано" : "🔗 Пригласить"}</button>
        </div>
      </header>

      {error && <div className="lobby__error">⚠ {error}</div>}

      <div className="room">
        <div className="room__teams">
          <TeamColumn t="DEF" label="Защитники" icon="🛡" />
          <TeamColumn t="ATT" label="Атакующие" icon="⚔" />
        </div>

        <div className="room__controls">
          {me ? (
            <>
              <button className={`btn ${me.ready ? "btn--ghost" : "btn--primary"}`} onClick={() => onReady(!me.ready)}>
                {me.ready ? "Не готов" : "Готов"}
              </button>
              {isHost && (
                <button className="btn btn--primary" onClick={onStart}>▶ Старт ({lobby.players.length} живых + ИИ)</button>
              )}
              <button className="btn btn--ghost" onClick={onLeave}>Выйти</button>
            </>
          ) : (
            <span className="muted">Подключение к комнате…</span>
          )}
        </div>

        {isHost && (
          <div className="room__settings">
            <span className="room__settings-label">Слоты (хост):</span>
            <label>DEF
              <input type="range" min={Math.max(1, team("DEF").length)} max={2} value={lobby.settings.defSlots}
                onChange={(e) => onSettings({ defSlots: +e.target.value })} /> {lobby.settings.defSlots}
            </label>
            <label>ATT
              <input type="range" min={Math.max(1, team("ATT").length)} max={6} value={lobby.settings.attSlots}
                onChange={(e) => onSettings({ attSlots: +e.target.value })} /> {lobby.settings.attSlots}
            </label>
            <label className="room__toggle">
              <input type="checkbox" checked={!!lobby.settings.autoStart}
                onChange={(e) => onSettings({ autoStart: e.target.checked })} /> Авто-старт
            </label>
            <label className="room__toggle">
              <input type="checkbox" checked={!!lobby.settings.requireReady}
                onChange={(e) => onSettings({ requireReady: e.target.checked })} /> Только когда все готовы
            </label>
            <div className="room__stage">
              <StageSelect
                emulator={emulator ?? null}
                stage={lobby.settings.stage || 1}
                onChange={(stage) => onSettings({ stage })}
                previewSize={140}
              />
              <StarsSelect
                stars={lobby.settings.defStars || 0}
                onChange={(defStars) => onSettings({ defStars })}
                pistol={!!lobby.settings.defPistol}
                onPistolChange={(defPistol) => onSettings({ defPistol })}
              />
            </div>
          </div>
        )}

        <aside className="room__chat">
          <ChatPanel title="Чат комнаты" messages={chat} onSend={onSendChat} meId={meId} />
        </aside>
      </div>
    </div>
  );
}
