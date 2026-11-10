import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import type { SceneRefs } from './scene-contract';

/**
 * A faint reflection of the room in the window glass – and your own dark silhouette in it.
 * Uses a real mirror render (three's Reflector), so it only runs while you're close to the glass.
 */
const shader = {
  name: 'GlassReflection',
  uniforms: {
    color: { value: null as THREE.Color | null },
    tDiffuse: { value: null as THREE.Texture | null },
    textureMatrix: { value: null as THREE.Matrix4 | null },
    uOpacity: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv; varying vec3 vWP; varying vec3 vN;
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * vec3(0.0, 0.0, 1.0));
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uOpacity;
    varying vec4 vUv; varying vec3 vWP; varying vec3 vN;
    void main() {
      vec3 base = texture2DProj(tDiffuse, vUv).rgb;
      vec3 V = normalize(cameraPosition - vWP);
      float fres = pow(1.0 - abs(dot(V, vN)), 3.0);
      // glass reflects ~4 % head-on and more at grazing angles; bright things in the room dominate
      float lum = dot(base, vec3(0.3, 0.59, 0.11));
      float a = uOpacity * (0.35 + 0.65 * fres) * (0.4 + 0.6 * smoothstep(0.0, 0.6, lum));
      gl_FragColor = vec4(base, clamp(a, 0.0, 0.6));
      #include <colorspace_fragment>
    }`,
};

export function setupWindowReflection(scene: THREE.Scene, refs: SceneRefs, renderer: THREE.WebGLRenderer, camera: THREE.Camera) {
  const glass = refs.find('Window_Glass');
  if (!glass) return null;
  const box = new THREE.Box3().setFromObject(glass);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const pr = Math.min(renderer.getPixelRatio(), 1.5);

  const mirror = new Reflector(new THREE.PlaneGeometry(size.x, size.y), {
    textureWidth: Math.round(innerWidth * pr * 0.5), textureHeight: Math.round(innerHeight * pr * 0.5),
    clipBias: 0.003, shader,
  });
  const mat = mirror.material as THREE.ShaderMaterial;
  mat.transparent = true; mat.depthWrite = false; mat.toneMapped = false;
  mirror.name = 'Window_Reflection';
  mirror.position.copy(center).add(new THREE.Vector3(0, 0, 0.004)); // just on the room side of the glass, facing in
  mirror.renderOrder = 5;
  mirror.raycast = () => {};
  scene.add(mirror);

  // your silhouette: only exists while the mirror renders
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x07050a, toneMapped: false });
  const ghost = new THREE.Group();
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.095, 20, 16), ghostMat); head.scale.set(0.9, 1.15, 1);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 12), ghostMat); neck.position.y = -0.14;
  const torso = new THREE.Mesh(new THREE.SphereGeometry(0.24, 24, 16), ghostMat); torso.scale.set(1.1, 1.3, 0.55); torso.position.y = -0.46;
  ghost.add(head, neck, torso);
  ghost.visible = false;
  scene.add(ghost);
  const render = mirror.onBeforeRender.bind(mirror);
  mirror.onBeforeRender = (...args: Parameters<THREE.Object3D['onBeforeRender']>) => {
    ghost.position.copy(camera.position).add(new THREE.Vector3(0, -0.02, 0.06));
    ghost.quaternion.setFromEuler(new THREE.Euler(0, Math.atan2(camera.position.x - center.x, camera.position.z - center.z), 0));
    ghost.visible = true;
    render(...args);
    ghost.visible = false;
  };

  let enabled = true, amount = 0;
  return {
    setEnabled(v: boolean) { enabled = v; },
    resize(w: number, h: number) {
      const p = Math.min(renderer.getPixelRatio(), 1.5) * 0.5;
      mirror.getRenderTarget().setSize(Math.round(w * p), Math.round(h * p));
    },
    /** room: 1 normal, <1 dimmed during films */
    update(dt: number, room: number) {
      // only worth rendering when you're near the glass and looking at it
      const d = camera.position.distanceTo(center);
      const facing = camera.getWorldDirection(new THREE.Vector3()).z < -0.2;
      const want = enabled && facing ? THREE.MathUtils.clamp(1.6 - d * 0.55, 0, 1) : 0;
      amount += (want - amount) * Math.min(1, dt * 2);
      mirror.visible = amount > 0.02;
      mat.uniforms.uOpacity.value = amount * 0.55 * (0.6 + 0.4 * room);
    },
  };
}
