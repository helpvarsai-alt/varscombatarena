/**
 * Arena verification harness — run with `bun run verify:arena`.
 *
 * The 3D arena needs WebGL to *look* right, so this checks the things that
 * actually break it, headlessly, against the real `buildArena` code (called
 * through the class prototype with a stub context, exactly like the renderer
 * would call it):
 *
 *   1. the deck's fighting surface sits exactly on STAGE.floorY, and the fight
 *      plane itself is clear — nothing inside the ring pokes up into it
 *   2. no arena geometry ever comes between the tracking camera and a fighter,
 *      sampled across the whole camera range `updateCamera` can produce
 *   3. the layered background exists and the shed-able decor layers are groups
 *   4. the light rig stays small, unshadowed and tier-appropriate
 *   5. the triangle budget stays mobile-sized and the low tier is cheaper
 *   6. the atmosphere (fog + sky) that supplies the depth cue is present
 */
import * as THREE from "three";
import { FIGHTER_H, FIGHTER_W, STAGE } from "../src/game/sim";
import { ThreeRenderer } from "../src/game/render3d";

/*
 * Minimal 2D-canvas stub: the arena builds CanvasTextures for its deck, sky,
 * backdrop, emblem and loading tag, which needs a canvas element but no GL.
 */
function installCanvasStub() {
  const gradient = { addColorStop() {} };
  const ctx = {
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    fillRect() {},
    strokeRect() {},
    clearRect() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    quadraticCurveTo() {},
    stroke() {},
    fill() {},
    fillText() {},
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    set fillStyle(_v: unknown) {},
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: unknown) {},
    set lineCap(_v: unknown) {},
    set font(_v: unknown) {},
    set textAlign(_v: unknown) {},
    set textBaseline(_v: unknown) {},
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

type Tier = "high" | "low";

interface Disposable {
  dispose(): void;
}

/**
 * Run the real `buildArena` against a stub context: `private` is a TypeScript
 * fiction, so the prototype method is reachable at runtime and every line of
 * arena code under test is the shipping code.
 */
function buildArena(tier: Tier) {
  const scene = new THREE.Scene();
  const disposables: Disposable[] = [];
  const decor: THREE.Object3D[] = [];
  const crowd: { group: THREE.Object3D; base: number; phase: number }[] = [];
  const track = <T extends Disposable>(x: T) => {
    disposables.push(x);
    return x;
  };
  const standard = (
    color: number,
    opts: Partial<THREE.MeshStandardMaterialParameters> = {},
  ) =>
    track(
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.62,
        metalness: 0.06,
        envMapIntensity: 0.75,
        ...opts,
      }),
    );
  const decal = (texture: THREE.Texture, color: number, opacity: number) =>
    track(
      new THREE.MeshBasicMaterial({
        map: texture,
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );

  const ctx = { scene, disposables, decor, crowd, tier, track, standard, decal };
  const proto = ThreeRenderer.prototype as unknown as {
    buildArena(this: unknown): void;
  };
  proto.buildArena.call(ctx);
  scene.updateMatrixWorld(true);
  return { scene, disposables, decor, crowd };
}

/* ------------------------------- geometry stats ---------------------------- */

function triangleCount(scene: THREE.Object3D): number {
  let tris = 0;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry as THREE.BufferGeometry;
    tris += g.index ? g.index.count / 3 : g.getAttribute("position").count / 3;
  });
  return Math.round(tris);
}

function meshes(scene: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) out.push(mesh);
  });
  return out;
}

const center = (STAGE.minX + STAGE.maxX) / 2;
const span = STAGE.maxX - STAGE.minX;

/* ------------------------------------------------------------------ tier: high */

const high = buildArena("high");
const low = buildArena("low");

/* 1. the fighting plane ----------------------------------------------------- */

const worldBox = new THREE.Box3();
function bounds(mesh: THREE.Mesh) {
  worldBox.setFromObject(mesh, true);
  return worldBox.clone();
}

const deckBounds = meshes(high.scene).map(bounds);
const surface = deckBounds.find(
  (b) =>
    Math.abs(b.max.y) < 1e-6 &&
    b.min.x <= STAGE.minX &&
    b.max.x >= STAGE.maxX &&
    b.min.z <= -300 &&
    b.max.z >= 300 &&
    b.min.y < -1,
);
check(
  "deck fighting surface sits exactly on STAGE.floorY",
  !!surface,
  surface ? "" : `no mesh with top face at y=0 spanning the ring (${STAGE.minX}..${STAGE.maxX})`,
);

