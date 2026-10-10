/**
 * Tiny WebAudio SFX synth — zero audio assets, all generated. Mobile requires
 * a user gesture before audio starts, so `unlock()` is called on the first
 * touch/keydown of the match screen.
 */

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  enabled = true;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      const len = Math.floor(ctx.sampleRate * 0.6);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.5 : 0;
  }

  private tone(
    freq: number,
    to: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    delay = 0,
  ) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.enabled) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, to: number, gain: number, q = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noiseBuf || !this.enabled) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, to), t + dur);
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  hit(power = 1) {
    this.noise(0.12 * power, 2200, 400, 0.5 * power, 0.9);
    this.tone(190 * power, 55, 0.16, "square", 0.22 * power);
    this.tone(90, 40, 0.2, "sine", 0.3 * power);
  }

  block() {
    this.noise(0.07, 3400, 1800, 0.3, 3);
    this.tone(520, 380, 0.06, "square", 0.1);
  }

  whiff() {
    this.noise(0.13, 500, 2600, 0.1, 0.6);
  }

  jump() {
    this.tone(280, 620, 0.12, "sine", 0.12);
  }

  land() {
    this.noise(0.1, 300, 90, 0.24, 0.7);
    this.tone(130, 60, 0.1, "sine", 0.16);
  }

  projectile() {
    this.tone(220, 880, 0.22, "sawtooth", 0.12);
    this.noise(0.2, 1200, 3200, 0.12, 1.4);
  }

  ko() {
    this.tone(160, 32, 0.9, "sawtooth", 0.32);
    this.noise(0.5, 1800, 100, 0.4, 0.5);
    this.tone(70, 30, 1.1, "sine", 0.35, 0.05);
  }

  ult() {
    this.tone(180, 1400, 0.5, "sawtooth", 0.16);
    this.noise(0.4, 600, 5000, 0.24, 1.1);
    this.tone(80, 44, 0.7, "sine", 0.3, 0.3);
  }

  ui() {
    this.tone(660, 880, 0.07, "square", 0.08);
  }

  nometer() {
    this.tone(160, 120, 0.1, "square", 0.1);
    this.tone(150, 110, 0.1, "square", 0.1, 0.12);
  }
}

export const sfx = new Sfx();
