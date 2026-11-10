import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

/**
 * The GLB's RCA cables just dangle over the cart edge with loose plugs. Replace them with three cables
 * that come up from the lower shelf, over the top-shelf edge and plug into front-AV jacks on the TV's
 * right side panel (yellow = video, white = L, red = R).
 */
export function setupCables(scene: THREE.Scene, refs: SceneRefs) {
  for (const n of ['Prop_Cable_RCA_Red', 'Prop_Cable_RCA_White', 'Prop_Cable_RCA_Yellow', 'Prop_RCA_Plug_1', 'Prop_RCA_Plug_2', 'Prop_RCA_Plug_3']) {
    const o = refs.find(n); if (o) o.visible = false;
  }
  const tv = new THREE.Box3().setFromObject(refs.get('TV_Body'));
  const sideX = tv.max.x;            // right side panel of the TV
  const shelfY = refs.get('Cart_TopShelf_Ref').getWorldPosition(new THREE.Vector3()).y;
  const lowerY = refs.get('Cart_LowerShelf_Ref').getWorldPosition(new THREE.Vector3()).y;
  const jackY = tv.min.y + 0.032;
  const jackZ0 = tv.max.z - 0.045;   // near the front edge, like a real front-AV block

  const group = new THREE.Group();
  group.name = 'AV_Cables';
  scene.add(group);

  // small recessed panel the jacks sit in
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(0.002, 0.022, 0.048),
    new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.6, metalness: 0.2 }),
  );
  panel.position.set(sideX + 0.0005, jackY, jackZ0 - 0.015);
  group.add(panel);

  const defs = [
    { name: 'Video', color: 0xe8c21e },
    { name: 'Audio_L', color: 0xe9e6dc },
    { name: 'Audio_R', color: 0xc8221e },
  ];
  const metal = new THREE.MeshStandardMaterial({ color: 0xc9c3b0, roughness: 0.25, metalness: 1 });
  const alongX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);

  defs.forEach((d, i) => {
    const z = jackZ0 - i * 0.015;
    const col = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.45, metalness: 0 });
    const rubber = new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.6, metalness: 0 });

    // jack: coloured ring + metal sleeve, flush with the side panel
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0055, 0.0055, 0.002, 16), col);
    ring.quaternion.copy(alongX); ring.position.set(sideX + 0.0015, jackY, z);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0036, 0.0036, 0.004, 12), metal);
    sleeve.quaternion.copy(alongX); sleeve.position.set(sideX + 0.003, jackY, z);

    // plug: metal collar, coloured body, rubber strain relief
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.006, 14), metal);
    collar.quaternion.copy(alongX); collar.position.set(sideX + 0.006, jackY, z);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.0048, 0.0045, 0.016, 14), col);
    body.quaternion.copy(alongX); body.position.set(sideX + 0.017, jackY, z);
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0028, 0.01, 12), rubber);
    boot.quaternion.copy(alongX); boot.position.set(sideX + 0.03, jackY, z);
    group.add(ring, sleeve, collar, body, boot);

    // cable: out of the plug, down onto the shelf, towards the front edge, over it and down to the lower shelf
    const j = (a: number) => (Math.sin(i * 12.9 + a * 7.1) * 0.5) * 0.012; // per-cable wobble
    const start = new THREE.Vector3(sideX + 0.035, jackY, z);
    const pts = [
      start,
      new THREE.Vector3(sideX + 0.05, jackY - 0.012, z + 0.004),
      // drop onto the shelf in the gap between the TV and the tape stacks, then run to the back
      new THREE.Vector3(sideX + 0.022 + j(1) * 0.3, shelfY + 0.004, z - 0.02),
      new THREE.Vector3(sideX + 0.024 + j(2) * 0.3, shelfY + 0.003, 0.0 + j(3)),
      new THREE.Vector3(sideX + 0.026 + j(4) * 0.3, shelfY + 0.003, -0.2 + j(5)),
      // over the rear rail and down behind the cart (out of sight from the hero view)
      new THREE.Vector3(sideX + 0.03, shelfY + 0.03, -0.29),
      new THREE.Vector3(sideX + 0.035 + j(6), shelfY - 0.04, -0.325),
      new THREE.Vector3(sideX + 0.05 + j(7), (shelfY + lowerY) / 2 + j(8) * 3, -0.33 + j(9)),
      new THREE.Vector3(sideX + 0.06, lowerY + 0.035, -0.31),
      new THREE.Vector3(sideX + 0.065, lowerY + 0.006, -0.24),
      new THREE.Vector3(0.3 + i * 0.012, lowerY + 0.012, -0.15),                // into the joystick base
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const cable = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.0027, 8, false), rubber);
    cable.name = `RCA_${d.name}`;
    group.add(cable);
  });

  group.traverse((o) => { (o as THREE.Mesh).raycast = () => {}; });
  return group;
}
