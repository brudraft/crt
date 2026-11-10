import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import gsap from 'gsap';
import type { SceneRefs } from './scene-contract';

export interface CameraRig {
  controls: OrbitControls;
  readonly mode: 'home' | 'window';
  flyHome(duration?: number): void;
  flyWindow(duration?: number): void;
  update(): void;
  resize(w: number, h: number): void;
}

/** Orbit camera clamped to stay inside the room, starting at Cam_Hero. */
export function setupCamera(camera: THREE.PerspectiveCamera, dom: HTMLElement, refs: SceneRefs): CameraRig {
  const target = refs.orbitTarget.getWorldPosition(new THREE.Vector3());
  const home = refs.camHero.getWorldPosition(new THREE.Vector3());
  const baseFov = refs.heroCamera?.fov ?? 34;
  const baseAspect = 16 / 9;

  // Room interior from the wall shell, shrunk by a margin.
  const room = new THREE.Box3();
  const walls = refs.find('Walls');
  if (walls) room.setFromObject(walls); else room.set(new THREE.Vector3(-2.5, 0, -2.5), new THREE.Vector3(2.5, 2.8, 2.5));
  room.expandByScalar(-0.3);
  room.min.y = Math.max(room.min.y, 0.35);
  console.info('[camera] room clamp box', room.min.toArray().map((v) => +v.toFixed(2)), room.max.toArray().map((v) => +v.toFixed(2)));

  camera.position.copy(home);
  const controls = new OrbitControls(camera, dom);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 0.45;
  controls.maxDistance = 2.4;
  controls.minPolarAngle = Math.PI * 0.28;
  controls.maxPolarAngle = Math.PI * 0.6;
  controls.minAzimuthAngle = -Math.PI * 0.45;
  controls.maxAzimuthAngle = Math.PI * 0.45;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.8;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.update();

  let flying: gsap.core.Tween | null = null;

  // ---- window viewpoint: stand at the glass and look down on the city
  const glass = refs.find('Window_Glass');
  const gBox = glass ? new THREE.Box3().setFromObject(glass) : new THREE.Box3(new THREE.Vector3(0.15, 0, -1.63), new THREE.Vector3(2.92, 2.8, -1.63));
  const gC = gBox.getCenter(new THREE.Vector3());
  const windowPos = new THREE.Vector3(gC.x - 0.1, 1.5, Math.max(room.min.z + 0.05, gBox.max.z + 0.45));
  // gaze out and ~25° down over the rooftops; target kept close so the orbit distance limits still apply
  const windowTarget = windowPos.clone().add(new THREE.Vector3(0.25, -0.8, -1.7).normalize().multiplyScalar(1.6));
  const limits = {
    home: { min: 0.45, max: 2.4, minPolar: 0.28, maxPolar: 0.6 },
    window: { min: 0.6, max: 2.2, minPolar: 0.12, maxPolar: 0.62 },
  };
  let mode: 'home' | 'window' = 'home';
  const setLimits = (m: 'home' | 'window') => {
    const l = limits[m];
    controls.minDistance = l.min; controls.maxDistance = l.max;
    controls.minPolarAngle = Math.PI * l.minPolar; controls.maxPolarAngle = Math.PI * l.maxPolar;
  };

  const flyTo = (pos: THREE.Vector3, tgt: THREE.Vector3, m: 'home' | 'window', duration: number) => {
    flying?.kill();
    mode = m;
    // widen limits during the flight so the clamp doesn't fight the tween
    controls.minDistance = 0.1; controls.maxDistance = 10; controls.minPolarAngle = 0.05; controls.maxPolarAngle = Math.PI * 0.95;
    const from = camera.position.clone(), fromT = controls.target.clone();
    // arc slightly upwards between viewpoints, like walking and turning your head
    const mid = from.clone().lerp(pos, 0.5); mid.y += from.distanceTo(pos) > 1 ? 0.12 : 0;
    const curve = new THREE.QuadraticBezierCurve3(from, mid, pos);
    const p = { k: 0 };
    flying = gsap.to(p, {
      k: 1, duration, ease: 'power2.inOut',
      onUpdate: () => { camera.position.copy(curve.getPoint(p.k)); controls.target.lerpVectors(fromT, tgt, p.k); },
      onComplete: () => { setLimits(m); flying = null; },
    });
  };

  // ---- idle "breathing": a person sitting still, not a tripod
  let lastInput = performance.now();
  for (const ev of ['pointerdown', 'pointermove', 'wheel', 'touchstart', 'keydown']) dom.addEventListener(ev, () => { lastInput = performance.now(); }, { passive: true });
  addEventListener('keydown', () => { lastInput = performance.now(); });
  const breath = new THREE.Vector3();
  const breathT = new THREE.Vector3();
  let breathAmt = 0;

  return {
    controls,
    get mode() { return mode; },
    flyHome(duration = 1.2) { flyTo(home, target, 'home', duration); },
    flyWindow(duration = 2.2) { flyTo(windowPos, windowTarget, 'window', duration); },
    update() {
      // take last frame's breathing offset out before OrbitControls integrates, then add the new one
      camera.position.sub(breath); controls.target.sub(breathT);
      controls.update();
      camera.position.clamp(room.min, room.max);
      const now = performance.now();
      const idle = !flying && now - lastInput > 3500 && controls.enabled;
      breathAmt += ((idle ? 1 : 0) - breathAmt) * (idle ? 0.01 : 0.15);
      const t = now / 1000;
      const inhale = Math.sin(t * 2 * Math.PI * 0.23);            // ~14 breaths per minute
      const sway = Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.91 + 1.7) * 0.4;
      breath.set(sway * 0.0035, inhale * 0.0028, inhale * 0.0016).multiplyScalar(breathAmt);
      breathT.set(sway * 0.006 + Math.sin(t * 0.21) * 0.004, Math.sin(t * 0.17 + 0.5) * 0.003, 0).multiplyScalar(breathAmt); // gaze drifts a little
      camera.position.add(breath); controls.target.add(breathT);
      camera.lookAt(controls.target);
    },
    resize(w: number, h: number) {
      const aspect = w / h;
      camera.aspect = aspect;
      // Keep the hero framing's horizontal extent on narrow / portrait screens.
      if (aspect < baseAspect) {
        const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov) / 2) * baseAspect);
        const vf = 2 * Math.atan(Math.tan(hf / 2) / aspect);
        camera.fov = Math.min(THREE.MathUtils.radToDeg(vf), 75);
      } else camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },
  };
}

