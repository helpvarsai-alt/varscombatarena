import * as THREE from "three";
import { MOVE_BY_ID } from "./combos";
import {
  getCharacter,
  getProportions,
  type CharacterTheme,
  type Proportions,
} from "./characters";
import { baseStance, rigPoseFor, type Pose3 } from "./animation";
import {
  disposeFighterModel,
  loadFighterModel,
  lookFor,
  modelsAvailable,
  MODELS,
  updateFighterModel,
  type FighterModel,
} from "./models";
import { STAGE, type Fighter, type FxEvent, type World } from "./sim";

/* ========================================================================== */
/*  three.js fight renderer                                                   */
/*                                                                            */
/*  Two layers of fighters. A procedural humanoid rig (pelvis / chest / head,   */
/*  two arms and two legs, every joint driven on three axes by the keyframe     */
/*  animation system) is built instantly at match start, so the first frame is  */
/*  playable and the game still works if the model files never arrive. Behind   */
/*  it, a rigged skinned model (41 bones, 76 clips) loads and takes over,       */
/*  driving the same clip-per-combo mapping through an AnimationMixer.          */
/*                                                                            */
/*  The rig itself (buildFighterRig / stampFighterStyle / applyRigPose) is     */
/*  pure three.js object-graph code with no WebGL, so its silhouette can be    */
/*  measured headlessly by scripts/verify-animation.ts.                        */
/*                                                                            */
/*  Mobile budget: no shadow maps (textured blob shadows), a fixed-size spark  */
/*  pool plus a soft dust pool, low-segment capsules/cylinders, a capped       */
/*  device pixel ratio and a lens that widens on tall screens.                 */
/* ========================================================================== */

type Disposable = { dispose(): void };

function track<T extends Disposable>(list: Disposable[], x: T): T {
  list.push(x);
  return x;
}

/* ------------------------------- particles -------------------------------- */

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  g: number;
  drag: number;
  r: number;
  gr: number;
  b: number;
}

interface Shockwave {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  max: number;
  base: number;
  grow: number;
}

interface CrowdMember {
  group: THREE.Group;
  base: number;
  phase: number;
}

const SPARK_POOL = 320;
const DUST_POOL = 200;

type Slotted = (Particle | undefined)[];

function emptySlots(n: number): Slotted {
  return new Array<Particle | undefined>(n).fill(undefined);
}

/* ------------------------------- textures -------------------------------- */

let texGlow: THREE.CanvasTexture | null = null;
let texDisc: THREE.CanvasTexture | null = null;
let texRing: THREE.CanvasTexture | null = null;
let texStar: THREE.CanvasTexture | null = null;
let texFloor: THREE.CanvasTexture | null = null;
let texSky: THREE.CanvasTexture | null = null;

function canvas(size: number) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  return c;
}

/** Soft radial falloff — aura sprites, dust points, light pools. */
export function radialTexture(soft: number) {
  const c = canvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 1, 64, 64, 63);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(soft, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  if (!texGlow) texGlow = radialTexture(0.34);
  return texGlow;
}

/** Dark-centred disc used for blob shadows. */
function discTexture() {
  if (texDisc) return texDisc;
  const c = canvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(0,0,0,0.9)");
  g.addColorStop(0.5, "rgba(0,0,0,0.55)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  texDisc = new THREE.CanvasTexture(c);
  texDisc.colorSpace = THREE.SRGBColorSpace;
  return texDisc;
}

/** Expanding shock ring. */
function ringTexture() {
  if (texRing) return texRing;
  const c = canvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 28, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,0)");
  g.addColorStop(0.58, "rgba(255,255,255,0.9)");
  g.addColorStop(0.82, "rgba(255,255,255,0.3)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  texRing = new THREE.CanvasTexture(c);
  texRing.colorSpace = THREE.SRGBColorSpace;
  return texRing;
}

/** Four-point impact star. */
function starTexture() {
  if (texStar) return texStar;
  const c = canvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 1, 64, 64, 60);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.26, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.globalCompositeOperation = "lighter";
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineCap = "round";
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    ctx.lineWidth = i % 2 === 0 ? 6 : 3.5;
    ctx.beginPath();
    ctx.moveTo(64, 64);
    ctx.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62);
    ctx.stroke();
  }
  texStar = new THREE.CanvasTexture(c);
  texStar.colorSpace = THREE.SRGBColorSpace;
  return texStar;
}

/** Arena floor plate: dark concrete with a lit grid. */
function floorTexture() {
  if (texFloor) return texFloor;
  const c = canvas(256);
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(128, 128, 8, 128, 128, 150);
  g.addColorStop(0, "#232a41");
  g.addColorStop(1, "#0b1020");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(120,190,255,0.17)";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const p = (i / 4) * 256;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, 256);
    ctx.moveTo(0, p);
    ctx.lineTo(256, p);
    ctx.stroke();
  }
  texFloor = new THREE.CanvasTexture(c);
  texFloor.wrapS = texFloor.wrapT = THREE.RepeatWrapping;
  texFloor.repeat.set(5, 3);
  texFloor.colorSpace = THREE.SRGBColorSpace;
  return texFloor;
}

/** Vertical sky gradient used as the scene background. */
function skyTexture() {
  if (texSky) return texSky;
  const c = canvas(128);
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, "#04050c");
  g.addColorStop(0.4, "#0a1124");
  g.addColorStop(0.72, "#1a1b3c");
  g.addColorStop(1, "#3c1f45");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  texSky = new THREE.CanvasTexture(c);
  texSky.colorSpace = THREE.SRGBColorSpace;
  return texSky;
}

/* ---------------------------------- rig ---------------------------------- */

export interface RigMats {
  suit: THREE.MeshStandardMaterial;
  pants: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  accent: THREE.MeshStandardMaterial;
  eye: THREE.MeshBasicMaterial;
}

export interface Dims {
  height: number;
  width: number;
  muscle: number;
  neckY: number;
  headY: number;
  shoulderY: number;
  shoulderZ: number;
  upperArm: number;
  foreArm: number;
  armR: number;
  thigh: number;
  shin: number;
  legR: number;
  hipZ: number;
  chestW: number;
  chestH: number;
  chestD: number;
  absW: number;
  absH: number;
  absD: number;
  pelvisW: number;
  pelvisH: number;
  pelvisD: number;
  headR: number;
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Group;
  chest: THREE.Group;
  head: THREE.Group;
  outfit: THREE.Group;
  hair: THREE.Group;
  shoulderF: THREE.Group;
  elbowF: THREE.Group;
  shoulderB: THREE.Group;
  elbowB: THREE.Group;
  hipF: THREE.Group;
  kneeF: THREE.Group;
  hipB: THREE.Group;
  kneeB: THREE.Group;
  glow: THREE.Sprite;
  ring: THREE.Mesh;
  shadow: THREE.Mesh;
  light: THREE.PointLight;
  mats: RigMats;
  dims: Dims;
  charId: string;
  pose: Pose3;
}

