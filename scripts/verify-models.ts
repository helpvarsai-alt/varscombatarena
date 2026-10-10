/**
 * Skinned-model verification — run with `bun run verify:models`.
 *
 * scripts/verify-animation.ts covers the procedural rig. This one covers the
 * real .glb characters, and it deliberately uses the SAME code path the browser
 * does: load the vendored file, hand the parsed glTF to buildFighterModel(), then
 * measure what came out. Nothing here reimplements the loader, so the numbers
 * below are the numbers a phone would get.
 *
 * Textures are stripped from the glTF before parsing — GLTFLoader decodes them
 * through the DOM, which Node does not have, and no geometry, skin or animation
 * depends on them. Everything else (skeleton, skinning, clips) is untouched.
 *
 * What this catches that a typecheck cannot:
 *   - a fighter that never moves because the mixer was never advanced
 *   - a clip name that silently resolves to nothing
 *   - scale/ground bugs (feet floating or sunk into the arena floor)
 *   - a loadout that leaves every weapon in the file visible at once
 */
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  MODELS,
  LOOKS,
  MOVE_CLIPS,
  buildFighterModel,
  mappedClipNames,
  updateFighterModel,
  type FighterModel,
} from "../src/game/models";
import { CHARACTERS, getCharacter } from "../src/game/characters";
import { FIGHTER_H, World, type Fighter } from "../src/game/sim";
import { MOVE_BY_ID } from "../src/game/combos";

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

/* -------------------------------------------------------------------------- */
/*  glb reading                                                               */
/* -------------------------------------------------------------------------- */

const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

function parseGlb(path: string) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== GLB_MAGIC)
    throw new Error(`${path} is not a glb`);
  let offset = 12;
  let json: Record<string, unknown> | null = null;
  let bin: Buffer = Buffer.alloc(0);
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === CHUNK_JSON) json = JSON.parse(data.toString("utf8"));
    else if (type === CHUNK_BIN) bin = data;
    offset += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error(`no JSON chunk in ${path}`);
  return { json, bin };
}

/** Re-pack the glb without images/textures so GLTFLoader needs no DOM. */
function stripTextures(
  json: Record<string, unknown>,
  bin: Buffer,
): ArrayBuffer {
  const g = JSON.parse(JSON.stringify(json));
  delete g.images;
  delete g.samplers;
  delete g.textures;
  for (const mat of (g.materials ?? []) as Record<string, unknown>[]) {
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
    const pbr = mat.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) delete pbr.baseColorTexture;
    if (pbr) delete pbr.metallicRoughnessTexture;
  }

  const jsonBytes = Buffer.from(JSON.stringify(g), "utf8");
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)]);

  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(total);
  out.writeUInt32LE(GLB_MAGIC, 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonChunk.length, 12);
  out.writeUInt32LE(CHUNK_JSON, 16);
  jsonChunk.copy(out, 20);
  const binStart = 20 + jsonChunk.length;
  out.writeUInt32LE(binChunk.length, binStart);
  out.writeUInt32LE(CHUNK_BIN, binStart + 4);
  binChunk.copy(out, binStart + 8);
  return out.buffer.slice(
    out.byteOffset,
    out.byteOffset + out.byteLength,
  ) as ArrayBuffer;
}

const loader = new GLTFLoader();
/**
 * Parse a fresh graph every time, exactly as loadFighterModel does (one fetch
 * and one parse per fighter). Sharing a cached graph would share the Skeleton
 * between fighters — Object3D.clone() copies the mesh but keeps the original's
 * skeleton, which silently cross-wires two characters' bones.
 */
function parseModel(file: string) {
  const { json, bin } = parseGlb(`public/models/${file}.glb`);
  const glb = stripTextures(json, bin);
  return loader.parseAsync(glb, "") as Promise<{
    scene: THREE.Object3D;
    animations: THREE.AnimationClip[];
  }>;
}

/* -------------------------------------------------------------------------- */
/*  measurement                                                               */
/* -------------------------------------------------------------------------- */

const SIGNATURE_STRIDE = 7; // a few hundred vertices per mesh is plenty

/**
 * True skinned bounds. Box3.setFromObject() on a SkinnedMesh returns the bind
 * pose, so walk the vertices through the bone matrices instead — this is the
 * silhouette the player actually sees.
 */
/**
 * Measure a model inside a neutral frame, which is exactly the space the
 * renderer parents it in: fighter units, feet at y = 0, facing +X.
 */
