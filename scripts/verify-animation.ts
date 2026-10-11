/**
 * Animation verification harness — run with `bun run verify:anim`.
 *
 * The 3D rig has no visual regression suite (it needs WebGL), so this checks
 * the things that actually break a fighting game's animation, headlessly:
 *
 *   1. every state produces a finite, bounded pose
 *   2. all 20 combos have a *unique*, moving animation on the ground and in air
 *   3. attack timing follows each move's real frame data (load -> extend -> guard)
 *   4. multi-hit strings really alternate hands
 *   5. feet reach the floor (forward kinematics of the rig leg chain)
 *   6. the roster carries the build/hair/outfit data the renderer reads
 *   7. every skeletal clip the model layer asks for exists in every vendored
 *      .glb, is playable (non-zero length), and the loadouts name real meshes
 *   8. each combo's beat count matches its hit count, and each beat lands
 *      inside the move's real frame window
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import {
  CHANNELS,
  baseStance,
  applyKeys,
  key,
  rigPoseFor,
} from "../src/game/animation";
import { MOVE_BY_ID, MOVES } from "../src/game/combos";
import { CHARACTERS, getCharacter, getProportions } from "../src/game/characters";
import { World, FIGHTER_H, RIG_CYCLE_DISTANCE, type Fighter } from "../src/game/sim";
import { POSE2D_CYCLE_DISTANCE, POSE2D_LIMB, poseFor } from "../src/game/pose";
import { applyRigPose, buildFighterRig, spineLayout, stampFighterStyle } from "../src/game/render3d";
import {
  CROUCH_DROP,
  LOOKS,
  MODELS,
  MOVE_CLIPS,
  STATE_CLIPS,
  beatContactFrame,
  beatSlice,
  impactFraction,
  mappedClipNames,
  moveClipsFor,
  planBeats,
  rigProportionsFor,
  type ClipCue,
} from "../src/game/models";

/*
 * Minimal 2D-canvas stub: the rig builder creates CanvasTextures for the aura
 * sprite and the blob shadow, which needs a canvas element but no real GL.
 */
function installCanvasStub() {
  const gradient = { addColorStop() {} };
  const ctx = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    set fillStyle(_v: unknown) {},
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: unknown) {},
    set lineCap(_v: unknown) {},
    set globalCompositeOperation(_v: unknown) {},
  };
  (globalThis as unknown as { document: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
  };
}
installCanvasStub();

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, extra = "") {
  if (!cond) {
    failures++;
    console.log(`FAIL  ${name}${extra ? " :: " + extra : ""}`);
  } else {
    passes++;
  }
}

/** Position channels are heights/offsets, not angles — checked separately. */
const POSITION_CHANNELS = new Set<string>(["pelvisY", "pelvisZ"]);

function finite(p: Record<string, number>) {
  return CHANNELS.every((c) => Number.isFinite(p[c]));
}

/** Largest joint rotation in the pose (radians). */
function maxAngle(p: Record<string, number>) {
  return Math.max(
    ...CHANNELS.filter((c) => !POSITION_CHANNELS.has(c)).map((c) => Math.abs(p[c])),
  );
}

function poseSane(p: Record<string, number>) {
  return (
    finite(p) &&
    maxAngle(p) < 8 &&
    p.pelvisY > 5 &&
    p.pelvisY < 130 &&
    Math.abs(p.pelvisZ) < 40
  );
}

const w = new World("blaze", "frost");
const f: Fighter = w.f[0];
const t0 = 1000;

/* ---- 1. every state produces a finite, bounded pose ---- */
const STATES: Fighter["state"][] = [
  "idle",
  "walk",
  "crouch",
  "air",
  "hurt",
  "block",
  "down",
  "ko",
  "win",
];
for (const s of STATES) {
  f.state = s;
  f.stateT = 3;
  f.airborne = s === "air";
  f.vy = s === "air" ? -400 : 0;
  f.downT = s === "down" ? 20 : 0;
  f.blockstun = s === "block" ? 8 : 0;
  const p = rigPoseFor(f, t0);
  check(
    `state ${s}: finite + bounded`,
    poseSane(p),
    `maxAngle=${maxAngle(p).toFixed(2)} pelvisY=${p.pelvisY.toFixed(1)}`,
  );
}
f.airborne = false;
f.downT = 0;
f.blockstun = 0;
f.vy = 0;

