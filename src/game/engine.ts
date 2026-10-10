import { AIController } from "./ai";
import { sfx } from "./audio";
import { InputManager } from "./input";
import { CanvasRenderer } from "./render2d";
import { ThreeRenderer } from "./render3d";
import {
  MATCH_SECONDS,
  MAX_HP,
  STEP_MS,
  emptyInput,
  type FighterInput,
  type FxEvent,
  type Snap,
  type World,
} from "./sim";
import type { Difficulty, GameMode, HudState, Renderer2D3D } from "./types";

/**
 * Orchestrates a match: fixed 60Hz simulation with an accumulator, rAF
 * rendering through either renderer, human/AI inputs, and (online) snapshot
 * publishing + remote interpolation.
 */

export interface EngineOptions {
  container: HTMLElement;
  world: World;
  mode: GameMode;
  localSide: 0 | 1;
  difficulty?: Difficulty;
  /** intro countdown before inputs unlock (ms, wall-clock so both peers sync) */
  countdownMs?: number;
  onHud: (h: HudState) => void;
  onPhase?: (p: "countdown" | "fight" | "over") => void;
  onEnd?: (winner: 0 | 1 | "tie") => void;
  onSendSnap?: (snap: Snap) => void;
}

interface QueuedSnap {
  snap: Snap;
  at: number;
}

const SNAP_MS = 120;
const REMOTE_DELAY = 70;

export class GameEngine {
  readonly input: InputManager;
  private opts: EngineOptions;
  private renderer: CanvasRenderer | ThreeRenderer | null = null;
  private kind: Renderer2D3D = "2d";
  private raf = 0;
  private lastT = 0;
  private acc = 0;
  private ai: AIController | null;
  private aiInput: FighterInput = emptyInput();
  private phase: "countdown" | "fight" | "over" = "countdown";
  private fightAt: number;
  private ended = false;
  private endAt = 0;
  private overAt = 0;
  private snapAcc = 0;
  private paused = false;
  private queue: QueuedSnap[] = [];
  private flashEl: HTMLDivElement | null = null;
  private disposed = false;
  private resizeHandler = () => this.renderer?.resize();

  constructor(opts: EngineOptions) {
    this.opts = opts;
    const w = opts.world;
    this.fightAt = Date.now() + (opts.countdownMs ?? 3000);

    this.input = new InputManager(
      () => w.f[opts.localSide].facing,
      () => w.f[opts.localSide].airborne,
    );
    this.input.attach();

    this.ai =
      opts.mode === "ai"
        ? new AIController((1 - opts.localSide) as 0 | 1, opts.difficulty ?? "normal")
        : null;

    w.onFx = (e) => this.handleFx(e);

    this.setRenderer("2d");
    window.addEventListener("resize", this.resizeHandler);
    window.addEventListener("orientationchange", this.resizeHandler);
    // first touch anywhere (arena or buttons) unlocks WebAudio on mobile
    window.addEventListener("pointerdown", () => sfx.unlock(), { once: true });
    window.addEventListener("keydown", () => sfx.unlock(), { once: true });

    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /* ------------------------------- renderers ------------------------------- */

  setRenderer(kind: Renderer2D3D) {
    if (this.kind === kind && this.renderer) {
      this.renderer.resize();
      return;
    }
    this.kind = kind;
    this.renderer?.dispose();
    this.renderer = null;
    this.flashEl?.remove();
    this.flashEl = null;
    if (kind === "2d") {
      this.renderer = new CanvasRenderer(this.opts.container);
    } else {
      const r = new ThreeRenderer(this.opts.container);
      this.renderer = r;
      const flash = document.createElement("div");
      flash.style.cssText =
        "position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;";
      this.opts.container.appendChild(flash);
      this.flashEl = flash;
    }
    this.renderer.resize();
  }

  getRendererKind(): Renderer2D3D {
    return this.kind;
  }

  /* --------------------------------- network -------------------------------- */

  /** incoming opponent snapshot (online) */
  applyRemote(snap: Snap) {
    const w = this.opts.world;
    const remoteSide = (1 - this.opts.localSide) as 0 | 1;
    // prune my events they have confirmed
    if (snap.ack > 0) {
      w.outEvents = w.outEvents.filter((e) => e.s > snap.ack);
    }
    w.applyRemote(remoteSide, snap, this.opts.localSide);
    this.queue.push({ snap, at: performance.now() });
    if (this.queue.length > 8) this.queue.shift();
  }

  private interpolateRemote() {
    if (this.opts.mode !== "online" || this.queue.length === 0) return;
    const now = performance.now();
    const target = now - REMOTE_DELAY;
    // find surrounding pair
    let a = this.queue[0];
    let b = this.queue[this.queue.length - 1];
    for (let i = this.queue.length - 1; i > 0; i--) {
      if (this.queue[i - 1].at <= target) {
        a = this.queue[i - 1];
        b = this.queue[i];
        break;
      }
    }
    const span = Math.max(1, b.at - a.at);
    const t = Math.max(0, Math.min(1, (target - a.at) / span));
    const f = this.opts.world.f[this.opts.localSide === 0 ? 1 : 0];
    f.x = a.snap.x + (b.snap.x - a.snap.x) * t;
    f.y = a.snap.y + (b.snap.y - a.snap.y) * t;
  }

  /* ---------------------------------- loop ---------------------------------- */

  private frame = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const now = performance.now();
    let dt = now - this.lastT;
    this.lastT = now;
    if (dt > 200) dt = 200;

    const w = this.opts.world;
    const wall = Date.now();

    // phase transitions (wall clock so peers agree)
    if (this.phase === "countdown" && wall >= this.fightAt) {
      this.phase = "fight";
      this.opts.onPhase?.("fight");
    }

    if (!this.paused && this.phase !== "countdown") {
      // slow-mo after the KO, then finish
      let scale = 1;
      if (this.phase === "over") {
        const since = now - this.overAt;
        scale = since < 1200 ? 0.35 : 0;
        if (!this.ended && since > 1500) this.finish(w.winner ?? "tie");
      }
      this.acc += dt * scale;
      let steps = 0;
      while (this.acc >= STEP_MS && steps < 5) {
        this.acc -= STEP_MS;
        steps++;
        this.step();
      }
      if (this.acc > STEP_MS * 6) this.acc = 0;
    }

    this.interpolateRemote();

    // end by timer
    if (this.phase === "fight" && !this.ended && this.secondsLeft() <= 0) {
      const [a, b] = w.f;
      const winner = a.hp === b.hp ? "tie" : a.hp > b.hp ? 0 : 1;
      this.phase = "over";
      this.overAt = now;
      w.over = true;
      w.winner = winner;
      this.opts.onPhase?.("over");
      if (winner === "tie") this.finish("tie");
    }

    // KO detection
    if (this.phase === "fight" && w.over) {
      this.phase = "over";
      this.overAt = now;
      this.opts.onPhase?.("over");
    }

    // snapshots (online)
    if (this.opts.onSendSnap && this.phase !== "over") {
      this.snapAcc += dt;
      if (this.snapAcc >= SNAP_MS) {
        this.snapAcc = 0;
        this.opts.onSendSnap(this.opts.world.serialize(this.opts.localSide));
      }
    }

    // render
    this.renderer?.render(w, wall, this.paused ? 0 : dt);
    if (this.flashEl) {
      this.flashEl.style.opacity = String(Math.min(0.7, w.flash * 0.65));
    }

    // hud
    this.opts.onHud(this.hud());
  };

