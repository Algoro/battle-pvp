// Lobby.tsx — качественное лобби: выбор команды/имени, онлайн-матч или соло.
import { useState } from "react";
import type { Team } from "../engine/net";

interface Props {
  backendUrl: string;
  onStart: (team: Team, playerId: string) => void;
  onSolo: (team: Team) => void;
}

interface TeamCard {
  id: Team;
  title: string;
  subtitle: string;
  accent: "def" | "att";
  icon: string;
}

const TEAMS: TeamCard[] = [
  {
    id: "DEF",
    title: "Защитники",
    subtitle: "Обороняют штаб. 1–2 танка, удержание базы — ключ к победе.",
    accent: "def",
    icon: "🛡️",
  },
  {
    id: "ATT",
    title: "Атакующие",
    subtitle: "Идут на штаб. Реальные игроки вместо ИИ, прорыв любой ценой.",
    accent: "att",
    icon: "⚔️",
  },
];

export default function Lobby({ onStart, onSolo }: Props) {
  const [team, setTeam] = useState<Team>("DEF");
  const [playerId, setPlayerId] = useState(`p_${Math.floor(Math.random() * 1e6)}`);
  const [busy, setBusy] = useState(false);

  const handleOnline = () => {
    setBusy(true);
    onStart(team, playerId || "player");
    // сброс busy при возврате обработает App через смену экрана
  };

  return (
    <div className="lobby">
      <header className="lobby__header">
        <span className="lobby__logo">🐉</span>
        <h1>Battle City <span>PvP</span></h1>
        <p className="lobby__subtitle">Классика на NES. Теперь против живых соперников — с сеткой и роллбэком.</p>
      </header>

      <section className="lobby__name">
        <label htmlFor="nick">Позывной</label>
        <input
          id="nick"
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          placeholder="Введите имя игрока"
          maxLength={20}
        />
      </section>

      <section className="lobby__teams">
        <div className="lobby__teams-label">Выберите сторону</div>
        <div className="lobby__cards">
          {TEAMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`lobby__card lobby__card--${t.accent}${team === t.id ? " is-selected" : ""}`}
              onClick={() => setTeam(t.id)}
            >
              <span className="lobby__card-icon">{t.icon}</span>
              <span className="lobby__card-title">{t.title}</span>
              <span className="lobby__card-sub">{t.subtitle}</span>
              <span className="lobby__card-check">{team === t.id ? "✓ выбрано" : "выбрать"}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lobby__actions">
        <button className="btn btn--primary" onClick={handleOnline} disabled={busy}>
          {busy ? "Поиск соперника…" : "Играть онлайн"}
        </button>
        <button className="btn btn--ghost" onClick={() => onSolo(team)}>
          Соло ({team === "DEF" ? "защитники" : "атакующие"})
        </button>
      </section>

      <footer className="lobby__footer">
        <span>🎮 WASD/стрелки — движение · Z — огонь · Enter — старт</span>
        <span className="lobby__pulse"><i /> сервер онлайн</span>
      </footer>
    </div>
  );
}