// ------------------------------------------------------------------ pointer interaction
export interface InteractionHandlers {
  /** Return the tape root for a hit object, or null. */
  tapeAt(o: THREE.Object3D): THREE.Object3D | null;
  canDrag(tapeNode: THREE.Object3D): boolean;
  onHoverTape(tapeNode: THREE.Object3D | null): void;
  onDragStart(tapeNode: THREE.Object3D): void;
  onDragMove(tapeNode: THREE.Object3D, nearSlot: boolean): void;
  onDrop(tapeNode: THREE.Object3D, nearSlot: boolean): void;
  onTapeClick(tapeNode: THREE.Object3D): void;
  onButton(name: string): void;
  onKnobDrag(name: string, deltaDeg: number): void;
  onKnobClick(name: string): void;
  onTVDoubleClick(): void;
  /** joystick: x,y in -1…1 while dragging (0,0 on release); tap = fire */
  onJoystick(x: number, y: number, dragging: boolean): void;
  onJoystickTap(): void;
  onHoloClick(): void;
  onWindowDoubleClick(): void;
  slotWorld(): THREE.Vector3;
  setCursor(c: string): void;
}

const BUTTONS = /^Btn_(Eject|Play|Stop|FF|Rew|Power)$/;
const KNOBS = /^Knob_(Channel|Volume)$/;
type Kind = 'tape' | 'button' | 'knob' | 'tv' | 'joystick' | 'holo' | 'window' | null;

/**
 * Raycast-based pointer handling for tapes, buttons, knobs and TV double-click.
 * Registered in the capture phase so it can disable OrbitControls before they see the pointerdown.
 */
