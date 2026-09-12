// RenderSettings.tsx — выбор драйвера рендера и расширений + управление камерой.
// Настройки локальные (не влияют на матч и не рассылаются по сети).
import { useEffect, useState } from "react";
import { listRenderers } from "../render/registry";
import type { RenderSystem } from "../render/render-system";
import { DEFAULT_DRIVER, loadRenderPrefs, saveRenderPrefs } from "../render/prefs";
import RendererSettingsPanel from "./RendererSettingsPanel";

interface Props {
  system: RenderSystem | null;
}

interface CamView {
  yaw: number;
  pitch: number;
  roll: number;
  distance: number;
  fx: number;
  fz: number;
}

export default function RenderSettings({ system }: Props) {
  const [driver, setDriver] = useState(() => loadRenderPrefs().driver || DEFAULT_DRIVER);
  const [extensions, setExtensions] = useState<string[]>(() => loadRenderPrefs().extensions ?? []);
  const [status, setStatus] = useState<{ id: string; state: string; reason?: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cam, setCam] = useState<CamView>({ yaw: 0, pitch: 1.05, roll: 0, distance: 34, fx: 0, fz: 0 });
  const [open, setOpen] = useState(false);

  const all = listRenderers();
  const drivers = all.filter((r) => r.kind === "driver");
  const exts = all.filter((r) => r.kind === "extension");
  const driverInfo = drivers.find((d) => d.id === driver);
  const caps = new Set(driverInfo?.provides ?? []);

  // Первичная инициализация рендера из настроек.
  useEffect(() => {
    if (!system) return;
    let alive = true;
    void (async () => {
      try {
        await system.init(driver, extensions);
        if (alive) {
          setStatus([...system.extensionStatus]);
          syncCam(system);
        }
      } catch (e) {
        if (alive) setError(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [system]);

  function syncCam(sys: RenderSystem): void {
    const c = sys.camera;
    setCam({ yaw: c.yaw, pitch: c.pitch, roll: c.roll, distance: c.distance, fx: c.fieldEuler.x, fz: c.fieldEuler.z });
  }

  async function applyDriver(id: string): Promise<void> {
    setDriver(id);
    saveRenderPrefs({ driver: id, extensions });
    if (!system) return;
    try {
      setError(null);
      await system.setDriver(id);
      await system.setExtensions(extensions);
      setStatus([...system.extensionStatus]);
      syncCam(system);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  async function toggleExtension(id: string, on: boolean): Promise<void> {
    const next = on ? [...new Set([...extensions, id])] : extensions.filter((x) => x !== id);
    setExtensions(next);
    saveRenderPrefs({ driver, extensions: next });
    if (!system) return;
    try {
      await system.setExtensions(next);
      setStatus([...system.extensionStatus]);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    }
  }

  function updateCam(patch: Partial<CamView>): void {
    if (!system) return;
    const c = system.camera;
    if (patch.yaw !== undefined) c.yaw = patch.yaw;
    if (patch.pitch !== undefined) c.pitch = patch.pitch;
    if (patch.roll !== undefined) c.roll = patch.roll;
    if (patch.distance !== undefined) c.distance = patch.distance;
    if (patch.fx !== undefined) c.fieldEuler.x = patch.fx;
    if (patch.fz !== undefined) c.fieldEuler.z = patch.fz;
    syncCam(system);
  }

  function preset(name: "top" | "iso" | "low"): void {
    system?.camera.setPreset(name);
    if (system) syncCam(system);
  }
  function reset(): void {
    system?.camera.reset();
    if (system) syncCam(system);
  }

  return (
    <div className="rset">
      <button className="rset__toggle" onClick={() => setOpen((v) => !v)}>
        Вид: {driverInfo?.title ?? driver} {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="rset__panel">
          <label className="rset__row">
            <span>Драйвер</span>
            <select value={driver} onChange={(e) => void applyDriver(e.target.value)}>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </label>
          <div className="rset__desc">{driverInfo?.description}</div>

          <div className="rset__sub">Расширения</div>
          {exts.map((x) => {
            const missing = (x.requires ?? []).filter((c) => !caps.has(c));
            const checked = extensions.includes(x.id);
            return (
              <label key={x.id} className={`rset__check${missing.length ? " rset__check--off" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={missing.length > 0}
                  onChange={(e) => void toggleExtension(x.id, e.target.checked)}
                />
                <span>{x.title}</span>
                {missing.length > 0 && <em>нет: {missing.join(", ")}</em>}
              </label>
            );
          })}

          {status.some((s) => s.state === "skipped") && (
            <div className="rset__warn">
              {status
                .filter((s) => s.state === "skipped")
                .map((s) => (
                  <div key={s.id}>
                    {s.id}: {s.reason}
                  </div>
                ))}
            </div>
          )}

          {caps.has("camera") && (
            <>
              <div className="rset__sub">Камера</div>
              <Slider label="Масштаб" min={8} max={90} step={0.5} value={cam.distance} onChange={(v) => updateCam({ distance: v })} />
              <Slider label="Поворот (Yaw)" min={-3.14} max={3.14} step={0.01} value={cam.yaw} onChange={(v) => updateCam({ yaw: v })} />
              <Slider label="Наклон (Pitch)" min={0.12} max={1.56} step={0.01} value={cam.pitch} onChange={(v) => updateCam({ pitch: v })} />
              <Slider label="Крен (Roll)" min={-3.14} max={3.14} step={0.01} value={cam.roll} onChange={(v) => updateCam({ roll: v })} />
              <Slider label="Тилт поля X" min={-1.5} max={1.5} step={0.01} value={cam.fx} onChange={(v) => updateCam({ fx: v })} />
              <Slider label="Тилт поля Z" min={-1.5} max={1.5} step={0.01} value={cam.fz} onChange={(v) => updateCam({ fz: v })} />
              <div className="rset__btns">
                <button onClick={() => preset("top")}>Сверху</button>
                <button onClick={() => preset("iso")}>Изометрия</button>
                <button onClick={() => preset("low")}>Низко</button>
                <button onClick={reset}>Сброс</button>
              </div>
              <div className="rset__hint">
                Мышь: ЛКМ — орбита, ПКМ/Shift — сдвиг, колесо — масштаб. Клавиши: Q/E, R/F, T/G, H, 1/2/3.
              </div>
            </>
          )}

          {error && <div className="rset__warn">{error}</div>}
          <RendererSettingsPanel key={driver} driver={driver} system={system} />
        </div>
      )}
    </div>
  );
}

function Slider(props: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="rset__row">
      <span>{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}