/** Base pelvis height (unscaled) the animation poses are authored against. */
export const BASE_PELVIS_Y = 72;

export function dimsFor(prop: Proportions): Dims {
  const { height: H, width: W, muscle: M, head } = prop;
  return {
    height: H,
    width: W,
    muscle: M,
    // the torso stack (pelvis -> abdomen -> chest -> neck -> crown) is laid
    // out so the crown lands at ~FIGHTER_H above the floor
    neckY: 44 * H,
    headY: 62 * H,
    shoulderY: 36 * H,
    shoulderZ: 13.6 * W,
    upperArm: 30 * H,
    foreArm: 28 * H,
    armR: 5.3 * M,
    // leg lengths chosen so the neutral stance plants the boots on the floor:
    // 36.5*cos(0.22) + (35.4 + 0.15*legR)*cos(-0.10) ~= BASE_PELVIS_Y
    thigh: 36.5 * H,
    shin: 35.4 * H,
    legR: 6.6 * M,
    hipZ: 7 * W,
    chestW: 28 * W,
    chestH: 24 * H,
    chestD: 17 * W,
    absW: 20 * W,
    absH: 14 * H,
    absD: 14.5 * W,
    pelvisW: 24 * W,
    pelvisH: 16 * H,
    pelvisD: 16.5 * W,
    headR: 12.6 * head,
  };
}

/** Where every anatomical mesh sits along the vertical spine. */
export function spineLayout(d: Dims) {
  return {
    pelvisBottom: -2,
    pelvisTop: d.pelvisH - 2,
    absBottom: 1,
    absTop: d.absH + 1,
    chestBottom: d.absH + 1,
    chestTop: d.chestH + d.absH + 1,
    neckBottom: d.neckY - 4.5,
    neckTop: d.neckY + 4.5,
    skullBottom: d.headY - d.headR * 1.14,
    crown: d.headY + d.headR * 1.14,
  };
}

/** Capsule that exactly spans `length` downward from its pivot. */
function segment(length: number, radius: number): [THREE.BufferGeometry, number] {
  const len = Math.max(radius * 2.02, length);
  return [new THREE.CapsuleGeometry(radius, len - radius * 2, 3, 9), -len / 2];
}

function makeRigMats(disposables: Disposable[]): RigMats {
  const std = (color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) =>
    track(
      disposables,
      new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.06, ...opts }),
    );
  return {
    suit: std(0x8899ff),
    pants: std(0x3b4a7a),
    skin: std(0xe8c39e, { roughness: 0.72 }),
    hair: std(0x2a2a33, { roughness: 0.85 }),
    trim: std(0xf0f0f5),
    accent: track(
      disposables,
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xffffff,
        emissiveIntensity: 1.1,
        roughness: 0.35,
        toneMapped: false,
      }),
    ),
    eye: track(
      disposables,
      new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    ),
  };
}

/**
 * Build one fighter's object graph. Pure three.js — no renderer, no canvas —
 * so it can be constructed and measured in a headless script.
 */