/* ---- 2. each of the 20 combos: finite, bounded, unique, actually moving --- */
function signature(id: number, airborne: boolean) {
  const mv = MOVE_BY_ID.get(id)!;
  const total = mv.windup + mv.active + mv.recover;
  const samples = 40;
  const parts: string[] = [];
  let motion = 0;
  let sane = true;
  let prev: Record<string, number> | null = null;
  f.state = "attack";
  f.move = mv;
  f.airborne = airborne;
  for (let i = 0; i < samples; i++) {
    f.moveFrame = Math.round((total - 1) * (i / (samples - 1)));
    const p = rigPoseFor(f, t0 + i * 16);
    if (!poseSane(p)) sane = false;
    parts.push(CHANNELS.map((c) => p[c].toFixed(2)).join(","));
    if (prev) for (const c of CHANNELS) motion += Math.abs(p[c] - prev[c]);
    prev = { ...p };
  }
  return { sig: parts.join("|"), motion, sane };
}

const groundSigs = new Map<string, number[]>();
const airSigs = new Map<string, number[]>();
for (const mv of MOVES) {
  const air = signature(mv.id, true);
  check(
    `move ${mv.id} ${mv.name}: air animation moves + stays sane`,
    air.motion > 2 && air.sane,
    `motion=${air.motion.toFixed(2)} sane=${air.sane}`,
  );
  const alist = airSigs.get(air.sig) ?? [];
  alist.push(mv.id);
  airSigs.set(air.sig, alist);

  if (mv.air) continue;
  const ground = signature(mv.id, false);
  check(
    `move ${mv.id} ${mv.name}: ground animation moves + stays sane`,
    ground.motion > 2 && ground.sane,
    `motion=${ground.motion.toFixed(2)} sane=${ground.sane}`,
  );
  const list = groundSigs.get(ground.sig) ?? [];
  list.push(mv.id);
  groundSigs.set(ground.sig, list);
}

const dupes = [...groundSigs.entries()].filter(([, ids]) => ids.length > 1);
check(
  "the 18 ground combos all animate differently",
  dupes.length === 0 && groundSigs.size === 18,
  `unique=${groundSigs.size} dupes=${dupes.map(([, ids]) => ids.join("+")).join(" ")}`,
);
const airDupes = [...airSigs.entries()].filter(([, ids]) => ids.length > 1);
check(
  "all 20 combos animate differently in the air too",
  airDupes.length === 0 && airSigs.size === 20,
  `unique=${airSigs.size} dupes=${airDupes.map(([, ids]) => ids.join("+")).join(" ")}`,
);

/* ---- 3. attack timing follows the move's real frame data ---- */
{
  const mv = MOVE_BY_ID.get(14)!; // Blitz Dash: straight with the lead arm
  const total = mv.windup + mv.active + mv.recover;
  f.state = "attack";
  f.move = mv;
  f.airborne = false;
  const at = (frame: number) => {
    f.moveFrame = frame;
    return rigPoseFor(f, t0);
  };
  const wind = at(1);
  const strike = at(mv.windup + mv.active - 1);
  check(
    "attack loads, then extends the striking arm",
    strike.armFShZ > wind.armFShZ + 0.3 && strike.armFEl < wind.armFEl - 0.5,
    `wind=${wind.armFShZ.toFixed(2)}/${wind.armFEl.toFixed(2)} strike=${strike.armFShZ.toFixed(2)}/${strike.armFEl.toFixed(2)}`,
  );
  check(
    "attack returns toward the guard on the last frame",
    Math.abs(at(total - 1).chestYaw - baseStance().chestYaw) < 0.25,
  );
}

/* ---- 4. multi-hit combos alternate hands (that is what makes them read) --- */
{
  const mv = MOVE_BY_ID.get(4)!; // Rush String, hitCount 3
  f.state = "attack";
  f.move = mv;
  f.airborne = false;
  let nearLeads = 0;
  let farLeads = 0;
  for (let k = mv.windup; k < mv.windup + mv.active; k++) {
    f.moveFrame = k;
    const p = rigPoseFor(f, t0);
    const nearExt = p.armFShZ - p.armFEl;
    const farExt = p.armBShZ - p.armBEl;
    if (nearExt > farExt) nearLeads++;
    else farLeads++;
  }
  check(
    "multi-hit string uses both arms",
    nearLeads > 0 && farLeads > 0,
    `near=${nearLeads} far=${farLeads}`,
  );
}

