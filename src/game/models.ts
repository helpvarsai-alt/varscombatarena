/**
 * Skinned character models — loading, loadout and skeletal clip playback.
 *
 * Replaces the procedural mesh rig with real rigged characters: 41-bone
 * skeletons and 76 animation clips each, from the CC0 KayKit Adventurers pack
 * (see src/game/model-manifest.json for the generated facts and CREDITS.md for
 * the licence). The procedural rig is still built and stays visible until a
 * model arrives, so the match is playable immediately and offline.
 *
 * Everything here was measured out of the .glb files rather than assumed:
 *
 *   - the models face +Z, so the frame is rotated +90 degrees to face +X, the
 *     direction the simulation and the procedural rig both use;
 *   - the `root` bone has zero horizontal translation in every clip, so the
 *     clips are in-place and the simulation owns movement, which means the step
 *     cadence has to be derived from the ground each clip covers (LOCO_CYCLE_MU)
 *     or the feet skate;
 *   - boots sit at y = 0 and the skinned body is 2.19-2.31 units tall. Scale is
 *     taken from the BODY meshes only: the Mage's hat reaches 3.00 while its
 *     body stops at 2.20, so whole-model bounds would shrink the Mage to 62%;
 *   - every prop (all five Knight shields, both axe variants, a mug, hats,
 *     capes) ships live in every file, so the per-character loadout explicitly
 *     hides everything it does not want;
 *   - each attack clip peaks its forward reach at a known fraction of its own
 *     length (CLIP_IMPACT), and the pack's clips are far longer than this
 *     game's moves, so a beat plays a slice of its clip at a derived rate
 *     rather than the whole clip at a fixed one.
 *
 * The clip tables below are the character direction: which fighter swings what,
 * where every beat starts inside its move, and how fast it plays. Nothing in
 * them is hand-timed against a stopwatch - planBeats()/beatSlice() derive all of
 * it from the move's own frame data, and scripts/verify-models.ts checks the
 * result against the real mixer for all six fighters.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FIGHTER_H, STEP_MS, type Fighter } from "./sim";
import { getProportions, type CharacterTheme, type Proportions } from "./characters";
import { rehitGap, PROJECTILE_REHIT, type MoveData } from "./combos";

/* ========================================================================== */
/*  model table                                                               */
/* ========================================================================== */

export interface ModelSpec {
  /** file in public/models (without extension) */
  file: string;
  /** skinned-body height in model units, measured from the .glb */
  bodyHeight: number;
  /** feet height in model units, measured from the .glb */
  feetY: number;
  /** prop meshes to keep visible; every other prop is hidden */
  keep: string[];
}

export const MODELS: Record<string, ModelSpec> = {
  kk_Barbarian: {
    file: "kk_Barbarian",
    bodyHeight: 2.19,
    feetY: 0,
    keep: ["Barbarian_Hat"],
  },
  kk_Knight: {
    file: "kk_Knight",
    bodyHeight: 2.31,
    feetY: 0,
    keep: ["Knight_Cape"],
  },
  kk_Mage: {
    file: "kk_Mage",
    bodyHeight: 2.2,
    feetY: 0,
    keep: ["Mage_Cape", "Spellbook"],
  },
  kk_Rogue: {
    file: "kk_Rogue",
    bodyHeight: 2.19,
    feetY: 0,
    keep: ["Knife", "Knife_Offhand"],
  },
  kk_Rogue_Hooded: {
    file: "kk_Rogue_Hooded",
    bodyHeight: 2.25,
    feetY: 0,
    keep: ["Rogue_Cape"],
  },
};

/** Which model and loadout each fighter wears, plus its colour tint. */
export interface FighterLook {
  model: keyof typeof MODELS;
  /** meshes to keep beyond the skinned body */
  keep?: string[];
  /** how far to push the base texture toward the fighter's suit colour (0-1) */
  tint?: number;
  /**
   * Wearing this loadout, how tall the skinned fighter actually stands, in
   * fighter units: the peak of its breathing idle, measured from the posed .glb
   * (scripts/verify-models.ts re-measures it every run). Props move this a lot:
   * the horned barbarian helm puts BLAZE 14u above the shortest fighter, and the
   * mage loses its tall hat when FROST is given a cape and book instead. The
   * stand-in rig is scaled to it so the hand-off to the model does not pop.
   */
  presentedHeight: number;
  /** Peak height the procedural rig stood at before that correction. */
  rigHeight: number;
  /** Roughness / metalness for the pack's single costume atlas at this outfit. */
  rough: number;
  metal: number;
}

