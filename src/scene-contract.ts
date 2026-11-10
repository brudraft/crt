import * as THREE from 'three';
import contract from './contract.json';

/** Everything the app needs from the GLB, resolved once at load. */
export interface SceneRefs {
  root: THREE.Object3D;
  get(name: string): THREE.Object3D;
  find(name: string): THREE.Object3D | undefined;
  screen: THREE.Mesh;
  screenAnchor: THREE.Object3D;
  screenSize: { w: number; h: number };
  slotAnchor: THREE.Object3D;
  slotInside: THREE.Object3D;
  flap: THREE.Object3D;
  tapeTemplate: THREE.Object3D;
  glbTapes: THREE.Object3D[];
  heroCamera?: THREE.PerspectiveCamera;
  orbitTarget: THREE.Object3D;
  camHero: THREE.Object3D;
}

export class ContractError extends Error {
  constructor(public checklist: string[]) {
    super('Scene contract failed');
  }
}

/** Validate the loaded scene against src/contract.json. Throws ContractError with a full checklist. */
export function validateScene(root: THREE.Object3D, cameras: THREE.Camera[]): SceneRefs {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => { if (!byName.has(o.name)) byName.set(o.name, o); });
  const materials = new Set<string>();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => materials.add(mm.name));
  });

  const lines: string[] = [];
  let ok = true;
  const check = (pass: boolean, label: string) => {
    lines.push(`${pass ? '[x]' : '[ ]'} ${label}`);
    if (!pass) ok = false;
  };

  for (const n of contract.nodes) check(byName.has(n), `node ${n}`);
  for (let i = 1; i <= 5; i++) {
    const id = `VHS_Tape_0${i}`;
    for (const c of contract.tapeChildren) check(byName.has(`${id}_${c}`), `node ${id}_${c}`);
  }
  for (const [node, keys] of Object.entries(contract.extras)) {
    const o = byName.get(node);
    for (const k of keys) check(!!o && o.userData[k] !== undefined, `extras ${node}.${k}`);
  }
  for (const m of contract.materials) check(materials.has(m), `material ${m}`);
  const screen = byName.get('Screen');
  check(!!screen && (screen as THREE.Mesh).isMesh, 'Screen is a mesh');

  if (!ok) {
    console.error('[contract] FAILED\n' + lines.join('\n'));
    throw new ContractError(lines);
  }
  console.info('[contract] OK – ' + lines.length + ' checks passed');

  const get = (n: string) => byName.get(n)!;
  const camHero = get('Cam_Hero');
  const heroCamera =
    (cameras.find((c) => c.parent === camHero || c.name === 'Cam_Hero') as THREE.PerspectiveCamera | undefined) ??
    (camHero.children.find((c) => (c as THREE.PerspectiveCamera).isPerspectiveCamera) as THREE.PerspectiveCamera | undefined);

  return {
    root,
    get,
    find: (n) => byName.get(n),
    screen: screen as THREE.Mesh,
    screenAnchor: get('ScreenAnchor'),
    screenSize: { w: Number(screen!.userData.screen_width_m), h: Number(screen!.userData.screen_height_m) },
    slotAnchor: get('VHS_Slot_Anchor'),
    slotInside: get('VHS_Slot_Inside_Anchor'),
    flap: get('VHS_Flap'),
    tapeTemplate: get('VHS_Tape_Root'),
    glbTapes: [1, 2, 3, 4, 5].map((i) => get(`VHS_Tape_0${i}`)),
    heroCamera,
    orbitTarget: get('OrbitTarget'),
    camHero,
  };
}

const AXES: [string, THREE.Vector3][] = [
  ['+X', new THREE.Vector3(1, 0, 0)], ['-X', new THREE.Vector3(-1, 0, 0)],
  ['+Y', new THREE.Vector3(0, 1, 0)], ['-Y', new THREE.Vector3(0, -1, 0)],
  ['+Z', new THREE.Vector3(0, 0, 1)], ['-Z', new THREE.Vector3(0, 0, -1)],
];

/** Which local axis of `obj` points most along `worldDir`? Returns the local axis and its world direction. */
export function bestLocalAxis(obj: THREE.Object3D, worldDir: THREE.Vector3) {
  const q = obj.getWorldQuaternion(new THREE.Quaternion());
  let best = { name: '', local: new THREE.Vector3(), world: new THREE.Vector3(), dot: -Infinity };
  for (const [name, v] of AXES) {
    const w = v.clone().applyQuaternion(q);
    const d = w.dot(worldDir);
    if (d > best.dot) best = { name, local: v.clone(), world: w, dot: d };
  }
  return best;
}
