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
 *     clips are in-place and the simulation owns movement (no sliding feet
 *     fighting the code);
 *   - boots sit at y = 0 and the skinned body is 2.19-2.31 units tall. Scale is
 *     taken from the BODY meshes only: the Mage's hat reaches 3.00 while its
 *     body stops at 2.20, so whole-model bounds would shrink the Mage to 62%;
 *   - every prop (all five Knight shields, both axe variants, a mug, hats,
 *     capes) ships live in every file, so the per-character loadout explicitly
 *     hides everything it does not want.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { FIGHTER_H, STEP_MS, type Fighter } from "./sim";
import type { CharacterTheme } from "./characters";

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
}

export const LOOKS: Record<string, FighterLook> = {
  // ember brawler — horned barbarian, bare fists
  blaze: { model: "kk_Barbarian", keep: ["Barbarian_Hat"], tint: 0.34 },
  // frost caster — caped mage with a spellbook out for the projectile combos
  frost: { model: "kk_Mage", keep: ["Mage_Cape", "Spellbook"], tint: 0.3 },
  // storm speedster — hooded rogue, cape flying
  volt: { model: "kk_Rogue_Hooded", keep: ["Rogue_Cape"], tint: 0.26 },
  // the mountain — full plate, shield and blade
  terra: {
    model: "kk_Knight",
    keep: ["Knight_Helmet", "Round_Shield", "1H_Sword"],
    tint: 0.34,
  },
  // shadow — twin knives, no cape
  nyx: { model: "kk_Rogue", keep: ["Knife", "Knife_Offhand"], tint: 0.36 },
  // the flowing one — same hooded silhouette as VOLT but capless and teal, so
  // no two fighters ever share both a model and a loadout
  tide: { model: "kk_Rogue_Hooded", keep: [], tint: 0.3 },
};

export function lookFor(theme: CharacterTheme): FighterLook {
  return LOOKS[theme.id] ?? LOOKS.blaze;
}

/* ========================================================================== */
/*  clip mapping                                                              */
/* ========================================================================== */

/** One beat of an animation: a clip and where it starts inside the move. */
export interface ClipCue {
  clip: string;
  /** fraction of the move's total frame window (0 = on the first frame) */
  at: number;
  /** counts toward the move's hit count (a dash-in beat does not) */
  hit?: boolean;
}

/** Looping / hold clips for every non-attack state. */
export const STATE_CLIPS: Record<string, { clip: string; loop: boolean }> = {
  idle: { clip: "Unarmed_Idle", loop: true },
  walk: { clip: "Walking_A", loop: true },
  crouch: { clip: "Blocking", loop: true },
  air: { clip: "Jump_Idle", loop: true },
  hurt: { clip: "Hit_A", loop: false },
  block: { clip: "Blocking", loop: true },
  down: { clip: "Lie_Down", loop: false },
  ko: { clip: "Death_A", loop: false },
  win: { clip: "Cheer", loop: true },
};

/** Walk-cycle playback rates: a fighter walks briskly, and backpedals slower. */
export const WALK_RATE = 1.32;
export const BACK_RATE = 1.0;

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
  0: [{ clip: "Unarmed_Melee_Attack_Punch_A", at: 0 }],
  // 1 Cross Spike (1)
  1: [{ clip: "Unarmed_Melee_Attack_Punch_B", at: 0 }],
  // 2 Arc Shot (1, projectile)
  2: [{ clip: "Spellcast_Shoot", at: 0 }],
  // 3 Double Tap (2)
  3: [
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0 },
    { clip: "Unarmed_Melee_Attack_Punch_B", at: 0.42 },
  ],
  // 4 Rush String (3)
  4: [
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0 },
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0.32 },
    { clip: "Unarmed_Melee_Attack_Punch_B", at: 0.64 },
  ],
  // 5 Breaker (2, heavy overheads: a smash, then a wide finishing slice)
  5: [
    { clip: "2H_Melee_Attack_Chop", at: 0 },
    { clip: "2H_Melee_Attack_Slice", at: 0.46 },
  ],
  // 6 Low Sweep (1)
  6: [{ clip: "Unarmed_Melee_Attack_Kick", at: 0 }],
  // 7 Crouch Crush (1)
  7: [{ clip: "Unarmed_Melee_Attack_Punch_B", at: 0 }],
  // 8 Rising Fang (1, launcher)
  8: [{ clip: "1H_Melee_Attack_Slice_Diagonal", at: 0 }],
  // 9 Spiral Cannon (3, projectile: two quick casts then a big one)
  9: [
    { clip: "Spellcast_Shoot", at: 0 },
    { clip: "Spellcast_Shoot", at: 0.34 },
    { clip: "Spellcast_Long", at: 0.67 },
  ],
  // 10 Storm Kick (1, dash: closes the gap, then kicks)
  10: [
    { clip: "Dodge_Forward", at: 0, hit: false },
    { clip: "Unarmed_Melee_Attack_Kick", at: 0.3 },
  ],
  // 11 Flame Wave (1, projectile)
  11: [{ clip: "Spellcast_Raise", at: 0 }],
  // 12 Counter Sweep (1)
  12: [{ clip: "1H_Melee_Attack_Slice_Horizontal", at: 0 }],
  // 13 Sky Rip (1, launcher)
  13: [{ clip: "2H_Melee_Attack_Slice", at: 0 }],
  // 14 Blitz Dash (1, dash: close the gap, then thrust)
  14: [
    { clip: "Dodge_Forward", at: 0, hit: false },
    { clip: "1H_Melee_Attack_Stab", at: 0.34 },
  ],
  // 15 Hurricane Spin (2, a fast spin into a full wide spin)
  15: [
    { clip: "2H_Melee_Attack_Spinning", at: 0 },
    { clip: "2H_Melee_Attack_Spin", at: 0.45 },
  ],
  // 16 Air Blade (1, aerial)
  16: [{ clip: "Unarmed_Melee_Attack_Kick", at: 0 }],
  // 17 Air Raid (1, aerial: a diving chop)
  17: [{ clip: "1H_Melee_Attack_Chop", at: 0 }],
  // 18 Grand Combo (3, launcher: jab, smash, rising cut)
  18: [
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0 },
    { clip: "2H_Melee_Attack_Chop", at: 0.35 },
    { clip: "1H_Melee_Attack_Slice_Diagonal", at: 0.7 },
  ],
  // 19 Ultimate Surge (5, ultimate)
  19: [
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0 },
    { clip: "Unarmed_Melee_Attack_Punch_A", at: 0.2 },
    { clip: "Unarmed_Melee_Attack_Punch_B", at: 0.4 },
    { clip: "Unarmed_Melee_Attack_Kick", at: 0.6 },
    { clip: "Spellcast_Shoot", at: 0.8 },
  ],
};