export const LOOKS: Record<string, FighterLook> = {
  // ember brawler — horned barbarian, bare fists
  blaze: {
    model: "kk_Barbarian",
    keep: ["Barbarian_Hat"],
    tint: 0.28,
    presentedHeight: 161.4,
    rigHeight: 159.0,
    rough: 0.78,
    metal: 0,
  },
  // frost caster — caped mage with a spellbook out for the projectile combos
  frost: {
    model: "kk_Mage",
    keep: ["Mage_Cape", "Spellbook"],
    tint: 0.24,
    presentedHeight: 146.2,
    rigHeight: 156.4,
    rough: 0.86,
    metal: 0,
  },
  // storm speedster — hooded rogue, cape flying
  volt: {
    model: "kk_Rogue_Hooded",
    keep: ["Rogue_Cape"],
    tint: 0.2,
    presentedHeight: 145.0,
    rigHeight: 160.2,
    rough: 0.66,
    metal: 0.05,
  },
  // the mountain — full plate, shield and blade: the one costume that should
  // read as steel rather than cloth, so it gets the only metal response
  terra: {
    model: "kk_Knight",
    keep: ["Knight_Helmet", "Round_Shield", "1H_Sword"],
    tint: 0.28,
    presentedHeight: 157.6,
    rigHeight: 150.0,
    rough: 0.44,
    metal: 0.2,
  },
  // shadow — twin knives, no cape
  nyx: {
    model: "kk_Rogue",
    keep: ["Knife", "Knife_Offhand"],
    tint: 0.3,
    presentedHeight: 147.0,
    rigHeight: 153.0,
    rough: 0.72,
    metal: 0,
  },
  // the flowing one — same hooded silhouette as VOLT but capless and teal, so
  // no two fighters ever share both a model and a loadout
  tide: {
    model: "kk_Rogue_Hooded",
    keep: [],
    tint: 0.24,
    presentedHeight: 145.0,
    rigHeight: 150.6,
    rough: 0.62,
    metal: 0.05,
  },
};

/**
 * Proportions for the stand-in rig, adjusted so it is the same height as the
 * model it will be replaced by. Only the overall height moves: build (width,
 * muscle) stays the roster's, because that is what makes the six silhouettes
 * read apart while a model is still loading.
 */
export function rigProportionsFor(theme: CharacterTheme): Proportions {
  const base = getProportions(theme.id);
  const look = lookFor(theme);
  return {
    ...base,
    height: base.height * (look.presentedHeight / look.rigHeight),
  };
}

export function lookFor(theme: CharacterTheme): FighterLook {
  return LOOKS[theme.id] ?? LOOKS.blaze;
}

/* ========================================================================== */
/*  clip mapping                                                              */
/* ========================================================================== */

/**
 * One beat of an animation: which clip, and whether that beat carries a hit.
 *
 * There is deliberately no hand-written timing here. Where a beat starts, when
 * it must peak and how fast it plays are all derived from the move's own frame
 * data by planBeats()/beatSlice() below, so a strike cannot drift away from the
 * frame the hitbox goes live on.
 */
export interface ClipCue {
  clip: string;
  /** counts toward the move's hit count (a dash-in beat does not) */
  hit?: boolean;
}

const c = (clip: string): ClipCue => ({ clip });
const dash = (clip: string): ClipCue => ({ clip, hit: false });

/** Looping / hold clips for every non-attack state. */
export const STATE_CLIPS: Record<string, { clip: string; loop: boolean }> = {
  idle: { clip: "Unarmed_Idle", loop: true },
  // the run cycle, not the walk cycle: see LOCO_FORWARD below
  walk: { clip: "Running_A", loop: true },
  crouch: { clip: "Blocking", loop: true },
  air: { clip: "Jump_Idle", loop: true },
  hurt: { clip: "Hit_A", loop: false },
  block: { clip: "Blocking", loop: true },
  down: { clip: "Lie_Down", loop: false },
  ko: { clip: "Death_A", loop: false },
  win: { clip: "Cheer", loop: true },
};

/**
 * A distinct animation per combo, timed against that move's real
 * windup/active/recover frames. Multi-hit strings are split into beats so the
 * strike lands inside the active window and the hands alternate.
 *
 * `hit` defaults to true, and the number of hit beats must equal the move's
 * hitCount — scripts/verify-animation.ts asserts that, and that every clip
 * named here really exists in every model.
 */