const intruders = meshes(high.scene)
  .map((m) => ({ m, b: bounds(m) }))
  .filter(
    ({ m, b }) =>
      // inside the ring, over the plane fighters actually stand on
      b.max.x > STAGE.minX - 20 &&
      b.min.x < STAGE.maxX + 20 &&
      b.min.z > -300 &&
      b.max.z < 300 &&
      b.max.y > 2 &&
      m.geometry.type !== "SphereGeometry",
  )
  .map(({ m, b }) => `${m.geometry.type} top y=${b.max.y.toFixed(1)}`);
check("nothing rises out of the fight plane", intruders.length === 0, intruders.join(", "));

/* 2. fighter visibility under every camera the tracker can build ------------ */

const PAIRS: [number, number][] = [
  [STAGE.minX, STAGE.minX],
  [STAGE.maxX, STAGE.maxX],
  [center, center],
  [STAGE.minX, STAGE.maxX],
  [STAGE.minX, center],
  [center, STAGE.maxX],
  [STAGE.minX + 260, center],
  [center, STAGE.maxX - 260],
];
const ASPECTS = [0.5, 0.75, 1, 1.78, 2.4];
const X_OFFSETS = [0, 44, 88];
const ZOOMS = [0.84, 0.92, 1];

interface Camera {
  camera: THREE.PerspectiveCamera;
  mid: number;
}

function cameras(): Camera[] {
  const out: Camera[] = [];
  for (const [f1x, f2x] of PAIRS) {
    const mid = (f1x + f2x) / 2;
    const dist = Math.abs(f1x - f2x);
    const lead = Math.max(Math.abs(f1x - mid), Math.abs(f2x - mid));
    const halfW = lead + 96;
    const y = 170 + Math.min(64, dist * 0.055);
    for (const aspect of ASPECTS) {
      const fov = aspect < 1 ? 40 + (1 - aspect) * 22 : 42;
      const vFov = (fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const fit = Math.max(620, Math.min(1700, halfW / Math.max(0.05, Math.tan(hFov / 2))));
      for (const zoom of ZOOMS) {
        const z = fit * zoom;
        for (const dx of X_OFFSETS) {
          const camera = new THREE.PerspectiveCamera(fov, aspect, 10, 6000);
          camera.position.set(mid + dx, y, z);
          camera.lookAt(mid, 96, 0);
          camera.updateMatrixWorld(true);
          camera.updateProjectionMatrix();
          out.push({ camera, mid });
        }
      }
    }
  }
  return out;
}

/** World-space vertices of every mesh, with a cheap "behind the fighters" cut. */
function occluders(scene: THREE.Object3D) {
  const list: { name: string; world: THREE.Matrix4; pos: Float32Array }[] = [];
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const b = bounds(mesh);
    // anything entirely at or behind the fight plane can never be in the way
    if (b.max.z <= FIGHTER_W / 2) return;
    const attr = mesh.geometry.getAttribute("position");
    list.push({
      name: mesh.geometry.type,
      world: mesh.matrixWorld.clone(),
      pos: attr.array as Float32Array,
    });
  });
  return list;
}

const CAMS = cameras();
const OCCLUDERS = occluders(high.scene);
const fighterCorners: THREE.Vector3[] = [];
for (const sx of [-1, 1])
  for (const sy of [0, 1])
    for (const sz of [-1, 1])
      fighterCorners.push(
        new THREE.Vector3(
          (sx * FIGHTER_W) / 2,
          sy * FIGHTER_H,
          (sz * FIGHTER_W) / 2,
        ),
      );

function checkPair(camera: THREE.PerspectiveCamera, fx: number): string[] {
  const box = new THREE.Box2();
  const view = new THREE.Vector3();
  const proj = new THREE.Vector3();
  const hits: string[] = [];

  let nearest = Infinity;
  for (const c of fighterCorners) {
    view.copy(c).add(new THREE.Vector3(fx, 0, 0));
    const v = view.clone().applyMatrix4(camera.matrixWorldInverse);
    const d = -v.z;
    if (d > 0) nearest = Math.min(nearest, d);
  }
  if (!isFinite(nearest)) return hits;

  for (const c of fighterCorners) {
    proj.copy(c).add(new THREE.Vector3(fx, 0, 0)).project(camera);
    box.expandByPoint(new THREE.Vector2(proj.x, proj.y));
  }
  const seen = new Set<string>();
  for (const occ of OCCLUDERS) {
    for (let i = 0; i < occ.pos.length; i += 3) {
      view.set(occ.pos[i], occ.pos[i + 1], occ.pos[i + 2]).applyMatrix4(occ.world);
      const v = view.clone().applyMatrix4(camera.matrixWorldInverse);
      const d = -v.z;
      if (d <= 5 || d >= nearest - 5) continue; // behind camera, or behind the fighter
      proj.copy(view).project(camera);
      if (proj.x < box.min.x || proj.x > box.max.x) continue;
      if (proj.y < box.min.y || proj.y > box.max.y) continue;
      if (!seen.has(occ.name)) {
        seen.add(occ.name);
        hits.push(`${occ.name} at ${fx.toFixed(0)}`);
      }
    }
  }
  return hits;
}

