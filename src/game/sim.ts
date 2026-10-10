import { MOVE_BY_ID, matchCombo, type MoveData } from "./combos";

/**
 * Fixed-timestep fighting simulation (60Hz logical ticks).
 *
 * One world simulates both fighters. Hit detection is attacker-side: whoever
 * throws the move checks overlap and emits a compact hit event that the other
 * client applies to its own fighter (hp/stun are defender-authoritative), so
 * two players on different continents agree without a server sim.
 */

export const STEP_MS = 1000 / 60;
export const STAGE = { minX: 60, maxX: 1140, floorY: 0 };
export const GRAVITY = 2600;
export const WALK_SPEED = 330;
export const BACK_SPEED = 245;
export const JUMP_V = -960;
export const MAX_HP = 100;
export const MAX_METER = 100;
export const MATCH_SECONDS = 99;
export const FIGHTER_H = 150;
export const FIGHTER_W = 48;

export type FState =
  | "idle"
  | "walk"
  | "crouch"
  | "air"
  | "attack"
  | "hurt"
  | "block"
  | "down"
  | "ko"
  | "win";

export interface FighterInput {
  held: { l: boolean; r: boolean; u: boolean; d: boolean };
  tokens: string[];
}

export function emptyInput(): FighterInput {
  return { held: { l: false, r: false, u: false, d: false }, tokens: [] };
}

export interface Fighter {
  side: 0 | 1;
  charId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  hp: number;
  meter: number;
  state: FState;
  stateT: number;
  move: MoveData | null;
  moveFrame: number;
  hitsLanded: number;
  spawned: boolean;
  rehitT: number;
  hitstun: number;
  blockstun: number;
  downT: number;
  invuln: number;
  projCd: number;
  blocking: boolean;
  airborne: boolean;
  jumpLatch: boolean;
  comboHits: number;
  comboT: number;
  buf: { tok: string; t: number }[];
  pending: MoveData | null;
  /** online: last opponent event seq applied (sent back as ack) */
  acked: number;
  /** online: frames to keep local predicted reaction before snapshot sync */
  predT: number;
  walkPhase: number;
}

/** attacker-authoritative hit packet (compact) */
export interface OutEvent {
  s: number; // seq
  o: 0 | 1; // owner/attacker side
  m: number; // move id
  d: number; // raw damage
  k: number; // knockback x
  y: number; // knockback y (launch)
  h: number; // hitstun frames
  kn: 0 | 1; // knockdown
}

export interface Projectile {
  id: number;
  owner: 0 | 1;
  move: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  life: number;
  rehit: number;
  hits: number;
}

export type FxEvent =
  | { type: "hit"; side: 0 | 1; x: number; y: number; move: number; blocked: boolean }
  | { type: "block"; side: 0 | 1; x: number; y: number }
  | { type: "whiff"; side: 0 | 1; move: number }
  | { type: "jump"; side: 0 | 1; x: number }
  | { type: "land"; side: 0 | 1; x: number }
  | { type: "ko"; x: number; y: number }
  | { type: "ult"; side: 0 | 1; move: number; x: number; y: number }
  | { type: "nometer"; side: 0 | 1 };

export interface Snap {
  t: number;
  x: number;
  y: number;
  f: number;
  h: number;
  m: number;
  s: FState;
  mv: number;
  mf: number;
  b: 0 | 1;
  c: number;
  ev: number[][];
  ack: number;
}

function makeFighter(side: 0 | 1, charId: string): Fighter {
  return {
    side,
    charId,
    x: side === 0 ? 380 : 820,
    y: 0,
    vx: 0,
    vy: 0,
    facing: side === 0 ? 1 : -1,
    hp: MAX_HP,
    meter: 0,
    state: "idle",
    stateT: 0,
    move: null,
    moveFrame: 0,
    hitsLanded: 0,
    spawned: false,
    rehitT: 0,
    hitstun: 0,
    blockstun: 0,
    downT: 0,
    invuln: 0,
    projCd: 0,
    blocking: false,
    airborne: false,
    jumpLatch: false,
    comboHits: 0,
    comboT: 0,
    buf: [],
    pending: null,
    acked: 0,
    predT: 0,
    walkPhase: 0,
  };
}