export const MOVE_CLIPS: Record<number, ClipCue[]> = {
  // 0 Jab Snap (1)
  0: [c("Unarmed_Melee_Attack_Punch_A")],
  // 1 Cross Spike (1)
  1: [c("Unarmed_Melee_Attack_Punch_B")],
  // 2 Arc Shot (1, projectile)
  2: [c("Spellcast_Shoot")],
  // 3 Double Tap (2)
  3: [c("Unarmed_Melee_Attack_Punch_A"), c("Unarmed_Melee_Attack_Punch_B")],
  // 4 Rush String (3)
  4: [
    c("Unarmed_Melee_Attack_Punch_A"),
    c("Unarmed_Melee_Attack_Punch_A"),
    c("Unarmed_Melee_Attack_Punch_B"),
  ],
  // 5 Breaker (2, heavy overheads: a smash, then a wide finishing slice)
  5: [c("2H_Melee_Attack_Chop"), c("2H_Melee_Attack_Slice")],
  // 6 Low Sweep (1)
  6: [c("Unarmed_Melee_Attack_Kick")],
  // 7 Crouch Crush (1)
  7: [c("Unarmed_Melee_Attack_Punch_B")],
  // 8 Rising Fang (1, launcher)
  8: [c("1H_Melee_Attack_Slice_Diagonal")],
  // 9 Spiral Cannon (3, projectile: two quick casts then a big one)
  9: [c("Spellcast_Shoot"), c("Spellcast_Shoot"), c("Spellcast_Long")],
  // 10 Storm Kick (1, dash: closes the gap, then kicks)
  10: [dash("Dodge_Forward"), c("Unarmed_Melee_Attack_Kick")],
  // 11 Flame Wave (1, projectile)
  11: [c("Spellcast_Raise")],
  // 12 Counter Sweep (1)
  12: [c("1H_Melee_Attack_Slice_Horizontal")],
  // 13 Sky Rip (1, launcher)
  13: [c("2H_Melee_Attack_Slice")],
  // 14 Blitz Dash (1, dash: close the gap, then thrust)
  14: [dash("Dodge_Forward"), c("1H_Melee_Attack_Stab")],
  // 15 Hurricane Spin (2, a fast spin into a full wide spin)
  15: [c("2H_Melee_Attack_Spinning"), c("2H_Melee_Attack_Spin")],
  // 16 Air Blade (1, aerial)
  16: [c("Unarmed_Melee_Attack_Kick")],
  // 17 Air Raid (1, aerial: a diving chop)
  17: [c("1H_Melee_Attack_Chop")],
  // 18 Grand Combo (3, launcher: jab, smash, rising cut)
  18: [
    c("Unarmed_Melee_Attack_Punch_A"),
    c("2H_Melee_Attack_Chop"),
    c("1H_Melee_Attack_Slice_Diagonal"),
  ],
  // 19 Ultimate Surge (5, ultimate)
  19: [
    c("Unarmed_Melee_Attack_Punch_A"),
    c("Unarmed_Melee_Attack_Punch_A"),
    c("Unarmed_Melee_Attack_Punch_B"),
    c("Unarmed_Melee_Attack_Kick"),
    c("Spellcast_Shoot"),
  ],
};

/**
 * Striking with an empty hand while a weapon swings from the other looks
 * broken, so the two armed fighters swap the empty-hand strikes for clips that
 * actually swing what they are holding. Everything else about the move — its
 * frames, its reach, its hit count — is untouched, and the beat count of every
 * override matches the move it replaces.
 *
 *   TERRA (sword + round shield)  -> one-handed cuts, keep the shield arm.
 *   NYX   (twin knives)           -> the pack's dual-wield clips.
 *
 * BLAZE, VOLT and TIDE hold nothing, and FROST's spellbook reads correctly in
 * a closed fist, so they keep the shared unarmed set and its casting beats.
 */
const TERRA_CLIPS: Partial<Record<number, ClipCue[]>> = {
  0: [c("1H_Melee_Attack_Stab")],
  1: [c("1H_Melee_Attack_Chop")],
  3: [c("1H_Melee_Attack_Stab"), c("1H_Melee_Attack_Slice_Diagonal")],
  4: [
    c("1H_Melee_Attack_Stab"),
    c("1H_Melee_Attack_Chop"),
    c("1H_Melee_Attack_Slice_Horizontal"),
  ],
  5: [c("1H_Melee_Attack_Chop"), c("1H_Melee_Attack_Slice_Diagonal")],
  7: [c("1H_Melee_Attack_Slice_Horizontal")],
  8: [c("1H_Melee_Attack_Slice_Diagonal")],
  12: [c("1H_Melee_Attack_Slice_Horizontal")],
  13: [c("1H_Melee_Attack_Chop")],
  14: [dash("Dodge_Forward"), c("1H_Melee_Attack_Stab")],
  18: [
    c("1H_Melee_Attack_Stab"),
    c("1H_Melee_Attack_Chop"),
    c("1H_Melee_Attack_Slice_Diagonal"),
  ],
  19: [
    c("1H_Melee_Attack_Stab"),
    c("1H_Melee_Attack_Stab"),
    c("1H_Melee_Attack_Chop"),
    c("Unarmed_Melee_Attack_Kick"),
    c("Spellcast_Shoot"),
  ],
};

const NYX_CLIPS: Partial<Record<number, ClipCue[]>> = {
  0: [c("Dualwield_Melee_Attack_Stab")],
  1: [c("Dualwield_Melee_Attack_Chop")],
  3: [c("Dualwield_Melee_Attack_Stab"), c("Dualwield_Melee_Attack_Chop")],
  4: [
    c("Dualwield_Melee_Attack_Stab"),
    c("Dualwield_Melee_Attack_Chop"),
    c("Dualwield_Melee_Attack_Slice"),
  ],
  5: [c("Dualwield_Melee_Attack_Slice"), c("Dualwield_Melee_Attack_Chop")],
  7: [c("Dualwield_Melee_Attack_Chop")],
  8: [c("Dualwield_Melee_Attack_Slice")],
  12: [c("Dualwield_Melee_Attack_Slice")],
  13: [c("Dualwield_Melee_Attack_Chop")],
  14: [dash("Dodge_Forward"), c("Dualwield_Melee_Attack_Stab")],
  18: [
    c("Dualwield_Melee_Attack_Stab"),
    c("Dualwield_Melee_Attack_Chop"),
    c("Dualwield_Melee_Attack_Slice"),
  ],
  19: [
    c("Dualwield_Melee_Attack_Stab"),
    c("Dualwield_Melee_Attack_Stab"),
    c("Dualwield_Melee_Attack_Chop"),
    c("Unarmed_Melee_Attack_Kick"),
    c("Spellcast_Shoot"),
  ],
};