export function buildFighterRig(prop: Proportions, disposables: Disposable[]): Rig {
  const d = dimsFor(prop);
  const geo = <T extends THREE.BufferGeometry>(g: T) => track(disposables, g);
  const root = new THREE.Group();
  const body = new THREE.Group();
  const chest = new THREE.Group();
  const head = new THREE.Group();
  const outfit = new THREE.Group();
  const hair = new THREE.Group();
  root.add(body);
  body.add(chest);
  chest.add(head);
  chest.add(outfit);
  head.add(hair);
  // the head rides on top of the torso, not at the pelvis
  head.position.y = d.headY;

  const mats = makeRigMats(disposables);

  const add = (
    parent: THREE.Object3D,
    g: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };

  /* ---- pelvis ---- */
  add(
    body,
    geo(new THREE.CylinderGeometry(d.pelvisW / 2, d.pelvisW / 2.25, d.pelvisH, 10)),
    mats.pants,
    0,
    d.pelvisH / 2 - 2,
    0,
  );
  add(
    body,
    geo(new THREE.CylinderGeometry(d.pelvisW / 1.85, d.pelvisW / 1.85, 5, 10)),
    mats.trim,
    0,
    2,
    0,
  );

  /* ---- torso ---- */
  add(
    chest,
    geo(new THREE.CylinderGeometry(d.absW / 2, d.absW / 2.2, d.absH, 10)),
    mats.suit,
    0,
    d.absH / 2 + 1,
    0,
  );
  add(
    chest,
    geo(new THREE.CylinderGeometry(d.chestW / 2, d.chestW / 2.5, d.chestH, 12)),
    mats.suit,
    0,
    d.chestH / 2 + d.absH + 1,
    0,
  );
  const pecGeo = geo(new THREE.SphereGeometry(d.chestW / 3.1, 10, 8));
  const pecY = d.chestH * 0.8 + d.absH - 2;
  add(chest, pecGeo, mats.suit, d.chestW * 0.14, pecY, d.chestD * 0.24);
  add(chest, pecGeo, mats.suit, d.chestW * 0.14, pecY, -d.chestD * 0.24);
  add(
    chest,
    geo(new THREE.CylinderGeometry(4.2 * d.width, 5.4 * d.width, 9, 8)),
    mats.skin,
    0,
    d.neckY,
    0,
  );
  const deltGeo = geo(new THREE.SphereGeometry(d.armR * 1.5, 10, 8));
  add(chest, deltGeo, mats.suit, 0, d.shoulderY, d.shoulderZ);
  add(chest, deltGeo, mats.suit, 0, d.shoulderY, -d.shoulderZ);
  add(
    chest,
    geo(new THREE.BoxGeometry(2.6, d.chestH * 0.7, 5)),
    mats.accent,
    d.chestD * 0.42,
    d.chestH + d.absH * 0.4,
    0,
  );

  /* ---- head ---- */
  const skull = add(head, geo(new THREE.SphereGeometry(d.headR, 14, 12)), mats.skin, 0, 0, 0);
  skull.scale.set(1, 1.14, 1.04);
  add(
    head,
    geo(new THREE.BoxGeometry(d.headR * 0.95, d.headR * 0.7, d.headR * 1.16)),
    mats.skin,
    d.headR * 0.34,
    -d.headR * 0.62,
    0,
  );
  add(
    head,
    geo(new THREE.BoxGeometry(2.6, d.headR * 0.32, d.headR * 1.5)),
    mats.hair,
    d.headR * 0.94,
    d.headR * 0.32,
    0,
  );
  const eyeGeo = geo(new THREE.SphereGeometry(2.5, 8, 6));
  add(head, eyeGeo, mats.eye, d.headR * 0.9, d.headR * 0.03, d.headR * 0.42);
  add(head, eyeGeo, mats.eye, d.headR * 0.9, d.headR * 0.03, -d.headR * 0.42);

  /* ---- arms ---- */
  const buildArm = (far: boolean) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0, d.shoulderY, far ? -d.shoulderZ : d.shoulderZ);
    chest.add(shoulder);
    const [g1, y1] = segment(d.upperArm, d.armR);
    add(shoulder, geo(g1), mats.skin, 0, y1, 0);
    const elbow = new THREE.Group();
    elbow.position.y = -d.upperArm;
    shoulder.add(elbow);
    add(elbow, geo(new THREE.SphereGeometry(d.armR * 1.02, 8, 6)), mats.skin, 0, 0, 0);
    const [g2, y2] = segment(d.foreArm, d.armR * 0.86);
    add(elbow, geo(g2), mats.skin, 0, y2, 0);
    const glove = add(
      elbow,
      geo(new THREE.SphereGeometry(d.armR * 1.18, 10, 8)),
      mats.trim,
      0,
      -d.foreArm + d.armR * 0.2,
      0,
    );
    glove.scale.set(1.05, 1.18, 1.05);
    return { shoulder, elbow };
  };
  const armF = buildArm(false);
  const armB = buildArm(true);

  /* ---- legs ---- */
  const buildLeg = (far: boolean) => {
    const hip = new THREE.Group();
    hip.position.set(0, 0, far ? -d.hipZ : d.hipZ);
    body.add(hip);
    const [g1, y1] = segment(d.thigh, d.legR);
    add(hip, geo(g1), mats.pants, 0, y1, 0);
    const knee = new THREE.Group();
    knee.position.y = -d.thigh;
    hip.add(knee);
    add(knee, geo(new THREE.SphereGeometry(d.legR * 1.02, 8, 6)), mats.pants, 0, 0, 0);
    const [g2, y2] = segment(d.shin, d.legR * 0.84);
    add(knee, geo(g2), mats.pants, 0, y2, 0);
    add(
      knee,
      geo(new THREE.BoxGeometry(d.legR * 3, d.legR * 1.3, d.legR * 1.9)),
      mats.trim,
      d.legR * 0.5,
      -d.shin + d.legR * 0.5,
      0,
    );
    add(
      knee,
      // rounded toe cap sits flush with the sole (0.73 * r lifts it by exactly
      // the sphere's overhang) so thicker builds do not poke under the floor
      geo(new THREE.SphereGeometry(d.legR * 0.88, 8, 6)),
      mats.trim,
      d.legR * 2,
      -d.shin + d.legR * 0.73,
      0,
    );
    return { hip, knee };
  };
  const legF = buildLeg(false);
  const legB = buildLeg(true);

  /* ---- aura, ring, shadow, light ---- */
  const glow = new THREE.Sprite(
    track(
      disposables,
      new THREE.SpriteMaterial({
        map: glowTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );
  glow.scale.set(300, 300, 1);
  glow.position.y = 78;
  root.add(glow);

  const ring = new THREE.Mesh(
    geo(new THREE.TorusGeometry(56, 2.6, 6, 36)),
    track(
      disposables,
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.65,
        toneMapped: false,
      }),
    ),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 2;
  root.add(ring);

  const shadow = new THREE.Mesh(
    geo(new THREE.CircleGeometry(46, 20)),
    track(
      disposables,
      new THREE.MeshBasicMaterial({
        map: discTexture(),
        color: 0x000000,
        transparent: true,
        opacity: 0.65,
        depthWrite: false,
      }),
    ),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.8;
  root.add(shadow);

  const light = new THREE.PointLight(0xffffff, 0, 560, 2);
  light.position.y = 100;
  root.add(light);

  return {
    root,
    body,
    chest,
    head,
    outfit,
    hair,
    shoulderF: armF.shoulder,
    elbowF: armF.elbow,
    shoulderB: armB.shoulder,
    elbowB: armB.elbow,
    hipF: legF.hip,
    kneeF: legF.knee,
    hipB: legB.hip,
    kneeB: legB.knee,
    glow,
    ring,
    shadow,
    light,
    mats,
    dims: d,
    charId: "",
    pose: baseStance(),
  };
}

/** Rebuild hair + outfit for a character. Runs only on a character change. */
export function stampFighterStyle(
  rig: Rig,
  theme: CharacterTheme,
  disposables: Disposable[],
) {
  const d = rig.dims;
  const mats = rig.mats;
  for (const group of [rig.hair, rig.outfit]) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      child.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      group.remove(child);
    }
  }

  const geo = <T extends THREE.BufferGeometry>(g: T) => track(disposables, g);
  const put = (parent: THREE.Object3D, g: THREE.BufferGeometry, mat: THREE.Material) => {
    const m = new THREE.Mesh(g, mat);
    parent.add(m);
    return m;
  };
  const R = d.headR;

  switch (theme.hairStyle) {
    case "spike": {
      for (let i = 0; i < 6; i++) {
        const a = -0.9 + i * 0.36;
        const s = put(rig.hair, geo(new THREE.ConeGeometry(R * 0.44, R * 1.5, 6)), mats.hair);
        s.position.set(R * 0.2, R * 0.92, Math.sin(a) * R * 0.7);
        s.rotation.set(Math.cos(a) * 0.4, 0, -0.4 + Math.cos(a) * 0.2);
      }
      break;
    }
    case "mohawk": {
      for (let i = 0; i < 5; i++) {
        const s = put(
          rig.hair,
          geo(new THREE.ConeGeometry(R * 0.36, R * (1.7 - i * 0.1), 5)),
          mats.hair,
        );
        s.position.set(-R * 0.5 + i * R * 0.32, R * 1.05, 0);
        s.rotation.z = -0.18;
      }
      break;
    }
    case "long": {
      const cap = put(
        rig.hair,
        geo(new THREE.SphereGeometry(R * 1.06, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62)),
        mats.hair,
      );
      cap.position.y = R * 0.06;
      const back = put(
        rig.hair,
        geo(new THREE.CapsuleGeometry(R * 0.62, R * 1.7, 3, 8)),
        mats.hair,
      );
      back.position.set(-R * 0.72, -R * 0.5, 0);
      back.rotation.z = 0.24;
      for (const z of [-R * 0.74, R * 0.74]) {
        const side = put(
          rig.hair,
          geo(new THREE.CapsuleGeometry(R * 0.3, R * 1.5, 3, 7)),
          mats.hair,
        );
        side.position.set(-R * 0.1, -R * 0.78, z);
        side.rotation.z = 0.1;
      }
      break;
    }
    case "ponytail": {
      const cap = put(
        rig.hair,
        geo(new THREE.SphereGeometry(R * 1.05, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.6)),
        mats.hair,
      );
      cap.position.y = R * 0.05;
      const tail = put(
        rig.hair,
        geo(new THREE.CapsuleGeometry(R * 0.3, R * 2.2, 3, 7)),
        mats.hair,
      );
      tail.position.set(-R * 1.15, -R * 0.35, 0);
      tail.rotation.z = 0.85;
      break;
    }
    case "braid": {
      const cap = put(
        rig.hair,
        geo(new THREE.SphereGeometry(R * 1.04, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58)),
        mats.hair,
      );
      cap.position.y = R * 0.04;
      for (let i = 0; i < 4; i++) {
        const seg = put(
          rig.hair,
          geo(new THREE.SphereGeometry(R * (0.3 - i * 0.035), 8, 6)),
          mats.hair,
        );
        seg.position.set(-R * 0.95 - i * R * 0.16, -R * 0.3 - i * R * 0.34, 0);
      }
      break;
    }
    default: {
      const cap = put(
        rig.hair,
        geo(new THREE.SphereGeometry(R * 1.02, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5)),
        mats.hair,
      );
      cap.position.y = R * 0.02;
      break;
    }
  }

  const chestMidY = d.chestH + d.absH * 0.35;
  switch (theme.outfit) {
    case "gi": {
      const collar = put(
        rig.outfit,
        geo(new THREE.TorusGeometry(d.chestW * 0.42, 2.6, 6, 16, Math.PI * 1.2)),
        mats.trim,
      );
      collar.position.set(0, chestMidY + d.chestH * 0.42, 0);
      collar.rotation.set(Math.PI / 2, 0, 0);
      const knot = put(rig.outfit, geo(new THREE.SphereGeometry(4.6, 8, 6)), mats.trim);
      knot.position.set(d.pelvisD * 0.5, -1, 0);
      break;
    }
    case "coat": {
      for (const z of [-d.chestD * 0.5, d.chestD * 0.5]) {
        const tail = put(
          rig.outfit,
          geo(new THREE.BoxGeometry(6, d.chestH * 1.5, d.chestD * 0.42)),
          mats.suit,
        );
        tail.position.set(-d.chestD * 0.5, chestMidY - d.chestH * 0.5, z);
        tail.rotation.z = 0.08;
      }
      const collar = put(
        rig.outfit,
        geo(new THREE.TorusGeometry(d.chestW * 0.4, 3.2, 6, 16, Math.PI)),
        mats.trim,
      );
      collar.position.set(0, chestMidY + d.chestH * 0.45, 0);
      collar.rotation.set(Math.PI / 2, 0, 0);
      break;
    }
    case "hoodie": {
      const hood = put(rig.outfit, geo(new THREE.SphereGeometry(R * 1.4, 12, 9)), mats.suit);
      hood.scale.set(1, 0.9, 1.12);
      hood.position.set(-R * 0.55, d.headY * 0.82, 0);
      const pocket = put(
        rig.outfit,
        geo(new THREE.BoxGeometry(3, d.absH * 0.7, d.absW * 0.65)),
        mats.trim,
      );
      pocket.position.set(d.absD * 0.5, d.absH * 0.5, 0);
      break;
    }
    case "armor": {
      const plate = put(
        rig.outfit,
        geo(new THREE.BoxGeometry(d.chestD * 0.5, d.chestH * 0.8, d.chestW * 0.78)),
        mats.trim,
      );
      plate.position.set(d.chestD * 0.24, chestMidY + d.chestH * 0.3, 0);
      const padGeo = geo(new THREE.SphereGeometry(d.armR * 1.9, 10, 8));
      for (const z of [d.shoulderZ, -d.shoulderZ]) {
        const pad = put(rig.outfit, padGeo, mats.trim);
        pad.position.set(-1, d.shoulderY + 2, z);
        pad.scale.set(1, 0.8, 1);
      }
      break;
    }
    case "ninja": {
      const mask = put(
        rig.outfit,
        geo(new THREE.BoxGeometry(R * 0.9, R * 0.7, R * 1.3)),
        mats.suit,
      );
      mask.position.set(R * 0.5, d.headY - R * 0.55, 0);
      const sash = put(
        rig.outfit,
        geo(new THREE.BoxGeometry(3, d.chestH * 1.6, 5)),
        mats.trim,
      );
      sash.position.set(-d.chestD * 0.5, chestMidY - d.chestH * 0.4, d.chestD * 0.2);
      sash.rotation.z = 0.3;
      break;
    }
    default: {
      for (let i = 0; i < 3; i++) {
        const band = put(
          rig.outfit,
          geo(new THREE.CylinderGeometry(d.chestW / 2.05, d.chestW / 2.15, 3.4, 10)),
          mats.trim,
        );
        band.position.set(0, d.absH + i * 6.5, 0);
      }
      const sash = put(
        rig.outfit,
        geo(new THREE.BoxGeometry(4, 5, d.pelvisD * 1.1)),
        mats.trim,
      );
      sash.position.set(-d.pelvisD * 0.5, 0, 0);
      sash.rotation.z = 0.2;
      break;
    }
  }
}

