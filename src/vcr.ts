import * as THREE from 'three';
import gsap from 'gsap';
import { bestLocalAxis, type SceneRefs } from './scene-contract';
import type { TVScreen, ScreenMode } from './screen';
import type { TapeLibrary, Tape } from './tapes';
import type { Sfx } from './audio';
import { loadIframeApi, YTState } from './youtube';

export type VcrState = 'IDLE' | 'DRAGGING' | 'INSERTING' | 'LOADING' | 'PLAYING' | 'PAUSED' | 'EJECTING';
export type ButtonName = 'Btn_Eject' | 'Btn_Play' | 'Btn_Stop' | 'Btn_FF' | 'Btn_Rew' | 'Btn_Power';
export type KnobName = 'Knob_Channel' | 'Knob_Volume';

export interface VcrHooks {
  onMutedFallback(muted: boolean): void;
  onState?(s: VcrState): void;
  /** false while the TV is tuned away from the VCR's channel 3 (video keeps running, sound off). */
  onChannelAudio?(on: boolean): void;
}

const deg = THREE.MathUtils.degToRad;

export class VCR {
  state: VcrState = 'IDLE';
  current: Tape | null = null;
  power = true;
  volume = 80;
  channel = 3;
  private flapOpenRot: number;
  private insertDir: THREE.Vector3;
  private slotPos = new THREE.Vector3();
  private insidePos = new THREE.Vector3();
  private slotQuat = new THREE.Quaternion();
  private pushDir = new Map<string, THREE.Vector3>();
  private btnBase = new Map<string, THREE.Vector3>();
  private knob = new Map<string, { base: THREE.Quaternion; axis: THREE.Vector3; angle: number }>();
  private display: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; last: string };
  private led: THREE.MeshStandardMaterial;
  private ledHalo?: THREE.Sprite;
  private displayHalo?: THREE.Sprite;
  private osdTimer = 0;
  private flash = '';
  private flashUntil = 0;

  constructor(private refs: SceneRefs, private tv: TVScreen, private tapes: TapeLibrary, private sfx: Sfx, private hooks: VcrHooks) {
    // --- insertion axis, verified numerically ---
    refs.slotAnchor.getWorldPosition(this.slotPos);
    refs.slotInside.getWorldPosition(this.insidePos);
    refs.slotAnchor.getWorldQuaternion(this.slotQuat);
    this.insertDir = this.insidePos.clone().sub(this.slotPos).normalize();
    const negZ = new THREE.Vector3(0, 0, -1).applyQuaternion(this.slotQuat);
    const ax = bestLocalAxis(refs.slotAnchor, this.insertDir);
    console.info(`[vcr] insertion dir (slot→inside) = (${this.insertDir.toArray().map((v) => v.toFixed(3))}); ` +
      `VHS_Slot_Anchor local -Z → world (${negZ.toArray().map((v) => v.toFixed(3))}), dot=${negZ.dot(this.insertDir).toFixed(3)}; best local axis ${ax.name}`);

    // --- flap: which sign of rotation about local X swings it INTO the TV? ---
    const flap = refs.flap;
    const openDeg = Number(flap.userData.open_rotation_deg ?? 88);
    const center = (r: number) => {
      const old = flap.rotation.x; flap.rotation.x = r; flap.updateMatrixWorld(true);
      const c = new THREE.Box3().setFromObject(flap).getCenter(new THREE.Vector3());
      flap.rotation.x = old; flap.updateMatrixWorld(true);
      return c;
    };
    const c0 = center(0), cPos = center(deg(openDeg)), cNeg = center(-deg(openDeg));
    const inPos = cPos.clone().sub(c0).dot(this.insertDir), inNeg = cNeg.clone().sub(c0).dot(this.insertDir);
    this.flapOpenRot = inPos >= inNeg ? deg(openDeg) : -deg(openDeg);
    console.info(`[vcr] flap open = rotation.x ${THREE.MathUtils.radToDeg(this.flapOpenRot).toFixed(0)}° (moves ${Math.max(inPos, inNeg).toFixed(3)} m along insertion dir)`);

    // --- buttons: push along the insertion direction (Blender +Y = into the TV), in each parent's space ---
    for (const n of ['Btn_Eject', 'Btn_Play', 'Btn_Stop', 'Btn_FF', 'Btn_Rew', 'Btn_Power']) {
      const b = refs.get(n);
      const pq = b.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
      const depth = Number(b.userData.push_depth_m ?? 0.004);
      this.pushDir.set(n, this.insertDir.clone().applyQuaternion(pq).multiplyScalar(depth));
      this.btnBase.set(n, b.position.clone());
    }

    // --- knobs: rotate about the local axis that faces the viewer ---
    const front = this.insertDir.clone().negate();
    for (const n of ['Knob_Channel', 'Knob_Volume']) {
      const k = refs.get(n);
      const a = bestLocalAxis(k, front);
      this.knob.set(n, { base: k.quaternion.clone(), axis: a.local, angle: 0 });
      console.info(`[vcr] ${n} rotation axis = local ${a.name}`);
    }
    this.setKnob('Knob_Volume', (this.volume / 100) * 270 - 135, false);

    // --- VCR display canvas ---
    const dispMesh = refs.get('VCR_Display') as THREE.Mesh;
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    const dmat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    dmat.name = 'M_Display_Canvas';
    dispMesh.material = dmat;
    this.display = { canvas, ctx: canvas.getContext('2d')!, tex, last: '' };

    const ledMesh = refs.get('LED_Power') as THREE.Mesh;
    this.led = (ledMesh.material as THREE.MeshStandardMaterial).clone();
    ledMesh.material = this.led;
    this.led.toneMapped = false;

    this.updateIndicators();
  }

  attachHalos(led: THREE.Sprite, display: THREE.Sprite) { this.ledHalo = led; this.displayHalo = display; this.updateIndicators(); }

  get hasTape() { return !!this.current; }
  get busy() { return this.state === 'INSERTING' || this.state === 'EJECTING' || this.state === 'LOADING'; }

  private set(s: VcrState) {
    this.state = s;
    console.debug('[vcr] →', s);
    this.hooks.onState?.(s);
    this.updateIndicators();
  }

  slotWorld() { return this.slotPos.clone(); }

  /** Pre-heat the IFrame API when the user starts dragging (it's a user gesture anyway). */
  prewarm() { loadIframeApi().catch(() => {}); }

  beginDrag() { if (this.state === 'IDLE') this.set('DRAGGING'); this.prewarm(); }
  cancelDrag() { if (this.state === 'DRAGGING') this.set('IDLE'); }

  /** Partially open the flap as a "drop here" cue while a dragged tape is near the slot. */
  hoverSlot(near: boolean) {
    if (this.busy || this.current) return;
    gsap.to(this.refs.flap.rotation, { x: near ? this.flapOpenRot * 0.25 : 0, duration: 0.2, overwrite: true });
  }

  // ------------------------------------------------------------- insert / eject
  async insert(tape: Tape) {
    if (!tape.record || this.busy) return;
    if (!this.power) { this.setPower(true); }
    if (this.current && this.current !== tape) await this.eject();
    if (this.current === tape) return;
    this.prewarm();
    this.current = tape;
    tape.node.userData.busy = true;
    this.set('INSERTING');
    this.tv.osd('LOADING…', 1500);

    const node = tape.node, parent = node.parent!;
    const pInv = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const toLocal = (w: THREE.Vector3) => parent.worldToLocal(w.clone());
    const targetQ = pInv.clone().multiply(this.slotQuat); // tape fits with the anchor's orientation
    const halfDepth = 0.104 / 2;
    const pre = toLocal(this.slotPos.clone().addScaledVector(this.insertDir, -(halfDepth + 0.05)));
    const mouth = toLocal(this.slotPos.clone().addScaledVector(this.insertDir, -halfDepth + 0.01));
    const inside = toLocal(this.insidePos);
    const q0 = node.quaternion.clone();
    const k = { v: 0 };
    const p0 = node.position.clone();
    const lift = p0.clone().lerp(pre, 0.5); lift.y += 0.08;
    const curve = new THREE.QuadraticBezierCurve3(p0, lift, pre);

    await new Promise<void>((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .to(k, {
          v: 1, duration: 0.7, ease: 'power2.inOut',
          onUpdate: () => { node.position.copy(curve.getPoint(k.v)); node.quaternion.slerpQuaternions(q0, targetQ, k.v); },
        })
        .to(this.refs.flap.rotation, { x: this.flapOpenRot, duration: 0.25, ease: 'power2.out', onStart: () => this.sfx.click() }, '-=0.15')
        .to(node.position, { x: mouth.x, y: mouth.y, z: mouth.z, duration: 0.25, ease: 'power1.in' })
        .to(node.position, { x: inside.x, y: inside.y, z: inside.z, duration: 0.45, ease: 'power3.out', onStart: () => this.sfx.whirr(0.9) })
        .add(() => { node.visible = false; this.sfx.clunk(); })
        .to(this.refs.flap.rotation, { x: 0, duration: 0.2, ease: 'back.out(2)' });
    });
    await this.load();
  }

  private async load() {
    const tape = this.current;
    if (!tape?.record) return;
    this.set('LOADING');
    this.tv.setMode('static');
    this.tv.glitch(900);
    this.sfx.static(1.0);
    await new Promise((r) => setTimeout(r, 900));
    if (this.current !== tape) return;
    this.tv.tracking(800);
    this.player().setVolume(this.volume);
    let res: 'sound' | 'muted' | 'failed';
    try {
      res = await this.tv.player.start(tape.record.videoId, this.volume);
    } catch (e) {
      console.warn('[vcr] player failed', e);
      res = 'failed';
    }
    if (this.current !== tape || this.state !== 'LOADING') return;
    if (res === 'failed') {
      this.tv.setMode('error', 'TRACKING ERROR');
      this.tv.osd('PRESS ▶ TO RETRY', 4000);
      this.set('PAUSED');
      return;
    }
    this.applyChannel();
    this.tv.tracking(500);
    this.tv.osd('▶ PLAY', 2000);
    this.hooks.onMutedFallback(res === 'muted');
    this.set('PLAYING');
  }

  async eject(): Promise<void> {
    const tape = this.current;
    if (!tape || this.state === 'EJECTING' || this.state === 'INSERTING') return;
    this.set('EJECTING');
    this.tv.player.unload();
    this.tv.flashAfterglow(0.35);
    this.tv.setMode('static');
    this.tv.osd('⏏ EJECT', 1200);
    const node = tape.node, parent = node.parent!;
    const toLocal = (w: THREE.Vector3) => parent.worldToLocal(w.clone());
    const out = toLocal(this.slotPos.clone().addScaledVector(this.insertDir, -(0.104 / 2 + 0.06)));
    node.visible = true;
    await new Promise<void>((resolve) => {
      gsap.timeline({ onComplete: resolve })
        .add(() => { this.sfx.clunk(0.8); this.sfx.whirr(0.7); })
        .to(this.refs.flap.rotation, { x: this.flapOpenRot, duration: 0.2, ease: 'power2.out' })
        .to(node.position, { x: out.x, y: out.y, z: out.z, duration: 0.55, ease: 'power2.out' })
        .to(this.refs.flap.rotation, { x: 0, duration: 0.2, ease: 'back.out(2)' }, '+=0.05')
        .add(this.tapes.returnHome(tape, 0.8), '-=0.1');
    });
    tape.node.userData.busy = false;
    this.current = null;
    this.hooks.onMutedFallback(false);
    if (this.power) { this.tv.setMode('idle'); this.applyChannel(); } else this.tv.setMode('off');
    this.set('IDLE');
  }

  /** A tape record was deleted while inside the VCR. */
  forget(tape: Tape) {
    if (this.current !== tape) return;
    this.tv.player.unload();
    this.current = null;
    if (this.power) { this.tv.setMode('idle'); this.applyChannel(); } else this.tv.setMode('off');
    this.set('IDLE');
  }

  // ------------------------------------------------------------- player events
  onPlayerState(s: number) {
    if (this.state === 'PLAYING' && s === YTState.PAUSED) this.set('PAUSED');
    if (this.state === 'PAUSED' && s === YTState.PLAYING && this.power) this.set('PLAYING');
    if (s === YTState.ENDED && (this.state === 'PLAYING' || this.state === 'PAUSED')) {
      this.tv.osd('■ END OF TAPE', 3000);
      this.tv.tracking(1200);
      this.set('PAUSED');
    }
  }

  onPlayerError(code: number) {
    if (!this.current) return;
    const msg = code === 101 || code === 150 ? 'COPY PROTECTED' : code === 100 ? 'TAPE NOT FOUND' : 'TRACKING ERROR';
    console.warn('[vcr] YouTube error', code, msg);
    this.tv.setMode('error', msg);
    this.tv.osd('EJECT ⏏ TO REMOVE', 4000);
    if (this.state === 'LOADING' || this.state === 'PLAYING') this.set('PAUSED');
  }

  private player() { return this.tv.player; }

  // ------------------------------------------------------------- buttons & knobs
  press(name: ButtonName) {
    const b = this.refs.get(name);
    const base = this.btnBase.get(name)!, push = this.pushDir.get(name)!;
    gsap.timeline()
      .to(b.position, { x: base.x + push.x, y: base.y + push.y, z: base.z + push.z, duration: 0.06, ease: 'power2.in' })
      .to(b.position, { x: base.x, y: base.y, z: base.z, duration: 0.14, ease: 'power2.out' });
    this.sfx.click();

    if (name === 'Btn_Power') { this.setPower(!this.power); return; }
    if (!this.power) return;
    switch (name) {
      case 'Btn_Play':
        if (this.state === 'PLAYING') { this.player().pause(); this.tv.osd('❚❚ PAUSE'); this.set('PAUSED'); }
        else if (this.state === 'PAUSED' && this.current) {
          if (this.tv.getMode() === 'error') { this.load(); return; }
          this.player().play(); this.tv.osd('▶ PLAY'); this.tv.tracking(300); this.set('PLAYING');
        } else if (!this.current) this.tv.osd('NO TAPE', 1500);
        break;
      case 'Btn_Stop':
        if (this.state === 'PLAYING' || this.state === 'PAUSED') { this.player().stop(); this.tv.osd('■ STOP'); this.flashDisplay('STOP', 1500); this.set('PAUSED'); }
        break;
      case 'Btn_FF':
      case 'Btn_Rew': {
        if (!(this.state === 'PLAYING' || this.state === 'PAUSED')) { this.tv.osd('NO TAPE', 1200); break; }
        const ff = name === 'Btn_FF';
        this.player().seekBy(ff ? 10 : -10);
        this.tv.tracking(800);
        this.tv.osd(ff ? '▶▶ FF +10s' : '◀◀ REW -10s', 1200);
        this.flashDisplay(ff ? '>> FF' : '<< REW', 900);
        this.sfx.whirr(0.5);
        break;
      }
      case 'Btn_Eject':
        if (this.current) this.eject(); else this.tv.osd('NO TAPE', 1200);
        break;
    }
  }

  setPower(on: boolean) {
    this.power = on;
    if (!on) {
      if (this.state === 'PLAYING') { this.player().pause(); this.set('PAUSED'); }
      this.tv.powerOff().then(() => { if (!this.power) this.tv.setMode('off'); });
    } else {
      this.tv.powerOn();
      this.tv.glitch(300);
      if (this.current && this.tv.player.exists && this.tv.getMode() !== 'error') this.applyChannel();
      else this.tv.setMode(this.current ? this.tv.getMode() : 'idle');
      this.tv.osd(`CH ${String(this.channel).padStart(2, '0')}`, 1500);
    }
    this.updateIndicators();
  }

  /** Rotate a knob to `angleDeg` (clamped −135…135). */
  setKnob(name: KnobName, angleDeg: number, apply = true) {
    const k = this.knob.get(name)!;
    k.angle = THREE.MathUtils.clamp(angleDeg, -135, 135);
    // clockwise (seen from the front) = positive angle
    this.refs.get(name).quaternion.copy(k.base).multiply(new THREE.Quaternion().setFromAxisAngle(k.axis, -deg(k.angle)));
    if (!apply) return;
    if (name === 'Knob_Volume') {
      this.volume = Math.round(((k.angle + 135) / 270) * 100);
      this.player().setVolume(this.volume);
      if (this.power) this.tv.osd(`VOL ${'|'.repeat(Math.round(this.volume / 10)).padEnd(10, '.')}`, 1200);
    } else {
      const step = Math.round(k.angle / 27);
      let ch = 3 + step;
      if (ch < 2) ch += 12;
      if (ch !== this.channel) {
        this.channel = ch;
        this.sfx.click();
        if (this.power) { this.tv.glitch(250); this.tv.osd(`CH ${String(ch).padStart(2, '0')}`, 1500); this.applyChannel(); }
      }
    }
  }
  knobAngle(name: KnobName) { return this.knob.get(name)!.angle; }
  /** Click on a knob: step it, wrapping around. */
  stepKnob(name: KnobName) {
    const a = this.knobAngle(name);
    const step = name === 'Knob_Channel' ? 27 : 27;
    this.setKnob(name, a + step > 135 ? -135 : a + step);
  }

  /** The VCR outputs on channel 3; other channels show snow. */
  private applyChannel() {
    if (!this.power) return;
    const playable = this.current && (this.state === 'PLAYING' || this.state === 'PAUSED' || this.state === 'LOADING');
    // CH 3 = VCR, 4 = test card, 5 = news, 6 = adverts, everything else = snow
    const broadcast: Record<number, ScreenMode> = { 4: 'testcard', 5: 'news', 6: 'ads', 7: 'game' };
    this.hooks.onChannelAudio?.(this.channel === 3);
    if (this.channel !== 3) this.tv.setMode(broadcast[this.channel] ?? 'blank');
    else if (playable && this.tv.getMode() !== 'error') this.tv.setMode('video');
    else if (!this.current) this.tv.setMode('idle');
  }

  private flashDisplay(text: string, ms: number) { this.flash = text; this.flashUntil = performance.now() + ms; }

  private updateIndicators() {
    const playing = this.state === 'PLAYING' && this.power;
    this.led.emissiveIntensity = !this.power ? 0 : playing ? 6 : 1.2;
    this.led.color.setRGB(this.power ? 0.8 : 0.15, 0.02, 0.01);
    if (this.ledHalo) {
      (this.ledHalo.material as THREE.SpriteMaterial).opacity = !this.power ? 0 : playing ? 0.9 : 0.3;
    }
    if (this.displayHalo) (this.displayHalo.material as THREE.SpriteMaterial).opacity = this.power ? 0.35 : 0;
  }

  // ------------------------------------------------------------- per-frame
  update(now: number) {
    if (now - this.osdTimer < 250) return;
    this.osdTimer = now;
    let text: string;
    if (!this.power) text = '';
    else if (now < this.flashUntil) text = this.flash;
    else switch (this.state) {
      case 'IDLE': text = this.hasTape ? 'STOP' : '--:--'; break;
      case 'DRAGGING': text = 'READY'; break;
      case 'INSERTING': text = 'LOAD'; break;
      case 'LOADING': text = (Math.floor(now / 300) % 2 ? 'TRK ' : 'TRK.'); break;
      case 'EJECTING': text = 'EJECT'; break;
      case 'PLAYING': text = '▶' + fmt(this.player().time()); break;
      case 'PAUSED': text = (Math.floor(now / 500) % 2 ? '❚❚' : '  ') + fmt(this.player().time()); break;
    }
    const d = this.display;
    if (text === d.last) return;
    d.last = text;
    const c = d.ctx, W = d.canvas.width, H = d.canvas.height;
    c.fillStyle = '#02100e'; c.fillRect(0, 0, W, H);
    // faint unlit segments
    c.font = "50px 'VT323', monospace"; c.textBaseline = 'middle'; c.textAlign = 'center';
    c.fillStyle = 'rgba(80,255,220,0.07)'; c.fillText('88:88:88', W / 2, H / 2 + 2);
    c.shadowColor = '#4dffe0'; c.shadowBlur = 10;
    c.fillStyle = '#7dfff0'; c.fillText(text, W / 2, H / 2 + 2);
    c.shadowBlur = 0;
    d.tex.needsUpdate = true;
  }
}

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
