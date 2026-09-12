// camera-rig.ts — модель камеры и преобразование поля. Чистая математика, без DOM/three.
//
// Позволяет масштабировать (zoom), вращать по разным плоскостям (yaw/pitch/roll) и
// панорамировать; отдельно задаёт Euler-поворот самого поля (fieldEuler), чтобы можно
// было наклонять «стол», а не только камеру.
//
// Относительный путь: ./frontend/src/render/camera-rig.ts

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPreset {
  yaw: number;
  pitch: number;
  roll: number;
  distance: number;
}

export const PRESETS: Record<"top" | "iso" | "low", CameraPreset> = {
  top: { yaw: 0, pitch: 1.55, roll: 0, distance: 30 },
  iso: { yaw: Math.PI / 4, pitch: 0.95, roll: 0, distance: 34 },
  low: { yaw: -Math.PI / 6, pitch: 0.5, roll: 0, distance: 36 },
};

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class CameraRig {
  yaw = 0;
  pitch = 1.05;
  roll = 0;
  distance = 34;
  target: Vec3 = { x: 13, y: 0, z: 13 };
  /** Euler-поворот корня сцены (радианы) — «вращение поля по разным плоскостям». */
  fieldEuler: Vec3 = { x: 0, y: 0, z: 0 };

  minPitch = 0.12;
  maxPitch = Math.PI / 2 - 0.01;
  minDistance = 8;
  maxDistance = 100;
  /** До какого времени (мс) не сбивать авто-доворот камеры после ручного ввода. */
  userHoldUntil = 0;

  /** Отметить ручной ввод — временно приостанавливает авто-доворот. */
  markUserInput(holdMs = 1200): void {
    this.userHoldUntil = (typeof performance !== "undefined" ? performance.now() : 0) + holdMs;
  }

  /** Орбита: dx — горизонталь (yaw), dy — вертикаль (pitch). Значения в радианах. */
  orbit(dx: number, dy: number): void {
    this.yaw += dx;
    this.pitch = clamp(this.pitch + dy, this.minPitch, this.maxPitch);
  }

  /** Крен вокруг оси взгляда. */
  rotateRoll(d: number): void {
    this.roll = clamp(this.roll + d, -Math.PI, Math.PI);
  }

  /** Масштаб: factor > 1 приближает. */
  zoom(factor: number): void {
    this.distance = clamp(this.distance * factor, this.minDistance, this.maxDistance);
  }

  /** Панорама по плоскости земли (пиксели мыши). */
  pan(dxPx: number, dyPx: number, viewportPx = 600): void {
    const k = this.distance / viewportPx;
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    // «Хват» мира: и по X, и по Z контент следует за курсором.
    // right = (cos,0,-sin), up-screen = (-sin,0,-cos).
    this.target.x += -cy * dxPx * k - sy * dyPx * k;
    this.target.z += sy * dxPx * k - cy * dyPx * k;
  }

  /** Поворот поля (корня сцены) по осям. */
  rotateField(dx: number, dy: number, dz = 0): void {
    this.fieldEuler.x = clamp(this.fieldEuler.x + dx, -Math.PI, Math.PI);
    this.fieldEuler.y = clamp(this.fieldEuler.y + dy, -Math.PI, Math.PI);
    this.fieldEuler.z = clamp(this.fieldEuler.z + dz, -Math.PI, Math.PI);
  }

  /** Позиция камеры в мире. */
  position(): Vec3 {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    return {
      x: this.target.x + this.distance * cp * Math.sin(this.yaw),
      y: this.target.y + this.distance * sp,
      z: this.target.z + this.distance * cp * Math.cos(this.yaw),
    };
  }

  setPreset(name: keyof typeof PRESETS): void {
    const p = PRESETS[name];
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.roll = p.roll;
    this.distance = p.distance;
  }

  reset(): void {
    this.yaw = 0;
    this.pitch = 1.05;
    this.roll = 0;
    this.distance = 34;
    this.target = { x: 13, y: 0, z: 13 };
    this.fieldEuler = { x: 0, y: 0, z: 0 };
  }
}

export default CameraRig;