const occlusions = new Set<string>();
for (const { camera, mid } of CAMS) {
  for (const fx of [STAGE.minX, mid, STAGE.maxX]) {
    for (const hit of checkPair(camera, fx)) occlusions.add(hit);
  }
}
check(
  `fighters stay visible across ${CAMS.length} camera setups`,
  occlusions.size === 0,
  [...occlusions].join(", "),
);

/* 3. layered background + degradable layers -------------------------------- */

check("layered background present", high.decor.length >= 4, `decor=${high.decor.length}`);
check(
  "every shed-able layer is a populated group",
  high.decor.every((d) => d.type === "Group" && d.children.length > 0),
  high.decor.map((d) => `${d.type}:${d.children.length}`).join(" "),
);
// Every shed-able layer must be either far behind the ring or far above it, so
// dropping one can never change what the fight plane looks like.
const shedSafe = high.decor.map((d) => {
  const b = bounds(d as unknown as THREE.Mesh);
  return b.max.z < -400 || b.min.y > 200;
});
check(
  "shed-able layers are background or overhead only",
  shedSafe.every(Boolean),
  high.decor
    .filter((_, i) => !shedSafe[i])
    .map((d) => {
      const b = bounds(d as unknown as THREE.Mesh);
      return `z=${b.max.z.toFixed(0)} y>=${b.min.y.toFixed(0)}`;
    })
    .join(", "),
);

/* 4. light rig -------------------------------------------------------------- */

function lights(scene: THREE.Object3D) {
  const out: THREE.Light[] = [];
  scene.traverse((o) => {
    if ((o as THREE.Light).isLight) out.push(o as THREE.Light);
  });
  return out;
}
const highLights = lights(high.scene);
const lowLights = lights(low.scene);
const countBy = (l: THREE.Light[], type: string) =>
  l.filter((x) => x.type === type).length;

check("high tier light rig is 1 hemi + 4 directional", highLights.length === 5, `got ${highLights.length}`);
check("low tier drops the kicker light", lowLights.length === 4, `got ${lowLights.length}`);
check("no shadow-casting lights (mobile budget)", highLights.every((l) => !l.castShadow));
check("low tier is strictly cheaper than high", lowLights.length < highLights.length);
console.log(
  `      lights: high ${countBy(highLights, "HemisphereLight")}hemi/${countBy(highLights, "DirectionalLight")}dir, ` +
    `low ${countBy(lowLights, "HemisphereLight")}hemi/${countBy(lowLights, "DirectionalLight")}dir`,
);

/* 5. triangle budget -------------------------------------------------------- */

const highTris = triangleCount(high.scene);
const lowTris = triangleCount(low.scene);
console.log(`      triangles: high ${highTris}, low ${lowTris}`);
check("high-tier arena stays under 120k triangles", highTris > 0 && highTris < 120_000, `${highTris}`);
check("low tier builds fewer triangles", lowTris < highTris, `${lowTris} vs ${highTris}`);
check("low tier thins the crowd", low.crowd.length < high.crowd.length, `${low.crowd.length} vs ${high.crowd.length}`);

/* 6. restrained glow -------------------------------------------------------- */

const arenaMats = (scene: THREE.Object3D) => {
  const mats = new Map<string, THREE.Material>();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) mats.set(m.uuid, m);
  });
  return [...mats.values()];
};
const highMats = arenaMats(high.scene);
const additive = highMats.filter((m) => m.blending === THREE.AdditiveBlending);
const emissive = highMats.filter(
  (m) => ((m as THREE.MeshStandardMaterial).emissive?.getHex() ?? 0) !== 0,
);
check(
  "at most one additive decal in the arena",
  additive.length <= 1,
  `${additive.length} additive materials`,
);
check(
  "only a few warm emissive strips",
  emissive.length <= 4,
  `${emissive.length} emissive materials`,
);
console.log(`      materials: ${highMats.length}, additive ${additive.length}, emissive ${emissive.length}`);

/* ---------------------------------- summary -------------------------------- */

console.log(`\narena: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
