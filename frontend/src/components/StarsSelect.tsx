// StarsSelect.tsx — стартовое количество звёзд (апгрейд) для команды защитников.
interface Props {
  stars: number;
  onChange: (stars: number) => void;
  disabled?: boolean;
}

export default function StarsSelect({ stars, onChange, disabled }: Props) {
  return (
    <div className="stars-select">
      <span className="stars-select__label">Звёзды защитников:</span>
      {[0, 1, 2, 3].map((n) => (
        <button
          key={n}
          className={`btn btn--ghost stars-select__btn${n === stars ? " stars-select__btn--on" : ""}`}
          disabled={disabled}
          onClick={() => onChange(n)}
          title={n === 0 ? "Без звёзд" : `Уровень ${n}`}
        >
          {n === 0 ? "0" : "★".repeat(n)}
        </button>
      ))}
    </div>
  );
}
