// Lobby.tsx — high-quality lobby: team/name selection, online match or solo.
import { useState } from "react";
import type { Team } from "../engine/net";
import { useT } from "../i18n/index.tsx";

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
  const t = useT();
  const [team, setTeam] = useState<Team>("DEF");
  const [playerId, setPlayerId] = useState(`p_${Math.floor(Math.random() * 1e6)}`);
  const [busy, setBusy] = useState(false);

  const handleOnline = () => {
    setBusy(true);
    onStart(team, playerId || "player");
    // busy reset on return is handled by App via the screen change
  };

  return (
    <div className="lobby">
      <header className="lobby__header">
        <span className="lobby__logo">🐉</span>
        <h1>Battle City <span>PvP</span></h1>
        <p className="lobby__subtitle">{t("Классика на NES. Теперь против живых соперников — с сеткой и роллбэком.")}</p>
      </header>

      <section className="lobby__name">
        <label htmlFor="nick">{t("Позывной")}</label>
        <input
          id="nick"
          value={playerId}
          onChange={(e) => setPlayerId(e.target.value)}
          placeholder={t("Введите имя игрока")}
          maxLength={20}
        />
      </section>

      <section className="lobby__teams">
        <div className="lobby__teams-label">{t("Выберите сторону")}</div>
        <div className="lobby__cards">
          {TEAMS.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`lobby__card lobby__card--${card.accent}${team === card.id ? " is-selected" : ""}`}
              onClick={() => setTeam(card.id)}
            >
              <span className="lobby__card-icon">{card.icon}</span>
              <span className="lobby__card-title">{t(card.title)}</span>
              <span className="lobby__card-sub">{t(card.subtitle)}</span>
              <span className="lobby__card-check">{team === card.id ? t("✓ выбрано") : t("выбрать")}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="lobby__actions">
        <button className="btn btn--primary" onClick={handleOnline} disabled={busy}>
          {busy ? t("Поиск соперника…") : t("Играть онлайн")}
        </button>
        <button className="btn btn--ghost" onClick={() => onSolo(team)}>
          {t("Соло ({team})", { team: team === "DEF" ? t("защитники") : t("атакующие") })}
        </button>
      </section>

      <footer className="lobby__footer">
        <span>{t("🎮 WASD/стрелки — движение · Z — огонь · Enter — старт")}</span>
        <span className="lobby__pulse"><i /> {t("сервер онлайн")}</span>
      </footer>
    </div>
  );
}