function posedBounds(model: FighterModel) {
  const frame = new THREE.Group();
  frame.add(model.root);
  frame.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const scene = model.root.children[0];
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh || !mesh.visible) return;
    // the renderer refreshes bone matrices during render; do it by hand here
    if (mesh.isSkinnedMesh) mesh.skeleton.update();
    const pos = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += SIGNATURE_STRIDE) {
      v.fromBufferAttribute(pos, i);
      // Box3.setFromObject would return the bind pose here; this walks the
      // actual bone matrices, so it is the silhouette on screen
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      box.expandByPoint(v);
    }
  });
  frame.remove(model.root);
  return box;
}

/** A numeric fingerprint of the whole skeleton, for "did it actually move" tests. */
function poseSignature(model: FighterModel) {
  const parts: number[] = [];
  const scene = model.root.children[0];
  scene.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    parts.push(
      o.quaternion.x,
      o.quaternion.y,
      o.quaternion.z,
      o.quaternion.w,
      o.position.y,
    );
  });
  return parts.map((n) => n.toFixed(4)).join(",");
}

function signatureDistance(a: string, b: string) {
  const x = a.split(",").map(Number);
  const y = b.split(",").map(Number);
  if (x.length !== y.length) return Infinity;
  let d = 0;
  for (let i = 0; i < x.length; i++) d += Math.abs(x[i] - y[i]);
  return d;
}

/* -------------------------------------------------------------------------- */
/*  per-fighter checks                                                        */
/* -------------------------------------------------------------------------- */

async function verifyTheme(themeId: string) {
  const theme = getCharacter(themeId);
  const look = LOOKS[themeId];
  const spec = MODELS[look.model];
  const gltf = await parseModel(spec.file);
  const model = buildFighterModel(
    { scene: gltf.scene, animations: gltf.animations },
    theme,
    spec,
  );

  const label = `${themeId}/${spec.file}`;

  // ---- loadout: exactly the skinned body plus the chosen props
  const visibleProps: string[] = [];
  const bodyMeshes: string[] = [];
  const bodyPart =
    /_(Body|Head|Head_Hooded|ArmLeft|ArmRight|LegLeft|LegRight)$/;
  model.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    if (bodyPart.test(mesh.name)) bodyMeshes.push(mesh.name);
    else visibleProps.push(mesh.name);
  });
  const keep = [...(look.keep ?? spec.keep)].sort();
  check(
    `${label}: shows exactly its loadout`,
    visibleProps.sort().join(",") === keep.join(","),
    `visible=[${visibleProps.join(",")}] wanted=[${keep.join(",")}]`,
  );
  check(
    `${label}: body meshes present`,
    bodyMeshes.length >= 6,
    `${bodyMeshes.length} of 6`,
  );

  // ---- placement: feet on the floor, height around the hitbox
  model.mixer.setTime(0.5); // settle into the idle
  const box = posedBounds(model);
  const height = box.max.y - box.min.y;
  check(
    `${label}: boots land on the floor`,
    Math.abs(box.min.y) < 4,
    `feet y=${box.min.y.toFixed(2)} of ${FIGHTER_H}u fighter`,
  );
  check(
    `${label}: stands about ${FIGHTER_H}u tall`,
    height > FIGHTER_H * 0.82 && height < FIGHTER_H * 1.06,
    `height=${height.toFixed(1)} (scale ${model.root.scale.x.toFixed(2)})`,
  );
  check(
    `${label}: is centred in front of its own origin`,
    Math.abs((box.min.x + box.max.x) / 2) < FIGHTER_H * 0.2,
    `x centre=${((box.min.x + box.max.x) / 2).toFixed(1)}`,
  );

  // ---- the skeleton is humanoid and actually animates
  const bones: string[] = [];
  model.root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o.name);
  });
  check(
    `${label}: humanoid skeleton`,
    bones.length >= 30,
    `${bones.length} bones`,
  );
  // three.js sanitises glTF node names (hand.l -> handl), so compare loosely
  const normalised = new Set(
    bones.map((b) => b.replace(/[.\s_]/g, "").toLowerCase()),
  );
  const anchors = ["root", "hips", "head", "handl", "handr", "footl", "footr"];
  check(
    `${label}: has the usual anchor joints`,
    anchors.every((b) => normalised.has(b)),
    `bone names: ${bones.slice(0, 8).join(",")}`,
  );
  console.log(
    `  ${themeId.padEnd(6)} ${spec.file.padEnd(16)} ${height.toFixed(0).padStart(3)}u tall  ` +
      `feet ${box.min.y.toFixed(1).padStart(5)}u  scale ${model.root.scale.x.toFixed(2)}  ` +
      `props [${visibleProps.join(",")}]  ${bones.length} bones  ${model.actions.size} playable clips`,
  );

  const before = poseSignature(model);
  model.mixer.update(0.3);
  const after = poseSignature(model);
  check(
    `${label}: the idle skeleton animates`,
    signatureDistance(before, after) > 0.02,
    `delta=${signatureDistance(before, after).toFixed(4)}`,
  ); // ---- every clip the game can ask for exists, plays and moves the skeleton
  // (mappedClipNames() is the union of combo beats and state clips)
  const wanted = mappedClipNames();
  for (const clipName of wanted) {
    const action = model.actions.get(clipName);
    if (!action) {
      check(`${label}: clip ${clipName} loads`, false, "missing from the file");
      continue;
    }
    model.mixer.stopAllAction();
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.setEffectiveWeight(1);
    action.play();
    const samples: string[] = [];
    for (let i = 0; i < 4; i++) {
      model.mixer.update(0.12);
      samples.push(poseSignature(model));
    }
    const moved = samples.some(
      (s, i) => i > 0 && signatureDistance(s, samples[i - 1]) > 0.01,
    );
    const distinct =
      signatureDistance(samples[0], samples[samples.length - 1]) > 0.01;
    check(
      `${label}: ${clipName} animates the skeleton`,
      moved && distinct,
      `start->end delta=${signatureDistance(samples[0], samples[samples.length - 1]).toFixed(4)}`,
    );
  }

  return model;
}

