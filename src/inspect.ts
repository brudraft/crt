import * as THREE from 'three';
import gsap from 'gsap';

/**
 * Pick something up and look at it: the object flies in front of the camera, drag to turn it,
 * click / E / Esc to put it back exactly where it was.
 */
export class Inspector {
  active: THREE.Object3D | null = null;
  private home: { parent: THREE.Object3D; pos: THREE.Vector3; quat: THREE.Quaternion; scale: THREE.Vector3 } | null = null;
  private holder = new THREE.Group();
  private drag: { id: number; x: number; y: number; moved: number } | null = null;
  private caption: HTMLElement;
  private busy = false;

  constructor(private camera: THREE.Camera, dom: HTMLElement, private onChange: (inspecting: boolean) => void) {
    camera.add(this.holder);
    this.holder.position.set(0, -0.01, -0.36);
    this.caption = document.getElementById('inspect-caption')!;

    // capture phase so orbit / walk-look / raycast picking don't also react
    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.stopImmediatePropagation(); e.preventDefault();
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    }, true);
    addEventListener('pointermove', (e) => {
      if (!this.active) return;
      const locked = !!document.pointerLockElement;
      if (!this.drag && !locked) return;
      const dx = locked ? e.movementX : e.clientX - this.drag!.x, dy = locked ? e.movementY : e.clientY - this.drag!.y;
      if (this.drag) { this.drag.x = e.clientX; this.drag.y = e.clientY; this.drag.moved += Math.abs(dx) + Math.abs(dy); }
      if (locked && !this.drag) return; // with a captured mouse, turn only while the button is held
      this.active.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), dx * 0.01);
      this.active.rotateOnWorldAxis(new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion), dy * 0.01);
    }, true);
    addEventListener('pointerup', (e) => {
      if (!this.active || !this.drag || e.pointerId !== this.drag.id) return;
      const click = this.drag.moved < 6;
      this.drag = null;
      if (click) this.putBack();
    }, true);
    addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (['e', 'escape', ' ', 'enter'].includes(e.key.toLowerCase())) { e.preventDefault(); e.stopImmediatePropagation(); this.putBack(); }
    }, true);
  }

  pickUp(obj: THREE.Object3D, caption: string, faceUp = new THREE.Euler(0, 0, 0), scale = 1) {
    if (this.active || this.busy) return;
    this.busy = true;
    this.home = { parent: obj.parent!, pos: obj.position.clone(), quat: obj.quaternion.clone(), scale: obj.scale.clone() };
    // reparent without a visual jump, then fly into the hands
    this.holder.updateMatrixWorld(true);
    this.holder.attach(obj);
    this.active = obj;
    const q0 = obj.quaternion.clone(), q1 = new THREE.Quaternion().setFromEuler(faceUp);
    const p = { k: 0 };
    const s0 = obj.scale.clone();
    gsap.to(obj.position, { x: 0, y: 0, z: 0, duration: 0.6, ease: 'power2.out' });
    gsap.to(p, { k: 1, duration: 0.6, ease: 'power2.out', onUpdate: () => { obj.quaternion.slerpQuaternions(q0, q1, p.k); obj.scale.lerpVectors(s0, s0.clone().multiplyScalar(scale), p.k); }, onComplete: () => { this.busy = false; } });
    this.caption.textContent = caption + '  ·  drag to turn · click / E to put it back';
    this.caption.hidden = false;
    this.onChange(true);
  }

  putBack() {
    const obj = this.active, home = this.home;
    if (!obj || !home || this.busy) return;
    this.busy = true;
    this.caption.hidden = true;
    // fly back in world space, then reattach to the original parent
    const world = new THREE.Vector3(), wq = new THREE.Quaternion();
    home.parent.updateMatrixWorld(true);
    world.copy(home.pos).applyMatrix4(home.parent.matrixWorld);
    home.parent.getWorldQuaternion(wq).multiply(home.quat);
    const root = obj.parent!;
    const q0 = obj.quaternion.clone(); const s0 = obj.scale.clone();
    const sTarget = home.scale.clone().multiply(new THREE.Vector3(1, 1, 1));
    const p = { k: 0 };
    const pos0 = obj.position.clone();
    gsap.to(p, {
      k: 1, duration: 0.5, ease: 'power2.inOut',
      onUpdate: () => {
        // the camera may move while it flies back → re-evaluate the target each frame
        root.updateMatrixWorld(true);
        const lt = root.worldToLocal(world.clone());
        obj.position.lerpVectors(pos0, lt, p.k);
        obj.quaternion.slerpQuaternions(q0, root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wq), p.k);
        obj.scale.lerpVectors(s0, sTarget, p.k);
      },
      onComplete: () => {
        home.parent.attach(obj);
        obj.position.copy(home.pos); obj.quaternion.copy(home.quat); obj.scale.copy(home.scale);
        this.active = null; this.home = null; this.busy = false;
        this.onChange(false);
      },
    });
  }
}
