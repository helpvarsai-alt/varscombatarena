/**
 * The universal combo list — all 20 are shared by every character.
 *
 * Inputs are token sequences produced by the control layer:
 *   buttons:  L H S  (qualified by direction: dL, fH, bS, or aL/aH/aS in air)
 *   motions:  qcf (down -> forward), qcb (down -> back),
 *             ff (double tap forward), dd (double tap down)
 * Everything is deliberately thumb-friendly: no half-circles, no 360s.
 * Longest match wins, so ["qcf","fS"] beats a plain ["S"] fallback.
 */

export type MoveType =
  | "melee"
  | "projectile"
  | "launcher"
  | "dash"
  | "aerial"
  | "ulti";

/**
 * Frames between two hits of the same multi-hit move.
 *
 * The animation layer plans its beats from this exact rule, so a strike is
 * never choreographed onto a frame the hitbox cannot reach.
 */
export function rehitGap(mv: MoveData): number {
  return Math.max(9, Math.floor(mv.active / Math.max(1, mv.hitCount)) + 4);
}

/** Frames between two hits from the same projectile. */
export const PROJECTILE_REHIT = 14;

export interface MoveData {
  id: number;
  name: string;
  tokens: string[];
  /** ms window to input the whole sequence */
  window: number;
  dmg: number;
  /** extra hits (multi-hit strings) */
  hitCount: number;
  /** frames before / during / after the strike */
  windup: number;
  active: number;
  recover: number;
  /** world units */
  reach: number;
  hbY: number;
  hbH: number;
  kb: number;
  kbY: number;
  hitstun: number;
  type: MoveType;
  /** knock the opponent down after the last hit */
  knockdown?: boolean;
  /** jump-only move */
  air?: boolean;
  /** ground-only move */
  ground?: boolean;
  /** projectile speed (units/s) */
  projSpeed?: number;
  projSize?: number;
  /** cooldown ms for projectile moves */
  cd?: number;
  /** dash velocity during active frames */
  dash?: number;
  /** meter cost to fire (ultimate) */
  meterCost?: number;
  meterGain?: number;
  /** hit-stop frames added on connect */
  hitstop?: number;
  /** cancels vertical velocity (air dive) */
  dive?: boolean;
  /** brief slow-motion flash */
  ultimate?: boolean;
  /** one-line hint shown in the move list */
  hint: string;
}

