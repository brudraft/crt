/** Procedural WebAudio SFX (no assets). Muted by default; the AudioContext is created on first enable. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = false;

  toggle() {
    this.enabled = !this.enabled;
    if (this.enabled && !this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    this.ctx?.resume();
    this.rain(this.enabled);
    return this.enabled;
  }

  private rainNode: { src: AudioBufferSourceNode; g: GainNode } | null = null;
  /** Soft rain against the window (looping filtered noise) while SFX are on. */
  private rain(on: boolean) {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (on && !this.rainNode) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuffer(ctx, 4); src.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07, t + 1.5);
      src.connect(lp).connect(hp).connect(g).connect(this.master); src.start();
      this.rainNode = { src, g };
    } else if (!on && this.rainNode) {
      const { src, g } = this.rainNode; this.rainNode = null;
      g.gain.linearRampToValueAtTime(0, t + 0.5); src.stop(t + 0.6);
    }
  }

  private ok() { return this.enabled && this.ctx && this.master ? { ctx: this.ctx, out: this.master } : null; }

  private noiseBuffer(ctx: AudioContext, sec: number) {
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
