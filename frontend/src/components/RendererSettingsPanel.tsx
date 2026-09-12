// RendererSettingsPanel.tsx — состояние настроек выбранного драйвера: загрузка из prefs,
// сохранение, применение к RenderSystem. Рендерит универсальную форму по схеме манифеста.
import { useEffect, useRef, useState } from "react";
import { rendererById } from "../render/registry";
import type { RenderSystem } from "../render/render-system";
import { loadRenderOptions, saveRenderOptions } from "../render/prefs";
import { normalizeValues, specDefaults, type SettingValues } from "../render/settings";
import RenderSettingsForm from "./RenderSettingsForm";

interface Props {
  driver: string;
  system: RenderSystem | null;
}

export default function RendererSettingsPanel({ driver, system }: Props) {
  const spec = rendererById(driver)?.settings;
  const [values, setValues] = useState<SettingValues>(() =>
    spec ? normalizeValues(spec, loadRenderOptions(driver, specDefaults(spec))) : {},
  );
  const ref = useRef(values);
  ref.current = values;

  // Применить сохранённые настройки к драйверу (в т.ч. при смене system: превью → бой).
  useEffect(() => {
    if (spec) system?.setDriverOptions(ref.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system, driver]);

  if (!spec) return null;

  const change = (next: SettingValues) => {
    setValues(next);
    saveRenderOptions(driver, next);
    system?.setDriverOptions(next);
  };

  return <RenderSettingsForm spec={spec} values={values} onChange={change} />;
}
