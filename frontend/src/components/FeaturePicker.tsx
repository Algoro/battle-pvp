// FeaturePicker.tsx — единый выбор опциональных патчей: карточки с названием и
// описанием + сводка выбранного. Используется на всех предполётных экранах.
import { OPTIONAL_FEATURES } from "../features";

interface Props {
  features: string[];
  onChange: (next: string[]) => void;
  title?: string;
  disabled?: boolean;
}

export default function FeaturePicker({ features, onChange, title = "Опциональные патчи", disabled }: Props) {
  const toggle = (id: string) => {
    onChange(features.includes(id) ? features.filter((x) => x !== id) : [...features, id]);
  };
  const selected = OPTIONAL_FEATURES.filter((f) => features.includes(f.id));

  return (
    <div className="fpick">
      <div className="fpick__head">
        <span className="fpick__title">{title}</span>
        <span className="fpick__count">{selected.length ? `выбрано: ${selected.length}` : "ванильная игра"}</span>
      </div>
      <div className="fpick__list">
        {OPTIONAL_FEATURES.map((f) => {
          const on = features.includes(f.id);
          return (
            <label key={f.id} className={`fpick__item${on ? " fpick__item--on" : ""}${disabled ? " fpick__item--disabled" : ""}`}>
              <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(f.id)} />
              <span className="fpick__item-body">
                <span className="fpick__item-title">{f.title}</span>
                <span className="fpick__item-desc">{f.description}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="fpick__summary">
        {selected.length ? (
          <>
            <b>В матче:</b> {selected.map((f) => f.title).join(" · ")}
          </>
        ) : (
          "Все патчи выключены — классические правила."
        )}
      </div>
    </div>
  );
}
