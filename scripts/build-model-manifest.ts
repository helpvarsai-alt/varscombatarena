/**
 * Builds src/game/model-manifest.json — the ground truth about the vendored
 * character models, read straight out of the .glb binaries.
 *
 *   bun scripts/build-model-manifest.ts
 *
 * models.ts maps game states and all 20 combos onto animation clip names, and
 * scripts/verify-animation.ts asserts every one of those names actually exists
 * in the manifest. A typo in a clip name would otherwise only show up as a
 * fighter frozen mid-air in the browser, so it is checked here instead.
 *
 * Measured per model:
 *   - the clip list (name, duration)
 *   - body meshes vs. prop meshes (weapons/shields/hats are separate nodes and
 *     ALL variants ship in every file — the loadout in models.ts hides the rest)
 *   - bodyHeight, the height of the skinned body ONLY. Measured on purpose:
 *     the Mage's hat reaches y=3.00 while its body tops out at 2.20, so scaling
 *     by the whole-model bounds would shrink the Mage's body to 62%.
 *   - feetY, which must be ~0 for the boots to land on the arena floor.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const MODELS_DIR = "public/models";
const OUT = "src/game/model-manifest.json";

type M = number[];
const ident = (): M => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function mul(a: M, b: M): M {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function fromTRS(t: number[], r: number[], s: number[]): M {
  const [x, y, z, w] = r;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2,
    yy = y * y2,
    yz = y * z2,
    zz = z * z2,
    wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  return [
    (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
    (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
    (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const apply = (m: M, p: number[]) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];

/* The subset of the glTF 2.0 JSON we read. Parsed from a binary we vendored
 * ourselves, and every field's presence is asserted by verify-models.ts. */
interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
  matrix?: number[];
}
interface GltfAccessor {
  count: number;
  min?: number[];
  max?: number[];
  bufferView?: number;
}
interface GltfPrimitive {
  attributes: Record<string, number>;
  material?: number;
}
interface GltfAnimation {
  name?: string;
  channels: { target: { node: number; path: string }; sampler: number }[];
  samplers: { input: number; output: number }[];
}
interface GltfJson {
  // validated at the parse boundary, so the rest of the file can rely on these
  nodes: GltfNode[];
  scenes: { nodes: number[] }[];
  meshes: { name?: string; primitives: GltfPrimitive[] }[];
  accessors: GltfAccessor[];
  bufferViews: { byteOffset?: number; byteLength: number }[];
  skins: { joints: number[]; skeleton?: number }[];
  animations?: GltfAnimation[];
  images?: { bufferView?: number }[];
}

/** Fields a character glb must have for this script to measure anything. */
const REQUIRED_GLTF_FIELDS = ["nodes", "scenes", "meshes", "accessors", "bufferViews", "skins"] as const;

interface Glb {
  json: GltfJson;
  bin: Buffer;
  bytes: number;
}

function parseGlb(path: string): Glb {
  const buf = readFileSync(path);
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Buffer = Buffer.alloc(0);
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString("utf8")) as GltfJson;
    else if (type === 0x004e4942) bin = data;
    offset += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error(`no JSON chunk in ${path}`);
  for (const field of REQUIRED_GLTF_FIELDS) {
    if (!Array.isArray(json[field]) || json[field].length === 0) {
      throw new Error(`${path}: glTF is missing "${field}"`);
    }
  }
  return { json, bin, bytes: buf.length };
}

const BODY_PART = /_(Body|Head|Head_Hooded|ArmLeft|ArmRight|LegLeft|LegRight)$/;