/** Drive the skeleton from a pose. Pure maths — no materials, no FX. */
export function applyRigPose(rig: Rig, p: Pose3) {
  const d = rig.dims;
  rig.body.position.set(p.pelvisZ * d.width, p.pelvisY * d.height, 0);
  rig.body.rotation.set(
    p.pelvisPitch + p.rootPitch,
    p.pelvisYaw + p.rootYaw,
    p.pelvisRoll + p.rootRoll,
  );
  rig.chest.rotation.set(p.chestPitch, p.chestYaw, p.chestRoll);
  rig.head.rotation.set(p.headPitch, p.headYaw, p.headRoll);

  rig.shoulderF.rotation.set(p.armFShX, p.armFShY, p.armFShZ);
  rig.elbowF.rotation.set(0, 0, p.armFEl);
  rig.shoulderB.rotation.set(p.armBShX, p.armBShY, p.armBShZ);
  rig.elbowB.rotation.set(0, 0, p.armBEl);

  rig.hipF.rotation.set(p.legFHpX, p.legFHpY, p.legFHpZ);
  rig.kneeF.rotation.set(0, 0, p.legFKn);
  rig.hipB.rotation.set(p.legBHpX, p.legBHpY, p.legBHpZ);
  rig.kneeB.rotation.set(0, 0, p.legBKn);
}

/* ========================================================================== */
/*  renderer                                                                  */
/* ========================================================================== */