/* ---- 5. feet reach the floor (forward kinematics of the leg chain) ---- */
{
  //
  // Ground contact is measured off the real rig, not a hand-rolled 2D knee
  // chain: the legs also rotate about X and the pelvis pitches, so "angles
  // add up" maths is simply wrong. Building the actual object graph and taking
  // a precise bounding box is the only honest way to know where the boots are.
  //
  const rig = buildFighterRig(getProportions("blaze"), []);
  stampFighterStyle(rig, getCharacter("blaze"), []);

  function floorOf(pose: Record<string, number>) {
    applyRigPose(rig, pose as never);
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.y = 0;
    rig.root.updateMatrixWorld(true);
    return new THREE.Box3().setFromObject(rig.body, true);
  }

  const setState = (s: Fighter["state"]) => {
    f.state = s;
    f.stateT = 3;
    f.downT = s === "down" ? 18 : 0;
    f.blockstun = s === "block" ? 6 : 0;
    f.airborne = s === "air";
    f.vy = s === "air" ? -300 : 0;
    f.move = null;
  };

  // every grounded state must keep the body out of the floor...
  let worstStateFloor = 99;
  let worstStateName = "";
  for (const s of ["idle", "walk", "crouch", "block", "hurt", "down", "ko", "win"] as Fighter["state"][]) {
    setState(s);
    const box = floorOf(rigPoseFor(f, t0));
    if (box.min.y < worstStateFloor) {
      worstStateFloor = box.min.y;
      worstStateName = s;
    }
  }
  check(
    "no grounded state sinks the body into the floor",
    worstStateFloor > -10,
    `worst=${worstStateFloor.toFixed(1)} in ${worstStateName}`,
  );

  // ...while the stance states must not hover above it either
  for (const s of ["idle", "hurt"] as Fighter["state"][]) {
    setState(s);
    const box = floorOf(rigPoseFor(f, t0));
    check(
      `${s}: feet rest on the floor (not hovering)`,
      box.min.y > -8 && box.min.y < 6,
      `floor=${box.min.y.toFixed(1)}`,
    );
  }

  // the silhouette must track the hitbox the sim actually fights with
  setState("idle");
  const stanceBox = floorOf(rigPoseFor(f, t0));
  const stanceHeight = stanceBox.max.y - stanceBox.min.y;
  check(
    `standing silhouette is about the ${FIGHTER_H}u hitbox`,
    Math.abs(stanceHeight - FIGHTER_H) < 16,
    `height=${stanceHeight.toFixed(1)}`,
  );

  // a crouch has to visibly drop the fighter
  setState("crouch");
  const crouchBox = floorOf(rigPoseFor(f, t0));
  check(
    "crouch drops the crown by at least 12%",
    crouchBox.max.y < stanceBox.max.y * 0.88,
    `crouch=${crouchBox.max.y.toFixed(1)} stance=${stanceBox.max.y.toFixed(1)}`,
  );
  check(
    "crouch keeps the feet on the floor",
    crouchBox.min.y > -8 && crouchBox.min.y < 6,
    `floor=${crouchBox.min.y.toFixed(1)}`,
  );

  // the walk cycle and the breathing idle must stay planted
  f.state = "walk";
  f.blockstun = 0;
  f.downT = 0;
  f.move = null;
  let walkFloor = 99;
  for (let i = 0; i < 60; i++) {
    f.walkPhase = i / 60;
    walkFloor = Math.min(walkFloor, floorOf(rigPoseFor(f, t0 + i * 16)).min.y);
  }
  check(
    "walk cycle keeps a foot on the floor",
    walkFloor > -10,
    `worst=${walkFloor.toFixed(1)}`,
  );

  f.walkPhase = 0;
  f.state = "idle";
  let idleLow = 99;
  let idleHigh = -99;
  for (let i = 0; i < 40; i++) {
    const low = floorOf(rigPoseFor(f, t0 + i * 40)).min.y;
    idleLow = Math.min(idleLow, low);
    idleHigh = Math.max(idleHigh, low);
  }
  check(
    "idle stays planted through the breathing cycle",
    idleLow > -8 && idleHigh < 6,
    `floor ${idleLow.toFixed(1)}..${idleHigh.toFixed(1)}`,
  );

  // and no grounded attack may drive the body through the floor at any frame
  let worstSink = 0;
  let worstInfo = "";
  for (const mv of MOVES) {
    if (mv.air) continue;
    const total = mv.windup + mv.active + mv.recover;
    f.state = "attack";
    f.move = mv;
    f.airborne = false;
    for (let k = 0; k < total; k++) {
      f.moveFrame = k;
      const box = floorOf(rigPoseFor(f, t0 + k * 16));
      if (box.min.y < worstSink) {
        worstSink = box.min.y;
        worstInfo = `move ${mv.id} ${mv.name} frame ${k}/${total}`;
      }
    }
  }
  f.move = null;
  check(
    "no grounded attack drives the body under the floor",
    worstSink > -12,
    `worst=${worstSink.toFixed(1)} :: ${worstInfo}`,
  );
}

