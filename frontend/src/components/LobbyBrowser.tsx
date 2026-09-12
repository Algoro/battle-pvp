// LobbyBrowser.tsx — экран списка игр: список лобби, создание, быстрый матч,
// вход по коду и глобальный чат.
import { useState } from "react";
import ChatPanel from "./ChatPanel";
import StageSelect from "./StageSelect";
import StarsSelect from "./StarsSelect";
import FeaturePicker from "./FeaturePicker";
import RenderPicker from "./RenderPicker";
import type { ChatMessage, LobbyState } from "../engine/lobby-client";
import type { EmulatorDriver } from "../engine/emulator";

interface Props {
  lobbies: LobbyState[];
  emulator?: EmulatorDriver | null;
  onJoin: (lobbyId: string) => void;
  onJoinCode: (code: string) => void;
  onCreate: () => void;
  onQuickMatch: () => void;
  onSolo: (team: "DEF" | "ATT", stage: number, stars: number, pistol: boolean, features: string[]) => void;
  onTowerDefence: () => void;
  chat: ChatMessage[];
  onSendChat: (text: string) => void;
  meId: string;
  meName: string;
  onNameChange: (name: string) => void;
  error?: string | null;
  busy?: boolean;
}

export default function LobbyBrowser({
  lobbies, emulator, onJoin, onJoinCode, onCreate, onQuickMatch, onSolo, onTowerDefence, chat, onSendChat, meId, meName, onNameChange, error, busy,
}: Props) {
  const [code, setCode] = useState("");
  const [soloStage, setSoloStage] = useState(1);
  const [soloStars, setSoloStars] = useState(0);
  const [soloPistol, setSoloPistol] = useState(false);
  const [soloFeatures, setSoloFeatures] = useState<string[]>([]);

  return (
    <div className="lobby">
      <header className="lobby__header">
        <span className="lobby__logo">🐉</span>
        <h1>Battle City <span>PvP</span></h1>
        <p className="lobby__subtitle">Выбирай игру или создай свою — она дождётся живых игроков.</p>
      </header>

      <div className="browser__profile">
        <label htmlFor="nick">Позывной</label>
        <input id="nick" value={meName} onChange={(e) => onNameChange(e.target.value)} maxLength={20} placeholder="Ваше имя" />
      </div>

      {error && <div className="lobby__error">⚠ {error}</div>}

      <div className="browser">
        <section className="browser__games">
          <div className="browser__bar">
            <button className="btn btn--primary" onClick={onCreate} disabled={busy}>＋ Создать игру</button>
            <button className="btn btn--ghost" onClick={onQuickMatch} disabled={busy}>⚡ Быстрый матч</button>
            <button className="btn btn--ghost" onClick={() => onSolo("DEF", soloStage, soloStars, soloPistol, soloFeatures)} disabled={busy}>Соло 🛡</button>
            <button className="btn btn--ghost" onClick={() => onSolo("ATT", soloStage, soloStars, soloPistol, soloFeatures)} disabled={busy}>Соло ⚔</button>
            <button className="btn btn--ghost" onClick={onTowerDefence} disabled={busy}>🏰 Tower Defence</button>
          </div>
          <div className="browser__stage">
            <StageSelect emulator={emulator ?? null} stage={soloStage} onChange={setSoloStage} previewSize={140} />
            <StarsSelect
              stars={soloStars}
              onChange={setSoloStars}
              pistol={soloPistol}
              onPistolChange={soloFeatures.includes("pistol") ? setSoloPistol : undefined}
            />
            <FeaturePicker
              features={soloFeatures}
              onChange={(next) => {
                setSoloFeatures(next);
                if (!next.includes("pistol")) setSoloPistol(false);
              }}
            />
            <RenderPicker emulator={emulator} stage={soloStage} />
          </div>

          <div className="browser__join">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Код игры (напр. AB12)"
              maxLength={6}
            />
            <button className="btn btn--ghost" disabled={code.length < 4 || busy} onClick={() => onJoinCode(code)}>
              Войти по коду
            </button>
          </div>

          <div className="browser__list">
            {lobbies.length === 0 && <div className="browser__empty">Открытых игр нет. Создай первую!</div>}
            {lobbies.map((l) => (
              <div key={l.id} className="game-card">
                <div className="game-card__main">
                  <div className="game-card__name">{l.name}</div>
                  <div className="game-card__meta">
                    код <b>{l.code}</b> · хост {l.players.find((p) => p.host)?.name || "—"} · {l.state}
                  </div>
                </div>
                <div className="game-card__slots">
                  <span className="slot slot--def">🛡 {l.slots.DEF}/{l.settings.defSlots}</span>
                  <span className="slot slot--att">⚔ {l.slots.ATT}/{l.settings.attSlots}</span>
                </div>
                <button
                  className="btn btn--primary"
                  disabled={busy || l.slots.DEF >= l.settings.defSlots && l.slots.ATT >= l.settings.attSlots}
                  onClick={() => onJoin(l.id)}
                >
                  Войти
                </button>
              </div>
            ))}
          </div>
        </section>

        <aside className="browser__chat">
          <ChatPanel title="Общий чат" messages={chat} onSend={onSendChat} meId={meId} />
        </aside>
      </div>
    </div>
  );
}
