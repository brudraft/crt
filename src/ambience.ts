import * as THREE from 'three';
import type { Sfx } from './audio';

/**
 * The soundscape that makes the apartment feel inhabited – and lonely:
 *  room   – fridge hum that cycles on/off, a ticking clock, CRT whine + mains hum near the TV
 *  city   – (muffled by the glass, panned towards the window) traffic rumble, distant sirens,
 *           air-car fly-bys, a far-away advert jingle echoing between towers, rain in gusts with drips
 *  wall   – now and then the neighbour's music or TV, bass-only through the wall
 * Everything is procedural. It ducks while a tape plays on channel 3.
 */
export interface AmbienceState {
  camera: THREE.Camera;
  tvOn: boolean;
  filmPlaying: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Ambience {
  private ctx!: AudioContext;
  private duck!: GainNode;
  private cityFilter!: BiquadFilterNode;
  private cityPan!: PannerNode;
  private wallPan!: PannerNode;
  private room!: GainNode; private city!: GainNode; private wall!: GainNode;
  private crt!: GainNode;
  private traffic!: GainNode; private rain!: GainNode;
  private echo!: DelayNode;
  private started = false;
  private timers: number[] = [];
  private gust = 0.7; private gustTarget = 0.7; private swell = 1;

  // listener geometry
  private window = new THREE.Vector3(1.55, 1.4, -1.63);
  private neighbourWall = new THREE.Vector3(-3, 1.4, 0.8);
  private tv = new THREE.Vector3(-0.045, 1.04, 0.23);

  constructor(sfx: Sfx, opts?: { window?: THREE.Vector3; tv?: THREE.Vector3 }) {
    if (opts?.window) this.window.copy(opts.window);
    if (opts?.tv) this.tv.copy(opts.tv);
    sfx.onReady((ctx, out) => this.start(ctx, out));
  }

  private start(ctx: AudioContext, out: GainNode) {
    if (this.started) return;
    this.started = true;
    this.ctx = ctx;
    this.duck = ctx.createGain(); this.duck.gain.value = 1; this.duck.connect(out);

    this.room = ctx.createGain(); this.room.gain.value = 1; this.room.connect(this.duck);

    // city bus: through the glass → lowpass, panned towards the window
    this.cityFilter = ctx.createBiquadFilter(); this.cityFilter.type = 'lowpass'; this.cityFilter.frequency.value = 900; this.cityFilter.Q.value = 0.5;
    this.cityPan = this.spatial(this.window.clone().add(new THREE.Vector3(0, 0, -0.4)), 1.6, 0.6);
    this.city = ctx.createGain(); this.city.gain.value = 1;
    this.city.connect(this.cityFilter).connect(this.cityPan).connect(this.duck);
    // long echo between the towers, shared by sirens and the advert
    this.echo = ctx.createDelay(1.5); this.echo.delayTime.value = 0.34;
    const fb = ctx.createGain(); fb.gain.value = 0.42;
    const echoLp = ctx.createBiquadFilter(); echoLp.type = 'lowpass'; echoLp.frequency.value = 1100;
    this.echo.connect(echoLp).connect(fb).connect(this.echo);
    echoLp.connect(this.city);

    // wall bus: only the bass makes it through concrete
    const wallLp = ctx.createBiquadFilter(); wallLp.type = 'lowpass'; wallLp.frequency.value = 190; wallLp.Q.value = 0.7;
    this.wallPan = this.spatial(this.neighbourWall, 1.2, 0.9);
    this.wall = ctx.createGain(); this.wall.gain.value = 1;
    this.wall.connect(wallLp).connect(this.wallPan).connect(this.duck);

    this.startFridge();
    this.startClock();
    this.startCRT();
    this.startTraffic();
    this.startRain();
    this.schedule(() => this.siren(), 25, 60, 70, 160);
    this.schedule(() => this.flyby(), 8, 20, 25, 70);
    this.schedule(() => this.advert(), 50, 90, 90, 200);
    this.schedule(() => this.neighbour(), 40, 90, 150, 320);
  }

  /** Run `fn` first after a..b s, then every c..d s. */
  private schedule(fn: () => void, a: number, b: number, c: number, d: number) {
    const loop = (delay: number) => {
      this.timers.push(window.setTimeout(() => { if (this.ctx.state === 'running') fn(); loop(rand(c, d)); }, delay * 1000));
    };
    loop(rand(a, b));
  }

  private noise(sec: number, brown = false) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * sec), ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  /** HRTF panner at a world position (room sounds get louder as you walk up to them). */
  private spatial(pos: THREE.Vector3, ref = 1, rolloff = 1.2) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = rolloff; p.maxDistance = 50;
    p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
    return p;
  }
  private fridgePos = new THREE.Vector3(2.6, 0.9, 3.0);
  private clockPos = new THREE.Vector3(-1.4, 1.9, 3.3);

  private loop(buf: AudioBuffer) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; }

  // ------------------------------------------------------------------ room
  private startFridge() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380;
    const pan = this.spatial(this.fridgePos, 0.8, 1.4); // kitchen corner, back right
    for (const [f, a] of [[50, 0.5], [100, 0.35], [150, 0.15], [233, 0.05]] as const) {
      const o = ctx.createOscillator(); o.type = f === 50 ? 'sine' : 'triangle'; o.frequency.value = f;
      const og = ctx.createGain(); og.gain.value = a; o.connect(og).connect(lp); o.start();
    }
    lp.connect(g).connect(pan).connect(this.room);
    // compressor cycles: on for a while, then the silence you suddenly notice
    const cycle = (on: boolean) => {
      const t = ctx.currentTime;
      if (on) {
        this.thump(pan, 0.05);
        g.gain.setTargetAtTime(0.018, t, 1.2);
      } else {
        g.gain.setTargetAtTime(0.0, t, 0.6);
        setTimeout(() => this.thump(pan, 0.03), 700); // little shudder as it stops
      }
      this.timers.push(window.setTimeout(() => cycle(!on), (on ? rand(40, 90) : rand(25, 70)) * 1000));
    };
    cycle(true);
  }

  private thump(dest: AudioNode, gain: number) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.25);
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.3);
    o.connect(g).connect(dest); o.start(t); o.stop(t + 0.32);
  }

  private startClock() {
    const ctx = this.ctx;
    const pan = this.spatial(this.clockPos, 0.5, 1.6); // on the wall shelf
    pan.connect(this.room);
    const buf = this.noise(0.03);
    let tock = false;
    const tick = () => {
      const t = Math.ceil(ctx.currentTime) + 0.02; // on the second
      const s = ctx.createBufferSource(); s.buffer = buf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tock ? 2600 : 3400; bp.Q.value = 8;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.03);
      s.connect(bp).connect(g).connect(pan); s.start(t); s.stop(t + 0.04);
      tock = !tock;
    };
    this.timers.push(window.setInterval(() => { if (ctx.state === 'running') tick(); }, 1000));
  }

  private startCRT() {
    const ctx = this.ctx;
    this.crt = ctx.createGain(); this.crt.gain.value = 0;
    const whine = ctx.createOscillator(); whine.frequency.value = 15734; // NTSC line frequency
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 50;
    const hg = ctx.createGain(); hg.gain.value = 0.5;
    whine.connect(wg).connect(this.crt); hum.connect(hg).connect(this.crt);
    whine.start(); hum.start();
    this.crt.connect(this.spatial(this.tv, 0.35, 2)).connect(this.room);
  }

  // ------------------------------------------------------------------ city
  private startTraffic() {
    const ctx = this.ctx;
    this.traffic = ctx.createGain(); this.traffic.gain.value = 0.22;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320;
    this.loop(this.noise(8, true)).connect(lp).connect(this.traffic).connect(this.city);
  }

  private startRain() {
    const ctx = this.ctx;
    this.rain = ctx.createGain(); this.rain.gain.value = 0.05;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    this.loop(this.noise(5)).connect(hp).connect(lp).connect(this.rain);
    // rain on the glass is right there – not behind it – so only lightly filtered and panned
    const pan = this.spatial(this.window, 1.2, 0.8);
    this.rain.connect(pan).connect(this.room);
    // single drips hitting the pane
    const drip = () => {
      if (ctx.state === 'running') {
        const t = ctx.currentTime;
        const o = ctx.createOscillator(); o.type = 'sine';
        const f = rand(1800, 4200); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.04);
        const g = ctx.createGain(); g.gain.setValueAtTime(rand(0.004, 0.014) * this.gust, t); g.gain.exponentialRampToValueAtTime(0.0002, t + 0.05);
        o.connect(g).connect(pan); o.start(t); o.stop(t + 0.06);
      }
      this.timers.push(window.setTimeout(drip, rand(40, 380) / Math.max(0.3, this.gust)));
    };
    drip();
  }

  private siren() {
    const ctx = this.ctx, t = ctx.currentTime, dur = rand(9, 15);
    const o = ctx.createOscillator(); o.type = 'triangle';
    const base = rand(560, 700);
    o.frequency.setValueAtTime(base, t);
    // wail: up and down a few times
    for (let k = 0; k < dur; k += 2.2) { o.frequency.linearRampToValueAtTime(base * 1.9, t + k + 1.1); o.frequency.linearRampToValueAtTime(base, t + k + 2.2); }
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03, t + dur * 0.4); g.gain.linearRampToValueAtTime(0, t + dur);
    const pan = ctx.createStereoPanner(); pan.pan.setValueAtTime(rand(-0.6, 0.2), t); pan.pan.linearRampToValueAtTime(rand(0.2, 0.9), t + dur);
    o.connect(g).connect(pan); pan.connect(this.city); pan.connect(this.echo);
    o.start(t); o.stop(t + dur + 0.1);
  }

  private flyby() {
    const ctx = this.ctx, t = ctx.currentTime, dur = rand(3.5, 6);
    const src = ctx.createBufferSource(); src.buffer = this.noise(dur + 0.2);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(260, t); bp.frequency.exponentialRampToValueAtTime(rand(800, 1300), t + dur * 0.45); bp.frequency.exponentialRampToValueAtTime(200, t + dur);
    const hum = ctx.createOscillator(); hum.type = 'sawtooth';
    hum.frequency.setValueAtTime(110, t); hum.frequency.exponentialRampToValueAtTime(150, t + dur * 0.45); hum.frequency.exponentialRampToValueAtTime(70, t + dur); // doppler
    const hg = ctx.createGain(); hg.gain.value = 0.25;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.09, t + dur * 0.45); g.gain.linearRampToValueAtTime(0, t + dur);
    const dir = Math.random() < 0.5 ? 1 : -1;
    const pan = ctx.createStereoPanner(); pan.pan.setValueAtTime(-0.9 * dir, t); pan.pan.linearRampToValueAtTime(0.9 * dir, t + dur);
    src.connect(bp).connect(g); hum.connect(hg).connect(g); g.connect(pan).connect(this.city);
    src.start(t); hum.start(t); src.stop(t + dur + 0.2); hum.stop(t + dur + 0.2);
  }

  /** A jingle from a billboard somewhere far away, echoing between the towers. */
  private advert() {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05;
    const tunes = [[659, 784, 988, 784, 1319], [523, 659, 784, 1047], [880, 740, 659, 587, 659, 880]];
    const tune = tunes[Math.floor(Math.random() * tunes.length)];
    const g = ctx.createGain(); g.gain.value = 0.022;
    const pan = ctx.createStereoPanner(); pan.pan.value = rand(0.1, 0.8);
    g.connect(pan); pan.connect(this.city); pan.connect(this.echo);
    tune.forEach((f, i) => {
      const t = t0 + i * 0.22;
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const e = ctx.createGain(); e.gain.setValueAtTime(0, t); e.gain.linearRampToValueAtTime(1, t + 0.01); e.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(e).connect(g); o.start(t); o.stop(t + 0.32);
    });
  }

  /** The neighbour: muffled music with a bass line, or a TV with voices. Only bass gets through. */
  private neighbour() {
    const ctx = this.ctx, t0 = ctx.currentTime + 0.1;
    const dur = rand(40, 90);
    const fade = ctx.createGain(); fade.gain.setValueAtTime(0, t0);
    fade.gain.linearRampToValueAtTime(1, t0 + 4); fade.gain.setValueAtTime(1, t0 + dur - 5); fade.gain.linearRampToValueAtTime(0, t0 + dur);
    fade.connect(this.wall);
    if (Math.random() < 0.6) {
      // music: kick on every beat + a looping bass line
      const bpm = rand(88, 112), beat = 60 / bpm;
      const bass = [55, 55, 65.4, 49, 55, 73.4, 65.4, 49];
      for (let i = 0, t = t0; t < t0 + dur; i++, t += beat) {
        const k = ctx.createOscillator(); k.frequency.setValueAtTime(110, t); k.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        const kg = ctx.createGain(); kg.gain.setValueAtTime(0.32, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        k.connect(kg).connect(fade); k.start(t); k.stop(t + 0.27);
        if (i % 2 === 0) {
          const b = ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = bass[(i / 2) % bass.length];
          const bg = ctx.createGain(); bg.gain.setValueAtTime(0.0, t); bg.gain.linearRampToValueAtTime(0.12, t + 0.02); bg.gain.exponentialRampToValueAtTime(0.01, t + beat * 1.8);
          b.connect(bg).connect(fade); b.start(t); b.stop(t + beat * 2);
        }
      }
    } else {
      // TV: voice-like formant noise with a syllable rhythm (no words survive the wall)
      const src = ctx.createBufferSource(); src.buffer = this.noise(dur + 1);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 150; f1.Q.value = 3;
      const env = ctx.createGain(); env.gain.value = 0;
      for (let t = t0; t < t0 + dur; t += rand(0.12, 0.3)) env.gain.setValueAtTime(Math.random() < 0.25 ? 0 : rand(0.6, 2.2), t);
      src.connect(f1).connect(env).connect(fade);
      src.start(t0); src.stop(t0 + dur + 0.5);
    }
  }

  // ------------------------------------------------------------------ per frame
  private right = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  update(s: AmbienceState, dt: number) {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const cam = s.camera.position;
    this.right.set(1, 0, 0).applyQuaternion(s.camera.quaternion);
    const L = this.ctx.listener;
    const fwd = this.tmp.set(0, 0, -1).applyQuaternion(s.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(s.camera.quaternion);
    if (L.positionX) {
      L.positionX.setTargetAtTime(cam.x, t, 0.05); L.positionY.setTargetAtTime(cam.y, t, 0.05); L.positionZ.setTargetAtTime(cam.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05); L.forwardY.setTargetAtTime(fwd.y, t, 0.05); L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      L.upX.setTargetAtTime(up.x, t, 0.05); L.upY.setTargetAtTime(up.y, t, 0.05); L.upZ.setTargetAtTime(up.z, t, 0.05);
    } else { L.setPosition(cam.x, cam.y, cam.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z); }
    // closer to the glass = less muffled, louder
    const dWin = cam.distanceTo(this.window);
    this.cityFilter.frequency.setTargetAtTime(700 + 1800 * Math.exp(-dWin * 0.9), t, 0.2);
    this.city.gain.setTargetAtTime(0.7 + 0.6 * Math.exp(-dWin * 0.8), t, 0.2);
    // CRT whine + hum: only when the tube is on, and you have to be close to hear it
    const dTv = cam.distanceTo(this.tv);
    this.crt.gain.setTargetAtTime(s.tvOn ? 0.006 : 0, t, 0.3); void dTv; // distance is handled by the panner
    // gusty rain + swelling traffic
    if (Math.random() < dt * 0.15) this.gustTarget = rand(0.4, 1.4);
    this.gust += (this.gustTarget - this.gust) * Math.min(1, dt * 0.5);
    this.rain.gain.setTargetAtTime(0.045 * this.gust, t, 0.5);
    this.swell += (Math.sin(t * 0.05) * 0.25 + Math.sin(t * 0.013) * 0.2 + 1 - this.swell) * Math.min(1, dt);
    this.traffic.gain.setTargetAtTime(0.2 * this.swell, t, 1);
    // duck the room while a film plays – you stop noticing it
    this.duck.gain.setTargetAtTime(s.filmPlaying ? 0.45 : 1, t, 1.2);
  }
}