export class World {
  f: [Fighter, Fighter];
  projectiles: Projectile[] = [];
  clock = 0; // world ms
  hitstop = 0;
  shake = 0;
  flash = 0;
  over = false;
  winner: 0 | 1 | "tie" | null = null;
  /** which side is remote-driven (online). null = full local sim (AI) */
  remoteSide: 0 | 1 | null = null;
  outEvents: OutEvent[] = [];
  seq = 0;
  projId = 1;
  onFx: (e: FxEvent) => void = () => {};

  constructor(char0: string, char1: string, remoteSide: 0 | 1 | null = null) {
    this.f = [makeFighter(0, char0), makeFighter(1, char1)];
    this.remoteSide = remoteSide;
  }

  me(): 0 | 1 {
    return this.remoteSide === 1 ? 0 : this.remoteSide === 0 ? 1 : 0;
  }

  pushTokens(side: 0 | 1, tokens: string[]) {
    const f = this.f[side];
    for (const tok of tokens) f.buf.push({ tok, t: this.clock });
  }

  step(inputs: [FighterInput, FighterInput]) {
    this.clock += STEP_MS;
    this.shake = Math.max(0, this.shake - 0.9);
    this.flash = Math.max(0, this.flash - 0.06);
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    for (let s = 0 as 0 | 1; s <= 1; s = (s + 1) as 0 | 1) {
      if (this.remoteSide === s) {
        // remote fighter is driven purely by network snapshots (no local physics
        // drift between packets — renderers interpolate)
        const f = this.f[s];
        f.predT = Math.max(0, f.predT - 1);
        continue;
      }
      this.stepFighter(this.f[s], this.f[1 - s], inputs[s]);
    }
    this.stepProjectiles();
    this.pushApart();
  }

  /* ------------------------------ fighter tick ----------------------------- */

  private stepFighter(f: Fighter, opp: Fighter, input: FighterInput) {
    const dt = STEP_MS / 1000;
    f.stateT++;
    // inputs are always buffered, even during hitstun — classic input buffering
    for (const tok of input.tokens) f.buf.push({ tok, t: this.clock });
    input.tokens.length = 0;
    if (f.projCd > 0) f.projCd -= STEP_MS;
    if (f.rehitT > 0) f.rehitT--;
    if (f.invuln > 0) f.invuln--;
    if (f.comboT > 0) {
      f.comboT -= STEP_MS;
      if (f.comboT <= 0) f.comboHits = 0;
    }

    // knockdown lying
    if (f.downT > 0) {
      if (f.airborne) {
        this.integrate(f);
        if (f.y >= 0 && f.vy > 0) {
          f.airborne = false;
          f.y = 0;
          f.vy = 0;
          f.vx *= 0.2;
          this.onFx({ type: "land", side: f.side, x: f.x });
        }
        return;
      }
      f.downT--;
      f.vx *= 0.8;
      f.state = "down";
      if (f.downT === 0) {
        f.invuln = 10;
        f.state = "idle";
        f.stateT = 0;
      }
      this.integrate(f);
      return;
    }

    // hitstun / blockstun
    if (f.hitstun > 0) {
      f.hitstun--;
      if (f.state !== "ko") f.state = "hurt";
      f.blocking = false;
      if (f.airborne) {
        this.integrate(f);
        if (f.y >= 0 && f.vy > 0) {
          f.airborne = false;
          f.y = 0;
          f.vy = 0;
          // landing during juggle -> hard knockdown (but a KO stays a KO)
          if (f.state !== "ko") {
            f.downT = 42;
            f.state = "down";
          }
          this.onFx({ type: "land", side: f.side, x: f.x });
        }
      } else {
        f.vx *= 0.86;
        this.integrate(f);
      }
      return;
    }
    if (f.blockstun > 0) {
      f.blockstun--;
      f.state = "block";
      f.vx *= 0.84;
      this.integrate(f);
      return;
    }

    // facing
    if (!f.move && f.state !== "ko") {
      const nf: 1 | -1 = opp.x >= f.x ? 1 : -1;
      if (nf !== f.facing) {
        f.facing = nf;
        f.stateT = 0;
      }
    }

    // attack in progress?
    if (f.move) {
      this.advanceAttack(f, opp, input);
      this.integrate(f);
      return;
    }

    // ------- free to act -------
    if (!input.held.u) f.jumpLatch = false;

    const fwd = f.facing === 1 ? input.held.r : input.held.l;
    const back = f.facing === 1 ? input.held.l : input.held.r;
    f.blocking = !f.airborne && back && !input.held.d;

    // combo input matching
    const res = matchCombo(f.buf, this.clock);
    if (res.kind === "move") {
      const mv = MOVE_BY_ID.get(res.id);
      if (mv) this.tryStart(f, mv);
    }

    if (f.airborne) {
      // air steering
      let ax = 0;
      if (input.held.l) ax -= 1;
      if (input.held.r) ax += 1;
      f.vx += ax * 900 * dt;
      f.vx = Math.max(-WALK_SPEED, Math.min(WALK_SPEED, f.vx));
      f.vx *= 0.985;
      f.state = "air";
      this.integrate(f);
      return;
    }

    // grounded movement
    if (input.held.d) {
      f.state = "crouch";
      f.vx = 0;
      f.blocking = back;
      this.integrate(f);
      return;
    }
    if (input.held.u && !f.jumpLatch) {
      f.jumpLatch = true;
      f.airborne = true;
      f.vy = JUMP_V;
      f.y = -1;
      f.state = "air";
      this.onFx({ type: "jump", side: f.side, x: f.x });
    }
    if (f.airborne) {
      this.integrate(f);
      return;
    }
    if (fwd && !back) {
      f.vx = WALK_SPEED * f.facing;
      f.state = "walk";
      f.walkPhase += STEP_MS * 0.02;
    } else if (back && !fwd) {
      f.vx = -BACK_SPEED * f.facing;
      f.state = "walk";
      f.walkPhase -= STEP_MS * 0.02;
    } else {
      f.vx = 0;
      f.state = "idle";
      f.walkPhase *= 0.8;
    }
    this.integrate(f);
  }