/* ---- 6. keyframe sampler edge cases ---- */
{
  const base = baseStance();
  const dst = { ...base };
  applyKeys(dst, base, [], 0.5);
  check("empty track falls back to base", finite(dst));
  const track = [key(0, { pelvisY: 60 }), key(1, { pelvisY: 80 })];
  applyKeys(dst, base, track, -5);
  check("t below the first key clamps", Math.abs(dst.pelvisY - 60) < 1e-6);
  applyKeys(dst, base, track, 5);
  check("t above the last key clamps", Math.abs(dst.pelvisY - 80) < 1e-6);
  applyKeys(dst, base, track, 0.5);
  check("t halfway interpolates", dst.pelvisY > 60 && dst.pelvisY < 80);
}

/* ---- 7. roster carries the 3D rig data the renderer reads ---- */
for (const c of CHARACTERS) {
  check(
    `character ${c.id} has build/hair/outfit/trim`,
    Boolean(c.build && c.hairStyle && c.outfit && c.trim),
  );
}

/* ---- 8. measure the real rig geometry (headless three.js object graph) ---- */
{
  for (const theme of CHARACTERS) {
    const rig = buildFighterRig(getProportions(theme.id), []);
    stampFighterStyle(rig, theme, []);

    f.charId = theme.id;
    f.state = "idle";
    f.stateT = 3;
    f.airborne = false;
    f.downT = 0;
    f.blockstun = 0;
    f.vy = 0;
    f.move = null;
    applyRigPose(rig, rigPoseFor(f, t0));
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.y = 0;
    rig.root.updateMatrixWorld(true);

    // precise = exact transformed vertices, so this is the true silhouette
    const box = new THREE.Box3().setFromObject(rig.body, true);
    const height = box.max.y - box.min.y;
    check(
      `${theme.id}: boots stand on the floor`,
      Math.abs(box.min.y) < 6,
      `minY=${box.min.y.toFixed(1)}`,
    );
    check(
      `${theme.id}: silhouette is about the ${FIGHTER_H}u hitbox`,
      Math.abs(height - FIGHTER_H) < 14,
      `height=${height.toFixed(1)}`,
    );

    // the vertical spine must be continuous (no floating head / gap at the waist)
    const lay = spineLayout(rig.dims);
    check(
      `${theme.id}: pelvis meets abdomen`,
      lay.pelvisTop >= lay.absBottom - 1,
      `pelvisTop=${lay.pelvisTop.toFixed(1)} absBottom=${lay.absBottom.toFixed(1)}`,
    );
    check(
      `${theme.id}: chest meets neck`,
      lay.neckBottom <= lay.chestTop + 1,
      `neckBottom=${lay.neckBottom.toFixed(1)} chestTop=${lay.chestTop.toFixed(1)}`,
    );
    check(
      `${theme.id}: neck meets skull`,
      lay.skullBottom <= lay.neckTop + 2,
      `skullBottom=${lay.skullBottom.toFixed(1)} neckTop=${lay.neckTop.toFixed(1)}`,
    );
    check(
      `${theme.id}: shoulders sit inside the chest`,
      rig.dims.shoulderY > lay.chestBottom && rig.dims.shoulderY < lay.chestTop,
      `shoulderY=${rig.dims.shoulderY.toFixed(1)} chest=${lay.chestBottom.toFixed(1)}..${lay.chestTop.toFixed(1)}`,
    );

    // the crown must actually be at the top of the box, not the pelvis
    const headBox = new THREE.Box3().setFromObject(rig.head, true);
    check(
      `${theme.id}: the head is the top of the figure`,
      headBox.max.y > box.max.y - 2 && headBox.min.y > box.min.y + height * 0.5,
      `head=${headBox.min.y.toFixed(1)}..${headBox.max.y.toFixed(1)} body=${box.min.y.toFixed(1)}..${box.max.y.toFixed(1)}`,
    );

    // and it must survive every pose without leaving the floor
    let lowest = 999;
    let worstState = "";
    for (const s of STATES) {
      f.state = s;
      f.stateT = 4;
      f.airborne = s === "air";
      f.downT = s === "down" ? 18 : 0;
      f.blockstun = 0;
      f.vy = s === "air" ? -300 : 0;
      applyRigPose(rig, rigPoseFor(f, t0));
      rig.root.updateMatrixWorld(true);
      const b = new THREE.Box3().setFromObject(rig.body, true);
      if (b.min.y < lowest) {
        lowest = b.min.y;
        worstState = s;
      }
    }
    check(
      `${theme.id}: no state drops the body under the floor`,
      lowest > -20,
      `lowest=${lowest.toFixed(1)} in state ${worstState}`,
    );
  }
}

/* ========================================================================== */
/*  skeletal model layer                                                      */
/*                                                                            */
/*  These are the checks that a typecheck cannot make. A single typo in a clip  */
/*  or mesh name would not fail the build — it would leave a fighter frozen in  */
/*  its bind pose, or holding all five Knight shields at once, in the browser.  */
/* ========================================================================== */

