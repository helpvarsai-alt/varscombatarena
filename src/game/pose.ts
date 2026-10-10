import type { Fighter } from "./sim";

/**
 * One skeletal pose drives BOTH renderers: the canvas renderer turns the
 * angles into limb endpoints, three.js rotates mesh pivots by the same
 * numbers. Character identity changes colors/aura/particles — not the moves.
 *
 * Limb angle convention: 0 = pointing straight down, positive rotates
 * forward (toward facing). Torso `lean` is positive forward.
 */

export interface Pose {
  hip: number;
  lean: number;
  headLean: number;
  armF: [number, number];
  armB: [number, number];
  legF: [number, number];
  legB: [number, number];
  /** whole-body rotation for spins / knockdowns (radians) */
  rot: number;
  /** 0..1 how deep the crouch is */
  crouch: number;
}

type Kind =
  | "punch"
  | "kick"
  | "low"
  | "upper"
  | "shot"
  | "dash"
  | "spin"
  | "air"
  | "ult"
  | "idle";

const KIND_BY_MOVE: Record<number, Kind> = {
  0: "punch",
  1: "punch",
  2: "shot",
  3: "punch",
  4: "punch",
  5: "punch",
  6: "low",
  7: "low",
  8: "upper",
  9: "shot",
  10: "dash",
  11: "shot",
  12: "kick",
  13: "upper",
  14: "dash",
  15: "spin",
  16: "air",
  17: "air",
  18: "punch",
  19: "ult",
};

export function swingOf(f: Fighter): number {
  const mv = f.move;
  if (!mv) return 0;
  const w = Math.max(1, mv.windup);
  const a = Math.max(1, mv.active);
  const r = Math.max(1, mv.recover);
  if (f.moveFrame < w) return -0.35 * (f.moveFrame / w);
  if (f.moveFrame < w + a) return Math.min(1, (f.moveFrame - w) / (a * 0.5));
  return Math.max(0, 1 - (f.moveFrame - w - a) / r);
}

const IDLE: Pose = {
  hip: 78,
  lean: 0.06,
  headLean: 0,
  armF: [0.4, 2.1],
  armB: [0.2, 1.9],
  legF: [0.2, 0.14],
  legB: [-0.26, 0.3],
  rot: 0,
  crouch: 0,
};

export function poseFor(f: Fighter, timeMs: number): Pose {
  const breathe = Math.sin(timeMs * 0.004 + f.side) * 1.6;
  const p: Pose = {
    hip: IDLE.hip + breathe,
    lean: IDLE.lean,
    headLean: 0,
    armF: [...IDLE.armF] as [number, number],
    armB: [...IDLE.armB] as [number, number],
    legF: [...IDLE.legF] as [number, number],
    legB: [...IDLE.legB] as [number, number],
    rot: 0,
    crouch: 0,
  };

  switch (f.state) {
    case "walk": {
      const ph = f.walkPhase * Math.PI * 2;
      p.legF = [Math.sin(ph) * 0.55, 0.15 + Math.max(0, -Math.sin(ph)) * 0.6];
      p.legB = [Math.sin(ph + Math.PI) * 0.55, 0.15 + Math.max(0, -Math.sin(ph + Math.PI)) * 0.6];
      p.hip = 76 + Math.abs(Math.sin(ph)) * 2;
      p.armF = [0.5, 2.0 + Math.sin(ph) * 0.15];
      p.armB = [0.1, 1.8 - Math.sin(ph) * 0.15];
      break;
    }
    case "crouch": {
      p.hip = 50;
      p.crouch = 1;
      p.legF = [1.0, -1.62];
      p.legB = [0.5, -1.1];
      p.armF = [0.7, 1.9];
      p.armB = [0.4, 1.7];
      p.lean = 0.22;
      break;
    }
    case "air": {
      p.hip = 76;
      p.legF = [0.9, -1.35];
      p.legB = [-0.45, -0.75];
      p.armF = [-0.7, 1.2];
      p.armB = [-1.0, 0.9];
      p.lean = 0.18;
      break;
    }
    case "hurt": {
      p.hip = 73;
      p.lean = -0.42;
      p.headLean = -0.3;
      p.armF = [-0.6, 0.9];
      p.armB = [-0.95, 0.7];
      p.legF = [0.55, -0.35];
      p.legB = [-0.5, 0.55];
      break;
    }
    case "block": {
      p.hip = 71;
      p.lean = 0.1;
      p.armF = [1.15, 1.95];
      p.armB = [0.95, 2.15];
      p.legF = [0.3, 0.4];
      p.legB = [-0.35, 0.5];
      p.crouch = 0.35;
      break;
    }
    case "down":
    case "ko": {
      p.hip = 22;
      p.rot = 1.5;
      p.lean = -0.2;
      p.armF = [-1.2, 0.4];
      p.armB = [-1.5, 0.3];
      p.legF = [0.5, -0.4];
      p.legB = [0.2, -0.6];
      p.crouch = 1;
      break;
    }
    case "win": {
      const bounce = Math.sin(timeMs * 0.008) * 3;
      p.hip = 78 + bounce;
      p.armF = [2.75, 0.35];
      p.armB = [2.6, 0.5];
      p.lean = -0.05;
      break;
    }
    case "attack": {
      applyAttack(p, f, timeMs);
      break;
    }
    default:
      break;
  }
  return p;
}

