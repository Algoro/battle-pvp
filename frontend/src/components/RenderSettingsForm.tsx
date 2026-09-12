// RenderSettingsForm.tsx — универсальная форма настроек плагина рендера по декларативной
// схеме из shared/renderers.ts. Не знает о конкретном драйвере.
import type { RenderSettingSpec, RenderSettingsSpec, SettingValue } from "../../../shared/renderers.ts";
import { applyPreset, type SettingValues } from "../render/settings";

interface Props {
  spec: RenderSettingsSpec;
  values: SettingValues;
  onChange: (next: SettingValues) => void;
  activePreset?: string;
}

export default function RenderSettingsForm({ spec, values, onChange, activePreset }: Props) {
  const set = (id: string, value: SettingValue) => onChange({ ...values, [id]: value });

  return (
    <div className="rform">
      {spec.presets && spec.presets.length > 0 && (
        <div className="rform__presets">
          {spec.presets.map((p) => (
            <button
              key={p.id}
              className={`rform__preset${activePreset === p.id ? " rform__preset--on" : ""}`}
              onClick={() => onChange(applyPreset(spec, p.id, values))}
              title="Применить пресет"
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {spec.fields.map((f, i) => (
        <Field key={f.id} field={f} value={values[f.id]} showGroup={i === 0 || spec.fields[i - 1].group !== f.group} onChange={(v) => set(f.id, v)} />
      ))}
    </div>
  );
}

function Field({
  field,
  value,
  showGroup,
  onChange,
}: {
  field: RenderSettingSpec;
  value: SettingValue | undefined;
  showGroup: boolean;
  onChange: (v: SettingValue) => void;
}) {
  const label = field.type === "range" ? `${field.label}: ${value ?? field.default}` : field.label;
  return (
    <>
      {showGroup && field.group && <div className="rform__group">{field.group}</div>}
      <label className="rform__row" title={field.hint ?? ""}>
        <span>{label}</span>
        {field.type === "select" && (
          <select value={String(value ?? field.default)} onChange={(e) => {
            const raw = e.target.value;
            const opt = field.options?.find((o) => String(o.value) === raw);
            onChange(opt ? opt.value : raw);
          }}>
            {field.options?.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        {field.type === "range" && (
          <input
            type="range"
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 1}
            value={Number(value ?? field.default)}
            onChange={(e) => onChange(Number(e.target.value))}
          />
        )}
        {field.type === "toggle" && (
          <input type="checkbox" checked={Boolean(value ?? field.default)} onChange={(e) => onChange(e.target.checked)} />
        )}
      </label>
    </>
  );
}