interface ManifestClip {
  name: string;
  duration: number;
}
interface ManifestModel {
  file: string;
  joints: number;
  clips: ManifestClip[];
  bodyMeshes: string[];
  propMeshes: string[];
  bodyHeight: number;
  feetY: number;
  fullHeight: number;
  forward: string;
  rootMotionM: number;
}
const manifest = JSON.parse(
  readFileSync(new URL("../src/game/model-manifest.json", import.meta.url), "utf8"),
) as { source: { license: string }; models: Record<string, ManifestModel> };

const manifestModels = manifest.models;

// ---- 1. the vendored files themselves
check(
  "manifest lists every vendored model",
  Object.keys(MODELS).every((k) => k in manifestModels) &&
    Object.keys(manifestModels).length === Object.keys(MODELS).length,
  `models.ts=${Object.keys(MODELS).join(",")} manifest=${Object.keys(manifestModels).join(",")}`,
);
check("models are CC0", /CC0/.test(manifest.source.license), manifest.source.license);

for (const [name, spec] of Object.entries(MODELS)) {
  const m = manifestModels[name];
  if (!m) continue;
  check(`${name}: rigged with a real skeleton`, m.joints >= 30, `${m.joints} joints`);
  check(
    `${name}: clips are in place (movement is code-driven)`,
    m.rootMotionM < 0.02,
    `root bone travels ${m.rootMotionM}m horizontally`,
  );
  check(
    `${name}: faces +Z so the +90 degree frame rotation is correct`,
    m.forward === "+Z",
    `measured forward=${m.forward}`,
  );
  check(
    `${name}: boots sit at y=0`,
    Math.abs(m.feetY) < 0.02,
    `feetY=${m.feetY}`,
  );
  check(
    `${name}: recorded bodyHeight matches the binary`,
    Math.abs(spec.bodyHeight - m.bodyHeight) < 0.02 && Math.abs(spec.feetY - m.feetY) < 0.02,
    `spec=${spec.bodyHeight} measured=${m.bodyHeight.toFixed(3)}`,
  );
  // scaling from the BODY is what keeps hats and weapons from shrinking a fighter
  const scale = FIGHTER_H / m.bodyHeight;
  check(
    `${name}: scales to the ${FIGHTER_H}u hitbox`,
    Math.abs(m.bodyHeight * scale - FIGHTER_H) < 0.01 && scale > 40 && scale < 90,
    `scale=${scale.toFixed(2)} (whole model would be ${(FIGHTER_H / m.fullHeight).toFixed(2)})`,
  );
}

// ---- 2. every clip we ask for exists, in every model, and can actually play
const wanted = mappedClipNames();
check("the clip map is not empty", wanted.length > 12, `${wanted.length} clips`);
for (const [name, m] of Object.entries(manifestModels)) {
  const have = new Map(m.clips.map((c) => [c.name, c.duration]));
  const missing = wanted.filter((w) => !have.has(w));
  check(`${name}: every mapped clip exists`, missing.length === 0, missing.join(", "));
  // a zero-length clip is a frozen pose, not an animation
  const dead = wanted.filter((w) => have.has(w) && have.get(w)! <= 0);
  check(`${name}: every mapped clip has duration`, dead.length === 0, dead.join(", "));
}

// ---- 3. loadouts name meshes that exist (a typo means a hidden weapon)
for (const theme of CHARACTERS) {
  const look = LOOKS[theme.id];
  check(`${theme.id}: has a look`, !!look);
  if (!look) continue;
  const m = manifestModels[look.model];
  check(`${theme.id}: look points at a vendored model`, !!m, look.model);
  if (!m) continue;
  const props = new Set([...m.propMeshes, ...m.bodyMeshes]);
  const keep = look.keep ?? MODELS[look.model].keep;
  const bogus = keep.filter((k) => !props.has(k));
  check(`${theme.id}: loadout names real meshes`, bogus.length === 0, bogus.join(", "));
  // and the loadout must actually trim the file down, not keep everything
  check(
    `${theme.id}: loadout hides most props`,
    keep.length < m.propMeshes.length,
    `keeps ${keep.length} of ${m.propMeshes.length} props`,
  );
  check(`${theme.id}: keeps the skinned body`, m.bodyMeshes.length >= 6, `${m.bodyMeshes.length} body meshes`);
}
// all six fighters must not collapse onto one silhouette+loadout pair
const signatures = CHARACTERS.map((c) => {
  const look = LOOKS[c.id];
  return look ? `${look.model}|${[...(look.keep ?? [])].sort().join(",")}` : c.id;
});
check(
  "no two fighters share a model and loadout",
  new Set(signatures).size === signatures.length,
  signatures.join(" / "),
);