const ARMED_CLIPS: Record<string, Partial<Record<number, ClipCue[]>>> = {
  terra: TERRA_CLIPS,
  nyx: NYX_CLIPS,
};

/** The beat list a given fighter plays for a given move. */
export function moveClipsFor(moveId: number, fighterId: string): ClipCue[] {
  return ARMED_CLIPS[fighterId]?.[moveId] ?? MOVE_CLIPS[moveId] ?? MOVE_CLIPS[0];
}

/** Moves played from a crouch — used to hold the crouch offset through them. */
export const CROUCH_MOVES = new Set([6, 7, 12]);
/** How far the fighter drops while crouching, in fighter units. */
export const CROUCH_DROP = 15;
/** Fade time between two clips, in seconds. */
const FADE = 0.09;

/* ========================================================================== */
/*  measured clip facts                                                       */
/* ========================================================================== */

/**
 * Where each attack clip actually peaks, as a fraction of its own duration.
 *
 * Measured out of the vendored .glb files: for every sample of the clip, the
 * forward reach along the model's facing axis of the four limb ends (both hands
 * and both toe bones) relative to the hips, and the sample of the maximum. That
 * peak is the animation's contact moment, and the retimer below lines it up
 * with the frame its hitbox goes live, so the strike the player sees is the
 * strike the game scores.
 *
 * The two spin clips read as constant extension in every direction, so they are
 * pinned to the middle of the turn rather than to a meaningless argmax.
 */
export const CLIP_IMPACT: Record<string, number> = {
  Unarmed_Melee_Attack_Punch_A: 0.35,
  Unarmed_Melee_Attack_Punch_B: 0.2,
  Unarmed_Melee_Attack_Kick: 0.467,
  "1H_Melee_Attack_Chop": 0.633,
  "1H_Melee_Attack_Slice_Diagonal": 0.333,
  "1H_Melee_Attack_Slice_Horizontal": 0.183,
  "1H_Melee_Attack_Stab": 0.467,
  "2H_Melee_Attack_Chop": 0.483,
  "2H_Melee_Attack_Slice": 0.4,
  "2H_Melee_Attack_Stab": 0.467,
  "2H_Melee_Attack_Spin": 0.5,
  "2H_Melee_Attack_Spinning": 0.5,
  Dualwield_Melee_Attack_Chop: 0.35,
  Dualwield_Melee_Attack_Slice: 0.567,
  Dualwield_Melee_Attack_Stab: 0.467,
  Spellcast_Shoot: 0.25,
  Spellcast_Long: 0.333,
  Spellcast_Raise: 0.333,
  Dodge_Forward: 0.917,
  Hit_A: 0.25,
  Hit_B: 0.183,
};

/** Contact fraction of a clip, with a neutral default for clips never measured. */
export function impactFraction(clip: string): number {
  return CLIP_IMPACT[clip] ?? 0.35;
}

/**
 * Ground a locomotion clip covers per full cycle at playback rate 1, in model
 * units.
 *
 * Measured the same way as the stand-in rig's stride: the widest gap between
 * the two feet over the cycle is one step, and a cycle is two steps. It is what
 * turns the sim's world speed into a step cadence, which is the difference
 * between feet that grip the deck and feet that skate across it.
 */
export const LOCO_CYCLE_MU: Record<string, number> = {
  Walking_A: 0.811,
  Walking_Backwards: 0.809,
  Running_A: 1.2,
};

/**
 * Forward locomotion uses the run cycle.
 *
 * The simulation walks at 330u/s, which is 2.2 body-heights per second: a run,
 * not a walk. The walk cycle covers 52u/s of ground at rate 1, so matching it
 * would need rate 6.3 - a leg flutter - and every rate below that slides. The
 * run cycle covers 103u/s, so rate 3.2 holds the deck exactly, and that is a
 * believable sprint cadence (4 strides a second).
 */
export const LOCO_FORWARD = "Running_A";
/**
 * Backpedal clip. The pack ships a purpose-made backwards walk and no backwards
 * run, so at the sim's 245u/s retreat the feet slip about 1.5x. A backdash clip
 * sized to the game's speed is in the asset proposal; the authored clip beats a
 * reversed run cycle (which the pack also allows) because the arms counter-swing
 * the right way.
 */
export const LOCO_BACK = "Walking_Backwards";
/** Playback rate band for locomotion, so a speed change cannot make it flicker. */
const LOCO_RATE_MIN = 1.15;
const LOCO_RATE_MAX = 3.2;