export class ThreeRenderer {
  canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(42, 1, 10, 6000);
  private rigs: [Rig, Rig];
  private crowd: CrowdMember[] = [];
  private sparks: Slotted = emptySlots(SPARK_POOL);
  private dust: Slotted = emptySlots(DUST_POOL);
  private sparkPos: Float32Array;
  private sparkCol: Float32Array;
  private sparkGeo = new THREE.BufferGeometry();
  private sparkIdx = 0;
  private dustPos: Float32Array;
  private dustCol: Float32Array;
  private dustGeo = new THREE.BufferGeometry();
  private dustIdx = 0;
  private waves: Shockwave[] = [];
  private flashes: Flash[] = [];
  private projMeshes = new Map<number, THREE.Group>();
  private models: (FighterModel | null)[] = [null, null];
  /** bumped whenever a slot's character changes, so late loads are discarded */
  private modelToken = [0, 0];
  private disposables: Disposable[] = [];
  private camX = 600;
  private camZ = 1200;
  private camY = 176;
  private zoom = 1;
  private w = 0;
  private h = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;";
    container.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: "high-performance",
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;

    this.scene.background = skyTexture();
    this.scene.fog = new THREE.Fog(0x0a1024, 1600, 3600);

    this.buildArena();

    // ---- sparks (additive energy) ----
    this.sparkPos = new Float32Array(SPARK_POOL * 3);
    this.sparkCol = new Float32Array(SPARK_POOL * 3);
    for (let i = 0; i < SPARK_POOL; i++) this.sparkPos[i * 3 + 1] = -99999;
    this.sparkGeo.setAttribute("position", new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute("color", new THREE.BufferAttribute(this.sparkCol, 3));
    const sparkMat = new THREE.PointsMaterial({
      size: 10,
      vertexColors: true,
      map: glowTexture(),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const sparks = new THREE.Points(this.sparkGeo, sparkMat);
    sparks.frustumCulled = false;
    this.scene.add(sparks);
    this.disposables.push(this.sparkGeo, sparkMat);

    // ---- dust / debris (soft, so it reads as matter rather than light) ----
    this.dustPos = new Float32Array(DUST_POOL * 3);
    this.dustCol = new Float32Array(DUST_POOL * 3);
    for (let i = 0; i < DUST_POOL; i++) this.dustPos[i * 3 + 1] = -99999;
    this.dustGeo.setAttribute("position", new THREE.BufferAttribute(this.dustPos, 3));
    this.dustGeo.setAttribute("color", new THREE.BufferAttribute(this.dustCol, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 40,
      vertexColors: true,
      map: glowTexture(),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const dust = new THREE.Points(this.dustGeo, dustMat);
    dust.frustumCulled = false;
    this.scene.add(dust);
    this.disposables.push(this.dustGeo, dustMat);

    this.rigs = [
      buildFighterRig(getProportions("blaze"), this.disposables),
      buildFighterRig(getProportions("frost"), this.disposables),
    ];
    this.rigs[0].root.position.x = -400;
    this.rigs[1].root.position.x = 400;
    this.scene.add(this.rigs[0].root, this.rigs[1].root);
  }

  /* -------------------------------- helpers -------------------------------- */

  private track<T extends Disposable>(x: T): T {
    return track(this.disposables, x);
  }

  private standard(color: number, opts: Partial<THREE.MeshStandardMaterialParameters> = {}) {
    return this.track(
      new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.06, ...opts }),
    );
  }

  private neon(color: number | string, opts: Partial<THREE.MeshBasicMaterialParameters> = {}) {
    return this.track(new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts }));
  }

  private spriteMat(texture: THREE.Texture, color: THREE.ColorRepresentation) {
    return this.track(
      new THREE.SpriteMaterial({
        map: texture,
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
  }

  /** Additive glow for a quad on the floor (a Mesh, not a Sprite). */
  private glowQuad(color: number, opacity: number) {
    return this.track(
      new THREE.MeshBasicMaterial({
        map: glowTexture(),
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
  }

  /* --------------------------------- arena --------------------------------- */

  private buildArena() {
    const center = (STAGE.minX + STAGE.maxX) / 2;
    const span = STAGE.maxX - STAGE.minX;

    let seed = 1337;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // floor
    const floorGeo = this.track(new THREE.PlaneGeometry(4600, 2400));
    const floorMat = this.standard(0xffffff, { roughness: 0.88, metalness: 0.14 });
    floorMat.map = floorTexture();
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(center, 0, 0);
    this.scene.add(floor);

    // raised fighting platform
    const platGeo = this.track(new THREE.BoxGeometry(span + 300, 16, 500));
    const plat = new THREE.Mesh(
      platGeo,
      this.standard(0x141a2d, { roughness: 0.5, metalness: 0.3 }),
    );
    plat.position.set(center, -8, 0);
    this.scene.add(plat);

    // neon rim
    const stripGeo = this.track(new THREE.BoxGeometry(span + 290, 3.6, 3.6));
    for (const z of [-246, 246]) {
      const strip = new THREE.Mesh(stripGeo, this.neon(0x4be3ff));
      strip.position.set(center, 2.6, z);
      this.scene.add(strip);
    }

    // corner posts
    const postGeo = this.track(new THREE.CylinderGeometry(5, 7, 170, 8));
    const postMat = this.standard(0x1d263c, { roughness: 0.45, metalness: 0.4 });
    for (let i = 0; i < 8; i++) {
      const x = center - (span + 220) / 2 + ((span + 220) / 7) * i;
      for (const z of [-252, 252]) {
        const post = new THREE.Mesh(postGeo, postMat);
        post.position.set(x, 78, z);
        this.scene.add(post);
      }
    }

    // LED back wall
    const wallGeo = this.track(new THREE.BoxGeometry(4600, 700, 18));
    const wall = new THREE.Mesh(wallGeo, this.standard(0x070b15, { roughness: 0.95 }));
    wall.position.set(center, 340, -560);
    this.scene.add(wall);

    const barGeo = this.track(new THREE.BoxGeometry(140, 9, 6));
    for (let i = -8; i <= 8; i++) {
      const c = i % 3 === 0 ? 0xff4fa3 : i % 3 === 1 ? 0x4be3ff : 0x9b6bff;
      const bar = new THREE.Mesh(barGeo, this.neon(c, { transparent: true, opacity: 0.9 }));
      bar.position.set(center + i * 220, 280 + ((i + 8) % 2) * 110, -546);
      this.scene.add(bar);
    }

    // distant skyline
    const towerGeo = this.track(new THREE.BoxGeometry(1, 1, 1));
    const towerMat = this.standard(0x0c1322, { roughness: 1 });
    for (let i = 0; i < 28; i++) {
      const wd = 130 + rnd() * 240;
      const hgt = 340 + rnd() * 900;
      const t = new THREE.Mesh(towerGeo, towerMat);
      t.scale.set(wd, hgt, 130 + rnd() * 150);
      t.position.set(center + (rnd() - 0.5) * 5600, hgt / 2 - 40, -820 - rnd() * 1000);
      this.scene.add(t);
    }

    // crowd silhouettes bobbing behind the platform
    const headGeo = this.track(new THREE.CapsuleGeometry(9, 22, 2, 6));
    const bodyGeo = this.track(new THREE.CapsuleGeometry(12, 16, 2, 6));
    const crowdMat = this.standard(0x080c18, { roughness: 1 });
    for (let i = 0; i < 28; i++) {
      const g = new THREE.Group();
      const bodyMesh = new THREE.Mesh(bodyGeo, crowdMat);
      bodyMesh.position.y = 12;
      const headMesh = new THREE.Mesh(headGeo, crowdMat);
      headMesh.rotation.z = 0.2;
      headMesh.position.y = 32;
      g.add(bodyMesh, headMesh);
      const x = center - 1000 + (2000 / 27) * i + (rnd() - 0.5) * 40;
      g.position.set(x, -16, -320 - rnd() * 100);
      this.scene.add(g);
      this.crowd.push({ group: g, base: g.position.y, phase: rnd() * 6.28 });
    }

    // light pools on the floor
    const poolGeo = this.track(new THREE.PlaneGeometry(360, 360));
    for (let i = -2; i <= 2; i++) {
      const pool = new THREE.Mesh(
        poolGeo,
        this.glowQuad(i % 2 === 0 ? 0x2f57b0 : 0x7a3aa8, 0.5),
      );
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(center + i * 480, 1.4, 0);
      this.scene.add(pool);
    }

    // lights
    this.scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x241436, 1.25));
    const keyLight = new THREE.DirectionalLight(0xfff2e2, 1.6);
    keyLight.position.set(center + 520, 940, 760);
    this.scene.add(keyLight);
    const rimA = new THREE.DirectionalLight(0xff6fbf, 0.9);
    rimA.position.set(center - 720, 330, -560);
    this.scene.add(rimA);
    const rimB = new THREE.DirectionalLight(0x5fd8ff, 0.75);
    rimB.position.set(center + 820, 270, -460);
    this.scene.add(rimB);
  }

  /* --------------------------------- resize -------------------------------- */

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.w, this.h, false);
    const aspect = this.w / this.h;
    this.camera.aspect = aspect;
    // widen the lens on tall screens so both fighters stay in frame
    this.camera.fov = aspect < 1 ? 40 + (1 - aspect) * 22 : 42;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    for (const w of this.waves) {
      w.mesh.geometry.dispose();
      (w.mesh.material as THREE.Material).dispose();
    }
    for (const f of this.flashes) {
      (f.sprite.material as THREE.Material).dispose();
    }
    for (const [, g] of this.projMeshes) this.disposeGroup(g);
    for (const m of this.models) if (m) disposeFighterModel(m);
    this.renderer.dispose();
    this.canvas.remove();
  }

  private disposeGroup(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = (o as unknown as { material?: THREE.Material }).material;
      if (mat) mat.dispose();
    });
  }