/* -------------------------------------------------------------------------- */
/*  the real integration, frame by frame                                      */
/* -------------------------------------------------------------------------- */

function verifyDriveLoop(model: FighterModel, themeId: string) {
  const world = new World(themeId, themeId === "blaze" ? "frost" : "blaze");
  const f: Fighter = world.f[0];

  // every non-attack state must resolve to the clip it maps to
  const expectedStateClips: Record<string, string> = {
    idle: "Unarmed_Idle",
    walk: "Walking_A",
    crouch: "Blocking",
    air: "Jump_Idle",
    hurt: "Hit_A",
    block: "Blocking",
    down: "Lie_Down",
    ko: "Death_A",
    win: "Cheer",
  };
  for (const [state, clip] of Object.entries(expectedStateClips)) {
    f.state = state as Fighter["state"];
    f.move = null;
    f.vx = 200;
    f.facing = 1;
    updateFighterModel(model, f, 1 / 60);
    check(
      `${themeId}: state ${state} plays ${clip}`,
      model.current?.getClip().name === clip,
      `got ${model.current?.getClip().name ?? "none"}`,
    );
  }

  // walk: the clip must be a locomotion clip and the skeleton must step
  f.state = "walk";
  f.vx = 200;
  f.facing = 1;
  const walkSig: string[] = [];
  for (let i = 0; i < 8; i++) {
    updateFighterModel(model, f, 1 / 60);
    walkSig.push(poseSignature(model));
  }
  check(
    `${themeId}: walk advances the skeleton`,
    signatureDistance(walkSig[0], walkSig[7]) > 0.02,
    `delta=${signatureDistance(walkSig[0], walkSig[7]).toFixed(4)}`,
  );
  check(
    `${themeId}: walking forward picks the forward clip`,
    model.current?.getClip().name === "Walking_A",
    model.current?.getClip().name ?? "none",
  );
  f.vx = -200;
  updateFighterModel(model, f, 1 / 60);
  check(
    `${themeId}: walking backwards picks the backpedal clip`,
    model.current?.getClip().name === "Walking_Backwards",
    model.current?.getClip().name ?? "none",
  );

  // crouch: the frame drops and comes back
  f.state = "crouch";
  f.vx = 0;
  for (let i = 0; i < 60; i++) updateFighterModel(model, f, 1 / 60);
  const crouched = model.root.position.y;
  check(
    `${themeId}: crouch lowers the fighter`,
    crouched < -12,
    `y=${crouched.toFixed(1)}`,
  );
  f.state = "idle";
  for (let i = 0; i < 60; i++) updateFighterModel(model, f, 1 / 60);
  check(
    `${themeId}: standing back up restores the height`,
    Math.abs(model.root.position.y) < 1,
    `y=${model.root.position.y.toFixed(2)}`,
  );

  // a full ultimate, frame by frame: every beat must fire, in order, and move
  const mv = MOVE_BY_ID.get(19)!;
  const total = mv.windup + mv.active + mv.recover;
  f.state = "attack";
  f.move = mv;
  const seen: string[] = [];
  const sigs: string[] = [];
  for (let frame = 0; frame < total; frame++) {
    f.moveFrame = frame;
    updateFighterModel(model, f, 1 / 60);
    const name = model.current?.getClip().name ?? "";
    if (seen[seen.length - 1] !== name) seen.push(name);
    sigs.push(poseSignature(model));
  }
  const expected = [...new Set(MOVE_CLIPS[19].map((c) => c.clip))];
  const got = [...new Set(seen)];
  check(
    `${themeId}: Ultimate Surge plays every beat in order`,
    got.join(">") === expected.join(">"),
    `got [${got.join(">")}] want [${expected.join(">")}]`,
  );
  let movedFrames = 0;
  for (let i = 1; i < sigs.length; i++) {
    if (signatureDistance(sigs[i], sigs[i - 1]) > 0.002) movedFrames++;
  }
  check(
    `${themeId}: the ultimate animates on almost every frame`,
    movedFrames >= total - 3,
    `${movedFrames} of ${total} frames moved`,
  );

  // and the fighter must not still be swinging after recovery
  f.state = "idle";
  f.move = null;
  for (let i = 0; i < 4; i++) updateFighterModel(model, f, 1 / 60);
  check(
    `${themeId}: returns to the idle clip after the combo`,
    model.current?.getClip().name === "Unarmed_Idle",
    model.current?.getClip().name ?? "none",
  );

  // no zero-weight actions pile up across a long combo sequence
  const live = [...model.actions.values()].filter(
    (a) => a.isRunning() && a.getEffectiveWeight() > 0.01,
  );
  check(
    `${themeId}: few actions run at once`,
    live.length <= 3,
    `${live.length} active actions`,
  );
}

