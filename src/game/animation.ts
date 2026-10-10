import type { Fighter } from "./sim";

/**
 * 3D fight animation — a flat-channel, keyframed pose system for the three.js
 * humanoid rig.
 *
 * Why a separate pose from `pose.ts`? The canvas renderer works in flat 2D
 * (one z-rotation per limb). The 3D rig needs three axes per joint so punches
 * turn the torso, kicks sweep across depth and knockdowns roll the body — that
 * is what makes the animation read as real animation instead of stick figures.
 *
 * Axis convention (local space, character faces +X, up is +Y, +Z is the
 * near/camera side):
 *   *_z  forward swing      (+ = limb tips toward the direction you face)
 *   *_x  lateral spread     (+ = limb tips toward -Z, i.e. across the body)
 *   *_y  twist about the limb axis
 *   knee *z is negative when the joint bends (shin folds backwards)
 *
 * Every one of the 20 combos has its own hand-authored keyframe track, timed
 * against that move's real frame data (windup / active / recover), so a Jab
 * Snap and an Ultimate Surge do not share a silhouette.
 */

export const CHANNELS = [
  "pelvisY",
  "pelvisZ",
  "rootPitch",
  "rootYaw",
  "rootRoll",
  "pelvisPitch",
  "pelvisYaw",
  "pelvisRoll",
  "chestPitch",
  "chestYaw",
  "chestRoll",
  "headPitch",
  "headYaw",
  "headRoll",
  "armFShX",
  "armFShY",
  "armFShZ",
  "armFEl",
  "armFWr",
  "armBShX",
  "armBShY",
  "armBShZ",
  "armBEl",
  "armBWr",
  "legFHpX",
  "legFHpY",
  "legFHpZ",
  "legFKn",
  "legFAn",
  "legBHpX",
  "legBHpY",
  "legBHpZ",
  "legBKn",
  "legBAn",
] as const;

export type Channel = (typeof CHANNELS)[number];
export type Pose3 = Record<Channel, number>;

/* ------------------------------- keyframes ------------------------------- */

export type EaseName = "linear" | "smooth" | "in" | "out" | "hold";

const EASE: Record<EaseName, (u: number) => number> = {
  linear: (u) => u,
  smooth: (u) => u * u * (3 - 2 * u),
  in: (u) => u * u,
  out: (u) => 1 - (1 - u) * (1 - u),
  hold: () => 0,
};

export interface Keyframe {
  /** normalized time within the move, 0..1 */
  t: number;
  /** channels this frame sets; anything omitted falls back to the base pose */
  v: Partial<Pose3>;
  /** easing used to reach this frame (default "smooth") */
  e?: EaseName;
}

export function key(t: number, frame: Partial<Pose3> & { e?: EaseName }): Keyframe {
  const { e, ...v } = frame;
  return { t, v, e };
}

function writeAll(dst: Pose3, base: Pose3, v: Partial<Pose3>) {
  for (const c of CHANNELS) dst[c] = v[c] ?? base[c];
}

/** Sample a keyframe track into `dst`, missing channels resolve against `base`. */
export function applyKeys(dst: Pose3, base: Pose3, keys: Keyframe[], t: number) {
  const n = keys.length;
  if (n === 0) {
    writeAll(dst, base, {});
    return;
  }
  if (t <= keys[0].t) {
    writeAll(dst, base, keys[0].v);
    return;
  }
  if (t >= keys[n - 1].t) {
    writeAll(dst, base, keys[n - 1].v);
    return;
  }
  for (let i = 1; i < n; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (t <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const u = EASE[b.e ?? "smooth"](Math.max(0, Math.min(1, (t - a.t) / span)));
      for (const c of CHANNELS) {
        const av = a.v[c] ?? base[c];
        const bv = b.v[c] ?? base[c];
        dst[c] = av + (bv - av) * u;
      }
      return;
    }
  }
}

/* --------------------------------- stance -------------------------------- */

/** Neutral fighting stance: bladed torso, guard up, weight between the feet. */
export function baseStance(): Pose3 {
  return {
    pelvisY: 72,
    pelvisZ: 0,
    rootPitch: 0,
    rootYaw: 0,
    rootRoll: 0,
    pelvisPitch: 0.05,
    pelvisYaw: 0.26,
    pelvisRoll: 0,
    chestPitch: 0.02,
    chestYaw: 0.3,
    chestRoll: -0.05,
    headPitch: -0.03,
    headYaw: -0.22,
    headRoll: 0,
    armFShX: -0.08,
    armFShY: 0,
    armFShZ: 0.8,
    armFEl: 1.95,
    armFWr: 0,
    armBShX: 0.34,
    armBShY: 0,
    armBShZ: 0.48,
    armBEl: 2.2,
    armBWr: 0,
    legFHpX: 0.06,
    legFHpY: 0,
    legFHpZ: 0.22,
    legFKn: -0.32,
    legFAn: 0.2,
    legBHpX: -0.06,
    legBHpY: 0,
    legBHpZ: -0.34,
    legBKn: -0.44,
    legBAn: 0.26,
  };
}