  /* ----------------------------------- fx ---------------------------------- */

  emitFx(e: FxEvent) {
    switch (e.type) {
      case "hit": {
        const mv = MOVE_BY_ID.get(e.move);
        const heavy = (mv?.dmg ?? 0) >= 10;
        this.spawnSparks(
          e.x,
          e.y,
          heavy ? 36 : 22,
          mv?.ultimate ? "#ffffff" : "#ffd166",
          heavy ? 580 : 400,
        );
        this.spawnDust(e.x, Math.max(8, e.y - 54), heavy ? 10 : 6, "#cbc4b6", 150);
        this.shockwave(e.x, e.y, mv?.ultimate ? 1.9 : heavy ? 1.32 : 0.95, "#ffd166");
        this.flash(
          e.x,
          e.y,
          mv?.ultimate ? 3.2 : heavy ? 2.2 : 1.5,
          mv?.ultimate ? "#ffffff" : "#ffe9a8",
        );
        break;
      }
      case "block": {
        this.spawnSparks(e.x, e.y, 14, "#9bd8ff", 300);
        this.shockwave(e.x, e.y, 0.62, "#9bd8ff");
        this.flash(e.x, e.y, 1.05, "#d8f0ff");
        break;
      }
      case "land": {
        this.spawnDust(e.x, 8, 16, "#9aa2b8", 240);
        this.spawnDust(e.x, 10, 8, "#717990", 190);
        break;
      }
      case "jump": {
        this.spawnDust(e.x, 6, 12, "#8b93a8", 200);
        break;
      }
      case "ko": {
        this.spawnSparks(e.x, e.y, 72, "#ffffff", 780);
        this.spawnDust(e.x, 10, 26, "#b7bfd4", 340);
        this.shockwave(e.x, e.y, 3.2, "#ffffff");
        this.flash(e.x, e.y, 5, "#ffffff");
        break;
      }
      case "ult": {
        this.spawnSparks(e.x, e.y, 64, "#fff2a8", 640);
        this.spawnDust(e.x, 10, 22, "#ffe6a8", 300);
        this.shockwave(e.x, e.y, 2.6, "#fff2a8");
        this.flash(e.x, e.y, 4.2, "#fff2a8");
        break;
      }
      default:
        break;
    }
  }