/** Moves played from a crouch — used to hold the crouch offset through them. */
export const CROUCH_MOVES = new Set([6, 7, 12]);
/** How far the fighter drops while crouching, in fighter units. */
export const CROUCH_DROP = 15;
/** Clip playback is clamped to this range so strikes stay readable. */
const MIN_SPEED = 1.0;
const MAX_SPEED = 2.8;
const FADE = 0.09;

/** Every clip name this module can ask for. */
export function mappedClipNames(): string[] {
  const names = new Set<string>();
  for (const s of Object.values(STATE_CLIPS)) names.add(s.clip);
  for (const cues of Object.values(MOVE_CLIPS))
    for (const c of cues) names.add(c.clip);
  names.add("Walking_Backwards");
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

/** Tint the whole character toward the fighter's palette (one atlas per body). */
function tintModel(
  scene: THREE.Object3D,
  theme: CharacterTheme,
  amount: number,
) {
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
      if (std.isMeshStandardMaterial) std.envMapIntensity = 0.75;
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

  tintModel(scene, theme, look.tint ?? 0.3);

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

function segmentSpeed(model: FighterModel, clip: string, segmentS: number) {
  const dur = model.durations.get(clip) ?? 1;
  return Math.max(
    MIN_SPEED,
    Math.min(MAX_SPEED, dur / Math.max(0.06, segmentS)),
  );
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
    const total = Math.max(1, f.move.windup + f.move.active + f.move.recover);
    const t = Math.max(0, Math.min(0.999, f.moveFrame / total));
    const cues = MOVE_CLIPS[f.move.id] ?? [
      { clip: "Unarmed_Melee_Attack_Punch_A", at: 0 },
    ];
    let idx = 0;
    for (let i = 0; i < cues.length; i++) if (t >= cues[i].at) idx = i;
    const cue = cues[idx];
    const nextAt = idx + 1 < cues.length ? cues[idx + 1].at : 1;
    const segmentS = Math.max(
      0.06,
      (nextAt - cue.at) * total * (STEP_MS / 1000),
    );
    play(
      model,
      cue.clip,
      false,
      segmentSpeed(model, cue.clip, segmentS),
      idx === 0 ? 0.06 : FADE,
      `mv${f.move.id}#${idx}`,
    );
    return;
  }

  // ---- locomotion and reactions
  if (f.state === "walk") {
    const forward = f.vx * f.facing >= 0;
    play(
      model,
      forward ? "Walking_A" : "Walking_Backwards",
      true,
      forward ? WALK_RATE : BACK_RATE,
      FADE,
      stateKey(f, forward ? "walk" : "back"),
    );
    return;
  }

  const entry = STATE_CLIPS[f.state];
  if (!entry) return; // unknown state: hold the last pose
  // hit reactions and deaths alternate by side so both fighters never share one
  let clip = entry.clip;
  if (f.state === "hurt") clip = f.side === 0 ? "Hit_A" : "Hit_B";
  if (f.state === "ko") clip = f.side === 0 ? "Death_A" : "Death_B";
  play(model, clip, entry.loop, 1, FADE, stateKey(f, clip));
}