function inspect(file: string) {
  const { json: g, bytes } = parseGlb(join(MODELS_DIR, file));
  const nodes: GltfNode[] = g.nodes;

  // world matrices from the scene roots (the armature "Rig" node is root)
  const world = new Map<number, M>();
  const walk = (idx: number, parent: M) => {
    const n = nodes[idx];
    const m = mul(parent, n.matrix ? n.matrix : fromTRS(n.translation ?? [0, 0, 0], n.rotation ?? [0, 0, 0, 1], n.scale ?? [1, 1, 1]));
    world.set(idx, m);
    for (const c of n.children ?? []) walk(c, m);
  };
  for (const root of g.scenes[0].nodes) walk(root, ident());

  const bbox = (pred: (name: string) => boolean) => {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    nodes.forEach((n, i) => {
      if (n.mesh === undefined || !pred(n.name ?? "")) return;
      for (const prim of g.meshes[n.mesh].primitives) {
        const acc = g.accessors[prim.attributes.POSITION];
        if (!acc?.min || !acc.max) continue;
        for (let b = 0; b < 8; b++) {
          const corner = [
            b & 1 ? acc.max[0] : acc.min[0],
            b & 2 ? acc.max[1] : acc.min[1],
            b & 4 ? acc.max[2] : acc.min[2],
          ];
          const w = apply(world.get(i) ?? ident(), corner);
          for (let k = 0; k < 3; k++) {
            lo[k] = Math.min(lo[k], w[k]);
            hi[k] = Math.max(hi[k], w[k]);
          }
        }
      }
    });
    return { min: lo, max: hi };
  };

  const meshNames = nodes.filter((n) => n.mesh !== undefined).map((n) => n.name as string);
  const bodyMeshes = meshNames.filter((n) => BODY_PART.test(n));
  const propMeshes = meshNames.filter((n) => !BODY_PART.test(n));
  const body = bbox((n) => BODY_PART.test(n));
  const everything = bbox(() => true);

  // forward axis: in the rest pose the toes sit forward of the foot
  const byName = new Map<string, number>();
  nodes.forEach((n, i) => n.name && byName.set(n.name, i));
  const at = (name: string) => {
    const i = byName.get(name);
    if (i === undefined) return null;
    return apply(world.get(i) ?? ident(), nodes[i].translation ?? [0, 0, 0]);
  };
  const foot = at("foot.l");
  const toes = at("toes.l");
  let forward = "unknown";
  if (foot && toes) {
    const d = [toes[0] - foot[0], toes[1] - foot[1], toes[2] - foot[2]];
    const axis = ["+X", "+Y", "+Z"].map((a, i) => (d[i] < 0 ? a.replace("+", "-") : a));
    forward = axis[d.map(Math.abs).indexOf(Math.max(...d.map(Math.abs)))];
  }

  // root motion: if the `root` bone translates horizontally, the clips fight
  // the code-driven movement and the fighter slides
  let rootMotion = 0;
  for (const a of g.animations ?? []) {
    for (const ch of a.channels) {
      if (ch.target.path !== "translation") continue;
      const nodeName = nodes[ch.target.node]?.name;
      if (nodeName !== "root") continue;
      const out = g.accessors[a.samplers[ch.sampler].output];
      if (!out?.min || !out.max) continue;
      rootMotion = Math.max(rootMotion, out.max[0] - out.min[0], out.max[2] - out.min[2]);
    }
  }

  let animBytes = 0;
  for (const a of g.animations ?? []) {
    for (const s of a.samplers) {
      for (const acc of [g.accessors[s.input], g.accessors[s.output]]) {
        animBytes += acc.bufferView === undefined ? 0 : g.bufferViews[acc.bufferView].byteLength;
      }
    }
  }
  const textureBytes = (g.images ?? []).reduce(
    (s: number, im) => s + (im.bufferView === undefined ? 0 : g.bufferViews[im.bufferView].byteLength),
    0,
  );

  const clips = (g.animations ?? []).map((a: GltfAnimation) => {
    const times = new Set<number>();
    for (const s of a.samplers) {
      const acc = g.accessors[s.input];
      times.add(acc.max?.[0] ?? 0);
    }
    return { name: a.name as string, duration: Math.max(...times) };
  });

  return {
    file,
    bytes,
    joints: g.skins[0].joints.length,
    clips,
    bodyMeshes: bodyMeshes.sort(),
    propMeshes: propMeshes.sort(),
    bodyHeight: +(body.max[1] - body.min[1]).toFixed(4),
    feetY: +body.min[1].toFixed(4),
    fullHeight: +(everything.max[1] - everything.min[1]).toFixed(4),
    forward,
    rootMotionM: +rootMotion.toFixed(4),
    textureBytes,
    animBytes,
  };
}

const files = readdirSync(MODELS_DIR)
  .filter((f) => f.endsWith(".glb"))
  .sort();

const models: Record<string, ReturnType<typeof inspect>> = {};
for (const f of files) models[f.replace(/\.glb$/, "")] = inspect(f);

const manifest = {
  note: "Generated by scripts/build-model-manifest.ts — do not edit by hand.",
  source: {
    pack: "KayKit Adventurers Character Pack 1.0",
    author: "Kay Lousberg (kaylousberg.com)",
    license: "CC0 1.0 Universal (public domain dedication)",
    url: "https://github.com/KayKit-Game-Assets/KayKit-Character-Pack-Adventures-1.0",
  },
  models,
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");

for (const [name, m] of Object.entries(models)) {
  console.log(
    `${name.padEnd(15)} body=${m.bodyHeight.toFixed(2)} (full ${m.fullHeight.toFixed(2)})  feetY=${m.feetY}  face=${m.forward}  rootMotion=${m.rootMotionM}  joints=${m.joints}  clips=${m.clips.length}  props=${m.propMeshes.length}`,
  );
}
console.log(`\nwrote ${OUT}`);
