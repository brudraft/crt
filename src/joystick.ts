import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

/**
 * Prop_Joystick is one merged mesh. Split the stick + ball (triangles above the base, around the stick
 * axis) into its own mesh pivoting at the base, so it can tilt with the player's input.
 */
export function setupJoystick(refs: SceneRefs) {
  const base = refs.find('Prop_Joystick') as THREE.Mesh | undefined;
  if (!base?.isMesh || !base.geometry.index) return null;
  const g = base.geometry;
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;

  // stick axis: centre (x,z) of the highest vertices (the ball)
  let top = -Infinity;
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
  const axis = new THREE.Vector2(); let n = 0;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > top - 0.01) { axis.x += pos.getX(i); axis.y += pos.getZ(i); n++; }
  axis.divideScalar(Math.max(1, n));
  const pivotY = 0.062;      // just above the base plate (vertex histogram: plate/buttons ≤ 0.065)
  const isStick = (i: number) => pos.getY(i) > pivotY + 0.004 && Math.hypot(pos.getX(i) - axis.x, pos.getZ(i) - axis.y) < 0.035;

  const keep: number[] = [], stick: number[] = [];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2);
    (isStick(a) && isStick(b) && isStick(c) ? stick : keep).push(a, b, c);
  }
  if (stick.length < 30) { console.warn('[joystick] could not isolate the stick'); return null; }

  const stickGeo = g.clone();
  stickGeo.setIndex(stick);
  stickGeo.translate(-axis.x, -pivotY, -axis.y);
  g.setIndex(keep);

  const stickMesh = new THREE.Mesh(stickGeo, base.material);
  stickMesh.name = 'Prop_Joystick_Stick';
  stickMesh.position.set(axis.x, pivotY, axis.y);
  base.add(stickMesh);
  console.info(`[joystick] stick split: ${stick.length / 3} tris at local (${axis.x.toFixed(3)}, ${pivotY}, ${axis.y.toFixed(3)})`);

  const tilt = new THREE.Vector2();
  return {
    stick: stickMesh,
    /** x,y in -1…1 (right / up) */
    set(x: number, y: number) { tilt.set(x, y); },
    update(dt: number) {
      const k = Math.min(1, dt * 18);
      // up = push away from the player (towards -Z in the joystick's frame → rotate about X)
      stickMesh.rotation.x += (-tilt.y * 0.4 - stickMesh.rotation.x) * k;
      stickMesh.rotation.z += (-tilt.x * 0.4 - stickMesh.rotation.z) * k;
    },
  };
}