/* ========================================================================== */
/*  beat planning and retiming                                                */
/* ========================================================================== */

/** One beat, placed inside the move's own frame window. */
export interface Beat {
  clip: string;
  hit: boolean;
  /** first frame of the beat inside the move */
  start: number;
  /** exclusive end frame of the beat */
  end: number;
  /** frame this beat's contact must land on (-1 for choreography beats) */
  strike: number;
  /** share of the beat that elapses before the contact */
  q: number;
}

/** A beat never gets less than this many frames, whatever the frame data says. */
const MIN_BEAT_FRAMES = 4;
/** Share of the gap before a hit that the beat spends on anticipation. */
const BEAT_LEAD = 0.35;
/** Share of its own length a beat aims to play from the source clip. */
const SLICE_SHARE = 0.32;
/** Retimed playback band, so one short beat cannot spin the skeleton. */
const BEAT_RATE_MIN = 0.7;
const BEAT_RATE_MAX = 3.2;

/**
 * Place every beat of a move inside that move's frame window.
 *
 * The hits come first: melee hits can only land on frames the sim actually
 * checks (the first active frame, then one per rehit gap), and any declared hit
 * that falls past the end of the active window is packed back so each beat keeps
 * MIN_BEAT_FRAMES to itself. Beats then start a little before their own hit, so
 * there is always anticipation to read, and the last one runs to the end of the
 * move to leave the recovery in place.
 *
 * Projectile moves are the exception: the projectile, not the melee box, decides
 * when the damage lands, and the cast beats after the first are choreography
 * spread on the projectile's own rehit rhythm.
 */
export function planBeats(mv: MoveData, cues: ClipCue[]): Beat[] {
  const total = Math.max(1, mv.windup + mv.active + mv.recover);
  const hits = cues.filter((cue) => cue.hit !== false);
  const ranged = mv.type === "projectile";
  const window = ranged ? total - 1 : mv.windup + mv.active;
  const gap = ranged ? PROJECTILE_REHIT : rehitGap(mv);

  const strikes: number[] = hits.map((_, i) => mv.windup + i * gap);
  for (let i = strikes.length - 1; i >= 0; i--) {
    const limit = window - (strikes.length - 1 - i) * MIN_BEAT_FRAMES;
    strikes[i] = Math.max(mv.windup, Math.min(strikes[i], limit));
  }
  for (let i = 1; i < strikes.length; i++) {
    strikes[i] = Math.max(strikes[i], strikes[i - 1] + MIN_BEAT_FRAMES);
  }

  // beats start a short lead-in before their own hit; the very first cue starts
  // the move at frame 0, and a dash-in cue (which carries no hit) keeps a lead
  // of its own in front of the strike that follows it
  const starts: number[] = [];
  let hitSeen = 0;
  for (let i = 0; i < cues.length; i++) {
    if (cues[i].hit === false) {
      starts.push(i === 0 ? 0 : starts[i - 1] + 1);
      continue;
    }
    const strike = strikes[hitSeen];
    if (hitSeen === 0 && i === 0) {
      starts.push(0);
    } else {
      const previous = hitSeen === 0 ? 0 : strikes[hitSeen - 1];
      const lead = Math.min(
        6,
        Math.max(1, Math.round(BEAT_LEAD * (strike - previous))),
      );
      starts.push(Math.max(starts[i - 1] + 1, strike - lead));
    }
    hitSeen++;
  }

  const beats: Beat[] = [];
  let next = 0;
  for (let i = 0; i < cues.length; i++) {
    const start = starts[i];
    const end = i + 1 < cues.length ? starts[i + 1] : total;
    let strike = -1;
    if (cues[i].hit !== false) {
      strike = strikes[next++];
    }
    beats.push({
      clip: cues[i].clip,
      hit: cues[i].hit !== false,
      start,
      end,
      strike,
      // a late beat can be packed so tight that the strike is barely a frame
      // after the beat opens; the floor is low enough to keep that contact on
      // its hit frame rather than nudging it past it
      q: strike < 0 ? 0.5 : clamp01((strike - start) / Math.max(1, end - start), 0.02, 0.9),
    });
  }
  return beats;
}

function clamp01(v: number, lo: number, hi: number) {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo;
}

/** How a beat plays a clip: rate, and where to start inside the clip. */
export interface BeatSlice {
  rate: number;
  from: number;
}

/**
 * Playback rate and clip offset for one beat.
 *
 * Two things have to be true at once: the clip's measured contact has to happen
 * exactly `q` of the way through the beat (so it coincides with the hitbox), and
 * the beat has to read at a sane speed. Both are satisfiable by starting the clip
 * at the right offset, so the offset is solved, not guessed. A very short beat
 * can still be forced past the rate band, and then the contact drifts by a frame
 * or so - scripts/verify-models.ts measures that drift rather than hiding it.
 */
