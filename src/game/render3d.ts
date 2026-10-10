import * as THREE from "three";
import { MOVE_BY_ID } from "./combos";
import { getCharacter, type CharacterTheme } from "./characters";
import { poseFor, swingOf } from "./pose";
import { STAGE, type Fighter, type FxEvent, type World } from "./sim";

/**
 * three.js renderer — same skeletal poses as the 2D canvas, expressed as mesh
 * pivots. Mobile-friendly: no shadow maps (blob shadows instead), one pooled
 * particle buffer, capped pixel ratio.
 */

interface P3 {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  g: number;
  cr: number;
  cg: number;
  cb: number;
}

interface Burst {
  mesh: THREE.Mesh;
  life: number;
  max: number;
  scale: number;
}

const POOL = 340;

class Rig {
  root = new THREE.Group();
  body = new THREE.Group();
  torso = new THREE.Group();
  head = new THREE.Group();
  armF = new THREE.Group();
  armF2 = new THREE.Group();
  armB = new THREE.Group();
  armB2 = new THREE.Group();
  legF = new THREE.Group();
  legF2 = new THREE.Group();
  legB = new THREE.Group();
  legB2 = new THREE.Group();
  glow = new THREE.Sprite();
  ring = new THREE.Mesh();
  shadow = new THREE.Mesh();
  light = new THREE.PointLight(0xffffff, 0, 420, 2);
}

