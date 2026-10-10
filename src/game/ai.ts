import { type FighterInput, type World } from "./sim";
import type { Difficulty } from "./types";

/**
 * The CPU plays by the exact same rules as a human: it emits held directions
 * and combo tokens through the same matcher, so it can be out-spaced, baited
 * and punished.
 */

const PROFILE: Record<
  Difficulty,
  { think: number; block: number; aggression: number; string: number }
> = {
  easy: { think: 430, block: 0.14, aggression: 0.5, string: 0.25 },
  normal: { think: 250, block: 0.4, aggression: 0.72, string: 0.55 },
  hard: { think: 145, block: 0.68, aggression: 0.9, string: 0.85 },
};

type Tok = { at: number; tok: string };

interface Attack {
  at: number[];
  toks: string[];
  needClose?: boolean;
}

const ATTACKS: Attack[] = [
  { at: [0], toks: ["L"] },
  { at: [0, 140], toks: ["L", "L"] },
  { at: [0, 150, 310], toks: ["L", "L", "H"] },
  { at: [0], toks: ["dL"] },
  { at: [0], toks: ["H"] },
  { at: [0], toks: ["bH"] },
  { at: [0], toks: ["dS"] },
  { at: [0, 160], toks: ["qcf", "fS"], needClose: false },
  { at: [0, 170], toks: ["qcf", "fH"], needClose: false },
  { at: [0, 150, 300, 460], toks: ["L", "H", "S"] },
];

export class AIController {
  private side: 0 | 1;
  private difficulty: Difficulty;
  private nextDecision = 0;
  private script: Tok[] = [];
  private held = { l: false, r: false, u: false, d: false };
  private holdUntil = 0;

  constructor(side: 0 | 1, difficulty: Difficulty) {
    this.side = side;
    this.difficulty = difficulty;
  }

  update(world: World, input: FighterInput): FighterInput {
    const clock = world.clock;
    const prof = PROFILE[this.difficulty];

    if (world.over) {
      this.held = { l: false, r: false, u: false, d: false };
      input.held = { ...this.held };
      input.tokens.length = 0;
      return input;
    }

    if (clock >= this.nextDecision) {
      this.decide(world, prof, clock);
      this.nextDecision = clock + prof.think * (0.75 + Math.random() * 0.5);
    }

    while (this.script.length && this.script[0].at <= clock) {
      input.tokens.push(this.script.shift()!.tok);
    }
    if (clock >= this.holdUntil) this.held = { l: false, r: false, u: false, d: false };

    input.held = { ...this.held };
    return input;
  }

  private decide(world: World, prof: (typeof PROFILE)["easy"], clock: number) {
    const f = world.f[this.side];
    const opp = world.f[1 - this.side];
    const dist = Math.abs(opp.x - f.x);
    const toward: "l" | "r" = f.facing === 1 ? "r" : "l";
    const away: "l" | "r" = toward === "r" ? "l" : "r";
    this.script = [];
    this.held = { l: false, r: false, u: false, d: false };

    // defend — opponent swinging nearby, or an incoming projectile
    const threat =
      (opp.move !== null && dist < 260) ||
      (opp.state === "air" && dist < 200) ||
      world.projectiles.some((p) => p.owner !== this.side);
    if (threat && Math.random() < prof.block) {
      this.held[away] = true;
      if (dist < 150) this.held.d = Math.random() < 0.5; // crouch-block lows
      this.holdUntil = clock + 320 + Math.random() * 280;
      return;
    }

    // opponent vulnerable — press the advantage
    if (opp.downT > 0 || opp.hitstun > 0) {
      if (dist > 140) {
        this.held[toward] = true;
        this.holdUntil = clock + 220;
      }
      if (dist < 240 && Math.random() < prof.aggression) this.queueAttack(clock, dist, prof);
      return;
    }

    if (dist > 430) {
      // long range: fireball or close the gap
      if (Math.random() < prof.aggression * 0.45) {
        this.script.push({ at: clock, tok: "qcf" });
        this.script.push({ at: clock + 150, tok: "fS" });
      } else {
        this.held[toward] = true;
        this.holdUntil = clock + 320 + Math.random() * 320;
      }
      return;
    }

    if (dist > 250) {
      const r = Math.random();
      if (r < 0.28) {
        this.script.push({ at: clock, tok: "qcf" });
        this.script.push({ at: clock + 150, tok: "fS" });
      } else if (r < 0.42) {
        this.script.push({ at: clock, tok: "ff" });
        this.script.push({ at: clock + 160, tok: "fH" });
      } else if (r < 0.65) {
        this.held[toward] = true;
        this.holdUntil = clock + 260;
      } else {
        this.queueAttack(clock, dist, prof);
      }
      return;
    }

    this.queueAttack(clock, dist, prof);
  }

  private queueAttack(clock: number, dist: number, prof: (typeof PROFILE)["easy"]) {
    const pool = ATTACKS.filter((a) => (a.needClose === false ? true : dist < 400));
    const useString = Math.random() < prof.string;
    const candidates = useString ? pool : pool.filter((a) => a.toks.length === 1);
    const list = candidates.length ? candidates : pool;
    const pick = list[Math.floor(Math.random() * list.length)];
    for (let i = 0; i < pick.toks.length; i++) {
      this.script.push({ at: clock + pick.at[i], tok: pick.toks[i] });
    }
    if (Math.random() < 0.35) {
      const toward: "l" | "r" = this.held.l || this.held.r ? (this.held.l ? "l" : "r") : "r";
      this.held[toward] = true;
      this.holdUntil = clock + 170;
    }
  }
}