  private integrate(f: Fighter) {
    f.x += (f.vx * STEP_MS) / 1000;
    if (f.airborne || f.y < 0 || f.vy !== 0) {
      f.vy += GRAVITY * (STEP_MS / 1000);
      f.y += (f.vy * STEP_MS) / 1000;
      if (f.y >= STAGE.floorY && f.vy > 0) {
        if (f.airborne && f.hitstun <= 0 && f.downT <= 0) {
          f.state = "idle";
          this.onFx({ type: "land", side: f.side, x: f.x });
        }
        f.y = STAGE.floorY;
        f.vy = 0;
        f.airborne = false;
      }
    }
    if (f.x < STAGE.minX) f.x = STAGE.minX;
    if (f.x > STAGE.maxX) f.x = STAGE.maxX;
    if (f.state !== "walk") f.vx *= 0.9;
  }

  /* -------------------------------- attacks -------------------------------- */

  private tryStart(f: Fighter, mv: MoveData) {
    if (mv.air && !f.airborne) return;
    if (mv.ground && f.airborne) return;
    if (mv.meterCost && f.meter < mv.meterCost) {
      this.onFx({ type: "nometer", side: f.side });
      return;
    }
    if (mv.projSpeed && f.projCd > 0) return;

    const canAct =
      !f.move && (f.state === "idle" || f.state === "walk" || f.state === "crouch" || f.state === "air");
    if (canAct) {
      this.startMove(f, mv);
      return;
    }
    // buffering: queue the move for the moment recovery ends (latest wins),
    // so L, L, H strings flow jab -> Double Tap -> Rush String smoothly.
    if (f.move) {
      f.pending = mv;
      return;
    }
    // otherwise (hitstun / blockstun / knockdown) the input is dropped —
    // correct fighting-game feel: you cannot act out of stun.
  }

