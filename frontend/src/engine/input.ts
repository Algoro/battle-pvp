// input.ts — keyboard -> con_btn bitmask (matches the core/ROM).
// Pure logic, tested (tests/input.test.js).
export const BTN = {
  A: 0x01,
  B: 0x02,
  Select: 0x04,
  Start: 0x08,
  Up: 0x10,
  Down: 0x20,
  Left: 0x40,
  Right: 0x80,
} as const;

// Key map -> bit. Used in KeyboardInput (port).
export interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  a: string[];
  b: string[];
  start: string[];
  select: string[];
}

export const DEFAULT_KEYS: KeyMap = {
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  a: ["KeyZ", "KeyJ"], // fire
  b: ["KeyX", "KeyK"],
  start: ["Enter"],
  select: ["ShiftLeft", "ShiftRight"],
};

// Key (e.code) -> con_btn bit (0 if not assigned).
export function keyToMask(code: string, keys: KeyMap = DEFAULT_KEYS): number {
  if (keys.up.includes(code)) return BTN.Up;
  if (keys.down.includes(code)) return BTN.Down;
  if (keys.left.includes(code)) return BTN.Left;
  if (keys.right.includes(code)) return BTN.Right;
  if (keys.a.includes(code)) return BTN.A;
  if (keys.b.includes(code)) return BTN.B;
  if (keys.start.includes(code)) return BTN.Start;
  if (keys.select.includes(code)) return BTN.Select;
  return 0;
}

// Aggregates the mask from a set of simultaneously pressed keys.
export function maskFromCodes(codes: string[], keys: KeyMap = DEFAULT_KEYS): number {
  let m = 0;
  for (const c of codes) m |= keyToMask(c, keys);
  return m;
}

// KeyboardInput — tracks presses and returns the current mask for the port.
export class KeyboardInput {
  private pressed = new Set<string>();
  private keys: KeyMap;

  constructor(keys: KeyMap = DEFAULT_KEYS) {
    this.keys = keys;
  }

  attach(el: Window | HTMLElement = window) {
    // Do not intercept keys when focus is in an input field (chat in battle) — otherwise
    // typing would move the tank and block the characters.
    const editable = (t: EventTarget | null) => {
      const e = t as HTMLElement | null;
      return !!e && (e.tagName === "INPUT" || e.tagName === "TEXTAREA" || e.isContentEditable);
    };
    el.addEventListener("keydown", (e) => {
      if (editable(e.target)) return;
      this.pressed.add((e as KeyboardEvent).code);
      e.preventDefault?.();
    });
    el.addEventListener("keyup", (e) => {
      if (editable(e.target)) return;
      this.pressed.delete((e as KeyboardEvent).code);
    });
    el.addEventListener("blur", () => this.pressed.clear());
    // when focus moves to an input field, reset "stuck" keys
    el.addEventListener("focusin", (e) => { if (editable(e.target)) this.pressed.clear(); });
  }

  mask(): number {
    return maskFromCodes([...this.pressed], this.keys);
  }

  reset() {
    this.pressed.clear();
  }
}
