// RendererSettingsPanel.tsx — settings state of the selected driver: loading from prefs,
// saving, applying to RenderSystem. Renders the universal form from the manifest schema.
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

  // Apply the saved settings to the driver (including on system change: preview → battle).
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