/* -------------------------------------------------------------------------- */

const models = new Map<string, FighterModel>();
for (const theme of CHARACTERS) {
  const model = await verifyTheme(theme.id);
  models.set(theme.id, model);
}

// the two fighters sharing the Knight must still look different
const terra = models.get("terra")!;
const tide = models.get("tide")!;
const propsOf = (m: FighterModel) => {
  const out: string[] = [];
  m.root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const bodyPart =
      /_(Body|Head|Head_Hooded|ArmLeft|ArmRight|LegLeft|LegRight)$/;
    if (mesh.isMesh && mesh.visible && !bodyPart.test(mesh.name))
      out.push(mesh.name);
  });
  return out.sort().join(",");
};
check(
  "terra and tide are visually distinct despite sharing a model",
  propsOf(terra) !== propsOf(tide),
  `terra=[${propsOf(terra)}] tide=[${propsOf(tide)}]`,
);

// A mirror match: two fighters on the same model must be fully independent
// instances. loadFighterModel caches on (slot, character) precisely because
// sharing one instance would leave a fighter with no model at all — an Object3D
// has one parent and a skeleton belongs to one scene graph.
const mirrorGltf = await parseModel(MODELS[LOOKS.blaze.model].file);
const mirrorA = buildFighterModel(
  { scene: mirrorGltf.scene, animations: mirrorGltf.animations },
  getCharacter("blaze"),
  MODELS[LOOKS.blaze.model],
);
const mirrorB = buildFighterModel(
  await parseModel(MODELS[LOOKS.blaze.model].file),
  getCharacter("blaze"),
  MODELS[LOOKS.blaze.model],
);
check(
  "a mirror match builds two independent models",
  mirrorA.root !== mirrorB.root && mirrorA.actions !== mirrorB.actions,
);
const bonesOf = (m: FighterModel) => {
  const out: THREE.Bone[] = [];
  m.root.traverse((o) => {
    if ((o as THREE.Bone).isBone) out.push(o as THREE.Bone);
  });
  return out;
};
const bonesA = bonesOf(mirrorA);
const bonesB = bonesOf(mirrorB);
check(
  "mirror-match skeletons are separate objects",
  bonesA.length > 0 && bonesB.length === bonesA.length && !bonesA.some((b) => bonesB.includes(b)),
  `${bonesA.length} vs ${bonesB.length} bones, shared=${bonesA.filter((b) => bonesB.includes(b)).length}`,
);

// drive a fighter that has already been through the clip sweep, like one
// mid-match: the animator must recover and take over cleanly
verifyDriveLoop(models.get("blaze")!, "blaze");

console.log(
  failures === 0
    ? `\nALL ${passes} MODEL CHECKS PASSED (${CHARACTERS.length} fighters, ${models.size} skinned builds)`
    : `\n${failures} of ${passes + failures} MODEL CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
