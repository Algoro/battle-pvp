// FeaturePicker.tsx — unified selection of optional patches: cards with name and
// description + auto-UI for settings of enabled features (per the shared/features.ts schema).
// Used on all pre-flight screens.
import { OPTIONAL_FEATURES } from "../features";
import type { FeatureSettingSpec, FeatureSettingValue } from "../../../shared/features.ts";
import { useT } from "../i18n/index.tsx";

export type FeatureOptions = Record<string, Record<string, FeatureSettingValue>>;

interface Props {
  features: string[];
  onChange: (next: string[]) => void;
  /** Current feature settings (id → values); missing ones are taken from default. */
  options?: FeatureOptions;
  /** Change of a single setting: feature id → its full set of values. */
  onOptionsChange?: (featureId: string, values: Record<string, FeatureSettingValue>) => void;
  title?: string;
  disabled?: boolean;
}

export default function FeaturePicker({
  features,
  onChange,
  options = {},
  onOptionsChange,
  title,
  disabled,
}: Props) {
  const t = useT();
  const toggle = (id: string) => {
    onChange(features.includes(id) ? features.filter((x) => x !== id) : [...features, id]);
  };
  // hidden features (e.g. tower-defence) are enabled by a separate mode, not a checkbox.
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
        <span className="fpick__title">{t(title ?? "Опциональные патчи")}</span>
        <span className="fpick__count">{selected.length ? t("выбрано: {count}", { count: selected.length }) : t("ванильная игра")}</span>
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
                  <span className="fpick__item-title">{t(f.title)}</span>
                  <span className="fpick__item-desc">{t(f.description)}</span>
                </span>
              </label>
              {on && fields.length > 0 && (
                <div className="fpick__settings">
                  {fields.map((field) => {
                    const value = valueOf(f.id, field);
                    return (
                      <label key={field.id} className="fpick__setting" title={field.hint ? t(field.hint) : undefined}>
                        <span className="fpick__setting-label">{t(field.label)}</span>
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
                                {t(o.label)}
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
            <b>{t("В матче:")}</b> {selected.map((f) => t(f.title)).join(" · ")}
          </>
        ) : (
          t("Все патчи выключены — классические правила.")
        )}
      </div>
    </div>
  );
}
