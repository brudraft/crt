import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';
import type { TVScreen } from './screen';

/**
 * Light the TV screen throws into the room:
 *  - a RectAreaLight the size of the screen lights the hero objects (cart, tapes, props, TV front)
 *  - additive "light pools" on the floor and the top shelf fake the spill on the baked (unlit) room
 *  - while a tape plays the room dims a little, like switching the big light off for a film
 */
export function setupTVLight(scene: THREE.Scene, refs: SceneRefs, tv: TVScreen) {
  const anchor = refs.screenAnchor.getWorldPosition(new THREE.Vector3());
  const { w, h } = refs.screenSize;
  const light = new THREE.RectAreaLight(0xaabbff, 0, w, h);
  light.position.copy(anchor).add(new THREE.Vector3(0, 0, 0.03));
  light.lookAt(anchor.x, anchor.y, anchor.z + 5);
  scene.add(light);

  // radial gradient pools (additive) on the baked floor + the cart shelf in front of the TV
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const pool = (width: number, depth: number, pos: THREE.Vector3, max: number) => {
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.copy(pos);
    m.raycast = () => {};
    m.renderOrder = 3;
    scene.add(m);
    return { mat, max };
  };
  const shelfY = refs.get('Cart_TopShelf_Ref').getWorldPosition(new THREE.Vector3()).y;
  const pools = [
    pool(2.6, 2.2, new THREE.Vector3(anchor.x, 0.004, anchor.z + 1.25), 0.2),     // floor in front of the cart
    pool(0.9, 0.22, new THREE.Vector3(anchor.x, shelfY + 0.002, anchor.z + 0.07), 0.3), // shelf lip in front of the TV
  ];

  // room dimming: baked room materials + warm dynamic lights
  const baked: { m: THREE.MeshBasicMaterial; base: THREE.Color }[] = [];
  const seen = new Set<THREE.Material>();
  refs.root.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (!mat || seen.has(mat) || !mat.userData?.baked) return;
    seen.add(mat);
    if (/^M_(Shell|Furniture|Floor|Plants|LED_Warm)/.test(mat.name)) baked.push({ m: mat, base: mat.color.clone() });
  });
  const warm: { l: THREE.Light; base: number }[] = [];
  scene.traverse((o) => {
    const l = o as THREE.Light;
    if (l.isLight && l !== light && (l as THREE.PointLight).color && l.color.r > l.color.b && !(l as THREE.AmbientLight).isAmbientLight) warm.push({ l, base: l.intensity });
  });
  const envBase = scene.environmentIntensity;

  let dim = 1, target = 1;
  const col = new THREE.Color();
  const state = { k: 0, color: col, dim: 1 };
  return {
    state,
    /** true while a film is playing → dim the room */
    setFilmMode(on: boolean) { target = on ? 0.62 : 1; },
    update(now: number, dt: number) {
      const k = tv.emission(now, col);
      state.k = k; state.dim = dim;
      light.color.copy(col);
      light.intensity = k * 10;
      for (const p of pools) { p.mat.color.copy(col); p.mat.opacity = Math.min(1, k) * p.max; }
      if (Math.abs(dim - target) > 1e-3) {
        dim += (target - dim) * Math.min(1, dt * 1.5);
        for (const b of baked) b.m.color.copy(b.base).multiplyScalar(dim);
        for (const w of warm) w.l.intensity = w.base * (0.4 + 0.6 * dim);
        scene.environmentIntensity = envBase * (0.5 + 0.5 * dim);
      }
    },
  };
}
