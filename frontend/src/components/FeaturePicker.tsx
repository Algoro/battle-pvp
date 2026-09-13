// FeaturePicker.tsx — единый выбор опциональных патчей: карточки с названием и
// описанием + авто-UI настроек включённых фич (по схеме из shared/features.ts).
// Используется на всех предполётных экранах.
import { OPTIONAL_FEATURES } from "../features";
import type { FeatureSettingSpec, FeatureSettingValue } from "../../../shared/features.ts";

export type FeatureOptions = Record<string, Record<string, FeatureSettingValue>>;

interface Props {
  features: string[];
  onChange: (next: string[]) => void;
  /** Текущие настройки фич (id → значения); отсутствующие — берутся из default. */
  options?: FeatureOptions;
  /** Изменение одной настройки: id фичи → её полный набор значений. */
  onOptionsChange?: (featureId: string, values: Record<string, FeatureSettingValue>) => void;
  title?: string;
  disabled?: boolean;
}

export default function FeaturePicker({
  features,
  onChange,
  options = {},
  onOptionsChange,
  title = "Опциональные патчи",
  disabled,
}: Props) {
  const toggle = (id: string) => {
    onChange(features.includes(id) ? features.filter((x) => x !== id) : [...features, id]);
  };
  // hidden-фичи (напр. tower-defence) включаются отдельным режимом, не чекбоксом.
  const visible = OPTIONAL_FEATURES.filter((f) => !f.hidden);
  const selected = visible.filter((f) => features.includes(f.id));

  const valueOf = (featureId: string, field: FeatureSettingSpec): FeatureSettingValue => {
    const stored = options[featureId]?.[field.id];
    return stored === undefined ? field.default : stored;
  };

  const setValue = (featureId: string, field: FeatureSettingSpec, value: FeatureSettingValue) => {
    onOptionsChange?.(featureId, { ...(options[featureId] || {}), [field.id]: value });
  };

  return (
    <div className="fpick">
      <div className="fpick__head">
        <span className="fpick__title">{title}</span>
        <span className="fpick__count">{selected.length ? `выбрано: ${selected.length}` : "ванильная игра"}</span>
      </div>
      <div className="fpick__list">
        {visible.map((f) => {
          const on = features.includes(f.id);
          const fields = (f.settings?.fields ?? []).filter(
            (field) => !field.requiresFeature || features.includes(field.requiresFeature),
          );
          return (
            <div key={f.id} className={`fpick__item${on ? " fpick__item--on" : ""}${disabled ? " fpick__item--disabled" : ""}`}>
              <label className="fpick__row">
                <input type="checkbox" checked={on} disabled={disabled} onChange={() => toggle(f.id)} />
                <span className="fpick__item-body">
                  <span className="fpick__item-title">{f.title}</span>
                  <span className="fpick__item-desc">{f.description}</span>
                </span>
              </label>
              {on && fields.length > 0 && (
                <div className="fpick__settings">
                  {fields.map((field) => {
                    const value = valueOf(f.id, field);
                    return (
                      <label key={field.id} className="fpick__setting" title={field.hint || undefined}>
                        <span className="fpick__setting-label">{field.label}</span>
                        {field.type === "toggle" && (
                          <input
                            type="checkbox"
                            checked={value === true}
                            disabled={disabled}
                            onChange={(e) => setValue(f.id, field, e.target.checked)}
                          />
                        )}
                        {field.type === "range" && (
                          <span className="fpick__setting-range">
                            <input
                              type="range"
                              min={field.min}
                              max={field.max}
                              step={field.step ?? 1}
                              value={Number(value)}
                              disabled={disabled}
                              onChange={(e) => setValue(f.id, field, Number(e.target.value))}
                            />
                            <b>{Number(value)}</b>
                          </span>
                        )}
                        {field.type === "select" && (
                          <select
                            value={String(value)}
                            disabled={disabled}
                            onChange={(e) => {
                              const opt = (field.options ?? []).find((o) => String(o.value) === e.target.value);
                              setValue(f.id, field, opt ? opt.value : field.default);
                            }}
                          >
                            {(field.options ?? []).map((o) => (
                              <option key={String(o.value)} value={String(o.value)}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
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
