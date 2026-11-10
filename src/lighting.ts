import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import type { SceneRefs } from './scene-contract';

/** Names of materials whose light is baked into emission (room, city, sky, neon). */
const isBakedEmissive = (m: THREE.MeshStandardMaterial) =>
  m.color.getHex() === 0x000000 && (m.emissiveMap !== null || m.emissive.getHex() !== 0x000000);

/**
 * Baked room materials: emission-only. Convert them to unlit MeshBasicMaterial with toneMapped = false
 * so they are neither re-lit by our dynamic lights / env map nor tone-mapped a second time.
 */
export function prepareMaterials(root: THREE.Object3D, bakedGain = 0.8) {
  const cache = new Map<THREE.Material, THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const swap = (src: THREE.Material): THREE.Material => {
      if (cache.has(src)) return cache.get(src)!;
      let out = src;
      const m = src as THREE.MeshStandardMaterial;
      if (m.isMeshStandardMaterial && !m.name.startsWith('M_Holo') && isBakedEmissive(m)) {
        const strength = (m.emissiveIntensity ?? 1);
        const basic = new THREE.MeshBasicMaterial({
          name: m.name,
          color: m.emissive.clone().multiplyScalar(strength * bakedGain),
          map: m.emissiveMap,
          transparent: m.transparent,
          opacity: m.opacity,
          side: m.side,
          alphaTest: m.alphaTest,
          depthWrite: m.depthWrite,
        });
        if (m.alphaTest > 0 && m.map) basic.alphaMap = m.map; // leaf mask lives in the base colour texture
        basic.toneMapped = false;
        basic.userData.baked = true;
        out = basic;
      } else if (m.isMeshStandardMaterial) {
        m.userData.hero = true;
      }
      cache.set(src, out);
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
  });
}

export interface Lights {
  update(t: number): void;
}

/** Dynamic lights for hero objects (TV, tapes, cart, props) – the room itself is baked. */
export function setupLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, refs: SceneRefs): Lights {
  RectAreaLightUniformsLib.init();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.32;
  // Slightly rotate env so its brightest panel sits roughly where the ceiling strip is.
  scene.environmentRotation.set(0, Math.PI * 0.15, 0);

  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  // Warm key: ceiling LED strip.
  const strip = refs.find('Ceiling_LED_Strip');
  const stripPos = new THREE.Vector3(0, 2.6, 0);
  if (strip) { box.setFromObject(strip).getCenter(stripPos); }
  const warm = new THREE.RectAreaLight(0xffc48a, 5.5, 1.6, 0.25);
  warm.position.copy(stripPos).add(new THREE.Vector3(0, -0.05, 0));
  warm.lookAt(stripPos.x, 0, stripPos.z);
  scene.add(warm);

  // A warm point fill near the TV front, slightly above – where the strip light would bounce.
  const warmFill = new THREE.PointLight(0xffb27a, 1.4, 4, 1.6);
  warmFill.position.set(-0.4, 1.9, 1.3);
  scene.add(warmFill);

  // Cool magenta/cyan from the window.
  const glass = refs.find('Window_Glass');
  let winCenter = new THREE.Vector3(1.6, 1.4, -0.5);
  if (glass) { box.setFromObject(glass).getCenter(winCenter); box.getSize(size); }
  const magenta = new THREE.PointLight(0xff4fc8, 2.6, 5, 1.4);
  magenta.position.copy(winCenter).lerp(new THREE.Vector3(0, 1.0, 0), 0.25).add(new THREE.Vector3(0, 0.3, 0));
  scene.add(magenta);
  const cyan = new THREE.PointLight(0x3fd8ff, 1.6, 5, 1.4);
  cyan.position.copy(winCenter).lerp(new THREE.Vector3(0, 1.0, 0), 0.25).add(new THREE.Vector3(0, -0.4, 0.4));
  scene.add(cyan);

  // Gentle hemisphere so shadowed sides are not pitch black.
  const hemi = new THREE.HemisphereLight(0x8a7cff, 0x2a1a20, 0.35);
  scene.add(hemi);

  center.set(0, 0, 0);
  const base = { magenta: magenta.intensity, cyan: cyan.intensity };
  return {
    update(t: number) {
      // Very subtle neon breathing from the window.
      magenta.intensity = base.magenta * (0.92 + 0.08 * Math.sin(t * 1.3));
      cyan.intensity = base.cyan * (0.94 + 0.06 * Math.sin(t * 0.9 + 1.0));
    },
  };
}
