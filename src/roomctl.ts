import * as THREE from 'three';
import gsap from 'gsap';
import type { SceneRefs } from './scene-contract';
import type { Sfx } from './audio';

/**
 * Room controls: the ceiling-light switch by the door and venetian blinds at the window.
 * Both are `userData.onUse` objects (click them, or aim + E in walk mode), plus keys L and B.
 */
export function setupRoomControls(scene: THREE.Scene, refs: SceneRefs, sfx: Sfx, hooks: { setCeiling(on: boolean): void; setBlinds(closed: number): void }) {
  // ---------------- light switch next to the door
  const door = refs.find('Door');
  const dBox = door ? new THREE.Box3().setFromObject(door) : new THREE.Box3(new THREE.Vector3(1.49, 0, 3.31), new THREE.Vector3(2.51, 2.16, 3.4));
  const sw = new THREE.Group(); sw.name = 'LightSwitch';
  sw.position.set(dBox.min.x - 0.18, 1.12, dBox.max.z - 0.004);
  sw.rotation.y = Math.PI; // facing into the room (-Z)
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.01), new THREE.MeshStandardMaterial({ color: 0xe8e2d2, roughness: 0.5 }));
  const rocker = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.012), new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.4 }));
  rocker.position.z = 0.008;
  const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.003, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff8030, toneMapped: false }));
  pilot.position.set(0, 0.035, 0.012);
  sw.add(plate, rocker, pilot);
  scene.add(sw);
  let ceiling = true;
  const setCeiling = (on: boolean) => {
    ceiling = on;
    sfx.click();
    gsap.to(rocker.rotation, { x: on ? -0.25 : 0.25, duration: 0.08 });
    (pilot.material as THREE.MeshBasicMaterial).color.set(on ? 0x302010 : 0xff8030); // glows in the dark so you can find it
    hooks.setCeiling(on);
  };
  rocker.rotation.x = -0.25;
  sw.userData.onUse = () => setCeiling(!ceiling);
  sw.userData.hint = 'Ceiling light';

  // ---------------- venetian blinds
  const glass = refs.find('Window_Glass');
  const g = glass ? new THREE.Box3().setFromObject(glass) : new THREE.Box3(new THREE.Vector3(0.15, 0, -1.63), new THREE.Vector3(2.92, 2.8, -1.63));
  const width = g.max.x - g.min.x - 0.04, topY = Math.min(g.max.y, 2.7) - 0.02, bottomY = Math.max(g.min.y, 0.05) + 0.02;
  const z = g.max.z + 0.05;
  const N = Math.round((topY - bottomY) / 0.05);
  const slatGeo = new THREE.BoxGeometry(width, 0.002, 0.045);
  const slatMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c4, roughness: 0.55, metalness: 0.1 });
  const slats = new THREE.InstancedMesh(slatGeo, slatMat, N);
  slats.name = 'Blinds';
  slats.frustumCulled = false;
  scene.add(slats);
  const head = new THREE.Mesh(new THREE.BoxGeometry(width + 0.04, 0.04, 0.06), slatMat);
  head.position.set((g.min.x + g.max.x) / 2, topY + 0.02, z);
  scene.add(head);
  // the wand you pull
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xcfc8b8, roughness: 0.4, transparent: true, opacity: 0.9 }));
  cord.name = 'BlindsCord';
  cord.position.set(g.max.x - 0.08, topY - 0.47, z + 0.03);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.009, 0.05, 10), slatMat);
  grip.position.y = -0.47; cord.add(grip);
  scene.add(cord);

  const state = { closed: 0, tilt: 0 };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
  const layout = () => {
    // closed 0 → all slats stacked under the head rail; 1 → lowered and tilted almost shut
    const spacing = (topY - bottomY) / N;
    for (let i = 0; i < N; i++) {
      const lowered = topY - 0.03 - i * spacing * state.closed;
      const stacked = topY - 0.03 - i * 0.004;
      p.set((g.min.x + g.max.x) / 2, Math.min(stacked, lowered), z);
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), state.tilt);
      m.compose(p, q, s);
      slats.setMatrixAt(i, m);
    }
    slats.instanceMatrix.needsUpdate = true;
    // the stack/blinds only collide visually; keep the wand at the bottom slat
    cord.position.y = Math.max(topY - 0.47, topY - (topY - bottomY) * state.closed + 0.2);
    hooks.setBlinds(state.closed * (0.55 + 0.45 * Math.min(1, state.tilt / 1.2)));
  };
  layout();
  let closed = false;
  const setBlinds = (c: boolean) => {
    closed = c;
    sfx.whirr(0.6);
    gsap.to(state, { closed: c ? 1 : 0, tilt: c ? 1.25 : 0.0, duration: 1.6, ease: 'power2.inOut', onUpdate: layout });
  };
  cord.userData.onUse = () => setBlinds(!closed);
  cord.userData.hint = 'Blinds';
  slats.userData.onUse = () => setBlinds(!closed);

  return {
    toggleCeiling: () => setCeiling(!ceiling),
    toggleBlinds: () => setBlinds(!closed),
    targets: [sw, cord, slats] as THREE.Object3D[],
  };
}
