// RendererPreview.tsx — live preview of the selected render driver before the match starts.
// The 3D driver shows a rotating demo scene; the pixel one shows a stage preview from the ROM.
import { useEffect, useRef } from "react";
import type { EmulatorDriver } from "../engine/emulator";
import { driverCapabilities } from "../render/registry";
import { previewScene } from "../render/preview-scene";
import { stageScene } from "../render/stage-scene";
import { RenderSystem } from "../render/render-system";
import { useT } from "../i18n/index.tsx";
import StagePreview from "./StagePreview";

interface Props {
  driver: string;
  extensions: string[];
  emulator?: EmulatorDriver | null;
  stage: number;
  onSystem?: (system: RenderSystem | null) => void;
}

export default function RendererPreview({ driver, extensions, emulator, stage, onSystem }: Props) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const is3d = driverCapabilities(driver).has("three");
  const extKey = extensions.join(",");
  const onSystemRef = useRef(onSystem);
  onSystemRef.current = onSystem;
  const stageRef = useRef(stage);
  stageRef.current = stage;

  useEffect(() => {
    if (!is3d) return;
    const el = ref.current;
    if (!el) return;
    const emu = emulator;
    const sys = new RenderSystem({
      container: el,
      // Show the real level of the selected stage (fallback — demo scene).
      scene: () => (emu ? stageScene(emu, stageRef.current) : previewScene()),
    });
    sys.setViewer({ port: 0 });
    onSystemRef.current?.(sys);
    let raf = 0;
    void sys.init(driver, extensions).catch(() => {});
    const loop = () => {
      sys.camera.yaw += 0.004;
      sys.frame();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      sys.dispose();
      onSystemRef.current?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is3d, driver, extKey, emulator]);

  if (!is3d) {
    return (
      <div className="rpreview rpreview--2d">
        <StagePreview emulator={emulator ?? null} stage={stage} size={240} />
        <span className="rpreview__hint">{t("Пиксельный вид (ROM)")}</span>
      </div>
    );
  }
  return <div className="rpreview" ref={ref} />;
}
