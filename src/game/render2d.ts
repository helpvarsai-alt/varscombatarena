import { MOVE_BY_ID } from "./combos";
import { getCharacter, type CharacterTheme } from "./characters";
import { POSE2D_LIMB, poseFor, swingOf, type Pose } from "./pose";
import { FIGHTER_H, STAGE, type Fighter, type FxEvent, type World } from "./sim";

/**
 * Canvas2D renderer — neon rooftop arena, articulated fighters, particle auras.
 * All per-character identity (aura color, particle behavior, trails) lives here;
 * the pose comes from the shared pose system.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: "dot" | "streak" | "flake" | "shard" | "shade" | "droplet" | "dust";
  g: number;
  rot: number;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
}

interface Wave {
  x: number;
  y: number;
  r: number;
  max: number;
  life: number;
  color: string;
  w: number;
}

const MAX_PARTICLES = 260;

export class CanvasRenderer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private particles: Particle[] = [];
  private texts: FloatText[] = [];
  private waves: Wave[] = [];
  private trail: [number[][], number[][]] = [[], []];
  private projTrail = new Map<number, { x: number; y: number }[]>();
  private auraT = 0;
  private stars: { x: number; y: number; r: number }[] = [];
  private buildings: { x: number; w: number; h: number; lit: number }[] = [];
  camX = 600;
  camShakeX = 0;
  camShakeY = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement("canvas");
    this.canvas.style.cssText =
      "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;";
    container.appendChild(this.canvas);
    const ctx = this.canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D unavailable");
    this.ctx = ctx;
    // deterministic scenery
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) this.stars.push({ x: rnd(), y: rnd() * 0.55, r: 0.5 + rnd() * 1.4 });
    let bx = -200;
    while (bx < 1700) {
      const bw = 60 + rnd() * 130;
      this.buildings.push({ x: bx, w: bw, h: 90 + rnd() * 260, lit: rnd() });
      bx += bw + 8 + rnd() * 30;
    }
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(1, Math.round(rect.width));
    this.h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  dispose() {
    this.canvas.remove();
  }

  /* ---------------------------------- fx ---------------------------------- */

  emitFx(e: FxEvent) {
    switch (e.type) {
      case "hit": {
        const mv = MOVE_BY_ID.get(e.move);
        const col = mv?.ultimate ? "#ffffff" : "#ffd166";
        this.burst(e.x, e.y, 16, col, 420, "streak");
        this.burst(e.x, e.y, 8, "#ffffff", 260, "dot");
        this.waves.push({
          x: e.x,
          y: e.y,
          r: 6,
          max: 90,
          life: 1,
          color: col,
          w: 5,
        });
        this.texts.push({
          x: e.x,
          y: e.y + 10,
          vy: -60,
          life: 1,
          max: 0.8,
          text: String(mv?.dmg ?? 5),
          color: col,
          size: 26,
        });
        break;
      }
      case "block": {
        this.burst(e.x, e.y, 8, "#9bd8ff", 240, "dot");
        this.waves.push({ x: e.x, y: e.y, r: 4, max: 55, life: 1, color: "#9bd8ff", w: 3 });
        this.texts.push({
          x: e.x,
          y: e.y,
          vy: -44,
          life: 1,
          max: 0.6,
          text: "BLOCK",
          color: "#9bd8ff",
          size: 17,
        });
        break;
      }
      case "jump":
        this.dust(e.x, 4, "#6b7590");
        break;
      case "land":
        this.dust(e.x, 10, "#7d88a6");
        this.waves.push({ x: e.x, y: 6, r: 4, max: 70, life: 0.8, color: "#8f9ab8", w: 3 });
        break;
      case "ko": {
        this.burst(e.x, e.y, 40, "#ffffff", 620, "streak");
        this.burst(e.x, e.y, 20, "#ffd166", 380, "dot");
        this.waves.push({ x: e.x, y: e.y, r: 8, max: 320, life: 1.2, color: "#ffffff", w: 8 });
        this.texts.push({
          x: e.x,
          y: e.y + 40,
          vy: -30,
          life: 1.4,
          max: 1.4,
          text: "K.O.",
          color: "#ffffff",
          size: 54,
        });
        break;
      }
      case "ult": {
        this.waves.push({ x: e.x, y: e.y, r: 10, max: 420, life: 1.3, color: "#fff2a8", w: 10 });
        this.burst(e.x, e.y, 44, "#fff2a8", 520, "streak");
        break;
      }
      default:
        break;
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, kind: Particle["kind"]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1,
        max: 0.35 + Math.random() * 0.4,
        size: 2 + Math.random() * 4,
        color,
        kind,
        g: 300,
        rot: a,
      });
    }
  }

  private dust(x: number, n: number, color: string) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 30,
        y: 4,
        vx: (Math.random() - 0.5) * 220,
        vy: -40 - Math.random() * 120,
        life: 1,
        max: 0.5,
        size: 3 + Math.random() * 5,
        color,
        kind: "dust",
        g: 320,
        rot: 0,
      });
    }
  }

  private spawn(p: Particle) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push(p);
  }

  /* --------------------------------- render -------------------------------- */

  render(world: World, timeMs: number, dt: number) {
    const ctx = this.ctx;
    const dtS = Math.min(0.05, dt / 1000);
    this.auraT += dt;

    const [f1, f2] = world.f;
    const mid = (f1.x + f2.x) / 2;
    const dist = Math.abs(f1.x - f2.x);
    const desiredW = Math.min(1500, Math.max(720, dist * 1.35 + 420));
    const scale = Math.min(this.w / desiredW, this.h / 520);
    const viewW = this.w / scale;
    const groundY = this.h * 0.86;

    // camera follow + shake
    this.camX += (mid - this.camX) * 0.09;
    const camMin = STAGE.minX + viewW / 2 - 120;
    const camMax = STAGE.maxX - viewW / 2 + 120;
    if (camMin < camMax) this.camX = Math.max(camMin, Math.min(camMax, this.camX));
    else this.camX = STAGE.minX + (STAGE.maxX - STAGE.minX) / 2;
    const shake = world.shake;
    this.camShakeX = (Math.random() - 0.5) * shake * 2.2;
    this.camShakeY = (Math.random() - 0.5) * shake * 2.2;

    const sx = (wx: number) => (wx - this.camX) * scale + this.w / 2 + this.camShakeX;
    const sy = (wy: number) => groundY - wy * scale + this.camShakeY;

    this.drawStage(ctx, scale, sx, sy, groundY);

    // shadows first
    for (const f of world.f) {
      const theme = getCharacter(f.charId);
      const sh = Math.max(0.25, 1 - Math.abs(f.y) / 320);
      ctx.globalAlpha = 0.4 * sh;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.ellipse(sx(f.x), sy(0), 34 * scale * sh, 9 * scale * sh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      void theme;
    }

    this.ambientAura(world, scale, dtS);

    // fighters
    for (const f of world.f) {
      const theme = getCharacter(f.charId);
      this.drawAura(ctx, f, theme, sx, sy, scale, timeMs);
      this.drawFighter(ctx, f, theme, sx, sy, scale, timeMs);
    }

    this.drawProjectiles(world, sx, sy, scale);
    this.stepParticles(dtS, sx, sy, scale);
    this.drawWaves(sx, sy, scale, dtS);
    this.drawTexts(sx, sy, scale, dtS);

    if (world.flash > 0.01) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.65, world.flash * 0.6)})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private drawStage(
    ctx: CanvasRenderingContext2D,
    scale: number,
    sx: (x: number) => number,
    sy: (y: number) => number,
    groundY: number,
  ) {
    const w = this.w;
    const h = this.h;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#070a18");
    sky.addColorStop(0.55, "#1b1038");
    sky.addColorStop(0.8, "#3d1440");
    sky.addColorStop(1, "#170a20");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    // stars
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    const px = (this.camX * 0.05) % w;
    for (const s of this.stars) {
      const x = ((s.x * w - px) % w + w) % w;
      ctx.globalAlpha = 0.25 + 0.55 * Math.abs(Math.sin(s.x * 40 + s.y * 20));
      ctx.fillRect(x, s.y * h * 0.7, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    // moon
    const moonX = w * 0.74 - (this.camX - 600) * 0.04;
    const moonY = h * 0.2;
    const mg = ctx.createRadialGradient(moonX, moonY, 6, moonX, moonY, 90);
    mg.addColorStop(0, "rgba(255,240,214,0.9)");
    mg.addColorStop(0.25, "rgba(255,222,170,0.35)");
    mg.addColorStop(1, "rgba(255,222,170,0)");
    ctx.fillStyle = mg;
    ctx.beginPath();
    ctx.arc(moonX, moonY, 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff3d6";
    ctx.beginPath();
    ctx.arc(moonX, moonY, 34, 0, Math.PI * 2);
    ctx.fill();

    // far skyline
    const par1 = (this.camX - 600) * 0.14;
    ctx.fillStyle = "#0d1026";
    for (const b of this.buildings) {
      const x = b.x - par1;
      const top = groundY - b.h * scale * 1.15;
      ctx.fillRect(x, top, b.w, groundY - top + 4);
      // windows
      ctx.fillStyle = b.lit > 0.5 ? "rgba(255,214,110,0.5)" : "rgba(120,220,255,0.4)";
      const cols = Math.floor(b.w / 22);
      const rows = Math.floor(b.h / 34);
      for (let cx = 0; cx < cols; cx++) {
        for (let ry = 0; ry < rows; ry++) {
          if ((cx * 7 + ry * 13 + Math.floor(b.lit * 100)) % 5 < 2) continue;
          ctx.fillRect(x + 8 + cx * 22, top + 10 + ry * 34, 8, 12);
        }
      }
      ctx.fillStyle = "#0d1026";
    }

    // near neon wall
    const par2 = (this.camX - 600) * 0.4;
    const wallTop = groundY - 150 * scale;
    const wg = ctx.createLinearGradient(0, wallTop, 0, groundY);
    wg.addColorStop(0, "#161a33");
    wg.addColorStop(1, "#0b0e1e");
    ctx.fillStyle = wg;
    ctx.fillRect(0, wallTop, w, groundY - wallTop + 2);
    // neon strip
    ctx.strokeStyle = "rgba(255,90,160,0.55)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, wallTop + 8);
    ctx.lineTo(w, wallTop + 8);
    ctx.stroke();
    // neon signs
    const signX = ((w * 0.5 - par2) % (w + 400)) - 200;
    ctx.save();
    ctx.shadowColor = "#ff4fa3";
    ctx.shadowBlur = 22;
    ctx.strokeStyle = "#ff7ac2";
    ctx.lineWidth = 4;
    ctx.strokeRect(signX, wallTop + 34, 130, 58);
    ctx.fillStyle = "rgba(255,122,194,0.9)";
    ctx.font = "bold 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("FIGHT", signX + 65, wallTop + 74);
    ctx.restore();

    // floor
    const floorTop = sy(0);
    const fg = ctx.createLinearGradient(0, floorTop, 0, h);
    fg.addColorStop(0, "#1a2138");
    fg.addColorStop(1, "#080b16");
    ctx.fillStyle = fg;
    ctx.fillRect(0, floorTop, w, h - floorTop);
    // grid perspective lines
    ctx.strokeStyle = "rgba(90,220,255,0.14)";
    ctx.lineWidth = 1;
    const stageL = sx(STAGE.minX - 60);
    const stageR = sx(STAGE.maxX + 60);
    for (let x = stageL; x <= stageR; x += 80 * scale) {
      ctx.beginPath();
      ctx.moveTo(x, floorTop);
      ctx.lineTo(x + (x - w / 2) * 0.35, h);
      ctx.stroke();
    }
    for (let i = 1; i < 6; i++) {
      const yy = floorTop + Math.pow(i / 6, 1.7) * (h - floorTop);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
    // stage edge glow
    ctx.strokeStyle = "#4be3ff";
    ctx.shadowColor = "#4be3ff";
    ctx.shadowBlur = 16;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(stageL, floorTop);
    ctx.lineTo(stageR, floorTop);
    ctx.stroke();
    ctx.shadowBlur = 0;
    void scale;
  }

  /* -------------------------------- fighters ------------------------------- */

  private limbEnd(
    x: number,
    y: number,
    a1: number,
    l1: number,
    a2: number,
    l2: number,
  ): { ex: number; ey: number; mx: number; my: number } {
    const mx = x + Math.sin(a1) * l1;
    const my = y - Math.cos(a1) * l1;
    const a = a1 + a2;
    const ex = mx + Math.sin(a) * l2;
    const ey = my - Math.cos(a) * l2;
    return { mx, my, ex, ey };
  }

  private drawSegment(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    a1: number,
    l1: number,
    a2: number,
    l2: number,
    color: string,
    w1: number,
    w2: number,
  ) {
    const j = this.limbEnd(x, y, a1, l1, a2, l2);
    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.lineWidth = w1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(j.mx, j.my);
    ctx.stroke();
    ctx.lineWidth = w2;
    ctx.beginPath();
    ctx.moveTo(j.mx, j.my);
    ctx.lineTo(j.ex, j.ey);
    ctx.stroke();
    return j;
  }

  private drawFighter(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    theme: CharacterTheme,
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
    timeMs: number,
  ) {
    const p: Pose = poseFor(f, timeMs);
    const active = f.state === "attack";
    const glow = active ? 0.55 : 0.16 + (f.meter >= 100 ? 0.3 : 0);

    ctx.save();
    ctx.translate(sx(f.x), sy(f.y));
    ctx.scale(f.facing * scale, scale);
    if (p.rot) {
      // rotate around the feet for spins / knockdowns
      ctx.translate(0, 0);
      ctx.rotate(p.rot * f.facing * 0.0 + p.rot);
    }

    const hipY = p.hip;
    const torsoLen = 52;
    const shoulderX = Math.sin(p.lean) * torsoLen;
    const shoulderY = hipY + Math.cos(p.lean) * torsoLen;
    const headX = shoulderX + Math.sin(p.lean + p.headLean) * 22;
    const headY = shoulderY + Math.cos(p.lean + p.headLean) * 22;

    const suit = theme.suit;
    const skin = theme.skin;
    const hair = theme.hair;
    const accent = theme.accent;
    const shade = (c: string, amt: number) => shadeColor(c, amt);

    // attack swoosh trail
    if (active && f.move) {
      const s = swingOf(f);
      if (s > 0.15) {
        ctx.globalAlpha = 0.32 * s;
        ctx.strokeStyle = theme.aura;
        ctx.lineWidth = 10;
        ctx.lineCap = "round";
        const r = 60 + s * 34;
        ctx.beginPath();
        ctx.arc(shoulderX, shoulderY, r, -1.5, -1.5 + 1.4 * s);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // back limbs (darker)
    this.drawSegment(
      ctx,
      0,
      hipY,
      p.legB[0],
      POSE2D_LIMB.thigh,
      p.legB[1],
      POSE2D_LIMB.shin,
      shade(suit, -28),
      15,
      12,
    );
    this.drawSegment(ctx, shoulderX, shoulderY, p.armB[0], 32, p.armB[1], 30, shade(skin, -26), 11, 9);

    // torso
    ctx.strokeStyle = suit;
    ctx.lineCap = "round";
    ctx.lineWidth = 30;
    ctx.beginPath();
    ctx.moveTo(0, hipY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.stroke();
    // belt
    ctx.strokeStyle = accent;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, hipY + 4);
    ctx.lineTo(8, hipY + 4);
    ctx.stroke();
    // chest emblem glow while powered
    if (glow > 0.3) {
      ctx.globalAlpha = Math.min(1, glow);
      ctx.fillStyle = theme.aura;
      ctx.beginPath();
      ctx.arc(shoulderX * 0.5, (hipY + shoulderY) / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(headX, headY, 16, 0, Math.PI * 2);
    ctx.fill();
    // hair
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.arc(headX, headY, 16, Math.PI * 1.05, Math.PI * 2.05);
    ctx.fill();
    // eye glow
    ctx.fillStyle = active ? theme.aura : accent;
    ctx.globalAlpha = active ? 1 : 0.85;
    ctx.fillRect(headX + 5, headY - 3, 7, 3.4);
    ctx.globalAlpha = 1;

    // front limbs
    this.drawSegment(
      ctx,
      0,
      hipY,
      p.legF[0],
      POSE2D_LIMB.thigh,
      p.legF[1],
      POSE2D_LIMB.shin,
      suit,
      16,
      13,
    );
    const hand = this.drawSegment(
      ctx,
      shoulderX,
      shoulderY,
      p.armF[0],
      32,
      p.armF[1],
      30,
      skin,
      12,
      10,
    );

    // gloves / wraps
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(hand.ex, hand.ey, 6.5, 0, Math.PI * 2);
    ctx.fill();

    // charge aura rim on the body
    if (glow > 0.2) {
      ctx.globalAlpha = Math.min(0.9, glow * 0.7);
      ctx.strokeStyle = theme.aura;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, hipY);
      ctx.lineTo(shoulderX, shoulderY);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // attack trail particles from the striking hand
    if (active && f.move) {
      const s = swingOf(f);
      if (s > 0.5 && Math.random() < 0.6) {
        const local = this.trail[f.side];
        const reach = f.move.reach * 0.55;
        const hx = f.x + f.facing * reach;
        const hy = f.y + f.move.hbY + 14;
        void local;
        this.spawn({
          x: hx,
          y: hy,
          vx: f.facing * 90,
          vy: (Math.random() - 0.5) * 90,
          life: 1,
          max: 0.3,
          size: 3 + Math.random() * 3,
          color: theme.aura,
          kind: particleKindOf(theme),
          g: 60,
          rot: 0,
        });
      }
    }
  }

  private drawAura(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    theme: CharacterTheme,
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
    timeMs: number,
  ) {
    const power = f.meter >= 100 ? 1 : f.state === "attack" ? 0.55 : 0.3;
    const cx = sx(f.x);
    const cy = sy(f.y + 70);
    const flick = 0.85 + Math.sin(timeMs * 0.012 + f.side * 3) * 0.15;
    const r = 78 * scale * flick * (0.7 + power * 0.5);

    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, r);
    const col = theme.aura;
    g.addColorStop(0, hexA(col, 0.32 * power));
    g.addColorStop(0.55, hexA(col, 0.14 * power));
    g.addColorStop(1, hexA(col, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    // style flourish behind the fighter
    ctx.save();
    ctx.translate(sx(f.x), sy(0));
    ctx.scale(f.facing * scale, scale);
    ctx.strokeStyle = hexA(theme.aura, 0.5 * power);
    ctx.fillStyle = hexA(theme.aura, 0.4 * power);
    const t = timeMs * 0.004;
    switch (theme.auraStyle) {
      case "flame": {
        ctx.beginPath();
        for (let i = -2; i <= 2; i++) {
          const bx = i * 16;
          const hgt = 60 + Math.sin(t * 3 + i) * 22;
          ctx.moveTo(bx - 9, 0);
          ctx.quadraticCurveTo(bx - 4, hgt * 0.6, bx, hgt);
          ctx.quadraticCurveTo(bx + 4, hgt * 0.6, bx + 9, 0);
        }
        ctx.fill();
        break;
      }
      case "frost": {
        for (let i = 0; i < 4; i++) {
          const a = t + (i * Math.PI) / 2;
          const rr = 40 + Math.sin(t * 2 + i) * 8;
          const px = Math.cos(a) * rr;
          const py = 70 + Math.sin(a) * rr * 0.7;
          drawHexagon(ctx, px, py, 6 + (i % 2) * 3);
        }
        break;
      }
      case "volt": {
        if (Math.sin(t * 9) > 0.35) {
          ctx.beginPath();
          ctx.moveTo(-10, 140);
          ctx.lineTo(6, 96);
          ctx.lineTo(-4, 92);
          ctx.lineTo(10, 40);
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        break;
      }
      case "stone": {
        ctx.globalAlpha = 0.5 * power;
        for (let i = 0; i < 5; i++) {
          const px = Math.sin(t * 1.3 + i * 1.7) * 44;
          const py = 6 + ((i * 37) % 40) + Math.sin(t * 2 + i) * 5;
          ctx.fillRect(px, py, 5, 5);
        }
        ctx.globalAlpha = 1;
        break;
      }
      case "void": {
        ctx.beginPath();
        ctx.ellipse(0, 74, 46 + Math.sin(t * 2) * 6, 66, t * 0.4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, 74, 30, 48 + Math.cos(t * 2.4) * 6, -t * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case "tide": {
        ctx.beginPath();
        for (let x = -50; x <= 50; x += 6) {
          const y = 30 + Math.sin(x * 0.12 + t * 3) * 8;
          if (x === -50) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        for (let x = -44; x <= 44; x += 6) {
          const y = 100 + Math.sin(x * 0.1 - t * 2.4) * 9;
          if (x === -44) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private ambientAura(world: World, scale: number, dtS: number) {
    this.auraT += 0;
    for (const f of world.f) {
      const theme = getCharacter(f.charId);
      const rate = f.state === "attack" ? 0.55 : f.meter >= 100 ? 0.5 : 0.2;
      if (Math.random() < rate) {
        const px = f.x + (Math.random() - 0.5) * 46;
        const kind = particleKindOf(theme);
        this.spawn({
          x: px,
          y: 4 + Math.random() * 90,
          vx: (Math.random() - 0.5) * 40,
          vy: kind === "flake" || kind === "shard" ? -30 - Math.random() * 40 : 60 + Math.random() * 70,
          life: 1,
          max: 0.7 + Math.random() * 0.6,
          size: 2 + Math.random() * 3.4,
          color: Math.random() < 0.7 ? theme.aura : theme.accent,
          kind,
          g: kind === "shard" ? 420 : kind === "flake" ? -10 : -60,
          rot: Math.random() * Math.PI,
        });
      }
    }
    void scale;
    void dtS;
  }

  private stepParticles(dtS: number, sx: (x: number) => number, sy: (y: number) => number, scale: number) {
    const ctx = this.ctx;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtS / p.max;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.g * dtS;
      p.x += p.vx * dtS;
      p.y += p.vy * dtS;
      p.rot += dtS * 6;
      const a = Math.max(0, p.life);
      const x = sx(p.x);
      const y = sy(p.y);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case "streak":
          ctx.strokeStyle = p.color;
          ctx.lineWidth = Math.max(1, p.size * 0.6 * scale);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x - p.vx * 0.04 * scale, y + p.vy * 0.04 * scale);
          ctx.stroke();
          break;
        case "flake":
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(-p.size, 0);
          ctx.lineTo(p.size, 0);
          ctx.moveTo(0, -p.size);
          ctx.lineTo(0, p.size);
          ctx.stroke();
          ctx.restore();
          break;
        case "shard":
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
          ctx.restore();
          break;
        case "droplet":
          ctx.beginPath();
          ctx.ellipse(x, y, p.size * 0.7, p.size * 1.2, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
        case "shade":
          ctx.globalAlpha = a * 0.6;
          ctx.beginPath();
          ctx.arc(x, y, p.size * 1.6, 0, Math.PI * 2);
          ctx.fill();
          break;
        default:
          ctx.beginPath();
          ctx.arc(x, y, p.size, 0, Math.PI * 2);
          ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawWaves(
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
    dtS: number,
  ) {
    const ctx = this.ctx;
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const wv = this.waves[i];
      wv.life -= dtS * 2.2;
      if (wv.life <= 0) {
        this.waves.splice(i, 1);
        continue;
      }
      const t = 1 - wv.life;
      const r = (wv.r + t * wv.max) * scale;
      ctx.globalAlpha = Math.max(0, wv.life) * 0.8;
      ctx.strokeStyle = wv.color;
      ctx.lineWidth = Math.max(1, wv.w * scale * wv.life);
      ctx.beginPath();
      ctx.arc(sx(wv.x), sy(wv.y), r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private drawTexts(
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
    dtS: number,
  ) {
    const ctx = this.ctx;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dtS / t.max;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * dtS;
      t.vy *= 0.94;
      ctx.globalAlpha = Math.min(1, t.life * 1.6);
      ctx.font = `800 ${t.size * scale}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(0,0,0,0.65)";
      ctx.strokeText(t.text, sx(t.x), sy(t.y));
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx(t.x), sy(t.y));
    }
    ctx.globalAlpha = 1;
  }

  private drawProjectiles(
    world: World,
    sx: (x: number) => number,
    sy: (y: number) => number,
    scale: number,
  ) {
    const ctx = this.ctx;
    const live = new Set<number>();
    for (const p of world.projectiles) {
      live.add(p.id);
      const theme = getCharacter(world.f[p.owner].charId);
      let pts = this.projTrail.get(p.id);
      if (!pts) {
        pts = [];
        this.projTrail.set(p.id, pts);
      }
      pts.push({ x: p.x, y: p.y });
      if (pts.length > 10) pts.shift();
      // trail
      for (let i = 0; i < pts.length; i++) {
        const a = (i / pts.length) * 0.5;
        ctx.globalAlpha = a;
        ctx.fillStyle = theme.aura;
        const r = p.w * scale * (0.35 + (i / pts.length) * 0.65);
        ctx.beginPath();
        ctx.arc(sx(pts[i].x), sy(pts[i].y), r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // core
      const cx = sx(p.x);
      const cy = sy(p.y);
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, p.w * scale * 1.8);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.35, theme.aura);
      g.addColorStop(1, hexA(theme.aura, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, p.w * scale * 1.8, 0, Math.PI * 2);
      ctx.fill();
      // spin core mark
      ctx.strokeStyle = hexA(theme.accent, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, p.w * scale * 0.55, 0, Math.PI * 1.4);
      ctx.stroke();
    }
    for (const id of this.projTrail.keys()) {
      if (!live.has(id)) this.projTrail.delete(id);
    }
  }
}

/* --------------------------------- helpers -------------------------------- */

function particleKindOf(theme: CharacterTheme): Particle["kind"] {
  switch (theme.particle) {
    case "ember":
      return "dot";
    case "flake":
      return "flake";
    case "volt":
      return "streak";
    case "shard":
      return "shard";
    case "shade":
      return "shade";
    case "droplet":
      return "droplet";
    default:
      return "dot";
  }
}

function shadeColor(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0xff) + amt;
  let b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `rgb(${r},${g},${b})`;
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 0xff},${(n >> 8) & 0xff},${n & 0xff},${a})`;
}

function drawHexagon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

export { FIGHTER_H };