  private startMove(f: Fighter, mv: MoveData) {
    f.move = mv;
    f.moveFrame = 0;
    f.hitsLanded = 0;
    f.spawned = false;
    f.rehitT = 0;
    f.state = "attack";
    f.stateT = 0;
    f.blocking = false;
    if (mv.meterCost) f.meter = 0;
    if (mv.dash) f.vx = 0;
    if (mv.dive && f.airborne) {
      f.vy = 520;
      f.vx = f.facing * 420;
    }
    if (mv.ultimate) {
      this.flash = 1;
      this.onFx({ type: "ult", side: f.side, move: mv.id, x: f.x, y: f.y + 90 });
    }
  }

  private advanceAttack(f: Fighter, opp: Fighter, input: FighterInput) {
    const mv = f.move!;
    f.moveFrame++;
    const dt = STEP_MS / 1000;

    if (f.airborne && mv.dash) {
      // dash moves that leave the ground fall normally
      this.applyGravityOnly(f, dt);
    }

    // dash propulsion
    if (mv.dash && f.moveFrame >= mv.windup && f.moveFrame <= mv.windup + mv.active) {
      f.vx = f.facing * mv.dash;
    } else if (mv.dash) {
      f.vx *= 0.8;
    }

    const activeStart = mv.windup;
    const activeEnd = mv.windup + mv.active;

    // projectile spawn
    if (mv.projSpeed && f.moveFrame === activeStart && !f.spawned) {
      f.spawned = true;
      f.projCd = mv.cd ?? 800;
      this.projectiles.push({
        id: this.projId++,
        owner: f.side,
        move: mv.id,
        x: f.x + f.facing * 44,
        y: mv.hbY + 8,
        vx: f.facing * mv.projSpeed,
        vy: 0,
        w: mv.projSize ?? 24,
        h: mv.projSize ?? 24,
        life: 2.4,
        rehit: 0,
        hits: 0,
      });
    }

    // melee hit check
    if (!mv.projSpeed && f.moveFrame >= activeStart && f.moveFrame <= activeEnd) {
      if (f.hitsLanded < mv.hitCount && f.rehitT <= 0) this.meleeHit(f, opp, mv);
    }

    const total = mv.windup + mv.active + mv.recover;
    if (f.moveFrame >= total) {
      f.move = null;
      f.state = f.airborne ? "air" : "idle";
      f.stateT = 0;
      const pending = f.pending;
      f.pending = null;
      if (pending) this.tryStart(f, pending);
      return;
    }

    // keep holding movement is ignored mid-move (except air drift handled by integrate)
    if (f.airborne && !mv.dash) {
      // mild air drift during aerial moves
      if (input.held.l) f.vx -= 300 * dt;
      if (input.held.r) f.vx += 300 * dt;
      f.vx = Math.max(-WALK_SPEED, Math.min(WALK_SPEED, f.vx));
    }
    if (!f.airborne && !mv.dash && f.moveFrame > activeEnd) f.vx *= 0.8;
    // buffered inputs keep feeding the combo matcher during recovery
    const res2 = matchCombo(f.buf, this.clock);
    if (res2.kind === "move") {
      const next = MOVE_BY_ID.get(res2.id);
      if (next) this.tryStart(f, next);
    }
  }

  private applyGravityOnly(f: Fighter, dt: number) {
    f.vy += GRAVITY * dt;
    f.y += f.vy * dt;
    if (f.y >= STAGE.floorY && f.vy > 0) {
      f.y = STAGE.floorY;
      f.vy = 0;
      f.airborne = false;
    }
  }

  private meleeHit(f: Fighter, opp: Fighter, mv: MoveData) {
    if (opp.invuln > 0 || opp.downT > 0 || opp.state === "ko") return;
    const dir = f.facing;
    const bx = dir > 0 ? f.x + 6 : f.x - 6 - mv.reach;
    const by = f.y + mv.hbY;
    const ox = opp.x - FIGHTER_W / 2;
    const oy = opp.y;
    const overlap =
      bx < ox + FIGHTER_W && bx + mv.reach > ox && by < oy + FIGHTER_H && by + mv.hbH > oy;
    if (!overlap) {
      if (f.moveFrame === mv.windup && mv.hitCount === 1) {
        this.onFx({ type: "whiff", side: f.side, move: mv.id });
      }
      return;
    }
    f.hitsLanded++;
    f.rehitT = Math.max(9, Math.floor(mv.active / Math.max(1, mv.hitCount)) + 4);
    const last = f.hitsLanded >= mv.hitCount;
    const ev: OutEvent = {
      s: ++this.seq,
      o: f.side,
      m: mv.id,
      d: mv.dmg,
      k: last ? mv.kb : mv.kb * 0.4,
      y: last ? mv.kbY : 0,
      h: mv.hitstun,
      kn: last && mv.knockdown ? 1 : 0,
    };
    this.outEvents.push(ev);
    this.applyEvent(opp, ev, f);
  }