  private spawnSparks(x: number, y: number, n: number, color: string, speed: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.35 + Math.random() * 0.85);
      this.sparks[this.sparkIdx++ % SPARK_POOL] = {
        x,
        y,
        z: (Math.random() - 0.5) * 46,
        vx: Math.cos(a) * Math.cos(el) * s,
        vy: Math.sin(el) * s + 90,
        vz: Math.sin(a) * Math.cos(el) * s * 0.6,
        life: 1,
        max: 0.36 + Math.random() * 0.42,
        g: -520,
        drag: 0.965,
        r: c.r,
        gr: c.g,
        b: c.b,
      };
    }
  }

  private spawnDust(x: number, y: number, n: number, color: string, speed: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.dust[this.dustIdx++ % DUST_POOL] = {
        x: x + (Math.random() - 0.5) * 28,
        y: y + Math.random() * 16,
        z: (Math.random() - 0.5) * 40,
        vx: Math.cos(a) * s,
        vy: 40 + Math.random() * 130,
        vz: Math.sin(a) * s * 0.5,
        life: 1,
        max: 0.5 + Math.random() * 0.6,
        g: -140,
        drag: 0.93,
        r: c.r,
        gr: c.g,
        b: c.b,
      };
    }
  }

  private shockwave(x: number, y: number, grow: number, color: string) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(60, 60),
      new THREE.MeshBasicMaterial({
        map: ringTexture(),
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    mesh.position.set(x, y, 0);
    this.scene.add(mesh);
    this.waves.push({ mesh, life: 1, max: 0.42, grow: grow * 6 });
    if (this.waves.length > 20) {
      const old = this.waves.shift()!;
      this.scene.remove(old.mesh);
      old.mesh.geometry.dispose();
      (old.mesh.material as THREE.Material).dispose();
    }
  }

  private flash(x: number, y: number, scale: number, color: string) {
    const sprite = new THREE.Sprite(this.spriteMat(starTexture(), color));
    sprite.position.set(x, y, 4);
    const base = 70 * scale;
    sprite.scale.setScalar(base);
    this.scene.add(sprite);
    this.flashes.push({ sprite, life: 1, max: 0.22, base, grow: 1.1 });
    if (this.flashes.length > 16) {
      const old = this.flashes.shift()!;
      this.scene.remove(old.sprite);
      (old.sprite.material as THREE.Material).dispose();
    }
  }

  /* --------------------------------- render -------------------------------- */

  render(world: World, timeMs: number, dt: number) {
    const dtS = Math.min(0.05, dt / 1000);
    this.updateCamera(world, timeMs, dtS);

    for (let i = 0; i < 2; i++) {
      const f = world.f[i as 0 | 1];
      const rig = this.rigs[i];
      const theme = getCharacter(f.charId);
      if (rig.charId !== theme.id) {
        rig.charId = theme.id;
        this.applyTheme(rig, theme);
        stampFighterStyle(rig, theme, this.disposables);
        this.attachModel(i as 0 | 1, theme.id);
      }
      // keep sampling the keyframe pose even when a model is driving the
      // visuals: the aura, light and trail effects read from rig.pose
      rigPoseFor(f, timeMs, rig.pose);
      // a loaded model drives the skeleton; until then (and if the file never
      // arrives) the procedural rig poses itself exactly as before
      const model = this.models[i];
      if (model) updateFighterModel(model, f, dtS);
      else applyRigPose(rig, rig.pose);
      rig.body.visible = !model;
      this.applyPose(rig, rig.pose, f, theme, timeMs);
    }

    this.stepParticles(this.sparks, this.sparkPos, this.sparkCol, this.sparkGeo, dtS);
    this.stepParticles(this.dust, this.dustPos, this.dustCol, this.dustGeo, dtS);

    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      w.life -= dtS / w.max;
      if (w.life <= 0) {
        this.scene.remove(w.mesh);
        w.mesh.geometry.dispose();
        (w.mesh.material as THREE.Material).dispose();
        this.waves.splice(i, 1);
        continue;
      }
      const t = 1 - w.life;
      const s = 1 + t * w.grow;
      w.mesh.scale.set(s, s, s);
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = w.life * 0.9;
    }

    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.life -= dtS / fl.max;
      if (fl.life <= 0) {
        this.scene.remove(fl.sprite);
        (fl.sprite.material as THREE.Material).dispose();
        this.flashes.splice(i, 1);
        continue;
      }
      const t = 1 - fl.life;
      fl.sprite.scale.setScalar(fl.base * (1 + t * fl.grow));
      (fl.sprite.material as THREE.SpriteMaterial).opacity = fl.life;
    }

    for (const c of this.crowd) {
      c.group.position.y = c.base + Math.sin(timeMs * 0.004 + c.phase) * 4;
    }

    this.syncProjectiles(world, timeMs, dtS);
    this.renderer.render(this.scene, this.camera);
    this.renderer.info.reset();
  }

  private updateCamera(world: World, timeMs: number, dtS: number) {
    const [f1, f2] = world.f;
    const mid = (f1.x + f2.x) / 2;
    const dist = Math.abs(f1.x - f2.x);
    const lead = Math.max(Math.abs(f1.x - mid), Math.abs(f2.x - mid));
    const halfW = lead + 96;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fit = Math.max(620, Math.min(1700, halfW / Math.max(0.05, Math.tan(hFov / 2))));

    const dramatic = world.flash > 0.35 || f1.state === "ko" || f2.state === "ko";
    const targetZoom = dramatic ? 0.84 : dist < 260 ? 0.92 : 1;
    this.zoom += (targetZoom - this.zoom) * Math.min(1, dtS * 3.4);

    const shake = world.shake;
    const jx = (Math.random() - 0.5) * shake * 3.2;
    const jy = (Math.random() - 0.5) * shake * 2.4;
    // slow cinematic drift that fades out once the round goes live
    const drift =
      Math.sin(timeMs * 0.0004) * 44 * Math.max(0, 1 - world.clock / 2600);

    const targetX = mid + 44 + drift + jx;
    const targetZ = fit * this.zoom;
    const targetY = 170 + Math.min(64, dist * 0.055) + jy;

    this.camX += (targetX - this.camX) * Math.min(1, dtS * 4.2);
    this.camZ += (targetZ - this.camZ) * Math.min(1, dtS * 2.6);
    this.camY += (targetY - this.camY) * Math.min(1, dtS * 4.2);

    this.camera.position.set(this.camX, this.camY, this.camZ);
    this.camera.lookAt(mid, 96, 0);
  }

  private stepParticles(
    list: Slotted,
    pos: Float32Array,
    col: Float32Array,
    geo: THREE.BufferGeometry,
    dtS: number,
  ) {
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p) continue;
      p.life -= dtS / p.max;
      if (p.life <= 0) {
        list[i] = undefined;
        pos[i * 3 + 1] = -99999;
        continue;
      }
      p.vy += p.g * dtS;
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.z += p.vz * dtS;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.vz *= p.drag;
      const a = 0.2 + p.life * 0.8;
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      col[i * 3] = p.r * a;
      col[i * 3 + 1] = p.gr * a;
      col[i * 3 + 2] = p.b * a;
    }
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  /* -------------------------------- posing --------------------------------- */

  /**
   * Start loading slot `i`'s skinned model. The procedural rig keeps rendering
   * until the file arrives; if the fetch fails the rig simply stays, so a fight
   * is always playable. A late load for a character that has already changed is
   * discarded via the token.
   */
  private attachModel(i: 0 | 1, themeId: string) {
    if (!modelsAvailable) return;
    const stale = this.models[i];
    if (stale) {
      this.rigs[i].root.remove(stale.root);
      disposeFighterModel(stale);
      this.models[i] = null;
    }
    const theme = getCharacter(themeId);
    const spec = MODELS[lookFor(theme).model];
    const token = ++this.modelToken[i];
    loadFighterModel(theme, spec, i)
      .then((model) => {
        if (this.modelToken[i] !== token) return;
        this.models[i] = model;
        this.rigs[i].root.add(model.root);
      })
      .catch(() => {
        /* offline or a bad file: keep the procedural rig */
      });
  }

  private applyTheme(rig: Rig, theme: CharacterTheme) {
    const m = rig.mats;
    m.suit.color.set(theme.suit);
    m.pants.color.set(theme.suit).multiplyScalar(0.58);
    m.skin.color.set(theme.skin);
    m.hair.color.set(theme.hair);
    m.trim.color.set(theme.trim);
    m.accent.color.set(theme.accent);
    m.accent.emissive.set(theme.aura);
    m.eye.color.set(theme.accent);
  }

  private applyPose(
    rig: Rig,
    p: Pose3,
    f: Fighter,
    theme: CharacterTheme,
    timeMs: number,
  ) {
    const d = rig.dims;

    rig.root.position.set(f.x, f.y, 0);
    rig.root.rotation.y = f.facing === 1 ? 0 : Math.PI;

    // accent glow: bright while striking, hot when the meter is full
    const charging = f.state === "attack";
    const maxed = f.meter >= 100;
    const pulse =
      theme.auraStyle === "volt"
        ? Math.sin(timeMs * 0.04) > 0.55
          ? 1.35
          : 0.72
        : 0.85 + Math.sin(timeMs * 0.011 + f.side * 2) * 0.18;
    rig.mats.accent.emissiveIntensity = charging ? 2.2 : maxed ? 1.5 : 1.0 * pulse;

    // blob shadow stays on the floor, shrinking as the fighter rises
    const shScale = Math.max(0.45, 1 - Math.abs(f.y) / 420);
    rig.shadow.scale.set(shScale, shScale, 1);
    (rig.shadow.material as THREE.MeshBasicMaterial).opacity = 0.62 * shScale;

    // aura sprite + power ring + character light
    const power = maxed ? 1 : charging ? 0.65 : 0.32;
    const flick = theme.auraStyle === "volt" ? pulse + Math.random() * 0.12 : pulse;
    const glowMat = rig.glow.material as THREE.SpriteMaterial;
    glowMat.color.set(theme.aura);
    glowMat.opacity = 0.24 * power * flick;
    rig.glow.scale.setScalar(250 + power * 90 + flick * 22);
    rig.glow.position.y = p.pelvisY * d.height * 0.9;
    const ringMat = rig.ring.material as THREE.MeshBasicMaterial;
    ringMat.color.set(maxed ? theme.accent : theme.aura);
    ringMat.opacity = 0.22 + power * 0.5;
    rig.ring.scale.setScalar(1 + Math.sin(timeMs * 0.006 + f.side) * 0.07);
    rig.ring.position.y = -f.y + 2;
    rig.light.color.set(theme.aura);
    rig.light.intensity = power * flick * 2.4;

    // strike trails off the actual hitbox
    const mv = f.move;
    if (mv) {
      const w = Math.max(1, mv.windup);
      const a = Math.max(1, mv.active);
      if (f.moveFrame >= w && f.moveFrame <= w + a) {
        const out = Math.min(1, (f.moveFrame - w) / Math.max(1, a * 0.6));
        const reach = mv.reach * (0.45 + out * 0.7);
        const n = mv.ultimate ? 4 : 2;
        for (let i = 0; i < n; i++) {
          const c = new THREE.Color(Math.random() < 0.6 ? theme.aura : theme.accent);
          this.sparks[this.sparkIdx++ % SPARK_POOL] = {
            x: f.x + f.facing * reach,
            y: f.y + mv.hbY * 0.8 + (Math.random() - 0.5) * 24,
            z: (Math.random() - 0.5) * 34,
            vx: f.facing * (120 + Math.random() * 160),
            vy: (Math.random() - 0.5) * 140,
            vz: (Math.random() - 0.5) * 90,
            life: 1,
            max: 0.3,
            g: -180,
            drag: 0.94,
            r: c.r,
            gr: c.g,
            b: c.b,
          };
        }
      }
    }
    // ambient aura motes
    if (Math.random() < (charging ? 0.8 : 0.35)) {
      const c = new THREE.Color(Math.random() < 0.7 ? theme.aura : theme.accent);
      const rise = theme.particle === "flake" || theme.particle === "shard";
      this.sparks[this.sparkIdx++ % SPARK_POOL] = {
        x: f.x + (Math.random() - 0.5) * 70,
        y: f.y + Math.random() * 130,
        z: (Math.random() - 0.5) * 56,
        vx: (Math.random() - 0.5) * 46,
        vy: rise ? -60 - Math.random() * 50 : 80 + Math.random() * 70,
        vz: (Math.random() - 0.5) * 30,
        life: 1,
        max: 0.85,
        g: theme.particle === "shard" ? -560 : -40,
        drag: 0.97,
        r: c.r,
        gr: c.g,
        b: c.b,
      };
    }
  }

  /* ------------------------------- projectiles ----------------------------- */

  private syncProjectiles(world: World, timeMs: number, dtS: number) {
    const live = new Set<number>();
    for (const p of world.projectiles) {
      live.add(p.id);
      let g = this.projMeshes.get(p.id);
      if (!g) {
        const theme = getCharacter(world.f[p.owner].charId);
        g = new THREE.Group();
        const core = new THREE.Mesh(
          this.track(new THREE.SphereGeometry(p.w * 0.55, 12, 10)),
          this.neon(theme.accent),
        );
        const shell = new THREE.Mesh(
          this.track(new THREE.IcosahedronGeometry(p.w * 0.95, 1)),
          this.track(
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(theme.aura),
              transparent: true,
              opacity: 0.5,
              wireframe: true,
              toneMapped: false,
            }),
          ),
        );
        const sprite = new THREE.Sprite(this.spriteMat(glowTexture(), theme.aura));
        sprite.scale.setScalar(p.w * 5);
        g.add(core, shell, sprite);
        this.scene.add(g);
        this.projMeshes.set(p.id, g);
      }
      g.position.set(p.x, p.y, 0);
      g.rotation.z += dtS * 11;
      g.rotation.y += dtS * 6;
      const s = 1 + Math.sin(timeMs * 0.02 + p.id) * 0.14;
      g.scale.set(s, s, s);
      if (Math.random() < 0.85) {
        const theme = getCharacter(world.f[p.owner].charId);
        const c = new THREE.Color(theme.accent);
        this.sparks[this.sparkIdx++ % SPARK_POOL] = {
          x: p.x - Math.sign(p.vx) * p.w,
          y: p.y + (Math.random() - 0.5) * p.w,
          z: (Math.random() - 0.5) * 24,
          vx: -Math.sign(p.vx) * 70,
          vy: (Math.random() - 0.5) * 70,
          vz: 0,
          life: 1,
          max: 0.3,
          g: 0,
          drag: 0.9,
          r: c.r,
          gr: c.g,
          b: c.b,
        };
      }
    }
    for (const [id, g] of this.projMeshes) {
      if (!live.has(id)) {
        this.scene.remove(g);
        this.disposeGroup(g);
        this.projMeshes.delete(id);
      }
    }
  }
}