export class Interaction {
  private ray = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private targets: THREE.Object3D[] = [];
  private down: null | {
    x: number; y: number; id: number; kind: 'tape' | 'button' | 'knob' | 'joystick' | 'holo'; obj: THREE.Object3D; name: string;
    dragging: boolean; lastX: number; lastY: number;
  } = null;
  private plane = new THREE.Plane();
  private grabOffset = new THREE.Vector3();
  private hovered: THREE.Object3D | null = null;
  private pendingMove: PointerEvent | null = null;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement, private controls: OrbitControls, private h: InteractionHandlers) {
    dom.addEventListener('pointerdown', this.onDown, { capture: true });
    dom.addEventListener('pointermove', (e) => { this.pendingMove = e; });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    dom.addEventListener('dblclick', this.onDbl);
  }

  /** Meshes to raycast against (interactive objects + occluders). */
  setTargets(list: THREE.Object3D[]) { this.targets = list; }

  private setRay(clientX: number, clientY: number) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
  }

  private pick(clientX: number, clientY: number) {
    this.setRay(clientX, clientY);
    const hits = this.ray.intersectObjects(this.targets, false);
    return hits.find((h) => isVisible(h.object)) ?? null;
  }

  private classify(o: THREE.Object3D): { kind: Kind; obj: THREE.Object3D; name: string } {
    const tape = this.h.tapeAt(o);
    if (tape) return { kind: 'tape', obj: tape, name: tape.name };
    let n: THREE.Object3D | null = o;
    while (n) {
      if (BUTTONS.test(n.name)) return { kind: 'button', obj: n, name: n.name };
      if (KNOBS.test(n.name)) return { kind: 'knob', obj: n, name: n.name };
      if (n.name === 'Prop_Joystick') return { kind: 'joystick', obj: n, name: n.name };
      if (n.name === 'Holo_Notify') return { kind: 'holo', obj: n, name: n.name };
      if (n.name === 'Window_Glass') return { kind: 'window', obj: n, name: n.name };
      if (n.name === 'TV_Root' || n.name === 'ScreenHole' || n.name === 'ScreenGlassSheen') return { kind: 'tv', obj: n, name: n.name };
      n = n.parent;
    }
    return { kind: null, obj: o, name: o.name };
  }

  private onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (this.down) return; // second finger → let OrbitControls handle pinch
    const hit = this.pick(e.clientX, e.clientY);
    if (!hit) return;
    const c = this.classify(hit.object);
    if (c.kind === 'tape' && !this.h.canDrag(c.obj)) return;
    if (c.kind === 'tape' || c.kind === 'button' || c.kind === 'knob' || c.kind === 'joystick' || c.kind === 'holo') {
      this.controls.enabled = false; // OrbitControls bails out of its own pointerdown when disabled
      e.stopImmediatePropagation();
      this.dom.setPointerCapture?.(e.pointerId);
      this.down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, id: e.pointerId, kind: c.kind, obj: c.obj, name: c.name, dragging: false };
      if (c.kind === 'tape') {
        const wp = c.obj.getWorldPosition(new THREE.Vector3());
        this.plane.setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(new THREE.Vector3()).negate(), wp);
        const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
        this.grabOffset.copy(wp).sub(p ?? wp);
      }
    }
  };

  private nearSlot(clientX: number, clientY: number, obj: THREE.Object3D) {
    const s = this.h.slotWorld();
    const wp = obj.getWorldPosition(new THREE.Vector3());
    if (wp.distanceTo(s) < 0.16) return true;
    const sp = s.clone().project(this.camera);
    const r = this.dom.getBoundingClientRect();
    const sx = (sp.x * 0.5 + 0.5) * r.width + r.left, sy = (-sp.y * 0.5 + 0.5) * r.height + r.top;
    // ~12 cm around the slot, in screen pixels at the current distance (min 40 px for small screens)
    const fovPx = r.height / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    const radius = Math.max(40, (0.12 / Math.max(0.2, this.camera.position.distanceTo(s))) * fovPx);
    return Math.hypot(sx - clientX, sy - clientY) < radius;
  }

  private dragTo(clientX: number, clientY: number) {
    const d = this.down!;
    this.setRay(clientX, clientY);
    const p = this.ray.ray.intersectPlane(this.plane, new THREE.Vector3());
    if (!p) return;
    p.add(this.grabOffset);
    p.y = Math.max(p.y, 0.2);
    d.obj.parent!.worldToLocal(p);
    d.obj.position.copy(p);
    this.h.onDragMove(d.obj, this.nearSlot(clientX, clientY, d.obj));
  }

  private onUp = (e: PointerEvent) => {
    const d = this.down;
    if (!d || e.pointerId !== d.id) return;
    this.flushMove();
    this.down = null;
    this.controls.enabled = true;
    if (this.dom.hasPointerCapture?.(e.pointerId)) this.dom.releasePointerCapture(e.pointerId);
    this.h.setCursor('');
    if (d.kind === 'tape') {
      if (d.dragging) this.h.onDrop(d.obj, e.type !== 'pointercancel' && this.nearSlot(e.clientX, e.clientY, d.obj));
      else if (e.type !== 'pointercancel') this.h.onTapeClick(d.obj);
    } else if (d.kind === 'button' && e.type !== 'pointercancel') this.h.onButton(d.name);
    else if (d.kind === 'knob' && !d.dragging && e.type !== 'pointercancel') this.h.onKnobClick(d.name);
    else if (d.kind === 'holo' && !d.dragging && e.type !== 'pointercancel') this.h.onHoloClick();
    else if (d.kind === 'joystick') { this.h.onJoystick(0, 0, false); if (!d.dragging && e.type !== 'pointercancel') this.h.onJoystickTap(); }
  };

  private onDbl = (e: MouseEvent) => {
    const hit = this.pick(e.clientX, e.clientY);
    const k = hit ? this.classify(hit.object).kind : null;
    if (k === 'tv') this.h.onTVDoubleClick();
    else if (k === 'window') this.h.onWindowDoubleClick();
  };

  private flushMove() {
    const e = this.pendingMove;
    if (!e) return;
    this.pendingMove = null;
    const d = this.down;
    if (d) {
      const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
      if (!d.dragging && moved > 6 && d.kind !== 'button') {
        d.dragging = true;
        if (d.kind === 'tape') this.h.onDragStart(d.obj);
      }
      if (d.dragging && d.kind === 'tape') this.dragTo(e.clientX, e.clientY);
      if (d.kind === 'joystick' && moved > 4) {
        d.dragging = true;
        const r = Math.max(40, Math.min(innerWidth, innerHeight) * 0.08); // full tilt after ~8% of the screen
        const clamp = (v: number) => Math.max(-1, Math.min(1, v));
        this.h.onJoystick(clamp((e.clientX - d.x) / r), clamp(-(e.clientY - d.y) / r), true);
      }
      if (d.dragging && d.kind === 'knob') this.h.onKnobDrag(d.name, ((e.clientX - d.lastX) - (e.clientY - d.lastY)) * 1.2);
      d.lastX = e.clientX; d.lastY = e.clientY;
      this.h.setCursor(d.kind === 'tape' ? 'grabbing' : 'pointer');
      return;
    }
    if (e.pointerType === 'touch') return;
    const hit = this.pick(e.clientX, e.clientY);
    const c = hit ? this.classify(hit.object) : null;
    const tape = c?.kind === 'tape' && this.h.canDrag(c.obj) ? c.obj : null;
    if (tape !== this.hovered) { this.hovered = tape; this.h.onHoverTape(tape); }
    this.h.setCursor(tape ? 'grab' : c && (c.kind === 'button' || c.kind === 'knob' || c.kind === 'joystick' || c.kind === 'holo') ? 'pointer' : '');
  }

  /** Called once per frame: coalesces pointermove events into a single raycast. */
  update() { this.flushMove(); }
}

function isVisible(o: THREE.Object3D) {
  for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
  return true;
}