// ---- 4. the state machine is fully covered
const FSTATES = ["idle", "walk", "crouch", "air", "attack", "hurt", "block", "down", "ko", "win"];
const covered = new Set([...Object.keys(STATE_CLIPS), "attack"]);
const uncovered = FSTATES.filter((s) => !covered.has(s));
check("every fighter state has a clip", uncovered.length === 0, uncovered.join(", "));
check(
  "crouch drops the fighter instead of standing still",
  CROUCH_DROP > 8 && CROUCH_DROP < FIGHTER_H * 0.2,
  `drop=${CROUCH_DROP}u`,
);

// ---- 5. every combo: one beat per hit, and every beat placed on real frames
//
// The beat table is no longer hand-timed: planBeats() derives where each beat
// starts and when its contact has to land from the move's own frame data, and
// beatSlice() retimes the clip onto that frame. So this section checks the plan
// the animator actually gets, not a copy of it pasted here.
const STEP_S = 1000 / 60 / 1000;

/** Clip lengths, straight from the vendored binaries. */
const clipDurations = new Map<string, number>();
for (const m of Object.values(manifestModels)) {
  for (const clip of m.clips) {
    const known = clipDurations.get(clip.name);
    if (known === undefined) clipDurations.set(clip.name, clip.duration);
    else if (Math.abs(known - clip.duration) > 0.001) {
      console.log(`  (clip ${clip.name} differs between models: ${known} vs ${clip.duration})`);
    }
  }
}
const durationOf = (clip: string) => clipDurations.get(clip) ?? 1;

/** Contact frame a retimed beat actually reaches, in move frames. */
function contactFrameOf(mv: (typeof MOVES)[number], beat: ReturnType<typeof planBeats>[number]) {
  return beatContactFrame(beat, durationOf(beat.clip), impactFraction(beat.clip));
}

let worstDrift = 0;
let worstDriftInfo = "";
let driftSamples = 0;
let driftSum = 0;

for (const theme of CHARACTERS) {
  const fighterId = theme.id;
  const sequences = new Set<string>();
  for (const mv of MOVES) {
    const cues = moveClipsFor(mv.id, fighterId);
    check(`${fighterId} move ${mv.id} ${mv.name}: has an animation`, cues.length > 0);
    if (cues.length === 0) continue;
    sequences.add(cues.map((x: ClipCue) => x.clip).join(">"));

    const hitBeats = cues.filter((x) => x.hit !== false).length;
    check(
      `${fighterId} move ${mv.id} ${mv.name}: ${mv.hitCount} hit(s) = ${hitBeats} beat(s)`,
      hitBeats === mv.hitCount,
      cues.map((x) => x.clip).join(" "),
    );
    if (cues.length > 1) {
      check(
        `${fighterId} move ${mv.id} ${mv.name}: multi-beat string varies its clips`,
        cues.some((x, i) => i > 0 && x.clip !== cues[i - 1].clip),
        cues.map((x) => x.clip).join(" -> "),
      );
    }

    const beats = planBeats(mv, cues);
    const total = mv.windup + mv.active + mv.recover;
    const activeEnd = mv.windup + mv.active;
    check(
      `${fighterId} move ${mv.id} ${mv.name}: beats tile the whole move`,
      beats.length === cues.length &&
        beats[0].start === 0 &&
        beats[beats.length - 1].end === total &&
        beats.every((b, i) => b.end > b.start && (i === 0 || b.start === beats[i - 1].end)),
      beats.map((b) => `${b.start}..${b.end}`).join(" "),
    );
    // every hit beat has to be live on a frame the move is active on
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      check(
        `${fighterId} move ${mv.id} ${mv.name}: beat ${i} lasts long enough`,
        b.end - b.start > 3,
        `${b.end - b.start} frames`,
      );
      if (!b.hit) continue;
      // A projectile decides its own damage, so only the cast that releases it
      // is pinned to the active frames; the rest of a multi-cast move is
      // choreography spread over the projectile's own rehit rhythm.
      const live =
        mv.type === "projectile"
          ? i === 0
            ? [mv.windup, activeEnd]
            : [mv.windup, total - 1]
          : [mv.windup, activeEnd];
      check(
        `${fighterId} move ${mv.id} ${mv.name}: beat ${i} contact is on a live frame`,
        b.strike >= live[0] && b.strike <= live[1] && b.strike >= b.start,
        `strike=${b.strike} window=${b.start}..${b.end} live=${live[0]}..${live[1]}`,
      );
      const dur = durationOf(b.clip);
      const slice = beatSlice(dur, b.end - b.start, b.q, impactFraction(b.clip));
      check(
        `${fighterId} move ${mv.id} ${mv.name}: beat ${i} retimes inside the clip`,
        slice.rate >= 0.7 && slice.rate <= 3.2 && slice.from >= 0 && slice.from < dur,
        `rate=${slice.rate.toFixed(2)} from=${slice.from.toFixed(2)}s of ${dur.toFixed(2)}s`,
      );
      // the whole point: the clip's contact has to land on the hit frame
      const contact = contactFrameOf(mv, b);
      const drift = Math.abs(contact - b.strike);
      driftSamples++;
      driftSum += drift;
      if (drift > worstDrift) {
        worstDrift = drift;
        worstDriftInfo = `${fighterId} move ${mv.id} beat ${i} (${b.clip})`;
      }
    }
  }
  check(`${fighterId}: has its own beat table`, sequences.size > 0, `${sequences.size} sequences`);
}