  /**
   * Apply a hit to the victim. Damage/stun run through the victim's own
   * blocking state so both screens land on the same numbers.
   */
  applyEvent(v: Fighter, ev: OutEvent, attacker: Fighter) {
    const dir: 1 | -1 = v.x >= attacker.x ? 1 : -1;
    const canBlock =
      v.blocking && !v.airborne && v.hitstun <= 0 && v.comboHits === 0 && v.downT <= 0;
    const blocked = canBlock;
    const dmg = blocked ? Math.max(1, Math.round(ev.d * 0.3)) : ev.d;
    v.hp = Math.max(0, v.hp - dmg);
    v.meter = Math.min(MAX_METER, v.meter + (blocked ? 2 : 4));

    if (blocked) {
      v.blockstun = 15;
      v.state = "block";
      v.vx = dir * 160;
      v.comboHits = 0;
      this.onFx({ type: "block", side: v.side, x: v.x, y: v.y + 80 });
      // chip damage can still finish the job
      if (v.hp <= 0) this.knockOut(v, attacker);
      return;
    }

    v.hitstun = ev.h;
    v.state = "hurt";
    v.stateT = 0;
    v.move = null;
    v.pending = null;
    v.blocking = false;
    v.vx = dir * ev.k;
    v.comboHits++;
    v.comboT = 2000;
    if (ev.y > 0) {
      v.vy = -ev.y;
      v.airborne = true;
      v.downT = 0;
    }
    if (ev.kn) {
      if (v.airborne) {
        v.downT = 42; // resolved when they land
      } else {
        v.downT = 38;
        v.invuln = 38;
        v.vx = dir * Math.max(160, ev.k * 0.6);
      }
    }
    const mv = MOVE_BY_ID.get(ev.m);
    if (this.remoteSide === v.side) v.predT = 14; // hold local reaction until snapshots catch up
    this.onFx({
      type: "hit",
      side: v.side,
      x: v.x,
      y: v.y + Math.min(130, 60 + (mv?.hbY ?? 60)),
      move: ev.m,
      blocked: false,
    });
    this.hitstop = Math.min(10, mv?.hitstop ?? 5);
    this.shake = Math.min(14, this.shake + (mv?.hitstop ?? 5) * 0.9);
    attacker.meter = Math.min(MAX_METER, attacker.meter + (mv?.meterGain ?? 4));

    if (v.hp <= 0) this.knockOut(v, attacker);
  }

  private knockOut(v: Fighter, attacker: Fighter) {
    v.hp = 0;
    v.state = "ko";
    v.hitstun = 999;
    v.vx = (v.x >= attacker.x ? 1 : -1) * 340;
    v.vy = -420;
    v.airborne = true;
    this.over = true;
    this.winner = attacker.side;
    this.hitstop = 26;
    this.shake = 22;
    this.flash = 1;
    this.onFx({ type: "ko", x: v.x, y: v.y + 90 });
  }

  /* ------------------------------ projectiles ------------------------------ */

