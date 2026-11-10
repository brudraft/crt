/**
 * Procedural WebAudio (no assets). Sound is ON by default (remembered); browsers only allow an
 * AudioContext after a user gesture, so it is created on the first click/tap/key press.
 */
const KEY = 'crtvhs.sfx.v1';

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readyCbs: ((ctx: AudioContext, out: GainNode) => void)[] = [];
  enabled = true;

  constructor() {
    try { const v = localStorage.getItem(KEY); if (v !== null) this.enabled = v === '1'; } catch { /* storage blocked */ }
    const arm = () => {
      this.ensure();
      if (this.ctx) for (const ev of ['pointerdown', 'keydown', 'touchend']) removeEventListener(ev, arm, true);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, arm, true);
  }

  /** Called once the AudioContext exists (ambience hooks in here). */
  onReady(cb: (ctx: AudioContext, out: GainNode) => void) {
    if (this.ctx && this.master) cb(this.ctx, this.master); else this.readyCbs.push(cb);
  }

  private ensure() {
    if (!this.enabled) return;
    if (!this.ctx) {
      try { this.ctx = new AudioContext(); } catch { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
      for (const cb of this.readyCbs) cb(this.ctx, this.master);
      this.readyCbs = [];
    }
    this.ctx.resume();
    const t = this.ctx.currentTime;
    this.master!.gain.cancelScheduledValues(t);
    this.master!.gain.setTargetAtTime(0.5, t, 0.4);
  }

  toggle() {
    this.enabled = !this.enabled;
    try { localStorage.setItem(KEY, this.enabled ? '1' : '0'); } catch { /* ignore */ }
    if (this.enabled) this.ensure();
    else if (this.ctx && this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(0, t, 0.15);
      setTimeout(() => { if (!this.enabled) this.ctx?.suspend(); }, 800);
    }
    return this.enabled;
  }

  private ok() { return this.enabled && this.ctx && this.master ? { ctx: this.ctx, out: this.master } : null; }

  noiseBuffer(ctx: AudioContext, sec: number) {
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  /** Short filtered noise burst + low thump. */
  clunk(gain = 1) {
    const a = this.ok(); if (!a) return;
    const { ctx, out } = a; const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(ctx, 0.12);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.6 * gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    n.connect(f).connect(g).connect(out); n.start(t);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.7 * gain, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.16);
  }

  click() { this.clunk(0.35); }

  /** Soft assistant chime (two sine notes; three and higher when urgent). */
  chime(urgent = false) {
    const a = this.ok(); if (!a) return;
    const { ctx, out } = a; const t0 = ctx.currentTime;
    const notes = urgent ? [988, 1319, 988] : [784, 1175];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.16;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.9);
      o.connect(g).connect(out); o.start(t); o.stop(t + 1);
    });
  }

  /** Chiptune-ish blip for the game channel. */
  blip(freq: number, dur: number, type: OscillatorType = 'square') {
    const a = this.ok(); if (!a) return;
    const { ctx, out } = a; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.6), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.08, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + 0.02);
  }

  /** Mechanical motor whirr. */
  whirr(sec = 1.2) {
    const a = this.ok(); if (!a) return;
    const { ctx, out } = a; const t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(110, t + sec * 0.6); o.frequency.linearRampToValueAtTime(90, t + sec);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = 8; lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.08); g.gain.setValueAtTime(0.18, t + sec - 0.15); g.gain.linearRampToValueAtTime(0, t + sec);
    o.connect(f).connect(g).connect(out); o.start(t); lfo.start(t); o.stop(t + sec); lfo.stop(t + sec);
  }

  /** TV static hiss. */
  static(sec = 1) {
    const a = this.ok(); if (!a) return;
    const { ctx, out } = a; const t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noiseBuffer(ctx, sec);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.linearRampToValueAtTime(0, t + sec);
    n.connect(f).connect(g).connect(out); n.start(t);
  }
}