export class ThreeRenderer {
  canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 10, 4000);
  private rigs: [Rig, Rig];
  private ptsGeo = new THREE.BufferGeometry();
  private ptsPos: Float32Array;
  private ptsCol: Float32Array;
  private particles: P3[] = [];
  private pIndex = 0;
  private bursts: Burst[] = [];
  private projMeshes = new Map<number, THREE.Group>();
  private disposables: { dispose(): void }[] = [];
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.scene.fog = new THREE.Fog(0x0a0e1e, 900, 2400);
    this.scene.background = new THREE.Color(0x0a0e1e);

    this.buildArena();

    // particle pool
    this.ptsPos = new Float32Array(POOL * 3);
    this.ptsCol = new Float32Array(POOL * 3);
    for (let i = 0; i < POOL; i++) this.ptsPos[i * 3 + 1] = -9999;
    this.ptsGeo.setAttribute("position", new THREE.BufferAttribute(this.ptsPos, 3));
    this.ptsGeo.setAttribute("color", new THREE.BufferAttribute(this.ptsCol, 3));
    const pmat = new THREE.PointsMaterial({
      size: 7,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(this.ptsGeo, pmat);
    points.frustumCulled = false;
    this.scene.add(points);
    this.disposables.push(this.ptsGeo, pmat);

    this.rigs = [this.buildRig(), this.buildRig()];
    this.scene.add(this.rigs[0].root, this.rigs[1].root);
  }

  /* --------------------------------- setup -------------------------------- */

  private mat(color: string, emissive = "#000000", ei = 0) {
    const m = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.6,
      metalness: 0.05,
      emissive: new THREE.Color(emissive),
      emissiveIntensity: ei,
    });
    this.disposables.push(m);
    return m;
  }

  private buildArena() {
    const center = (STAGE.minX + STAGE.maxX) / 2;
    const span = STAGE.maxX - STAGE.minX;

    const groundGeo = new THREE.PlaneGeometry(2600, 1400);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x131a2c,
      roughness: 0.85,
      metalness: 0.1,
    });
    this.disposables.push(groundGeo, groundMat);
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center, 0, 0);
    this.scene.add(ground);

    const grid = new THREE.GridHelper(2400, 40, 0x2f88b0, 0x1c3450);
    grid.position.set(center, 0.6, 0);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    this.scene.add(grid);
    this.disposables.push(grid.geometry, grid.material as THREE.Material);

    // stage boundary glow strips
    const stripGeo = new THREE.BoxGeometry(span + 140, 4, 4);
    const stripMat = new THREE.MeshBasicMaterial({ color: 0x4be3ff });
    this.disposables.push(stripGeo, stripMat);
    const strip = new THREE.Mesh(stripGeo, stripMat);
    strip.position.set(center, 1.5, 240);
    this.scene.add(strip);

    // back wall + neon pillars
    const wallGeo = new THREE.BoxGeometry(2600, 460, 12);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0e1426, roughness: 0.9 });
    this.disposables.push(wallGeo, wallMat);
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(center, 230, -420);
    this.scene.add(wall);

    const pillarGeo = new THREE.BoxGeometry(26, 460, 26);
    this.disposables.push(pillarGeo);
    for (let i = -3; i <= 3; i++) {
      const c = i % 2 === 0 ? 0xff4fa3 : 0x4be3ff;
      const mat = new THREE.MeshBasicMaterial({ color: c });
      this.disposables.push(mat);
      const p = new THREE.Mesh(pillarGeo, mat);
      p.position.set(center + i * 260, 230, -400);
      this.scene.add(p);
    }

    // lights
    const hemi = new THREE.HemisphereLight(0x93a8ff, 0x1a1030, 0.85);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.05);
    dir.position.set(400, 700, 500);
    this.scene.add(dir);
    const rim = new THREE.DirectionalLight(0xff6fbf, 0.5);
    rim.position.set(-500, 300, -400);
    this.scene.add(rim);
  }

  private buildRig(): Rig {
    const r = new Rig();
    r.root.add(r.body);
    r.body.add(r.torso);
    r.torso.add(r.head);

    // torso (hip -> shoulder)
    const torsoGeo = new THREE.CapsuleGeometry(13, 34, 4, 10);
    const torsoMesh = new THREE.Mesh(torsoGeo, this.mat("#555"));
    torsoMesh.position.y = 26;
    r.torso.add(torsoMesh);
    this.disposables.push(torsoGeo);

    // head
    const headGeo = new THREE.SphereGeometry(14, 14, 12);
    const headMesh = new THREE.Mesh(headGeo, this.mat("#eee"));
    headMesh.position.y = 16;
    r.head.add(headMesh);
    this.disposables.push(headGeo);
    const hairGeo = new THREE.SphereGeometry(14.6, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
    const hairMesh = new THREE.Mesh(hairGeo, this.mat("#333"));
    hairMesh.position.y = 17;
    r.head.add(hairMesh);
    this.disposables.push(hairGeo);
    const eyeGeo = new THREE.BoxGeometry(6, 2.6, 2);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.disposables.push(eyeGeo, eyeMat);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(9.5, 17, 4.4);
    r.head.add(eye);
    const eye2 = eye.clone();
    eye2.position.z = -4.4;
    r.head.add(eye2);

    const armMats: THREE.MeshStandardMaterial[] = [];
    const legMats: THREE.MeshStandardMaterial[] = [];

    // arms: upper group at shoulder, lower group at elbow
    const mkLimb = (
      parent: THREE.Object3D,
      upper: THREE.Group,
      lower: THREE.Group,
      x: number,
      y: number,
      z: number,
      len1: number,
      len2: number,
      radius: number,
      mats: THREE.MeshStandardMaterial[],
    ) => {
      upper.position.set(x, y, z);
      parent.add(upper);
      const g1 = new THREE.CapsuleGeometry(radius, len1, 3, 8);
      const m1 = new THREE.Mesh(g1, this.mat("#ccc"));
      m1.position.y = -len1 / 2;
      upper.add(m1);
      this.disposables.push(g1);
      lower.position.y = -len1;
      upper.add(lower);
      const g2 = new THREE.CapsuleGeometry(radius * 0.85, len2, 3, 8);
      const m2 = new THREE.Mesh(g2, this.mat("#ccc"));
      m2.position.y = -len2 / 2;
      lower.add(m2);
      this.disposables.push(g2);
      // end cap (hand / foot)
      const g3 = new THREE.SphereGeometry(radius * 1.3, 8, 6);
      const m3 = new THREE.Mesh(g3, this.mat("#eee"));
      m3.position.y = -len2 - radius * 0.6;
      lower.add(m3);
      this.disposables.push(g3);
      mats.push(
        m1.material as THREE.MeshStandardMaterial,
        m2.material as THREE.MeshStandardMaterial,
        m3.material as THREE.MeshStandardMaterial,
      );
    };

    mkLimb(r.torso, r.armF, r.armF2, 0, 52, 7, 30, 28, 5.5, armMats);
    mkLimb(r.torso, r.armB, r.armB2, 0, 52, -7, 30, 28, 5.5, armMats);
    mkLimb(r.body, r.legF, r.legF2, 0, 0, 7, 40, 38, 7, legMats);
    mkLimb(r.body, r.legB, r.legB2, 0, 0, -7, 40, 38, 7, legMats);

    (r as unknown as { userData: Record<string, unknown> }).userData = {
      eyeMat,
      torsoMesh,
      headMesh,
      hairMesh,
      armMats,
      legMats,
    };

    // aura sprite (radial gradient texture)
    const glowTex = radialTexture();
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.disposables.push(glowMat);
    r.glow = new THREE.Sprite(glowMat);
    r.glow.scale.set(240, 240, 1);
    r.glow.position.y = 80;
    r.root.add(r.glow);

    // ground power ring
    const ringGeo = new THREE.TorusGeometry(52, 2.4, 6, 40);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.7,
    });
    this.disposables.push(ringGeo, ringMat);
    r.ring = new THREE.Mesh(ringGeo, ringMat);
    r.ring.rotation.x = -Math.PI / 2;
    r.ring.position.y = 2;
    r.root.add(r.ring);

    // blob shadow
    const shGeo = new THREE.CircleGeometry(34, 20);
    const shMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.disposables.push(shGeo, shMat);
    r.shadow = new THREE.Mesh(shGeo, shMat);
    r.shadow.rotation.x = -Math.PI / 2;
    r.shadow.position.y = 1;
    r.root.add(r.shadow);

    r.light = new THREE.PointLight(0xffffff, 0, 460, 2);
    r.light.position.y = 90;
    r.root.add(r.light);

    this.scene.add(r.root);
    return r;
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }

  /* ---------------------------------- fx ---------------------------------- */

  emitFx(e: FxEvent) {
    switch (e.type) {
      case "hit": {
        const mv = MOVE_BY_ID.get(e.move);
        this.burstAt(e.x, e.y, 26, mv?.ultimate ? "#ffffff" : "#ffd166", 420);
        this.ringAt(e.x, e.y, mv?.ultimate ? 3.4 : 1.6, "#ffd166");
        break;
      }
      case "block":
        this.burstAt(e.x, e.y, 12, "#9bd8ff", 260);
        break;
      case "land":
        this.burstAt(e.x, 6, 12, "#7d88a6", 180);
        break;
      case "jump":
        this.burstAt(e.x, 4, 6, "#7d88a6", 140);
        break;
      case "ko":
        this.burstAt(e.x, e.y, 60, "#ffffff", 640);
        this.ringAt(e.x, e.y, 4.5, "#ffffff");
        break;
      case "ult":
        this.burstAt(e.x, e.y, 56, "#fff2a8", 540);
        this.ringAt(e.x, e.y, 4, "#fff2a8");
        break;
      default:
        break;
    }
  }

  private burstAt(x: number, y: number, n: number, color: string, speed: number) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const el = (Math.random() - 0.5) * Math.PI;
      const s = speed * (0.4 + Math.random() * 0.7);
      const p: P3 = {
        x,
        y,
        z: (Math.random() - 0.5) * 40,
        vx: Math.cos(a) * Math.cos(el) * s,
        vy: Math.sin(el) * s + 60,
        vz: Math.sin(a) * Math.cos(el) * s * 0.5,
        life: 1,
        max: 0.4 + Math.random() * 0.45,
        g: -420,
        cr: c.r,
        cg: c.g,
        cb: c.b,
      };
      const idx = this.pIndex++ % POOL;
      this.particles[idx] = p;
    }
  }

  private ringAt(x: number, y: number, mult: number, color: string) {
    const geo = new THREE.SphereGeometry(26, 14, 10);
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color),
      transparent: true,
      opacity: 0.75,
      wireframe: false,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.disposables.push(geo, mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0);
    this.scene.add(mesh);
    this.bursts.push({ mesh, life: 1, max: 0.45, scale: mult });
    if (this.bursts.length > 12) {
      const old = this.bursts.shift()!;
      this.scene.remove(old.mesh);
      (old.mesh.material as THREE.Material).dispose();
      old.mesh.geometry.dispose();
    }
  }

  /* --------------------------------- render -------------------------------- */

  render(world: World, timeMs: number, dt: number) {
    const dtS = Math.min(0.05, dt / 1000);
    const [f1, f2] = world.f;
    const mid = (f1.x + f2.x) / 2;
    const dist = Math.abs(f1.x - f2.x);
    const camDist = Math.min(1500, Math.max(680, dist * 1.15 + 430));

    // camera follow + shake
    const shake = world.shake;
    const camX = mid;
    this.camera.position.x += (camX + (Math.random() - 0.5) * shake * 3 - this.camera.position.x) * 0.12;
    this.camera.position.y = 210 + (Math.random() - 0.5) * shake * 2;
    this.camera.position.z += (camDist - this.camera.position.z) * 0.06;
    this.camera.lookAt(camX, 96, 0);

    // rigs
    for (let i = 0; i < 2; i++) {
      const f = world.f[i as 0 | 1];
      const rig = this.rigs[i];
      const theme = getCharacter(f.charId);
      this.poseRig(rig, f, theme, timeMs);
    }

    // particles
    const posAttr = this.ptsGeo.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = this.ptsGeo.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p) continue;
      p.life -= dtS / p.max;
      if (p.life <= 0) {
        this.ptsPos[i * 3 + 1] = -9999;
        continue;
      }
      p.vy += p.g * dtS;
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.z += p.vz * dtS;
      p.vx *= 0.97;
      p.vy *= 0.985;
      const a = 0.25 + p.life * 0.75;
      this.ptsPos[i * 3] = p.x;
      this.ptsPos[i * 3 + 1] = p.y;
      this.ptsPos[i * 3 + 2] = p.z;
      this.ptsCol[i * 3] = p.cr * a;
      this.ptsCol[i * 3 + 1] = p.cg * a;
      this.ptsCol[i * 3 + 2] = p.cb * a;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // burst shells
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.life -= dtS / b.max;
      if (b.life <= 0) {
        this.scene.remove(b.mesh);
        (b.mesh.material as THREE.Material).dispose();
        b.mesh.geometry.dispose();
        this.bursts.splice(i, 1);
        continue;
      }
      const t = 1 - b.life;
      const s = 1 + t * b.scale * 3;
      b.mesh.scale.set(s, s, s);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = b.life * 0.7;
    }

    this.syncProjectiles(world, timeMs, dtS);
    this.renderer.render(this.scene, this.camera);
    this.renderer.info.reset();
  }

  private poseRig(r: Rig, f: Fighter, theme: CharacterTheme, timeMs: number) {
    const p = poseFor(f, timeMs);
    const ud = (r as unknown as { userData: Record<string, unknown> }).userData;

    r.root.position.set(f.x, f.y, 0);
    r.root.rotation.y = f.facing === 1 ? 0 : Math.PI;
    r.body.position.y = p.hip;
    const lying = f.state === "down" || f.state === "ko";
    r.body.rotation.z = lying ? p.rot : 0;
    r.body.rotation.y = f.state === "attack" && f.move?.id === 15 ? p.rot : 0;
    r.body.rotation.x = 0;

    r.torso.rotation.z = -p.lean;
    r.head.rotation.z = -p.headLean;

    r.armF.rotation.z = p.armF[0];
    r.armF2.rotation.z = p.armF[1];
    r.armB.rotation.z = p.armB[0];
    r.armB2.rotation.z = p.armB[1];
    r.legF.rotation.z = p.legF[0];
    r.legF2.rotation.z = p.legF[1];
    r.legB.rotation.z = p.legB[0];
    r.legB2.rotation.z = p.legB[1];

    // per-character materials
    const tm = ud.torsoMesh as THREE.Mesh;
    const mm = tm.material as THREE.MeshStandardMaterial;
    mm.color.set(theme.suit);
    mm.emissive.set(f.state === "attack" ? theme.aura : "#000000");
    mm.emissiveIntensity = f.state === "attack" ? 0.55 : 0;
    const hm = ud.headMesh as THREE.Mesh;
    (hm.material as THREE.MeshStandardMaterial).color.set(theme.skin);
    const hair = ud.hairMesh as THREE.Mesh;
    (hair.material as THREE.MeshStandardMaterial).color.set(theme.hair);
    (ud.eyeMat as THREE.MeshBasicMaterial).color.set(
      f.state === "attack" ? theme.aura : theme.accent,
    );
    const armMats = ud.armMats as THREE.MeshStandardMaterial[];
    for (const m of armMats) m.color.set(theme.skin);
    const legMats = ud.legMats as THREE.MeshStandardMaterial[];
    for (const m of legMats) m.color.set(theme.suit);
    r.shadow.position.y = Math.max(1, -f.y + 1);
    r.shadow.position.x = 0;
    const shScale = Math.max(0.35, 1 - Math.abs(f.y) / 340);
    r.shadow.scale.set(shScale, shScale, shScale);
    (r.shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 * shScale;

    // aura: glow sprite + ring + point light
    const power = f.meter >= 100 ? 1 : f.state === "attack" ? 0.6 : 0.3;
    const flick =
      theme.auraStyle === "volt"
        ? (Math.sin(timeMs * 0.04) > 0.6 ? 1.5 : 0.7) + Math.random() * 0.15
        : 0.85 + Math.sin(timeMs * 0.011 + f.side * 2) * 0.18;
    const gm = r.glow.material as THREE.SpriteMaterial;
    gm.color.set(theme.aura);
    gm.opacity = 0.28 * power * flick;
    r.glow.scale.setScalar(210 + power * 70 + flick * 18);
    const rm = r.ring.material as THREE.MeshBasicMaterial;
    rm.color.set(f.meter >= 100 ? theme.accent : theme.aura);
    rm.opacity = 0.28 + power * 0.5;
    r.ring.scale.setScalar(1 + Math.sin(timeMs * 0.006 + f.side) * 0.06);
    r.ring.position.y = -f.y + 2; // ring stays on the floor
    r.light.color.set(theme.aura);
    r.light.intensity = power * flick * 1.6;

    // attack trail sparks from the strike point
    if (f.state === "attack" && f.move && swingOf(f) > 0.5 && Math.random() < 0.5) {
      const c = new THREE.Color(Math.random() < 0.6 ? theme.aura : theme.accent);
      const idx = this.pIndex++ % POOL;
      this.particles[idx] = {
        x: f.x + f.facing * f.move.reach * 0.6,
        y: f.y + f.move.hbY + 16,
        z: (Math.random() - 0.5) * 30,
        vx: f.facing * 120,
        vy: (Math.random() - 0.5) * 120,
        vz: 0,
        life: 1,
        max: 0.32,
        g: -200,
        cr: c.r,
        cg: c.g,
        cb: c.b,
      };
    }

    // ambient aura motes
    if (Math.random() < (f.state === "attack" ? 0.7 : 0.3)) {
      const c = new THREE.Color(Math.random() < 0.7 ? theme.aura : theme.accent);
      const idx = this.pIndex++ % POOL;
      const rise = theme.particle === "flake" || theme.particle === "shard";
      this.particles[idx] = {
        x: f.x + (Math.random() - 0.5) * 60,
        y: f.y + Math.random() * 110,
        z: (Math.random() - 0.5) * 50,
        vx: (Math.random() - 0.5) * 40,
        vy: rise ? -50 - Math.random() * 40 : 70 + Math.random() * 60,
        vz: 0,
        life: 1,
        max: 0.8,
        g: theme.particle === "shard" ? -500 : -40,
        cr: c.r,
        cg: c.g,
        cb: c.b,
      };
    }
  }

  private syncProjectiles(world: World, timeMs: number, dtS: number) {
    const live = new Set<number>();
    for (const p of world.projectiles) {
      live.add(p.id);
      let g = this.projMeshes.get(p.id);
      if (!g) {
        g = new THREE.Group();
        const theme = getCharacter(world.f[p.owner].charId);
        const geo = new THREE.SphereGeometry(p.w * 0.6, 12, 10);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(theme.aura) });
        const core = new THREE.Mesh(geo, mat);
        const tex = radialTexture();
        const smat = new THREE.SpriteMaterial({
          map: tex,
          color: new THREE.Color(theme.aura),
          transparent: true,
          opacity: 0.85,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const spr = new THREE.Sprite(smat);
        spr.scale.setScalar(p.w * 4.5);
        g.add(core, spr);
        this.scene.add(g);
        this.projMeshes.set(p.id, g);
      }
      g.position.set(p.x, p.y, 0);
      g.rotation.z += dtS * 9;
      const s = 1 + Math.sin(timeMs * 0.02 + p.id) * 0.12;
      g.scale.set(s, s, s);
      if (Math.random() < 0.7) {
        const theme = getCharacter(world.f[p.owner].charId);
        const c = new THREE.Color(theme.accent);
        const idx = this.pIndex++ % POOL;
        this.particles[idx] = {
          x: p.x - Math.sign(p.vx) * p.w,
          y: p.y,
          z: (Math.random() - 0.5) * 20,
          vx: -Math.sign(p.vx) * 60,
          vy: (Math.random() - 0.5) * 60,
          vz: 0,
          life: 1,
          max: 0.3,
          g: 0,
          cr: c.r,
          cg: c.g,
          cb: c.b,
        };
      }
    }
    for (const [id, g] of this.projMeshes) {
      if (!live.has(id)) {
        this.scene.remove(g);
        g.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.geometry) mesh.geometry.dispose();
          const m = (mesh as unknown as { material?: THREE.Material }).material;
          if (m) m.dispose();
          const sprite = o as THREE.Sprite;
          if (sprite.material) sprite.material.dispose();
        });
        this.projMeshes.delete(id);
      }
    }
  }
}

/** shared soft radial texture (module-level cache) */
let cachedGlow: THREE.CanvasTexture | null = null;
function radialTexture(): THREE.CanvasTexture {
  if (cachedGlow) return cachedGlow;
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.55)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  cachedGlow = new THREE.CanvasTexture(c);
  return cachedGlow;
}
