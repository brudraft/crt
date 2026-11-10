import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

/**
 * Dust motes drifting in the light: in the glow from the window, under the ceiling LED strip and in the
 * beam of the TV screen (that one only shows while the screen is lit). GPU-animated points, one draw call
 * per volume.
 */
const vert = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime; uniform vec3 uMin; uniform vec3 uMax; uniform float uSize; uniform float uPx;
  uniform vec3 uLightPos; uniform vec3 uLightDir; uniform float uFalloff;
  varying float vA; varying float vTw;
  void main() {
    vec3 size = uMax - uMin;
    // slow brownian-ish drift + gentle sinking, wrapped inside the volume
    vec3 p = aSeed.xyz * size;
    float t = uTime * (0.6 + aSeed.w * 0.8);
    p += vec3(sin(t * 0.21 + aSeed.w * 40.0) * 0.12 + t * 0.004,
              -t * 0.006 + sin(t * 0.17 + aSeed.x * 30.0) * 0.06,
              cos(t * 0.19 + aSeed.y * 50.0) * 0.12);
    p = uMin + mod(p, size);
    // brightness: strongest close to the light source, along its direction
    vec3 d = p - uLightPos;
    float along = max(dot(d, uLightDir), 0.0);
    float side = length(d - uLightDir * along);
    vA = exp(-along * uFalloff) * exp(-side * side * 1.5);
    // fade near the volume walls so wrapping never pops
    vec3 e = min(p - uMin, uMax - p) / max(size, vec3(1e-3));
    vA *= smoothstep(0.0, 0.12, min(e.x, min(e.y, e.z)));
    vTw = 0.55 + 0.45 * sin(uTime * (1.5 + aSeed.w * 3.0) + aSeed.z * 60.0); // glints as motes tumble
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = uSize * (0.6 + aSeed.w) * uPx / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  uniform vec3 uColor; uniform float uIntensity;
  varying float vA; varying float vTw;
  void main() {
    float r = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, r) * vA * vTw * uIntensity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor * a, a);
  }`;

interface Volume { mat: THREE.ShaderMaterial }

function makeVolume(scene: THREE.Scene, opts: {
  min: THREE.Vector3; max: THREE.Vector3; count: number; color: THREE.ColorRepresentation; size: number;
  lightPos: THREE.Vector3; lightDir: THREE.Vector3; falloff: number; intensity: number;
}): Volume {
  const seeds = new Float32Array(opts.count * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(opts.count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert, fragmentShader: frag,
    uniforms: {
      uTime: { value: 0 }, uMin: { value: opts.min }, uMax: { value: opts.max }, uSize: { value: opts.size }, uPx: { value: 800 },
      uLightPos: { value: opts.lightPos }, uLightDir: { value: opts.lightDir.normalize() }, uFalloff: { value: opts.falloff },
      uColor: { value: new THREE.Color(opts.color) }, uIntensity: { value: opts.intensity },
    },
    transparent: true, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,          // additive colour …
    blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, // … but never touch alpha (screen hole!)
  });
  mat.toneMapped = false;
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.raycast = () => {};
  pts.renderOrder = 6;
  scene.add(pts);
  return { mat };
}

export function setupDust(scene: THREE.Scene, refs: SceneRefs) {
  const vols: { v: Volume; base: number; kind: 'window' | 'ceiling' | 'tv' }[] = [];
  const box = new THREE.Box3();

  const glass = refs.find('Window_Glass');
  if (glass) {
    box.setFromObject(glass);
    const c = box.getCenter(new THREE.Vector3());
    vols.push({ kind: 'window', base: 0.55, v: makeVolume(scene, {
      min: new THREE.Vector3(box.min.x + 0.05, 0.25, box.min.z + 0.05), max: new THREE.Vector3(box.max.x - 0.05, 2.6, box.min.z + 1.8),
      count: 700, color: 0xffb8e0, size: 0.012, lightPos: new THREE.Vector3(c.x, c.y + 0.4, box.min.z), lightDir: new THREE.Vector3(-0.15, -0.25, 1),
      falloff: 1.1, intensity: 0.55,
    }) });
  }
  const strip = refs.find('Ceiling_LED_Strip');
  if (strip) {
    box.setFromObject(strip);
    const c = box.getCenter(new THREE.Vector3());
    vols.push({ kind: 'ceiling', base: 0.4, v: makeVolume(scene, {
      min: new THREE.Vector3(c.x - 1.6, box.min.y - 0.9, c.z - 1.6), max: new THREE.Vector3(c.x + 1.6, box.min.y - 0.05, c.z + 1.6),
      count: 450, color: 0xffd2a0, size: 0.011, lightPos: new THREE.Vector3(c.x, box.min.y, c.z), lightDir: new THREE.Vector3(0, -1, 0),
      falloff: 1.6, intensity: 0.4,
    }) });
  }
  const anchor = refs.screenAnchor.getWorldPosition(new THREE.Vector3());
  vols.push({ kind: 'tv', base: 0.9, v: makeVolume(scene, {
    min: new THREE.Vector3(anchor.x - 0.45, anchor.y - 0.35, anchor.z + 0.06), max: new THREE.Vector3(anchor.x + 0.45, anchor.y + 0.4, anchor.z + 1.3),
    count: 260, color: 0xbfd0ff, size: 0.008, lightPos: anchor.clone(), lightDir: new THREE.Vector3(0, -0.05, 1),
    falloff: 1.4, intensity: 0,
  }) });

  return {
    /** tvLight: 0..1+ screen brightness; tvColor its tint; room: 1 normal, <1 dimmed */
    update(t: number, px: number, tvLight: number, tvColor: THREE.Color, room: number) {
      for (const { v, base, kind } of vols) {
        const u = v.mat.uniforms;
        u.uTime.value = t; u.uPx.value = px;
        if (kind === 'tv') { u.uIntensity.value = base * Math.min(1.2, tvLight) * (1.4 - room * 0.5); u.uColor.value.copy(tvColor); }
        else if (kind === 'ceiling') u.uIntensity.value = base * room;
        else u.uIntensity.value = base * (0.7 + 0.3 * room);
      }
    },
  };
}
