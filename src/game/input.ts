/**
 * Human input layer. Turns keyboard / touch gestures into the token stream
 * the universal combo matcher understands:
 *
 *   - direction-qualified buttons: L, dL, fH, bS, aL ...
 *   - motion tokens:  qcf (down -> toward), qcb (down -> away)
 *   - double taps:    ff (toward twice), dd (down twice)
 *
 * Windows here use real time (performance.now) — combo matching stamps tokens
 * with the simulation clock, so the two never need to agree.
 */

export type Btn = "L" | "H" | "S";
export type Dir = "l" | "r" | "u" | "d";

const MOTION_MS = 450;
const DOUBLE_MS = 420;
const MOTION_GRACE = 320; // button right after a motion uses its direction

export class InputManager {
  held: Record<Dir, boolean> = { l: false, r: false, u: false, d: false };

  private tokens: string[] = [];
  private lastPress: Partial<Record<Dir, number>> = {};
  private lastDirEvent: { dir: Dir; t: number } | null = null;
  private recentMotion: { dir: "f" | "b"; t: number } | null = null;
  private keyMap: Record<string, Dir> = {
    ArrowLeft: "l",
    a: "l",
    A: "l",
    ArrowRight: "r",
    d: "r",
    D: "r",
    ArrowUp: "u",
    w: "u",
    W: "u",
    ArrowDown: "d",
    s: "d",
    S: "d",
  };
  private btnMap: Record<string, Btn> = {
    j: "L",
    J: "L",
    z: "L",
    Z: "L",
    k: "H",
    K: "H",
    x: "H",
    X: "H",
    l: "S",
    L: "S",
    c: "S",
    C: "S",
    " ": "H",
  };

  private getFacing: () => 1 | -1;
  private isAirborne: () => boolean;

  constructor(getFacing: () => 1 | -1, isAirborne: () => boolean) {
    this.getFacing = getFacing;
    this.isAirborne = isAirborne;
  }

  attach() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.releaseAll);
  }

  detach() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.releaseAll);
  }

  releaseAll = () => {
    this.held = { l: false, r: false, u: false, d: false };
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const dir = this.keyMap[e.key];
    if (dir) {
      e.preventDefault();
      this.setDir(dir, true);
      return;
    }
    const btn = this.btnMap[e.key];
    if (btn) {
      e.preventDefault();
      this.press(btn);
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const dir = this.keyMap[e.key];
    if (dir) {
      e.preventDefault();
      this.setDir(dir, false);
    }
  };

  /** called by the virtual joystick / keys */
  setDir(dir: Dir, on: boolean) {
    if (this.held[dir] === on) return;
    this.held[dir] = on;
    if (on) this.dirEvent(dir);
  }

  /** whole-stick vector from the touch pad (-1..1 per axis) */
  setStick(x: number, y: number) {
    const dz = 0.32;
    this.held.l = x < -dz;
    this.held.r = x > dz;
    this.held.u = y < -dz;
    this.held.d = y > dz;
    // synthesize a direction event when the active direction changes
    const dir = this.activeDir();
    if (dir && dir !== this.lastDirEvent?.dir) this.dirEvent(dir);
    if (!dir) this.lastDirEvent = null;
  }

  private activeDir(): Dir | null {
    if (this.held.l !== this.held.r) return this.held.l ? "l" : "r";
    if (this.held.u !== this.held.d) return this.held.u ? "u" : "d";
    return null;
  }

  private dirEvent(dir: Dir) {
    const now = performance.now();
    const facing = this.getFacing();
    const toward: Dir = facing === 1 ? "r" : "l";
    const away: Dir = facing === 1 ? "l" : "r";
    const prev = this.lastDirEvent;

    if (dir === toward || dir === away) {
      // motion: down -> forward/back
      if (prev && prev.dir === "d" && now - prev.t < MOTION_MS) {
        const kind = dir === toward ? "qcf" : "qcb";
        this.tokens.push(kind);
        this.recentMotion = { dir: dir === toward ? "f" : "b", t: now };
      }
      // double tap toward = dash
      if (dir === toward) {
        const lp = this.lastPress[dir];
        if (lp !== undefined && now - lp < DOUBLE_MS) {
          this.tokens.push("ff");
          this.lastPress[dir] = undefined;
        }
        this.lastPress[dir] = now;
      } else {
        this.lastPress[dir] = now;
      }
    } else if (dir === "d") {
      const lp = this.lastPress.d;
      if (lp !== undefined && now - lp < DOUBLE_MS) {
        this.tokens.push("dd");
        this.lastPress.d = undefined;
      }
      this.lastPress.d = now;
    }
    this.lastDirEvent = { dir, t: now };
  }

  /** button press -> qualified token */
  press(btn: Btn) {
    const now = performance.now();
    if (this.recentMotion && now - this.recentMotion.t < MOTION_GRACE) {
      this.tokens.push(this.recentMotion.dir + btn);
      return;
    }
    if (this.isAirborne()) {
      this.tokens.push("a" + btn);
      return;
    }
    if (this.held.d) {
      this.tokens.push("d" + btn);
      return;
    }
    const facing = this.getFacing();
    const toward: Dir = facing === 1 ? "r" : "l";
    const away: Dir = facing === 1 ? "l" : "r";
    if (this.held[toward]) this.tokens.push("f" + btn);
    else if (this.held[away]) this.tokens.push("b" + btn);
    else this.tokens.push(btn);
  }

  /** hand queued tokens to the simulation (called once per sim step) */
  flush(): string[] {
    const out = this.tokens;
    this.tokens = [];
    return out;
  }

  /** HUD hint: current suggested direction glyph */
  snapshot() {
    return { ...this.held };
  }
}
