// camera-controls.ts — привязка ввода (мышь/тач/клавиатура) к CameraRig.
// Клавиши не пересекаются с игровыми (WASD/стрелки/Z/Enter): Q/E, R/F, T/G, H, 1-3, +/-.
//
// Относительный путь: ./frontend/src/render/camera-controls.ts
import type { CameraRig } from "./camera-rig.ts";

const ORBIT_SPEED = 0.008;
const PAN_SPEED = 1;

export function attachCameraControls(container: HTMLElement, rig: CameraRig): () => void {
  let mode: "orbit" | "pan" | null = null;
  let lastX = 0;
  let lastY = 0;
  let pointerId = -1;

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== -1) return;
    pointerId = e.pointerId;
    mode = e.button === 0 && !e.shiftKey ? "orbit" : "pan";
    lastX = e.clientX;
    lastY = e.clientY;
    container.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId || !mode) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === "orbit") rig.orbit(-dx * ORBIT_SPEED, dy * ORBIT_SPEED);
    else rig.pan(dx * PAN_SPEED, dy * PAN_SPEED, container.clientWidth || 600);
    rig.markUserInput();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    mode = null;
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    rig.zoom(e.deltaY > 0 ? 1.08 : 1 / 1.08);
    rig.markUserInput();
  };

  const onContextMenu = (e: Event) => e.preventDefault();
  const onDoubleClick = () => rig.reset();

  const onKeyDown = (e: KeyboardEvent) => {
    // Не перехватываем ввод в текстовых полях/селектах (позывной, настройки и т.п.).
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
    switch (e.key) {
      case "q": rig.orbit(-0.08, 0); break;
      case "e": rig.orbit(0.08, 0); break;
      case "r": rig.orbit(0, -0.06); break;
      case "f": rig.orbit(0, 0.06); break;
      case "t": rig.rotateRoll(-0.08); break;
      case "g": rig.rotateRoll(0.08); break;
      case "h": rig.reset(); break;
      case "+": case "=": rig.zoom(1 / 1.1); break;
      case "-": rig.zoom(1.1); break;
      case "1": rig.setPreset("top"); break;
      case "2": rig.setPreset("iso"); break;
      case "3": rig.setPreset("low"); break;
      default: return;
    }
    rig.markUserInput();
    e.preventDefault();
  };

  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("wheel", onWheel, { passive: false });
  container.addEventListener("contextmenu", onContextMenu);
  container.addEventListener("dblclick", onDoubleClick);
  window.addEventListener("keydown", onKeyDown);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("wheel", onWheel);
    container.removeEventListener("contextmenu", onContextMenu);
    container.removeEventListener("dblclick", onDoubleClick);
    window.removeEventListener("keydown", onKeyDown);
  };
}

export default attachCameraControls;