export function beatSlice(
  durationS: number,
  windowFrames: number,
  q: number,
  impact: number,
): BeatSlice {
  const windowS = Math.max(1 / 240, windowFrames * (STEP_MS / 1000));
  const target = (SLICE_SHARE * durationS) / windowS;
  // from = impact - q*span >= 0 and from + span <= 1, with span = rate*window/dur
  const capLate = windowS > 0 ? (impact * durationS) / Math.max(0.05, q) / windowS : target;
  const capEarly = windowS > 0 ? ((1 - impact) * durationS) / Math.max(0.05, 1 - q) / windowS : target;
  const rate = clamp01(Math.min(target, capLate, capEarly), BEAT_RATE_MIN, BEAT_RATE_MAX);
  const span = (rate * windowS) / durationS;
  const from = Math.max(0, Math.min(Math.max(0, 1 - span), impact - q * span));
  return { rate, from };
}

/**
 * How many of a move's declared hits the simulation can actually deliver.
 *
 * A multi-hit move lands one hit per rehit gap inside its active window, so a
 * move that declares more hits than fit in that window has a finisher the game
 * can never reach (and `last` - the knockdown, the big knockback - never fires).
 * The animation still plays every beat, because the roster's frame data is the
 * source of truth; this exists so the gap is measured rather than assumed.
 */
export function hittableHits(mv: MoveData): number {
  const end = mv.type === "projectile" ? Infinity : mv.windup + mv.active;
  const gap = mv.type === "projectile" ? PROJECTILE_REHIT : rehitGap(mv);
  let n = 0;
  for (let i = 0; i < mv.hitCount; i++) if (mv.windup + i * gap <= end) n++;
  return n;
}

/** Contact frame a beat's retimed clip actually reaches, for verification. */
export function beatContactFrame(
  beat: Beat,
  durationS: number,
  impact: number,
): number {
  const slice = beatSlice(durationS, beat.end - beat.start, beat.q, impact);
  return beat.start + ((impact - slice.from) * durationS) / slice.rate / (STEP_MS / 1000);
}

/** Every clip name this module can ask for. */
export function mappedClipNames(): string[] {
  const names = new Set<string>();
  for (const s of Object.values(STATE_CLIPS)) names.add(s.clip);
  const add = (cues: ClipCue[]) => {
    for (const cue of cues) names.add(cue.clip);
  };
  for (const cues of Object.values(MOVE_CLIPS)) add(cues);
  for (const table of Object.values(ARMED_CLIPS)) {
    for (const cues of Object.values(table)) if (cues) add(cues);
  }
  names.add(LOCO_FORWARD);
  names.add(LOCO_BACK);
  return [...names];
}

/* ========================================================================== */
/*  loading                                                                   */
/* ========================================================================== */

export interface FighterModel {
  themeId: string;
  /** frame the renderer parents to the fighter root: faces +X, feet at y = 0 */
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  durations: Map<string, number>;
  /** retimed beat tables, resolved against this model's clip lengths */
  beats: Map<string, ResolvedBeat[]>;
  current: THREE.AnimationAction | null;
  /** the action currently fading out; stopped once the next beat starts */
  fading: THREE.AnimationAction | null;
  /** identifies the beat being played so repeats of one clip still restart */
  currentKey: string;
  /** smoothed crouch drop in fighter units */
  crouch: number;
}

const loader = new GLTFLoader();
const cache = new Map<string, Promise<FighterModel>>();

function assetUrl(file: string) {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  return `${base}models/${file}.glb`;
}

/** Real model only exists in a browser; Node (verification) has no DOM. */
export const modelsAvailable = typeof document !== "undefined";

/**
 * Dress the loaded character.
 *
 * The pack gives every model exactly one atlas material, so the mask that puts
 * a fighter in its roster colour is a multiply over the whole costume - skin,
 * hair and steel included. Keeping it light (a fifth to a third of the way to
 * the suit colour) means the pack's own costume art still reads, and the roster
 * colour lands as a cast over it rather than replacing it.
 *
 * The same atlas covers cloth and armour, so the material response is per
 * fighter, not per part: the knight's plate is the only costume allowed any
 * metalness, and it is kept low because the low quality tier renders with no
 * environment map, where metalness just goes dark.
 */
function tintModel(scene: THREE.Object3D, theme: CharacterTheme, look: FighterLook) {
  const amount = look.tint ?? 0.3;
  const tint = new THREE.Color(theme.suit).lerp(
    new THREE.Color(0xffffff),
    1 - amount,
  );
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const std = m as THREE.MeshStandardMaterial;
      if (std.color) std.color.copy(tint);
      // match the arena's procedural materials so a loaded fighter shades under
      // the same room lighting as the fallback rig
      if (std.isMeshStandardMaterial) {
        std.envMapIntensity = 0.75;
        std.roughness = look.rough;
        std.metalness = look.metal;
      }
    }
  });
}