function applyAttack(p: Pose, f: Fighter, timeMs: number) {
  const mv = f.move!;
  const s = swingOf(f);
  const kind = KIND_BY_MOVE[mv.id] ?? "punch";
  const t = Math.sin(timeMs * 0.006) * 0.04;

  switch (kind) {
    case "punch": {
      p.armF = [0.4 + s * 1.2, 2.1 - s * 2.4];
      p.armB = [0.15 - s * 0.3, 1.9];
      p.lean = 0.06 + s * 0.2;
      p.hip = 78 - s * 3;
      p.legF = [0.3 + s * 0.25, 0.14];
      p.legB = [-0.3 - s * 0.15, 0.3];
      break;
    }
    case "kick": {
      p.legF = [0.25 + s * 1.35, 0.2 - s * 0.45];
      p.legB = [-0.3, 0.35];
      p.hip = 78 - s * 7;
      p.lean = -0.05 - s * 0.35;
      p.armF = [0.6, 1.5];
      p.armB = [-0.7 - s * 0.4, 0.9];
      break;
    }
    case "low": {
      p.hip = 54 - s * 8;
      p.crouch = 1;
      p.legF = [1.15 + s * 0.35, -1.5 - s * 0.4];
      p.legB = [0.45, -1.05];
      p.lean = 0.3 + s * 0.15;
      p.armF = [1.3, 0.6];
      p.armB = [-0.4, 1.2];
      break;
    }
    case "upper": {
      p.armF = [0.3 + s * 2.7, 2.2 - s * 2.3];
      p.armB = [0.1, 1.7];
      p.hip = 77 + s * 5;
      p.lean = 0.05 - s * 0.28;
      p.legF = [0.35, 0.1];
      p.legB = [-0.35, 0.5];
      break;
    }
    case "shot": {
      p.armF = [0.85 + s * 0.75, 1.5 - s * 1.5];
      p.armB = [0.7 + s * 0.8, 1.4 - s * 1.4];
      p.lean = 0.06 + s * 0.18;
      p.hip = 76;
      p.legF = [0.35, 0.2];
      p.legB = [-0.4, 0.45];
      break;
    }
    case "dash": {
      p.lean = 0.1 + s * 0.55;
      p.armF = [-0.5 - s * 0.5, 1.2];
      p.armB = [-1.1, 0.6];
      p.legF = [0.3 + s * 1.1, 0.1];
      p.legB = [-0.6 - s * 0.3, 0.7];
      p.hip = 74 - s * 5;
      break;
    }
    case "spin": {
      p.rot = s * Math.PI * 3.5;
      p.armF = [1.5, 0.1];
      p.armB = [-1.5, -0.1];
      p.legF = [0.5, 0.1];
      p.legB = [-0.4, 0.3];
      p.hip = 70;
      p.lean = 0.2;
      break;
    }
    case "air": {
      p.legF = [0.4 + s * 1.0, -1.2 + s * 1.1];
      p.legB = [-0.5, -0.6];
      p.armF = [0.5 + s * 1.4, 1.7 - s * 1.7];
      p.armB = [-0.9, 0.8];
      p.lean = 0.25 + s * 0.25;
      break;
    }
    case "ult": {
      const flurry = Math.sin(f.moveFrame * 0.9) * 0.5 + 0.5;
      p.armF = [0.3 + flurry * 1.3, 2.2 - flurry * 2.5];
      p.armB = [0.1 + (1 - flurry) * 1.3, 2.0 - (1 - flurry) * 2.3];
      p.lean = 0.15 + s * 0.3;
      p.hip = 76 - s * 4;
      p.legF = [0.4 + s * 0.3, 0.1];
      p.legB = [-0.45, 0.4];
      break;
    }
  }
  p.headLean += t;
}