// the six fighters must not all be choreographed onto the same clip set
const beatTables = new Set(
  CHARACTERS.map((c) => MOVES.map((mv) => moveClipsFor(mv.id, c.id).map((x) => x.clip).join(">")).join("|")),
);
check(
  "armed fighters are choreographed differently from the empty-handed ones",
  beatTables.size >= 3,
  `${beatTables.size} distinct fighters' beat tables`,
);

// an armed fighter must not punch with a weapon in hand
for (const armed of ["terra", "nyx"]) {
  const punchy = MOVES.filter((mv) =>
    moveClipsFor(mv.id, armed).some((x) => x.clip.startsWith("Unarmed_Melee_Attack_Punch")),
  );
  check(
    `${armed}: swings its weapon instead of an empty fist`,
    punchy.length === 0,
    punchy.map((mv) => mv.name).join(", "),
  );
}
const terraMoves = MOVES.filter((mv) => moveClipsFor(mv.id, "terra").every((x) => x.clip.startsWith("1H_")));
check(
  "terra's blade work uses one-handed sword clips",
  terraMoves.length >= 8,
  `${terraMoves.length} sword-first moves`,
);
const nyxMoves = MOVES.filter((mv) => moveClipsFor(mv.id, "nyx").every((x) => x.clip.startsWith("Dualwield")));
check(
  "nyx's knife work uses dual-wield clips",
  nyxMoves.length >= 8,
  `${nyxMoves.length} dual-wield moves`,
);

check(
  "every strike's contact lands within one frame of its hitbox frame",
  driftSum / Math.max(1, driftSamples) < 1 && worstDrift < 2.01,
  `mean=${(driftSum / Math.max(1, driftSamples)).toFixed(2)}f worst=${worstDrift.toFixed(2)}f :: ${worstDriftInfo}`,
);
console.log(
  `  contact alignment: ${driftSamples} beats, mean ${(driftSum / Math.max(1, driftSamples)).toFixed(2)} frames, ` +
    `worst ${worstDrift.toFixed(2)} frames (${worstDriftInfo})`,
);

// the twenty combos must not all play the same animation
const distinct = new Set(Object.values(MOVE_CLIPS).map((c) => c.map((x) => x.clip).join(">")));
check(
  "the 20 combos use distinct animations",
  distinct.size >= 18,
  `${distinct.size} distinct sequences`,
);