export function loadFighterModel(
  theme: CharacterTheme,
  spec: ModelSpec,
  slot: number | string = 0,
): Promise<FighterModel> {
  // Keyed per slot as well as per character. Two fighters wearing the same
  // model must never share one instance: an Object3D has a single parent and a
  // glTF skeleton belongs to exactly one scene graph, so a mirror match would
  // otherwise leave one of the two fighters missing or frozen.
  const key = `${slot}:${theme.id}:${spec.file}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = (async (): Promise<FighterModel> => {
    const gltf = await loader.loadAsync(assetUrl(spec.file));
    return buildFighterModel(gltf, theme, spec);
  })();
  cache.set(key, p);
  p.catch(() => cache.delete(key)); // allow a retry after a failed fetch
  return p;
}

/**
 * Turn a parsed glTF into a playable fighter.
 *
 * Pure three.js — no loader, no DOM, no WebGL — so scripts/verify-models.ts can
 * run the exact code the browser runs against the real files and then measure
 * the resulting object graph and skeleton.
 */
export function buildFighterModel(
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] },
  theme: CharacterTheme,
  spec: ModelSpec,
): FighterModel {
  const scene = gltf.scene;

  // Which props to keep: the skinned body is always kept, every other mesh is
  // a prop (weapon/shield/hat/cape) and is hidden unless the loadout lists it.
  const look = lookFor(theme);
  const keep = new Set(look.keep ?? spec.keep);
  const bodyPart =
    /_(Body|Head|Head_Hooded|ArmLeft|ArmRight|LegLeft|LegRight)$/;
  const bodies: THREE.Object3D[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (bodyPart.test(mesh.name)) {
      bodies.push(mesh);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      return;
    }
    const wanted = keep.has(mesh.name);
    mesh.visible = wanted;
    mesh.frustumCulled = false;
  });

  tintModel(scene, theme, look);

  // Scale by the skinned BODY, not the whole model: hats and shields would
  // otherwise drag the scale down (the Mage's hat is 0.8 units above its head).
  const box = new THREE.Box3();
  for (const b of bodies) box.expandByObject(b);
  const height = box.isEmpty() ? spec.bodyHeight : box.max.y - box.min.y;
  const feetY = box.isEmpty() ? spec.feetY : box.min.y;
  const scale = FIGHTER_H / Math.max(0.2, height);

  const root = new THREE.Group();
  root.rotation.y = Math.PI / 2; // model faces +Z, fighters face +X
  root.scale.setScalar(scale);
  scene.position.y = -feetY;
  root.add(scene);

  const mixer = new THREE.AnimationMixer(scene);
  const actions = new Map<string, THREE.AnimationAction>();
  const durations = new Map<string, number>();
  for (const clip of gltf.animations) {
    if (clip.duration <= 0) continue; // pose-only clips cannot be played
    const action = mixer.clipAction(clip);
    action.setEffectiveWeight(1);
    actions.set(clip.name, action);
    durations.set(clip.name, clip.duration);
  }
  if (actions.size === 0) throw new Error(`no playable clips in ${spec.file}`);

  const model: FighterModel = {
    themeId: theme.id,
    root,
    mixer,
    actions,
    durations,
    beats: new Map(),
    current: null,
    fading: null,
    currentKey: "",
    crouch: 0,
  };
  // Settle into the idle before the first frame so a bind-pose T-pose never
  // flashes on screen.
  play(model, "Unarmed_Idle", true, 1, 0, "boot");
  mixer.update(0);
  return model;
}

/**
 * Detach a fighter's animation bindings. Deliberately does NOT free the
 * geometry or textures: parsed models live in the module cache for the whole
 * session, so a rematch against the same character re-parents them instead of
 * downloading and parsing 3.5MB again.
 */
export function disposeFighterModel(model: FighterModel) {
  model.mixer.stopAllAction();
  model.mixer.uncacheRoot(model.root);
}

/* ========================================================================== */
/*  playback                                                                  */
/* ========================================================================== */

function play(
  model: FighterModel,
  clip: string,
  loop: boolean,
  speed: number,
  fade: number,
  key: string,
  offsetS = 0,
) {
  const next = model.actions.get(clip);
  if (!next) return; // a missing clip leaves the previous pose intact
  if (model.currentKey === key && model.current === next) {
    next.setEffectiveTimeScale(speed);
    return;
  }
  const prev = model.current;
  // retire the action that was fading out last beat: otherwise every beat of a
  // long combo leaves a zero-weight action running and the mixer keeps
  // evaluating skeletons nobody can see
  if (model.fading && model.fading !== next) {
    model.fading.stop();
    model.fading = null;
  }
  next.reset();
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  next.clampWhenFinished = !loop;
  next.setEffectiveTimeScale(speed);
  next.setEffectiveWeight(1);
  // Scrub into the clip when a beat has to reach its contact on a frame the
  // move owns. The pack's attack clips are 1 to 2.5 seconds of heavy wind-up
  // and the game's moves are 0.25 to 0.7 seconds, so playing them from frame 0
  // spends the whole hitbox window on the wind-up and freezes mid-swing.
  if (offsetS > 0) {
    const dur = model.durations.get(clip) ?? 0;
    next.time = Math.max(0, Math.min(offsetS, dur > 0 ? dur - 0.01 : offsetS));
  }
  next.play();
  if (prev && prev !== next) {
    if (fade > 0) {
      next.crossFadeFrom(prev, fade, false);
      model.fading = prev;
    } else {
      prev.stop();
    }
  }
  model.current = next;
  model.currentKey = key;
}

/**
 * Playback rate that makes a one-shot reaction finish with the state that owns
 * it, instead of being cut off halfway (or holding a clamped pose for a second
 * while the fighter is already standing up again).
 */
function reactionRate(model: FighterModel, clip: string, seconds: number) {
  const dur = model.durations.get(clip) ?? 1;
  return Math.max(1, Math.min(2.2, dur / Math.max(0.05, seconds)));
}

/** A beat with its retiming already resolved against the clips that loaded. */
interface ResolvedBeat {
  clip: string;
  rate: number;
  offsetS: number;
  fade: number;
  start: number;
  key: string;
}

/**
 * Resolve and cache a move's beats for one fighter.
 *
 * Costs one allocation per (fighter, move) for the whole session: the frame
 * loop below only reads the table, so nothing is built while fighting.
 */
function beatsFor(
  model: FighterModel,
  mv: MoveData,
  fighterId: string,
): ResolvedBeat[] {
  const cacheKey = `${fighterId}:${mv.id}`;
  const hit = model.beats.get(cacheKey);
  if (hit) return hit;
  const plan = planBeats(mv, moveClipsFor(mv.id, fighterId));
  const resolved = plan.map((beat, i) => {
    const dur = model.durations.get(beat.clip) ?? 0.8;
    const slice = beatSlice(dur, beat.end - beat.start, beat.q, impactFraction(beat.clip));
    return {
      clip: beat.clip,
      rate: slice.rate,
      offsetS: slice.from * dur,
      // the first beat of a move snaps in: the move has already started
      fade: i === 0 ? 0.06 : FADE,
      start: beat.start,
      key: `mv${mv.id}#${beat.start}`,
    };
  });
  model.beats.set(cacheKey, resolved);
  return resolved;
}