function reset(p: Pose3, base: Pose3) {
  for (const c of CHANNELS) p[c] = base[c];
}

/* ---------------------------- non-attack states --------------------------- */

function idlePose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  const s = Math.sin(timeMs * 0.0021 + f.side * 2.4);
  const b = Math.sin(timeMs * 0.0042 + f.side * 1.7);
  p.pelvisY = base.pelvisY + b * 1.5;
  p.pelvisYaw = base.pelvisYaw + s * 0.06;
  p.pelvisRoll = base.pelvisRoll + s * 0.02;
  p.chestYaw = base.chestYaw - s * 0.07;
  p.chestPitch = base.chestPitch + b * 0.022;
  p.chestRoll = base.chestRoll + s * 0.03;
  p.headYaw = base.headYaw + s * 0.09;
  p.headPitch = base.headPitch - b * 0.014;
  p.headRoll = base.headRoll + s * 0.03;
  p.armFShZ = base.armFShZ + s * 0.09;
  p.armFShX = base.armFShX + s * 0.04;
  p.armFEl = base.armFEl - s * 0.11;
  p.armBShZ = base.armBShZ - s * 0.07;
  p.armBShX = base.armBShX - s * 0.04;
  p.armBEl = base.armBEl + s * 0.09;
  p.legFKn = base.legFKn + s * 0.05;
  p.legBKn = base.legBKn - s * 0.05;
  p.legFAn = base.legFAn - s * 0.03;
  p.legBAn = base.legBAn + s * 0.03;
}

function walkPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  const ph = f.walkPhase * Math.PI * 2;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  const swing = Math.max(0, -s); // passing leg
  const swingB = Math.max(0, s);
  p.legFHpZ = base.legFHpZ + s * 0.6;
  p.legBHpZ = base.legBHpZ - s * 0.6;
  p.legFKn = base.legFKn - swing * 0.95;
  p.legBKn = base.legBKn - swingB * 0.95;
  p.legFAn = base.legFAn + swing * 0.3;
  p.legBAn = base.legBAn + swingB * 0.3;
  p.legFHpX = base.legFHpX + s * 0.04;
  p.legBHpX = base.legBHpX + s * 0.04;
  p.pelvisY = base.pelvisY - Math.abs(c) * 2.4;
  p.pelvisYaw = base.pelvisYaw + s * 0.09;
  p.pelvisRoll = base.pelvisRoll + c * 0.05;
  p.chestYaw = base.chestYaw - s * 0.12;
  p.chestRoll = base.chestRoll + s * 0.05;
  p.chestPitch = base.chestPitch + Math.max(0, f.vx * f.facing) * 0.00012;
  p.headYaw = base.headYaw + s * 0.06;
  p.armFShZ = base.armFShZ - s * 0.2;
  p.armFEl = base.armFEl + s * 0.16;
  p.armBShZ = base.armBShZ + s * 0.2;
  p.armBEl = base.armBEl - s * 0.16;
  p.armBShX = base.armBShX + c * 0.06;
  // breathe under the step cycle so walking never looks mechanical
  p.pelvisY += Math.sin(timeMs * 0.008) * 0.7;
}

function crouchPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  p.pelvisY = base.pelvisY - 19;
  p.pelvisZ = 2;
  p.pelvisPitch = 0.24;
  p.chestPitch = 0.3;
  p.headPitch = -0.18;
  p.legFHpZ = 0.82;
  p.legFKn = -2.25;
  p.legFAn = 0.72;
  p.legBHpZ = 0.32;
  p.legBKn = -2.02;
  p.legBAn = 0.82;
  p.legFHpX = 0.28;
  p.legBHpX = -0.3;
  p.armFShZ = 0.72;
  p.armFEl = 2.1;
  p.armBShZ = 0.44;
  p.armBEl = 2.25;
  const s = Math.sin(timeMs * 0.004);
  p.chestYaw = base.chestYaw + s * 0.03;
  p.headYaw = base.headYaw + Math.sin(timeMs * 0.0055) * 0.05;
  if (f.blocking) p.armFShX = base.armFShX - 0.16;
}

function airPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  const rise = f.vy < -60 ? 1 : f.vy > 160 ? 0 : 0.5;
  const tuck = 0.35 + rise * 0.65;
  p.pelvisY = base.pelvisY + 1 + Math.sin(timeMs * 0.006) * 1.2;
  p.pelvisPitch = 0.12 + rise * 0.1;
  p.chestPitch = 0.14 + rise * 0.1;
  p.headPitch = -0.08;
  p.legFHpZ = base.legFHpZ + 0.75 * tuck;
  p.legFKn = base.legFKn - 1.15 * tuck;
  p.legFHpX = 0.12;
  p.legBHpZ = base.legBHpZ - 0.1 * (1 - tuck);
  p.legBKn = base.legBKn - 0.85 * tuck;
  p.legBHpX = -0.12;
  p.armFShZ = -0.2;
  p.armFShX = -0.42;
  p.armFEl = 1.4;
  p.armBShZ = -0.55;
  p.armBShX = 0.42;
  p.armBEl = 1.05;
  p.armFWr = 0.15;
}

function hurtPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  const flinch = 1 - Math.min(1, f.stateT / 8);
  p.pelvisY = base.pelvisY - 2;
  p.pelvisPitch = -0.16 * (0.5 + flinch);
  p.chestPitch = -0.36 * (0.5 + flinch);
  p.chestYaw = base.chestYaw - 0.5;
  p.chestRoll = 0.12 * flinch;
  p.headPitch = -0.44 * (0.5 + flinch);
  p.headYaw = base.headYaw - 0.3;
  p.headRoll = 0.16 * flinch;
  p.armFShZ = -0.5;
  p.armFShX = -0.5;
  p.armFEl = 1.0;
  p.armBShZ = -0.9;
  p.armBShX = 0.58;
  p.armBEl = 0.8;
  p.legFHpZ = 0.52;
  p.legFKn = -0.4;
  p.legFAn = 0.3;
  p.legBHpZ = -0.35;
  p.legBKn = -0.5;
  p.legBAn = 0.42;
  p.pelvisRoll = Math.sin(timeMs * 0.02) * 0.05 * flinch;
}

function blockPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  p.pelvisY = base.pelvisY - 5;
  p.pelvisPitch = 0.16;
  p.chestPitch = 0.18;
  p.headPitch = -0.06;
  p.chestYaw = base.chestYaw + 0.06;
  p.armFShZ = 1.02;
  p.armFShX = -0.3;
  p.armFEl = 2.4;
  p.armFWr = -0.2;
  p.armBShZ = 0.96;
  p.armBShX = 0.32;
  p.armBEl = 2.58;
  p.armBWr = 0.2;
  // brace: knees loaded so the guard does not sink the boots when hit
  p.legFHpZ = 0.36;
  p.legFKn = -0.85;
  p.legFAn = 0.44;
  p.legBHpZ = -0.28;
  p.legBKn = -0.75;
  p.legBAn = 0.5;
  // shake under a heavy block
  const jar = f.blockstun > 0 ? 1 : 0;
  p.pelvisY += Math.sin(timeMs * 0.03) * 0.6 * (0.4 + jar);
  p.chestPitch += jar * 0.06;
}

function downPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  // knocked flat on the back: the body rolls ~87 deg about the hip, so the
  // pelvis has to sit only a torso-radius above the floor or the limbs punch
  // through it (measured, not guessed)
  p.pelvisY = 18;
  p.pelvisZ = -3;
  p.rootRoll = 1.52;
  p.pelvisPitch = -0.05;
  p.chestPitch = 0.05;
  p.chestYaw = base.chestYaw - 0.18;
  p.headPitch = 0.1;
  p.headYaw = base.headYaw - 0.12;
  p.armFShZ = 0.05;
  p.armFShX = -0.55;
  p.armFEl = 0.3;
  p.armBShZ = 0.45;
  p.armBShX = 0.5;
  p.armBEl = 0.8;
  p.legFHpZ = -0.08;
  p.legFKn = -0.1;
  p.legBHpZ = -0.15;
  p.legBKn = 0.85;
  // settling bounce after the knockdown
  const settle = Math.max(0, 1 - f.downT / 14);
  p.rootRoll += Math.sin(timeMs * 0.012) * 0.02 * settle;
}

function winPose(p: Pose3, base: Pose3, f: Fighter, timeMs: number) {
  reset(p, base);
  const b = Math.sin(timeMs * 0.008) * 3;
  const s = Math.sin(timeMs * 0.004 + 0.7);
  p.pelvisY = base.pelvisY + b;
  p.pelvisYaw = 0.12;
  p.chestYaw = 0.14;
  p.chestPitch = -0.14;
  p.headPitch = 0.14;
  p.headYaw = 0.05;
  p.armFShZ = 2.55 + s * 0.1;
  p.armFShX = -0.5;
  p.armFEl = 0.5;
  p.armBShZ = 2.25 - s * 0.1;
  p.armBShX = 0.45;
  p.armBEl = 0.72;
  p.legFHpZ = 0.2;
  p.legFAn = -0.1;
  p.legBHpZ = -0.3;
  p.legBAn = 0.1;
  p.pelvisY += Math.sin(timeMs * 0.008) * 0.6;
}

/* ------------------------------- attack keys ------------------------------ */

const GUARD_F = { armFShZ: 0.8, armFEl: 1.95, armFShX: -0.08 };
const GUARD_B = { armBShZ: 0.48, armBEl: 2.2, armBShX: 0.34 };

/**
 * Shared deep-crouch leg set for the low gestures (sweeps, slams, launcher
 * loads). Tuned against the rig's measured silhouette — see
 * scripts/verify-animation.ts — so the boots stay on the floor while the
 * crown drops about a quarter of the fighter's height.
 */
const LOW_STANCE = {
  pelvisY: 60,
  pelvisPitch: 0.32,
  chestPitch: 0.36,
  headPitch: -0.28,
  legFHpZ: 1.05,
  legFKn: -2.0,
  legFAn: 0.6,
  legFHpX: 0.26,
  legBHpZ: 0.45,
  legBKn: -1.7,
  legBAn: 0.7,
  legBHpX: -0.28,
};