export const MOVES: MoveData[] = [
  {
    id: 0,
    name: "Jab Snap",
    tokens: ["L"],
    window: 400,
    dmg: 5,
    hitCount: 1,
    windup: 4,
    active: 3,
    recover: 9,
    reach: 58,
    hbY: 74,
    hbH: 30,
    kb: 90,
    kbY: 0,
    hitstun: 13,
    type: "melee",
    meterGain: 3,
    hitstop: 3,
    hint: "Light attack",
  },
  {
    id: 1,
    name: "Cross Spike",
    tokens: ["H"],
    window: 400,
    dmg: 10,
    hitCount: 1,
    windup: 7,
    active: 4,
    recover: 15,
    reach: 66,
    hbY: 76,
    hbH: 34,
    kb: 210,
    kbY: 0,
    hitstun: 17,
    type: "melee",
    meterGain: 5,
    hitstop: 5,
    hint: "Heavy attack",
  },
  {
    id: 2,
    name: "Arc Shot",
    tokens: ["S"],
    window: 400,
    dmg: 7,
    hitCount: 1,
    windup: 9,
    active: 2,
    recover: 17,
    reach: 40,
    hbY: 84,
    hbH: 26,
    kb: 130,
    kbY: 0,
    hitstun: 15,
    type: "projectile",
    ground: true,
    projSpeed: 540,
    projSize: 20,
    cd: 700,
    meterGain: 4,
    hitstop: 4,
    hint: "Energy bolt",
  },
  {
    id: 3,
    name: "Double Tap",
    tokens: ["L", "L"],
    window: 700,
    dmg: 4,
    hitCount: 2,
    windup: 4,
    active: 9,
    recover: 11,
    reach: 58,
    hbY: 74,
    hbH: 30,
    kb: 130,
    kbY: 0,
    hitstun: 11,
    type: "melee",
    ground: true,
    meterGain: 5,
    hitstop: 3,
    hint: "Two quick jabs",
  },
  {
    id: 4,
    name: "Rush String",
    tokens: ["L", "L", "H"],
    window: 950,
    dmg: 4,
    hitCount: 3,
    windup: 4,
    active: 14,
    recover: 17,
    reach: 62,
    hbY: 74,
    hbH: 34,
    kb: 280,
    kbY: 0,
    hitstun: 13,
    type: "melee",
    ground: true,
    meterGain: 9,
    hitstop: 4,
    hint: "Jab jab finisher",
  },
  {
    id: 5,
    name: "Breaker",
    tokens: ["H", "H"],
    window: 800,
    dmg: 9,
    hitCount: 2,
    windup: 7,
    active: 10,
    recover: 19,
    reach: 68,
    hbY: 72,
    hbH: 38,
    kb: 320,
    kbY: 0,
    hitstun: 16,
    type: "melee",
    ground: true,
    knockdown: true,
    meterGain: 8,
    hitstop: 6,
    hint: "Heavy double",
  },
  {
    id: 6,
    name: "Low Sweep",
    tokens: ["dL"],
    window: 450,
    dmg: 7,
    hitCount: 1,
    windup: 5,
    active: 4,
    recover: 13,
    reach: 74,
    hbY: 8,
    hbH: 30,
    kb: 150,
    kbY: 0,
    hitstun: 15,
    type: "melee",
    ground: true,
    knockdown: true,
    meterGain: 4,
    hitstop: 5,
    hint: "Crouch + Light — knocks down",
  },
  {
    id: 7,
    name: "Crouch Crush",
    tokens: ["dH"],
    window: 450,
    dmg: 11,
    hitCount: 1,
    windup: 9,
    active: 4,
    recover: 16,
    reach: 70,
    hbY: 26,
    hbH: 40,
    kb: 250,
    kbY: 0,
    hitstun: 18,
    type: "melee",
    ground: true,
    meterGain: 6,
    hitstop: 6,
    hint: "Crouch + Heavy",
  },
  {
    id: 8,
    name: "Rising Fang",
    tokens: ["dS"],
    window: 500,
    dmg: 12,
    hitCount: 1,
    windup: 5,
    active: 6,
    recover: 24,
    reach: 60,
    hbY: 90,
    hbH: 80,
    kb: 70,
    kbY: 560,
    hitstun: 26,
    type: "launcher",
    ground: true,
    meterGain: 7,
    hitstop: 7,
    hint: "Crouch + Special — rising launcher",
  },
  {
    id: 9,
    name: "Spiral Cannon",
    tokens: ["qcf", "fS"],
    window: 700,
    dmg: 5,
    hitCount: 3,
    windup: 10,
    active: 2,
    recover: 23,
    reach: 46,
    hbY: 78,
    hbH: 34,
    kb: 170,
    kbY: 0,
    hitstun: 12,
    type: "projectile",
    ground: true,
    projSpeed: 470,
    projSize: 34,
    cd: 950,
    meterGain: 9,
    hitstop: 5,
    hint: "Down, Forward + S — piercing spiral",
  },
  {
    id: 10,
    name: "Storm Kick",
    tokens: ["qcb", "bS"],
    window: 700,
    dmg: 13,
    hitCount: 1,
    windup: 6,
    active: 10,
    recover: 17,
    reach: 72,
    hbY: 50,
    hbH: 44,
    kb: 350,
    kbY: 0,
    hitstun: 20,
    type: "dash",
    ground: true,
    dash: 760,
    meterGain: 7,
    hitstop: 7,
    hint: "Down, Back + S — rushing spin",
  },
  {
    id: 11,
    name: "Flame Wave",
    tokens: ["qcf", "fH"],
    window: 700,
    dmg: 12,
    hitCount: 1,
    windup: 11,
    active: 2,
    recover: 21,
    reach: 46,
    hbY: 44,
    hbH: 50,
    kb: 300,
    kbY: 120,
    hitstun: 22,
    type: "projectile",
    ground: true,
    projSpeed: 420,
    projSize: 46,
    cd: 1100,
    meterGain: 8,
    hitstop: 7,
    hint: "Down, Forward + H — ground wave",
  },
  {
    id: 12,
    name: "Counter Sweep",
    tokens: ["qcb", "bH"],
    window: 700,
    dmg: 13,
    hitCount: 1,
    windup: 9,
    active: 5,
    recover: 18,
    reach: 84,
    hbY: 40,
    hbH: 56,
    kb: 380,
    kbY: 0,
    hitstun: 20,
    type: "melee",
    ground: true,
    meterGain: 7,
    hitstop: 7,
    hint: "Down, Back + H — long sweep",
  },
  {
    id: 13,
    name: "Sky Rip",
    tokens: ["bH"],
    window: 450,
    dmg: 9,
    hitCount: 1,
    windup: 8,
    active: 5,
    recover: 18,
    reach: 62,
    hbY: 84,
    hbH: 76,
    kb: 40,
    kbY: 660,
    hitstun: 28,
    type: "launcher",
    ground: true,
    meterGain: 6,
    hitstop: 7,
    hint: "Back + Heavy — launches for juggles",
  },
  {
    id: 14,
    name: "Blitz Dash",
    tokens: ["ff", "fH"],
    window: 650,
    dmg: 15,
    hitCount: 1,
    windup: 7,
    active: 8,
    recover: 19,
    reach: 76,
    hbY: 66,
    hbH: 44,
    kb: 400,
    kbY: 60,
    hitstun: 22,
    type: "dash",
    ground: true,
    dash: 900,
    meterGain: 8,
    hitstop: 8,
    hint: "Double-tap forward + H",
  },
  {
    id: 15,
    name: "Hurricane Spin",
    tokens: ["dd", "dH"],
    window: 650,
    dmg: 6,
    hitCount: 2,
    windup: 8,
    active: 9,
    recover: 19,
    reach: 88,
    hbY: 20,
    hbH: 70,
    kb: 300,
    kbY: 90,
    hitstun: 15,
    type: "melee",
    ground: true,
    knockdown: true,
    meterGain: 8,
    hitstop: 6,
    hint: "Double-tap down + H — spinning quake",
  },
  {
    id: 16,
    name: "Air Blade",
    tokens: ["aS"],
    window: 500,
    dmg: 10,
    hitCount: 1,
    windup: 5,
    active: 5,
    recover: 12,
    reach: 66,
    hbY: 30,
    hbH: 50,
    kb: 240,
    kbY: 0,
    hitstun: 18,
    type: "aerial",
    air: true,
    dive: true,
    meterGain: 5,
    hitstop: 5,
    hint: "Air + Special — diving blade",
  },
  {
    id: 17,
    name: "Air Raid",
    tokens: ["aH"],
    window: 500,
    dmg: 12,
    hitCount: 1,
    windup: 6,
    active: 5,
    recover: 14,
    reach: 70,
    hbY: 24,
    hbH: 54,
    kb: 260,
    kbY: 0,
    hitstun: 20,
    type: "aerial",
    air: true,
    meterGain: 5,
    hitstop: 6,
    hint: "Air + Heavy",
  },
  {
    id: 18,
    name: "Grand Combo",
    tokens: ["L", "H", "S"],
    window: 1100,
    dmg: 5,
    hitCount: 3,
    windup: 5,
    active: 15,
    recover: 21,
    reach: 72,
    hbY: 62,
    hbH: 54,
    kb: 430,
    kbY: 280,
    hitstun: 16,
    type: "launcher",
    ground: true,
    meterGain: 12,
    hitstop: 6,
    hint: "L → H → S — launcher string",
  },
  {
    id: 19,
    name: "Ultimate Surge",
    tokens: ["L", "L", "H", "S"],
    window: 1400,
    dmg: 8,
    hitCount: 5,
    windup: 10,
    active: 22,
    recover: 30,
    reach: 86,
    hbY: 50,
    hbH: 90,
    kb: 520,
    kbY: 320,
    hitstun: 18,
    type: "ulti",
    ground: true,
    meterCost: 100,
    knockdown: true,
    ultimate: true,
    hitstop: 9,
    hint: "L L H S with FULL meter — max damage",
  },
];