const stateKey = (f: Fighter, tag: string) => `${tag}:${f.state}:${f.side}`;

/**
 * Advance one fighter's skeleton by `dtS` seconds and pick the clip its current
 * state calls for. The caller keeps the procedural rig hidden for as long as a
 * model exists here.
 */
export function updateFighterModel(
  model: FighterModel,
  f: Fighter,
  dtS: number,
): void {
  // ---- crouch: the rig has no crouch clip, so lower the frame under a guard
  const crouching =
    f.state === "crouch" ||
    (f.state === "attack" && !!f.move && CROUCH_MOVES.has(f.move.id));
  const target = crouching ? CROUCH_DROP : 0;
  model.crouch += (target - model.crouch) * Math.min(1, dtS * 10);
  model.root.position.y = -model.crouch;

  // advance the skeleton first, so this frame's clip change is visible now
  model.mixer.update(dtS);

  // ---- attacks: beat by beat through the move's frame window
  if (f.state === "attack" && f.move) {
    const beats = beatsFor(model, f.move, f.charId);
    const frame = Math.max(0, f.moveFrame);
    let beat = beats[0];
    for (const b of beats) if (frame >= b.start) beat = b;
    play(model, beat.clip, false, beat.rate, beat.fade, beat.key, beat.offsetS);
    return;
  }

  // ---- locomotion: the cadence is driven by the ground speed the sim is
  // applying right now, so the feet grip at any speed instead of at a fixed
  // rate tuned for one of them
  if (f.state === "walk") {
    const forward = f.vx * f.facing >= 0;
    const clip = forward ? LOCO_FORWARD : LOCO_BACK;
    const dur = model.durations.get(clip) ?? 1;
    const cycle = (LOCO_CYCLE_MU[clip] ?? 0.83) * model.root.scale.x;
    const rate = Math.max(
      LOCO_RATE_MIN,
      Math.min(LOCO_RATE_MAX, (Math.abs(f.vx) * dur) / Math.max(1, cycle)),
    );
    play(model, clip, true, rate, FADE, stateKey(f, forward ? "walk" : "back"));
    return;
  }

  const entry = STATE_CLIPS[f.state];
  if (!entry) return; // unknown state: hold the last pose
  // hit reactions and deaths alternate by side so both fighters never share one
  let clip = entry.clip;
  let rate = 1;
  if (f.state === "hurt") {
    clip = f.side === 0 ? "Hit_A" : "Hit_B";
    // the reaction has to play out inside the stun that caused it
    rate = reactionRate(model, clip, f.hitstun * (STEP_MS / 1000));
  }
  if (f.state === "down") {
    // a knockdown is ~38 frames; the lie-down clip is 3 seconds
    rate = reactionRate(model, clip, Math.max(0.2, f.downT * (STEP_MS / 1000)));
  }
  if (f.state === "ko") clip = f.side === 0 ? "Death_A" : "Death_B";
  play(model, clip, entry.loop, rate, FADE, stateKey(f, clip));
}