/** Lead-arm straight (jab / double-tap / rush-string opener). */
function jabKeys(wT: number, aT: number, power = 1, side: "F" | "B" = "F"): Keyframe[] {
  const ext = 0.95 + power * 0.55;
  const arm =
    side === "F"
      ? { armFShZ: ext, armFEl: 0.95 - power * 0.8, armFWr: 0, armFShX: 0.02 }
      : { armBShZ: ext, armBEl: 0.95 - power * 0.8, armBWr: 0, armBShX: 0.06 };
  const yaw = side === "F" ? -0.16 : -0.34;
  return [
    key(0, {}),
    key(wT * 0.9, { ...GUARD_F, ...GUARD_B, chestYaw: 0.42, pelvisYaw: 0.34, e: "out" }),
    key(wT + (aT - wT) * 0.4, {
      ...arm,
      chestYaw: yaw,
      pelvisYaw: yaw * 0.5,
      chestPitch: 0.05,
      pelvisZ: 4 * power,
      headYaw: -0.08,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.85, { ...arm, chestYaw: yaw, pelvisZ: 3 * power, e: "linear" }),
    key(1, { chestYaw: 0.34, pelvisYaw: 0.3, ...GUARD_F, ...GUARD_B, e: "out" }),
  ];
}

/** Rear-arm heavy straight: hips turn into it (cross / breaker). */
function crossKeys(wT: number, aT: number, power = 1): Keyframe[] {
  return [
    key(0, {}),
    key(wT * 0.92, {
      armBShZ: 0.3,
      armBEl: 2.45,
      armBShX: 0.6,
      chestYaw: 0.56,
      pelvisYaw: 0.46,
      chestRoll: -0.14,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.45, {
      armBShZ: 1.32 + power * 0.28,
      armBEl: 0.16,
      armBShX: 0.05,
      armBShY: -0.15,
      armFShZ: 0.6,
      armFEl: 2.2,
      chestYaw: -0.34,
      pelvisYaw: -0.2,
      chestRoll: 0.16,
      chestPitch: 0.06,
      pelvisZ: 6 * power,
      headYaw: 0.02,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.9, {
      armBShZ: 1.3 + power * 0.28,
      armBEl: 0.2,
      chestYaw: -0.3,
      pelvisZ: 4 * power,
      e: "linear",
    }),
    key(1, { chestYaw: 0.32, pelvisYaw: 0.28, e: "out" }),
  ];
}

/** Both palms thrust forward — energy release (Arc Shot / Spiral Cannon). */
function castKeys(wT: number, aT: number, power = 1): Keyframe[] {
  const push = 0.78 + power * 0.4;
  return [
    key(0, {}),
    key(wT * 0.95, {
      armFShZ: 0.42,
      armFEl: 2.5,
      armFShX: -0.35,
      armBShZ: 0.34,
      armBEl: 2.6,
      armBShX: 0.4,
      chestYaw: 0.66,
      pelvisYaw: 0.5,
      chestPitch: -0.14,
      headPitch: -0.2,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.4, {
      armFShZ: push,
      armFEl: 0.18,
      armFShX: -0.12,
      armFWr: -0.3,
      armBShZ: push - 0.08,
      armBEl: 0.22,
      armBShX: 0.14,
      armBWr: 0.3,
      chestYaw: 0.06,
      pelvisYaw: 0.06,
      chestPitch: 0.12,
      pelvisZ: 7 * power,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.9, {
      armFShZ: push - 0.05,
      armFEl: 0.24,
      armBShZ: push - 0.12,
      armBEl: 0.3,
      chestYaw: 0.1,
      pelvisZ: 5 * power,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/**
 * Alternating strikes across the active window — one clean hit per frame slice,
 * which is what makes Double Tap / Rush String / Grand Combo / Ultimate read as
 * a *combo* rather than a single pose held.
 */
function alternateKeys(
  wT: number,
  aT: number,
  hits: number,
  opts: { power?: number; hook?: boolean } = {},
): Keyframe[] {
  const power = opts.power ?? 1;
  const keys: Keyframe[] = [key(0, {})];
  keys.push(
    key(wT * 0.92, {
      ...GUARD_F,
      ...GUARD_B,
      chestYaw: 0.44,
      pelvisYaw: 0.34,
      e: "out",
    }),
  );
  const span = Math.max(0.001, aT - wT);
  for (let i = 0; i < hits; i++) {
    const t0 = wT + span * (i / hits);
    const t1 = wT + span * ((i + 1) / hits);
    const mid = t0 + (t1 - t0) * 0.42;
    const near = i % 2 === 0;
    const last = i === hits - 1;
    const heavy = opts.hook && last;
    const arm = near
      ? {
          armFShZ: 1.42 + power * 0.4,
          armFEl: heavy ? 0.4 : 0.1,
          armFShX: heavy ? -0.55 : 0.04,
          armFWr: 0,
        }
      : {
          armBShZ: 1.3 + power * 0.44,
          armBEl: heavy ? 0.42 : 0.14,
          armBShX: heavy ? 0.62 : 0.05,
          armBShY: -0.12,
          armBWr: 0,
        };
    keys.push(
      key(t0, {
        ...GUARD_F,
        ...GUARD_B,
        chestYaw: near ? 0.46 : 0.36,
        pelvisYaw: near ? 0.36 : 0.3,
        e: "out",
      }),
      key(mid, {
        ...arm,
        chestYaw: near ? -0.2 : -0.38,
        pelvisYaw: near ? -0.1 : -0.22,
        chestRoll: near ? 0.1 : -0.14,
        pelvisZ: (near ? 3 : 5) * power,
        chestPitch: 0.05,
        headYaw: near ? -0.06 : 0.02,
        e: "in",
      }),
      key(t1, {
        ...arm,
        chestYaw: near ? -0.16 : -0.32,
        pelvisZ: (near ? 2 : 3) * power,
        e: "linear",
      }),
    );
  }
  keys.push(key(1, { chestYaw: 0.32, pelvisYaw: 0.28, e: "out" }));
  return keys;
}

/** Low sweeping leg — crouch, leg scythes across the floor. */
function sweepKeys(wT: number, aT: number, reach = 1): Keyframe[] {
  const low = {
    ...LOW_STANCE,
    pelvisY: 58,
    pelvisPitch: 0.22,
    chestPitch: 0.3,
    headPitch: -0.2,
  };
  return [
    key(0, {}),
    key(wT * 0.95, {
      ...low,
      legFHpZ: 0.5,
      legFKn: -1.75,
      legBHpX: 0.4,
      chestYaw: 0.5,
      armFShZ: 1.0,
      armFEl: 1.7,
      armBShZ: -0.3,
      armBEl: 1.2,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.45, {
      ...low,
      legFHpZ: 0.45 + 1.05 * reach,
      legFKn: -0.28,
      legFAn: -0.15,
      legFHpX: -0.3,
      legBHpZ: 0.2,
      legBKn: -1.5,
      legBHpX: -0.35,
      chestYaw: -0.34,
      chestRoll: 0.22,
      pelvisY: 58,
      armFShZ: 0.4,
      armFEl: 1.9,
      armFShX: -0.6,
      armBShZ: -0.75,
      armBEl: 1.0,
      pelvisZ: 5,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.9, {
      ...low,
      legFHpZ: 0.4 + 1.0 * reach,
      legFKn: -0.35,
      legFHpX: -0.28,
      chestYaw: -0.3,
      pelvisY: 58,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/** Rising strike — deep load then explode upward (launcher). */
function launcherKeys(wT: number, aT: number, power = 1): Keyframe[] {
  const load = {
    ...LOW_STANCE,
    pelvisY: 58,
    pelvisPitch: 0.24,
    chestPitch: 0.3,
    headPitch: -0.24,
    armFShZ: 0.2,
    armFEl: 2.4,
    armFShX: -0.3,
  };
  const up = {
    pelvisY: 78 + power * 4,
    pelvisPitch: -0.14,
    chestPitch: -0.22,
    headPitch: 0.36,
    legFHpZ: 0.34,
    legFKn: -0.18,
    legFAn: -0.15,
    legBHpZ: -0.3,
    legBKn: -0.36,
    armFShZ: 1.75 + power * 0.3,
    armFEl: 0.1,
    armFShX: -0.24,
    armFWr: -0.3,
  };
  return [
    key(0, {}),
    key(wT * 0.96, { ...load, chestYaw: 0.5, pelvisYaw: 0.4, e: "out" }),
    key(wT + (aT - wT) * 0.4, {
      ...up,
      chestYaw: -0.16,
      pelvisYaw: -0.05,
      pelvisZ: 6 * power,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.85, {
      ...up,
      chestYaw: -0.12,
      pelvisZ: 5 * power,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/** Body spins, leg extends — Storm Kick / Hurricane Spin. */
function spinKeys(wT: number, aT: number, turns: number, low: boolean): Keyframe[] {
  const base = low
    ? {
        ...LOW_STANCE,
        pelvisY: 62,
        pelvisPitch: 0.2,
        chestPitch: 0.24,
        legFKn: -1.3,
        legBKn: -1.3,
      }
    : { pelvisY: 70, chestPitch: 0.14 };
  const strike = low
    ? {
        ...base,
        legFHpZ: 0.5,
        legFKn: -0.35,
        legFHpX: -0.42,
        legBHpZ: 0.25,
        legBKn: -1.1,
        legBHpX: -0.65,
        armFShZ: 0.2,
        armFEl: 1.5,
        armFShX: -0.8,
        armBShZ: -0.4,
        armBEl: 0.9,
        armBShX: 0.8,
        chestPitch: 0.3,
      }
    : {
        ...base,
        legFHpZ: 1.25,
        legFKn: -0.16,
        legFHpX: -0.45,
        legBHpZ: 0.3,
        legBKn: -1.4,
        legBHpX: -0.15,
        armFShZ: -0.4,
        armFEl: 0.7,
        armFShX: -0.9,
        armBShZ: 0.5,
        armBEl: 0.8,
        armBShX: 0.9,
      };
  return [
    key(0, {}),
    key(wT * 0.9, {
      ...base,
      rootYaw: -turns * 0.22,
      // the low spin keeps the deep crouch knees so the support foot stays down
      ...(low ? { legFKn: -1.9, legBKn: -1.7 } : { legFKn: -1.0, legBKn: -1.0 }),
      armFShZ: 0.3,
      armFEl: 1.4,
      armFShX: -0.7,
      armBShZ: 0.2,
      armBEl: 1.3,
      armBShX: 0.7,
      chestYaw: 0.7,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.35, { ...strike, rootYaw: turns * 0.5, e: "in" }),
    key(wT + (aT - wT) * 0.7, { ...strike, rootYaw: turns * 0.85, e: "linear" }),
    key(aT, { ...strike, rootYaw: turns, e: "linear" }),
    key(1, { rootYaw: turns, e: "out" }),
  ];
}

/** Both fists drive down into the floor — Flame Wave. */
function waveKeys(wT: number, aT: number): Keyframe[] {
  // every key after the windup spreads this so the crouch legs stay planted
  const low = {
    ...LOW_STANCE,
    pelvisPitch: 0.36,
    chestPitch: 0.62,
    headPitch: -0.34,
  };
  return [
    key(0, {}),
    key(wT * 0.95, {
      armFShZ: 0.5,
      armFEl: 2.1,
      armFShX: -0.55,
      armBShZ: 0.42,
      armBEl: 2.25,
      armBShX: 0.6,
      chestPitch: -0.24,
      headPitch: 0.2,
      pelvisY: 70,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.42, {
      ...low,
      armFShZ: -0.35,
      armFEl: 0.18,
      armFShX: -0.2,
      armFWr: 0.2,
      armBShZ: -0.42,
      armBEl: 0.2,
      armBShX: 0.24,
      armBWr: -0.2,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.9, {
      ...low,
      pelvisY: 62,
      armFShZ: -0.3,
      armFEl: 0.24,
      armBShZ: -0.38,
      armBEl: 0.26,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/** Lunging straight with a driving shoulder — Blitz Dash. */
function dashKeys(wT: number, aT: number): Keyframe[] {
  return [
    key(0, {}),
    key(wT * 0.85, {
      chestPitch: 0.34,
      pelvisPitch: 0.26,
      armBShZ: -0.3,
      armBEl: 1.2,
      armFShZ: 0.3,
      armFEl: 1.4,
      legBHpZ: -0.85,
      legBKn: -0.9,
      legFHpZ: 0.7,
      legFKn: -0.9,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.4, {
      chestPitch: 0.5,
      pelvisPitch: 0.34,
      pelvisZ: 8,
      armFShZ: 1.5,
      armFEl: 0.12,
      armFShX: -0.05,
      armBShZ: -1.0,
      armBEl: 0.7,
      armBShX: 0.5,
      legBHpZ: -0.95,
      legBKn: -0.25,
      legFKn: -1.15,
      headPitch: -0.2,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.9, {
      chestPitch: 0.42,
      armFShZ: 1.4,
      armFEl: 0.2,
      pelvisZ: 6,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/** Aerial dive — arm spears downward, body tucks. */
function diveKeys(wT: number, aT: number): Keyframe[] {
  const air = {
    pelvisY: 72,
    pelvisPitch: 0.35,
    chestPitch: 0.4,
    headPitch: -0.34,
    legFHpZ: 0.9,
    legFKn: -1.2,
    legFHpX: 0.14,
    legBHpZ: -0.3,
    legBKn: -1.0,
    legBHpX: -0.14,
  };
  return [
    key(0, {}),
    key(wT * 0.9, {
      ...air,
      armFShZ: -1.5,
      armFEl: 0.9,
      armFShX: -0.4,
      armBShZ: -1.8,
      armBEl: 0.7,
      armBShX: 0.5,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.35, {
      ...air,
      armFShZ: -0.5,
      armFEl: 0.08,
      armFShX: -0.1,
      armFWr: -0.2,
      armBShZ: -2.1,
      armBEl: 0.4,
      armBShX: 0.6,
      legFHpZ: 1.25,
      legFKn: -0.6,
      legBHpZ: -0.15,
      legBKn: -0.7,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.85, {
      ...air,
      armFShZ: -0.45,
      armFEl: 0.14,
      armBShZ: -2.0,
      legFHpZ: 1.2,
      legFKn: -0.65,
      e: "linear",
    }),
    key(1, { e: "out" }),
  ];
}

/** Aerial kick — knee then heel. */
function airKickKeys(wT: number, aT: number): Keyframe[] {
  const air = {
    pelvisY: 72,
    pelvisPitch: 0.22,
    chestPitch: 0.26,
    headPitch: -0.2,
  };
  return [
    key(0, {}),
    key(wT * 0.9, {
      ...air,
      legFHpZ: 1.35,
      legFKn: -1.6,
      legFHpX: 0.1,
      legBHpZ: -0.25,
      legBKn: -0.9,
      armFShZ: -0.5,
      armFEl: 1.1,
      armFShX: -0.5,
      armBShZ: -0.8,
      armBEl: 0.9,
      armBShX: 0.5,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.4, {
      ...air,
      legFHpZ: 0.62,
      legFKn: -0.1,
      legFAn: -0.2,
      legFHpX: -0.12,
      legBHpZ: -0.55,
      legBKn: -1.25,
      armFShZ: -0.9,
      armFEl: 0.6,
      armFShX: -0.7,
      armBShZ: -1.1,
      armBEl: 0.5,
      armBShX: 0.7,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.85, {
      ...air,
      legFHpZ: 0.66,
      legFKn: -0.16,
      armFShZ: -0.85,
      armBShZ: -1.05,
      e: "linear",
    }),
    key(1, { e: "out" }),
  ];
}

/** Three-beat string: jab → cross → launcher (Grand Combo). */
function grandKeys(wT: number, aT: number): Keyframe[] {
  const keys = alternateKeys(wT, aT, 2, { power: 0.8 });
  // replace the tail with a rising finisher instead of a guard return
  keys.pop();
  keys.push(
    key(wT + (aT - wT) * 0.78, {
      ...LOW_STANCE,
      pelvisY: 58,
      armFShZ: 0.2,
      armFEl: 2.35,
      armFShX: -0.3,
      armBShZ: 0.3,
      armBEl: 2.3,
      armBShX: 0.35,
      chestYaw: 0.5,
      pelvisYaw: 0.4,
      e: "out",
    }),
    key(aT, {
      pelvisY: 82,
      pelvisPitch: -0.16,
      chestPitch: -0.24,
      headPitch: 0.36,
      legFHpZ: 0.3,
      legFKn: -0.16,
      legFAn: -0.2,
      legBHpZ: -0.3,
      legBKn: -0.4,
      armBShZ: 1.85,
      armBEl: 0.08,
      armBShX: 0.16,
      armBShY: -0.2,
      armFWr: -0.3,
      chestYaw: -0.2,
      pelvisYaw: -0.06,
      pelvisZ: 6,
      e: "in",
    }),
    key(1, { e: "out" }),
  );
  return keys;
}

/** Five-hit flurry capped by a spinning finisher (Ultimate Surge). */
function ultimateKeys(wT: number, aT: number): Keyframe[] {
  const keys = alternateKeys(wT, aT * 0.78, 4, { power: 1.05 });
  keys.pop();
  const fin = aT * 0.78;
  keys.push(
    key(fin, {
      ...GUARD_F,
      ...GUARD_B,
      chestYaw: 0.6,
      pelvisYaw: 0.5,
      rootYaw: -0.3,
      e: "out",
    }),
    key(fin + (aT - fin) * 0.45, {
      rootYaw: Math.PI * 1.15,
      pelvisY: 82,
      chestPitch: -0.2,
      headPitch: 0.3,
      pelvisPitch: -0.12,
      armFShZ: 1.9,
      armFEl: 0.05,
      armFShX: -0.2,
      armBShZ: 1.7,
      armBEl: 0.1,
      armBShX: 0.24,
      legFHpZ: 0.6,
      legFKn: -0.3,
      legBHpZ: -0.4,
      legBKn: -0.5,
      pelvisZ: 8,
      e: "in",
    }),
    key(aT, {
      rootYaw: Math.PI * 2,
      pelvisY: 70,
      chestYaw: -0.1,
      armFShZ: 0.9,
      armFEl: 1.2,
      armBShZ: 0.7,
      armBEl: 1.3,
      e: "linear",
    }),
    key(1, { rootYaw: Math.PI * 2, e: "out" }),
  );
  return keys;
}

/** Crouch-heavy: wind low, then drive a short diagonal punch up. */
function crouchStrikeKeys(wT: number, aT: number, power = 1): Keyframe[] {
  const low = {
    ...LOW_STANCE,
    pelvisY: 58,
    pelvisPitch: 0.24,
    chestPitch: 0.3,
    headPitch: -0.22,
  };
  return [
    key(0, {}),
    key(wT * 0.95, {
      ...low,
      armFShZ: 0.35,
      armFEl: 2.45,
      armFShX: -0.4,
      armBShZ: 0.2,
      armBEl: 2.4,
      armBShX: 0.45,
      chestYaw: 0.56,
      pelvisYaw: 0.46,
      e: "out",
    }),
    key(wT + (aT - wT) * 0.4, {
      ...low,
      pelvisY: 56 + power * 4,
      armFShZ: 1.62,
      armFEl: 0.16,
      armFShX: -0.3,
      armFWr: -0.25,
      armBShZ: 0.4,
      armBEl: 2.1,
      chestYaw: -0.24,
      pelvisYaw: -0.12,
      chestPitch: 0.12,
      pelvisZ: 6 * power,
      e: "in",
    }),
    key(wT + (aT - wT) * 0.88, {
      ...low,
      pelvisY: 54 + power * 4,
      armFShZ: 1.55,
      armFEl: 0.24,
      chestYaw: -0.2,
      pelvisZ: 4 * power,
      e: "linear",
    }),
    key(1, { chestYaw: 0.3, pelvisYaw: 0.26, e: "out" }),
  ];
}

/** Which hand-authored track a move id plays. */
function gestureKeys(f: Fighter, wT: number, aT: number): Keyframe[] {
  const mv = f.move!;
  const hits = Math.max(1, mv.hitCount);
  switch (mv.id) {
    case 0: // Jab Snap
      return jabKeys(wT, aT, 0.85, "F");
    case 1: // Cross Spike
      return crossKeys(wT, aT, 1.05);
    case 2: // Arc Shot
      return castKeys(wT, aT, 0.9);
    case 3: // Double Tap
      return alternateKeys(wT, aT, hits, { power: 0.75 });
    case 4: // Rush String
      return alternateKeys(wT, aT, hits, { power: 0.9, hook: true });
    case 5: // Breaker
      return alternateKeys(wT, aT, hits, { power: 1.2, hook: true });
    case 6: // Low Sweep
      return sweepKeys(wT, aT, 0.75);
    case 7: // Crouch Crush
      return crouchStrikeKeys(wT, aT, 1.0);
    case 8: // Rising Fang
      return launcherKeys(wT, aT, 1.15);
    case 9: // Spiral Cannon
      return castKeys(wT, aT, 1.25);
    case 10: // Storm Kick
      return spinKeys(wT, aT, Math.PI * 1.1, false);
    case 11: // Flame Wave
      return waveKeys(wT, aT);
    case 12: // Counter Sweep
      return sweepKeys(wT, aT, 1.15);
    case 13: // Sky Rip
      return launcherKeys(wT, aT, 0.95);
    case 14: // Blitz Dash
      return dashKeys(wT, aT);
    case 15: // Hurricane Spin
      return spinKeys(wT, aT, Math.PI * 2, true);
    case 16: // Air Blade
      return diveKeys(wT, aT);
    case 17: // Air Raid
      return airKickKeys(wT, aT);
    case 18: // Grand Combo
      return grandKeys(wT, aT);
    case 19: // Ultimate Surge
      return ultimateKeys(wT, aT);
  }
  if (mv.type === "projectile") return castKeys(wT, aT, 1);
  if (mv.type === "launcher") return launcherKeys(wT, aT, 1);
  if (mv.type === "aerial") return airKickKeys(wT, aT);
  if (mv.type === "dash") return dashKeys(wT, aT);
  if (mv.type === "ulti") return ultimateKeys(wT, aT);
  return hits > 1 ? alternateKeys(wT, aT, hits, { power: 0.9 }) : jabKeys(wT, aT, 1);
}

/* ------------------------------- entry point ------------------------------ */

/**
 * Full pose for one fighter this frame. Always writes into `out` when given so
 * the renderer avoids per-frame allocation.
 */
export function rigPoseFor(f: Fighter, timeMs: number, out?: Pose3): Pose3 {
  const p = out ?? baseStance();
  const base = baseStance();

  switch (f.state) {
    case "walk":
      walkPose(p, base, f, timeMs);
      return p;
    case "crouch":
      crouchPose(p, base, f, timeMs);
      return p;
    case "air":
      airPose(p, base, f, timeMs);
      return p;
    case "hurt":
      hurtPose(p, base, f, timeMs);
      return p;
    case "block":
      if (f.blockstun > 0) blockPose(p, base, f, timeMs);
      else crouchPose(p, base, f, timeMs);
      return p;
    case "down":
    case "ko": {
      if (f.airborne || f.y < -8) {
        // launched: flail in the air, then land into the lying pose
        airPose(p, base, f, timeMs);
        p.rootRoll = 0.85;
        p.chestPitch = -0.3;
        p.headPitch = -0.35;
        p.armFShZ = -1.9;
        p.armFShX = -0.55;
        p.armFEl = 0.4;
        p.armBShZ = -2.05;
        p.armBShX = 0.6;
        p.armBEl = 0.3;
        p.legFHpZ = 0.85;
        p.legFKn = -0.5;
        p.legBHpZ = -0.15;
        p.legBKn = -1.15;
        return p;
      }
      downPose(p, base, f, timeMs);
      return p;
    }
    case "win":
      winPose(p, base, f, timeMs);
      return p;
    case "attack": {
      const mv = f.move;
      if (!mv) {
        idlePose(p, base, f, timeMs);
        return p;
      }
      const total = Math.max(1, mv.windup + mv.active + mv.recover);
      const t = Math.max(0, Math.min(1, f.moveFrame / total));
      const wT = mv.windup / total;
      const aT = (mv.windup + mv.active) / total;
      // aerial moves fall back to the air pose, ground moves to the stance
      const stance = baseStance();
      if (f.airborne) airPose(stance, base, f, timeMs);
      applyKeys(p, stance, gestureKeys(f, wT, aT), t);
      return p;
    }
    default:
      idlePose(p, base, f, timeMs);
      return p;
  }
}
