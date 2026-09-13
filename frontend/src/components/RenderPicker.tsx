// RenderPicker.tsx — choosing the render driver and extensions BEFORE the match starts, with a live
// preview. The setting is local (localStorage) and does not affect the match/determinism.
import { useState } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import { driverCapabilities, listRenderers } from "../render/registry";
import { DEFAULT_DRIVER, loadRenderPrefs, saveRenderPrefs } from "../render/prefs";
import type { RenderSystem } from "../render/render-system";
import RendererPreview from "./RendererPreview";
import RendererSettingsPanel from "./RendererSettingsPanel";
import { useT } from "../i18n/index.tsx";

interface Props {
  emulator?: EmulatorDriver | null;
  stage: number;
}

const RENDERERS = listRenderers();
const DRIVERS = RENDERERS.filter((r) => r.kind === "driver");
const EXTENSIONS = RENDERERS.filter((r) => r.kind === "extension");

export default function RenderPicker({ emulator, stage }: Props) {
  const t = useT();
  const [driver, setDriver] = useState(() => {
    const id = loadRenderPrefs().driver || DEFAULT_DRIVER;
    return DRIVERS.some((d) => d.id === id) ? id : DEFAULT_DRIVER;
  });
  const [extensions, setExtensions] = useState<string[]>(() => loadRenderPrefs().extensions ?? []);
  const [previewSys, setPreviewSys] = useState<RenderSystem | null>(null);

  const caps = driverCapabilities(driver);
  const driverInfo = DRIVERS.find((d) => d.id === driver);

  const pickDriver = (id: string) => {
    setDriver(id);
    saveRenderPrefs({ driver: id, extensions });
  };
  const toggleExt = (id: string, on: boolean) => {
    const next = on ? [...new Set([...extensions, id])] : extensions.filter((x) => x !== id);
    setExtensions(next);
    saveRenderPrefs({ driver, extensions: next });
  };

  return (
    <div className="rpick">
      <div className="fpick__head">
        <span className="fpick__title">{t("Вид поля")}</span>
        <span className="fpick__count">{t("локально · не влияет на матч")}</span>
      </div>

      <div className="rpick__drivers">
        {DRIVERS.map((d) => (
          <button
            key={d.id}
            className={`rpick__card${d.id === driver ? " rpick__card--on" : ""}`}
            onClick={() => pickDriver(d.id)}
            title={t(d.description)}
          >
            <span className="rpick__card-title">{t(d.title)}</span>
            <span className="rpick__card-desc">{t(d.description)}</span>
          </button>
        ))}
      </div>

      <RendererPreview driver={driver} extensions={extensions} emulator={emulator} stage={stage} onSystem={setPreviewSys} />

      <RendererSettingsPanel key={driver} driver={driver} system={previewSys} />
      <div className="rpick__exts">
        {EXTENSIONS.map((x) => {
          const missing = (x.requires ?? []).filter((c) => !caps.has(c));
          const on = extensions.includes(x.id);
          return (
            <label key={x.id} className={`rpick__ext${missing.length ? " rpick__ext--off" : ""}`} title={t(x.description)}>
              <input type="checkbox" checked={on} disabled={missing.length > 0} onChange={(e) => toggleExt(x.id, e.target.checked)} />
              <span>{t(x.title)}</span>
              {missing.length > 0 && <em>{t("нет: {list}", { list: missing.join(", ") })}</em>}
            </label>
          );
        })}
      </div>

      {driverInfo && <div className="rpick__note">{t(driverInfo.description)}</div>}
    </div>
  );
}