  private stepProjectiles() {
    const dt = STEP_MS / 1000;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.rehit > 0) p.rehit--;
      let dead = p.life <= 0 || p.x < STAGE.minX - 80 || p.x > STAGE.maxX + 80;
      if (!dead) {
        const mv = MOVE_BY_ID.get(p.move);
        const v = this.f[1 - p.owner];
        const overlap =
          p.x - p.w / 2 < v.x + FIGHTER_W / 2 &&
          p.x + p.w / 2 > v.x - FIGHTER_W / 2 &&
          p.y - p.h / 2 < v.y + FIGHTER_H &&
          p.y + p.h / 2 > v.y;
        if (overlap && p.rehit <= 0 && v.invuln <= 0 && v.downT <= 0 && v.state !== "ko" && mv) {
          p.hits++;
          p.rehit = 14;
          const last = p.hits >= mv.hitCount;
          const ev: OutEvent = {
            s: ++this.seq,
            o: p.owner,
            m: mv.id,
            d: mv.dmg,
            k: last ? mv.kb : mv.kb * 0.4,
            y: last ? mv.kbY : 0,
            h: mv.hitstun,
            kn: last && mv.knockdown ? 1 : 0,
          };
          this.outEvents.push(ev);
          this.applyEvent(v, ev, this.f[p.owner]);
          if (last) dead = true;
        }
      }
      if (dead) this.projectiles.splice(i, 1);
    }
  }

  private pushApart() {
    const [a, b] = this.f;
    if (a.state === "ko" || b.state === "ko") return;
    if (a.move || b.move) return; // allow attacking through
    if (a.downT > 0 || b.downT > 0) return;
    const minD = FIGHTER_W - 6;
    const dx = b.x - a.x;
    const overlapY = a.y < b.y + FIGHTER_H && b.y < a.y + FIGHTER_H;
    if (Math.abs(dx) < minD && overlapY) {
      const push = (minD - Math.abs(dx)) / 2;
      const sign = dx >= 0 ? 1 : -1;
      a.x -= push * sign;
      b.x += push * sign;
      a.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, a.x));
      b.x = Math.max(STAGE.minX, Math.min(STAGE.maxX, b.x));
    }
  }

  /* ------------------------------- networking ------------------------------ */

  /** Pack local side state + unacked hit events + ack of opponent events. */
  serialize(side: 0 | 1): Snap {
    const f = this.f[side];
    const ev = this.outEvents
      .filter((e) => e.o === side)
      .map((e) => [e.s, e.o, e.m, e.d, e.k, e.y, e.h, e.kn]);
    return {
      t: Date.now(),
      x: Math.round(f.x * 10) / 10,
      y: Math.round(f.y * 10) / 10,
      f: f.facing,
      h: Math.round(f.hp),
      m: Math.round(f.meter),
      s: f.state,
      mv: f.move ? f.move.id : -1,
      mf: f.moveFrame,
      b: f.blocking ? 1 : 0,
      c: f.comboHits,
      ev,
      ack: f.acked,
    };
  }

  consumeOutgoing(): OutEvent[] {
    const out = this.outEvents;
    this.outEvents = [];
    return out;
  }

  /** Fold an opponent snapshot into the remote-driven fighter. */
  applyRemote(side: 0 | 1, snap: Snap, mySide: 0 | 1) {
    const r = this.f[side];
    const me = this.f[mySide];

    // apply their hit events against me (defender-authoritative hp)
    for (const arr of snap.ev) {
      const [s, o, m, d, k, y, h, kn] = arr;
      if (s <= me.acked) continue;
      me.acked = s;
      const attackerSide = (o as 0 | 1) === side ? side : mySide;
      this.applyEvent(me, { s, o: o as 0 | 1, m, d, k, y, h, kn: kn as 0 | 1 }, this.f[attackerSide]);
    }

    r.x = snap.x;
    r.y = snap.y;
    r.facing = snap.f === 1 ? 1 : -1;
    r.hp = snap.h;
    r.meter = snap.m;
    r.blocking = snap.b === 1;
    r.comboHits = snap.c;
    r.airborne = snap.y < 0;
    if (r.predT <= 0) {
      r.state = snap.s;
      r.stateT++;
      if (snap.mv >= 0 && r.move?.id !== snap.mv) {
        r.move = MOVE_BY_ID.get(snap.mv) ?? null;
        r.moveFrame = snap.mf;
      } else if (snap.mv >= 0) {
        r.moveFrame = snap.mf;
      } else {
        r.move = null;
        r.moveFrame = 0;
      }
    }
    if (snap.s === "ko") {
      r.state = "ko";
      r.hitstun = 999;
      if (!this.over) {
        this.over = true;
        this.winner = mySide;
        this.onFx({ type: "ko", x: r.x, y: r.y + 90 });
      }
    }
  }
}
