// StarsSelect.tsx — starting DEF upgrade: stars (0..3) and optionally a super-weapon.
// "4★" = maximum upgrade + gun (equivalent to collecting the 4th star in battle).
import { useT } from "../i18n/index.tsx";

interface Props {
  stars: number;
  onChange: (stars: number) => void;
  pistol?: boolean;
  onPistolChange?: (on: boolean) => void;
  disabled?: boolean;
}

export default function StarsSelect({ stars, onChange, pistol = false, onPistolChange, disabled }: Props) {
  const t = useT();
  return (
    <div className="stars-select">
      <span className="stars-select__label">{t("Звёзды защитников:")}</span>
      {[0, 1, 2, 3].map((n) => (
        <button
          key={n}
          className={`btn btn--ghost stars-select__btn${n === stars && !pistol ? " stars-select__btn--on" : ""}`}
          disabled={disabled}
          onClick={() => { onChange(n); onPistolChange?.(false); }}
          title={n === 0 ? t("Без звёзд") : t("Уровень {n}", { n })}
        >
          {n === 0 ? "0" : "★".repeat(n)}
        </button>
      ))}
      {onPistolChange && (
        <button
          className={`btn btn--ghost stars-select__btn${pistol ? " stars-select__btn--on" : ""}`}
          disabled={disabled}
          onClick={() => { onPistolChange(!pistol); if (stars < 3) onChange(3); }}
          title={t("4★: максимум + супер-оружие (пистолет)")}
        >
          4★🔫
        </button>
      )}
    </div>
  );
}