  private step() {
    const w = this.opts.world;
    const inputs: [FighterInput, FighterInput] = [emptyInput(), emptyInput()];
    const me = this.opts.localSide;
    const tokens = this.input.flush();
    inputs[me].held = { ...this.input.snapshot() };
    inputs[me].tokens = tokens;
    if (this.ai) {
      const other = (1 - me) as 0 | 1;
      inputs[other] = this.ai.update(w, this.aiInput);
    }
    w.step(inputs);
  }

  private finish(winner: 0 | 1 | "tie") {
    if (this.ended) return;
    this.ended = true;
    this.phase = "over";
    this.opts.onPhase?.("over");
    this.opts.onEnd?.(winner);
  }

  /* ----------------------------------- fx ----------------------------------- */

  private handleFx(e: FxEvent) {
    this.renderer?.emitFx(e);
    switch (e.type) {
      case "hit":
        sfx.hit(e.move === 19 ? 1.6 : 1);
        break;
      case "block":
        sfx.block();
        break;
      case "jump":
        sfx.jump();
        break;
      case "land":
        sfx.land();
        break;
      case "whiff":
        sfx.whiff();
        break;
      case "ko":
        sfx.ko();
        break;
      case "ult":
        sfx.ult();
        break;
      case "nometer":
        sfx.nometer();
        break;
      default:
        break;
    }
  }

  /* ----------------------------------- hud ---------------------------------- */

  private secondsLeft(): number {
    if (this.phase === "countdown") return MATCH_SECONDS;
    const elapsed = (Date.now() - this.fightAt) / 1000;
    return Math.max(0, Math.ceil(MATCH_SECONDS - elapsed));
  }

  private hud(): HudState {
    const [a, b] = this.opts.world.f;
    return {
      hp1: a.hp / MAX_HP,
      hp2: b.hp / MAX_HP,
      meter1: a.meter,
      meter2: b.meter,
      combo1: a.comboHits,
      combo2: b.comboHits,
      seconds: this.secondsLeft(),
      over: this.phase === "over",
      winner: this.opts.world.winner,
    };
  }

  getPhase() {
    return this.phase;
  }

  countdownLeft(): number {
    return Math.max(0, this.fightAt - Date.now());
  }

  /* --------------------------------- controls -------------------------------- */

  pause() {
    if (this.opts.mode === "online") return; // no pausing a live online match
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.lastT = performance.now();
    this.acc = 0;
  }

  isPaused() {
    return this.paused;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resizeHandler);
    window.removeEventListener("orientationchange", this.resizeHandler);
    this.input.detach();
    this.renderer?.dispose();
    this.renderer = null;
    this.flashEl?.remove();
  }
}
