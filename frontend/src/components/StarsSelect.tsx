// StarsSelect.tsx — стартовый апгрейд DEF: звёзды (0..3) и опционально супер-оружие.
// «4★» = максимальный апгрейд + пистолет (аналог сбора 4-й звезды в бою).
interface Props {
  stars: number;
  onChange: (stars: number) => void;
  pistol?: boolean;
  onPistolChange?: (on: boolean) => void;
  disabled?: boolean;
}

export default function StarsSelect({ stars, onChange, pistol = false, onPistolChange, disabled }: Props) {
  return (
    <div className="stars-select">
      <span className="stars-select__label">Звёзды защитников:</span>
      {[0, 1, 2, 3].map((n) => (
        <button
          key={n}
          className={`btn btn--ghost stars-select__btn${n === stars && !pistol ? " stars-select__btn--on" : ""}`}
          disabled={disabled}
          onClick={() => { onChange(n); onPistolChange?.(false); }}
          title={n === 0 ? "Без звёзд" : `Уровень ${n}`}
        >
          {n === 0 ? "0" : "★".repeat(n)}
        </button>
      ))}
      {onPistolChange && (
        <button
          className={`btn btn--ghost stars-select__btn${pistol ? " stars-select__btn--on" : ""}`}
          disabled={disabled}
          onClick={() => { onPistolChange(!pistol); if (stars < 3) onChange(3); }}
          title="4★: максимум + супер-оружие (пистолет)"
        >
          4★🔫
        </button>
      )}
    </div>
  );
}