export const MOVE_BY_ID = new Map(MOVES.map((m) => [m.id, m]));

/** Fallback when a lone button press doesn't match any combo string. */
const FALLBACK: Record<string, number> = {
  L: 0,
  H: 1,
  S: 2,
  dL: 6,
  dH: 7,
  dS: 8,
  aL: 0,
};

/** How long we hold a partial sequence waiting for the next input. */
const EXTEND_MS = 280;
const MAX_BUF_AGE = 1500;

type MatchResult =
  | { kind: "move"; id: number }
  | { kind: "pending" }
  | { kind: "none" };

function suffixMatches(buf: { tok: string; t: number; ghost?: boolean }[], seq: string[]) {
  if (seq.length > buf.length) return false;
  const start = buf.length - seq.length;
  for (let i = 0; i < seq.length; i++) {
    if (buf[start + i].tok !== seq[i]) return false;
  }
  return true;
}

function prefixHeld(buf: { tok: string; t: number; ghost?: boolean }[], now: number) {
  const last = buf[buf.length - 1];
  if (last.ghost || now - last.t >= EXTEND_MS) return false;
  for (const move of MOVES) {
    const maxK = Math.min(buf.length, move.tokens.length - 1);
    for (let k = 1; k <= maxK; k++) {
      const start = buf.length - k;
      let ok = true;
      for (let i = 0; i < k; i++) {
        if (buf[start + i].tok !== move.tokens[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return true;
    }
  }
  return false;
}

function fallbackFor(tok: string): number | null {
  if (FALLBACK[tok] !== undefined) return FALLBACK[tok];
  // qualified direction + button with no dedicated combo -> basic button move
  if (tok.length === 2 && "dfb".includes(tok[0]) && FALLBACK[tok[1]] !== undefined) {
    return FALLBACK[tok[1]];
  }
  return null;
}

/**
 * Match the newest tokens against the combo list.
 *
 * A token that has already fired a move becomes a *ghost*: it stays in the
 * buffer as context so the same presses can extend into longer strings (L ->
 * jab, L L -> Double Tap, L L H -> Rush String) but it can never re-trigger a
 * move by itself. Only a fresh press can fire, longest exact suffix wins, and
 * a partial sequence waits up to EXTEND_MS for the next button before falling
 * back, so nothing ever feels dead.
 */
export function matchCombo(
  buf: { tok: string; t: number; ghost?: boolean }[],
  now: number,
): MatchResult {
  // age out stale inputs
  while (buf.length && now - buf[0].t > MAX_BUF_AGE) buf.shift();
  if (buf.length === 0) return { kind: "none" };

  const last = buf[buf.length - 1];
  if (last.ghost) return { kind: "none" }; // already fired; wait for a fresh press

  // 1) longest exact suffix wins
  let best: MoveData | null = null;
  let bestLen = 0;
  for (const move of MOVES) {
    const len = move.tokens.length;
    if (len <= bestLen) continue;
    if (!suffixMatches(buf, move.tokens)) continue;
    const first = buf[buf.length - len];
    if (now - first.t > move.window) continue;
    best = move;
    bestLen = len;
  }
  if (best) {
    last.ghost = true;
    return { kind: "move", id: best.id };
  }

  // 2) partial sequence: hold briefly for the next button
  if (prefixHeld(buf, now)) return { kind: "pending" };

  // 3) nothing matches and nothing can extend: answer the press immediately
  if (now - last.t <= 450) {
    const fb = fallbackFor(last.tok);
    if (fb !== null) {
      last.ghost = true;
      return { kind: "move", id: fb };
    }
    buf.pop(); // stray motion token with no follow-up
    return { kind: "none" };
  }
  buf.pop();
  return { kind: "none" };
}
