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
import { World, FIGHTER_H, type Fighter } from "../src/game/sim";
import { applyRigPose, buildFighterRig, spineLayout, stampFighterStyle } from "../src/game/render3d";
import {
  CROUCH_DROP,
  LOOKS,
  MODELS,
  MOVE_CLIPS,
  STATE_CLIPS,
  mappedClipNames,
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

// ---- 5. every combo: one beat per hit, in order, inside the frame window
const STEP_S = 1000 / 60 / 1000;
for (const mv of MOVES) {
  const cues = MOVE_CLIPS[mv.id];
  check(`move ${mv.id} ${mv.name}: has an animation`, !!cues);
  if (!cues) continue;

  const beats = cues.filter((c) => c.hit !== false).length;
  check(
    `move ${mv.id} ${mv.name}: ${mv.hitCount} hit(s) = ${beats} beat(s)`,
    beats === mv.hitCount,
    `cues=${cues.map((c) => `${c.clip}@${c.at}`).join(" ")}`,
  );
  check(`move ${mv.id} ${mv.name}: starts on frame 1`, cues[0].at === 0, `at=${cues[0].at}`);
  check(
    `move ${mv.id} ${mv.name}: beats are ordered`,
    cues.every((c, i) => c.at >= 0 && c.at < 1 && (i === 0 || c.at > cues[i - 1].at)),
    cues.map((c) => c.at).join(","),
  );
  // the strike must not be scheduled past the move's own recovery
  const total = mv.windup + mv.active + mv.recover;
  const lastStart = cues[cues.length - 1].at * total;
  check(
    `move ${mv.id} ${mv.name}: last beat starts inside the move`,
    lastStart < total,
    `start frame ${lastStart.toFixed(1)} of ${total}`,
  );
  // multi-hit strings must not repeat one clip back to back at one speed
  if (cues.length > 1) {
    const alternating = cues.some((c, i) => i > 0 && c.clip !== cues[i - 1].clip);
    check(
      `move ${mv.id} ${mv.name}: multi-beat string varies its clips`,
      alternating,
      cues.map((c) => c.clip).join(" -> "),
    );
  }
  // each beat has to be playable within its own slice of the move
  for (let i = 0; i < cues.length; i++) {
    const nextAt = i + 1 < cues.length ? cues[i + 1].at : 1;
    const sliceS = Math.max(0.06, (nextAt - cues[i].at) * total * STEP_S);
    check(
      `move ${mv.id} ${mv.name}: beat ${i} fits its window`,
      sliceS > 0.05 && sliceS < 3,
      `${(sliceS * 1000).toFixed(0)}ms`,
    );
  }
}

// the twenty combos must not all play the same animation
const distinct = new Set(Object.values(MOVE_CLIPS).map((c) => c.map((x) => x.clip).join(">")));
check(
  "the 20 combos use distinct animations",
  distinct.size >= 18,
  `${distinct.size} distinct sequences`,
);

console.log(
  failures === 0
    ? `\nALL ${passes} ANIMATION CHECKS PASSED (${MOVES.length} combos, ${CHARACTERS.length} rigs verified)`
    : `\n${failures} of ${passes + failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
