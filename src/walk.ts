import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

/**
 * First-person "walk" mode.
 *  desktop: click to capture the mouse (pointer lock) · WASD / arrows · Shift = walk faster · Esc frees the mouse
 *  touch:   virtual stick bottom-left to walk · drag anywhere else to look
 * Collision: the room walls plus boxes around the furniture (circle-vs-AABB, sliding along walls).
 */
export interface WalkHooks {
  onLockChange(locked: boolean): void;
}

const EYE = 1.62;
const RADIUS = 0.24;

export class Walk {
  active = false;
  locked = false;
  private yaw = 0; private pitch = 0;
  private vel = new THREE.Vector3();
  private keys = new Set<string>();
  private boxes: THREE.Box2[] = [];
  private bounds: THREE.Box2;
  private bob = 0; private bobAmt = 0;
  private stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 };
  private look = { id: -1, x: 0, y: 0 };
  private lastInput = 0;
  private stickEl: HTMLElement; private knobEl: HTMLElement;
  private coarse = matchMedia('(pointer: coarse)').matches;

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, refs: SceneRefs, hooks: WalkHooks) {
    const walls = new THREE.Box3().setFromObject(refs.get('Walls'));
    this.bounds = new THREE.Box2(new THREE.Vector2(walls.min.x + 0.28, walls.min.z + 0.4), new THREE.Vector2(walls.max.x - 0.28, walls.max.z - 0.4));
    const add = (name: string, pad = 0, clampTo?: number) => {
      const o = refs.find(name); if (!o) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.min.y > 1.2) return; // above head height – walk under it
      let box = new THREE.Box2(new THREE.Vector2(b.min.x, b.min.z), new THREE.Vector2(b.max.x, b.max.z));
      if (clampTo) { const c = o.getWorldPosition(new THREE.Vector3()); box = new THREE.Box2(new THREE.Vector2(c.x - clampTo, c.z - clampTo), new THREE.Vector2(c.x + clampTo, c.z + clampTo)); }
      box.expandByScalar(RADIUS + pad);
      this.boxes.push(box);
    };
    add('Cart'); add('Sideboard'); add('Side_Table'); add('Divider_Panel');
    add('Plant_Large_01', 0, 0.3); add('Plant_Large_02', 0, 0.3); // pot footprint, not the leaves
    console.info(`[walk] ${this.boxes.length} collision boxes`);

    // touch stick UI
    this.stickEl = document.createElement('div'); this.stickEl.className = 'walk-stick'; this.stickEl.hidden = true;
    this.knobEl = document.createElement('div'); this.knobEl.className = 'walk-stick-knob';
    this.stickEl.append(this.knobEl);
    document.body.append(this.stickEl);

    addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement | null)?.closest?.('input, textarea')) return;
      const k = this.keyOf(e.key); if (k) { this.keys.add(k); this.lastInput = performance.now(); e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    addEventListener('keyup', (e) => { const k = this.keyOf(e.key); if (k) this.keys.delete(k); }, true);
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      hooks.onLockChange(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.locked) return;
      this.turn(e.movementX * 0.0022, e.movementY * 0.0022);
    });
    // desktop: click captures the mouse; touch: stick (left) / look (right)
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      if (e.pointerType === 'mouse') {
        if (!this.locked && dom.requestPointerLock) { try { (dom.requestPointerLock as () => Promise<void> | void)(); } catch { /* not allowed */ } }
        if (!this.locked) { this.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; } // fallback: drag to look
        return;
      }
      if (e.clientX < innerWidth * 0.4 && e.clientY > innerHeight * 0.45 && this.stick.id < 0) {
        this.stick = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: 0, y: 0 };
        this.stickEl.style.left = `${e.clientX - 50}px`; this.stickEl.style.top = `${e.clientY - 50}px`;
        this.stickEl.classList.add('on');
      } else if (this.look.id < 0) this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', (e) => {
      if (!this.active) return;
      if (e.pointerId === this.stick.id) {
        const dx = e.clientX - this.stick.x0, dy = e.clientY - this.stick.y0, r = Math.min(1, Math.hypot(dx, dy) / 45);
        const a = Math.atan2(dy, dx);
        this.stick.x = Math.cos(a) * r; this.stick.y = Math.sin(a) * r;
        this.knobEl.style.transform = `translate(${this.stick.x * 32}px, ${this.stick.y * 32}px)`;
        this.lastInput = performance.now();
      } else if (e.pointerId === this.look.id) {
        this.turn((e.clientX - this.look.x) * 0.005, (e.clientY - this.look.y) * 0.005);
        this.look.x = e.clientX; this.look.y = e.clientY;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.stick.id) { this.stick = { id: -1, x0: 0, y0: 0, x: 0, y: 0 }; this.knobEl.style.transform = ''; this.stickEl.classList.remove('on'); }
      if (e.pointerId === this.look.id) this.look.id = -1;
    };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
  }

  private keyOf(k: string) {
    const m: Record<string, string> = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', shift: 'run' };
    return m[k.toLowerCase()];
  }

  private turn(dx: number, dy: number) {
    this.yaw -= dx; this.pitch = THREE.MathUtils.clamp(this.pitch - dy, -1.25, 1.15);
    this.lastInput = performance.now();
  }

  /** Enter walk mode from the current camera view, standing up at eye height. */
  enter() {
    this.active = true;
    const dir = this.camera.getWorldDirection(new THREE.Vector3());
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)) * 0.5;
    const p = this.camera.position;
    p.y = EYE;
    const v = new THREE.Vector2(p.x, p.z);
    this.bounds.clampPoint(v, v);
    // if we start inside furniture (e.g. leaning over the cart), step back until free
    for (let i = 0; i < 40 && this.blocked(v.x, v.y); i++) { v.x += Math.sin(this.yaw) * 0.08; v.y += Math.cos(this.yaw) * 0.08; }
    p.x = v.x; p.z = v.y;
    this.stickEl.hidden = !this.coarse;
    this.lastInput = performance.now();
  }

  exit() {
    this.active = false;
    this.keys.clear(); this.vel.set(0, 0, 0);
    this.stickEl.hidden = true;
    if (this.locked) document.exitPointerLock();
  }

  private blocked(x: number, z: number) {
    const v = new THREE.Vector2(x, z);
    if (!this.bounds.containsPoint(v)) return true;
    return this.boxes.some((b) => b.containsPoint(v));
  }

  update(dt: number) {
    if (!this.active) return;
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    let fx = (k.has('r') ? 1 : 0) - (k.has('l') ? 1 : 0) + this.stick.x;
    let fz = (k.has('f') ? 1 : 0) - (k.has('b') ? 1 : 0) - this.stick.y;
    const len = Math.hypot(fx, fz); if (len > 1) { fx /= len; fz /= len; }
    const speed = k.has('run') ? 2.4 : 1.25;
    // world-space wish direction from yaw
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const wx = (-sin * fz + cos * fx) * speed, wz = (-cos * fz - sin * fx) * speed;
    const acc = len > 0.01 ? 10 : 8;
    this.vel.x += (wx - this.vel.x) * Math.min(1, dt * acc);
    this.vel.z += (wz - this.vel.z) * Math.min(1, dt * acc);

    const p = this.camera.position;
    // axis-separated moves → slide along walls and furniture
    const nx = p.x + this.vel.x * dt; if (!this.blocked(nx, p.z)) p.x = nx; else this.vel.x = 0;
    const nz = p.z + this.vel.z * dt; if (!this.blocked(p.x, nz)) p.z = nz; else this.vel.z = 0;

    // head bob while moving, breathing while still
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.bob += dt * (5.5 + sp * 2.2) * Math.min(1, sp);
    this.bobAmt += ((sp > 0.15 ? 1 : 0) - this.bobAmt) * Math.min(1, dt * 6);
    const t = performance.now() / 1000;
    const idle = performance.now() - this.lastInput > 3000 ? 1 : 0;
    p.y = EYE + Math.sin(this.bob * 2) * 0.018 * this.bobAmt + Math.sin(t * 2 * Math.PI * 0.23) * 0.004 * idle;
    const sway = Math.sin(this.bob) * 0.008 * this.bobAmt;

    this.camera.rotation.set(this.pitch + Math.sin(t * 0.31) * 0.004 * idle, this.yaw, sway, 'YXZ');
  }
}