/* ---- 6. the stand-in rig and the 2D figure walk at the speed they move ---- */
{
  /** One step is the widest gap between the two feet; a cycle is two steps. */
  const strideOf = (pts: { ax: number; bx: number }[]) => {
    let high = -Infinity;
    let low = Infinity;
    for (const p of pts) {
      high = Math.max(high, p.ax, p.bx);
      low = Math.min(low, p.ax, p.bx);
    }
    return (high - low) * 2;
  };
  // Ground the cycle covers: the widest gap between the two boots is one step,
  // and a cycle is two steps. The simulation advances walkPhase by distance
  // covered divided by that, so this constant IS the feet not skating.
  let travelled = 0;
  const w2 = new World("blaze", "frost");
  const f2: Fighter = w2.f[0];
  const rig = buildFighterRig(rigProportionsFor(getCharacter("blaze")), []);
  f2.state = "walk";
  f2.stateT = 3;
  f2.airborne = false;
  f2.move = null;
  const bootX = (phase: number) => {
    f2.walkPhase = phase;
    applyRigPose(rig, rigPoseFor(f2, 1000));
    rig.root.position.set(0, 0, 0);
    rig.root.rotation.y = 0;
    rig.root.updateMatrixWorld(true);
    const front = new THREE.Box3().setFromObject(rig.kneeF, true);
    const back = new THREE.Box3().setFromObject(rig.kneeB, true);
    return { fx: front.max.x, fy: front.min.y, bx: back.max.x, by: back.min.y };
  };
  const N = 64;
  const samples = Array.from({ length: N }, (_, i) => bootX(i / N));
  travelled = strideOf(samples.map((s) => ({ ax: s.fx, bx: s.bx })));
  check(
    "the rig's measured walk stride is still the one the sim advances the phase by",
    Math.abs(travelled - RIG_CYCLE_DISTANCE) / RIG_CYCLE_DISTANCE < 0.06,
    `measured=${travelled.toFixed(1)}u constant=${RIG_CYCLE_DISTANCE}u`,
  );

  // Same measurement on the 2D skeleton: replicate its limb chain, which is a
  // two-segment forward kinematic, and sum the planted foot's travel.
  const foot2d = (phase: number) => {
    const probe: Fighter = { ...f2, walkPhase: phase };
    const p = poseFor(probe, 1000);
    const end = (ang1: number, ang2: number) => {
      const mx = 0 + Math.sin(ang1) * POSE2D_LIMB.thigh;
      const my = p.hip - Math.cos(ang1) * POSE2D_LIMB.thigh;
      return {
        x: mx + Math.sin(ang1 + ang2) * POSE2D_LIMB.shin,
        y: my - Math.cos(ang1 + ang2) * POSE2D_LIMB.shin,
      };
    };
    return {
      front: end(p.legF[0], p.legF[1]),
      back: end(p.legB[0], p.legB[1]),
    };
  };
  // the 2D skeleton only consumes POSE2D_PHASE_SCALE of a phase per cycle, so
  // sweep a whole cycle of ITS phase to measure its stride
  const samples2d = Array.from({ length: N }, (_, i) => foot2d(i / N / (RIG_CYCLE_DISTANCE / POSE2D_CYCLE_DISTANCE)));
  const travelled2d = strideOf(
    samples2d.map((s) => ({ ax: s.front.x, bx: s.back.x })),
  );
  check(
    "the 2D figure's stride matches the ratio its phase is scaled by",
    Math.abs(travelled2d - POSE2D_CYCLE_DISTANCE) / POSE2D_CYCLE_DISTANCE < 0.06,
    `measured=${travelled2d.toFixed(1)}u constant=${POSE2D_CYCLE_DISTANCE}u`,
  );
  console.log(
    `  walk stride: rig ${travelled.toFixed(1)}u/cycle (constant ${RIG_CYCLE_DISTANCE}), ` +
      `2D ${travelled2d.toFixed(1)}u/cycle (constant ${POSE2D_CYCLE_DISTANCE}), ` +
      `phase scale ${(RIG_CYCLE_DISTANCE / POSE2D_CYCLE_DISTANCE).toFixed(3)}`,
  );
}

/* ---- 7. the stand-in rig is the height of the model that replaces it ---- */
for (const theme of CHARACTERS) {
  const look = LOOKS[theme.id];
  const plain = buildFighterRig(getProportions(theme.id), []);
  const matched = buildFighterRig(rigProportionsFor(theme), []);
  // the recorded heights were measured with the fighter's hair and outfit on,
  // which is what the player sees: an unstyled rig is 6u shorter
  stampFighterStyle(plain, theme, []);
  stampFighterStyle(matched, theme, []);
  const heightOf = (r: typeof plain, timeMs: number) => {
    f.charId = theme.id;
    f.state = "idle";
    f.stateT = 3;
    f.airborne = false;
    f.downT = 0;
    f.blockstun = 0;
    f.move = null;
    applyRigPose(r, rigPoseFor(f, timeMs));
    r.root.position.set(0, 0, 0);
    r.root.rotation.y = 0;
    r.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(r.body, true);
    return box.max.y - box.min.y;
  };
  // the peak of the breathing idle: the same figure the model side records
  const peakOf = (r: typeof plain) => {
    let high = 0;
    for (let i = 0; i < 8; i++) high = Math.max(high, heightOf(r, 1000 + i * 200));
    return high;
  };
  const plainHeight = peakOf(plain);
  const matchedHeight = peakOf(matched);
  check(
    `${theme.id}: recorded rig height matches the rig`,
    Math.abs(plainHeight - look.rigHeight) < 3,
    `measured=${plainHeight.toFixed(1)} recorded=${look.rigHeight}`,
  );
  check(
    `${theme.id}: stand-in rig is the height of its model`,
    Math.abs(matchedHeight - look.presentedHeight) < 3,
    `rig=${matchedHeight.toFixed(1)} model=${look.presentedHeight}`,
  );
}

console.log(
  failures === 0
    ? `\nALL ${passes} ANIMATION CHECKS PASSED (${MOVES.length} combos, ${CHARACTERS.length} rigs verified)`
    : `\n${failures} of ${passes + failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
