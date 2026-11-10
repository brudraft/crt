import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

/**
 * Rain: droplets on the outside of the window (static beads + drops that run down leaving trails),
 * and falling streaks between the glass and the city. All procedural, two draw calls.
 */
const dropFrag = /* glsl */ `
  uniform float uTime; uniform vec2 uSize; uniform vec3 uSky; uniform vec3 uNeon;
  varying vec2 vUv;
  float hh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }

  // static beads: returns (mask, local y)
  vec2 beads(vec2 m, float cell, float t) {
    vec2 id = floor(m / cell), f = fract(m / cell) - 0.5;
    float r = hh(id);
    vec2 off = vec2(hh(id + 3.1), hh(id + 7.7)) - 0.5;
    float rad = mix(0.12, 0.3, hh(id + 1.3));
    float life = fract(t * 0.05 + r);                  // beads appear and slowly evaporate / get washed away
    float alive = step(0.68, r) * smoothstep(0.0, 0.05, life) * (1.0 - smoothstep(0.7, 1.0, life));
    vec2 d = f - off * 0.5;
    float mask = smoothstep(rad, rad * 0.6, length(d * vec2(1.0, 0.9))) * alive;
    return vec2(mask, d.y / rad);
  }

  // running drops in columns, with a stick–slip fall and a trail of tiny beads above them
  vec3 runners(vec2 m, float colW, float t) {
    float ci = floor(m.x / colW);
    float r = hh(vec2(ci, 4.0));
    if (r < 0.35) return vec3(0.0);
    float speed = mix(0.08, 0.22, hh(vec2(ci, 9.0)));
    float tt = t * speed + r * 10.0;
    float fall = fract(tt);
    float y = uSize.y * (1.0 - fall - 0.08 * sin(tt * 18.0) * fall);  // jerky descent
    float x = (ci + 0.5) * colW + sin(m.y * 9.0 + r * 6.0) * colW * 0.12;
    vec2 d = (m - vec2(x, y)) / colW;
    float rad = mix(0.16, 0.26, r);
    float drop = smoothstep(rad, rad * 0.55, length(d * vec2(1.0, 0.75)));
    float above = m.y - y;
    float trailLen = 0.45 * uSize.y * fall;
    float inTrail = step(0.0, above) * step(above, trailLen) * smoothstep(0.08, 0.0, abs(d.x));
    float tb = fract(m.y / (colW * 0.35));
    float trailBeads = inTrail * smoothstep(0.35, 0.15, abs(tb - 0.5)) * smoothstep(trailLen, 0.0, above) * 0.8;
    return vec3(drop, trailBeads, d.y / rad);
  }

  void main() {
    vec2 m = vUv * uSize;               // metres on the glass
    float t = uTime;
    vec2 b1 = beads(m, 0.035, t);
    vec2 b2 = beads(m + 0.37, 0.016, t * 1.3) * vec2(step(0.5, hh(floor(m * 3.0))), 1.0); // fine mist in patches
    vec3 rn = runners(m, 0.06, t);
    float mask = clamp(max(max(b1.x, b2.x * 0.8), max(rn.x, rn.y)), 0.0, 1.0);
    float ly = rn.x > b1.x ? rn.z : b1.y;
    // a drop acts like a tiny inverted lens: the bright sky shows at its bottom, neon glints at the top
    vec3 inner = mix(uSky * 1.6 + 0.04, vec3(0.02, 0.015, 0.035), smoothstep(-0.9, 0.7, ly));
    inner += uNeon * 0.35 * smoothstep(0.5, 0.9, -ly) * step(0.5, hh(floor(m * 20.0)));
    float rim = mask * (1.0 - mask) * 4.0;
    vec3 col = inner + vec3(0.9, 0.85, 1.0) * rim * 0.25;
    float a = mask * 0.6 + 0.03;      // + faint wet film over the whole pane
    gl_FragColor = vec4(mix(uSky * 0.6, col, step(0.001, mask)), a);
    #include <colorspace_fragment>
  }`;

export function setupRain(scene: THREE.Scene, refs: SceneRefs, sky: THREE.Color) {
  const glass = refs.find('Window_Glass');
  if (!glass) return { update: () => {} };
  const box = new THREE.Box3().setFromObject(glass);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const facingZ = size.z < size.x;           // window plane is XY (normal ±Z) in this scene
  const W = facingZ ? size.x : size.z, H = size.y;

  const uTime = { value: 0 };
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: dropFrag,
    uniforms: { uTime, uSize: { value: new THREE.Vector2(W, H) }, uSky: { value: sky }, uNeon: { value: new THREE.Color(1.0, 0.3, 0.8) } },
    transparent: true, depthWrite: false,
  });
  mat.toneMapped = false;
  const pane = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  pane.name = 'Window_Rain';
  // just outside the glass (rain is on the outer surface), so the window frame occludes it correctly
  pane.position.copy(center).add(new THREE.Vector3(0, 0, facingZ ? -0.006 : 0));
  if (!facingZ) pane.rotation.y = Math.PI / 2;
  pane.raycast = () => {};
  pane.renderOrder = 4;
  scene.add(pane);

  // falling streaks outside, between the glass and the nearest buildings
  const N = 1400;
  const pos = new Float32Array(N * 6);
  const seeds = new Float32Array(N * 4);
  const area = { x0: box.min.x - 6, x1: box.max.x + 14, y0: -14, y1: 9, z0: box.min.z - 1.0, z1: box.min.z - 18 };
  for (let i = 0; i < N; i++) {
    seeds.set([Math.random(), Math.random(), Math.random(), 0.6 + Math.random() * 0.8], i * 4);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xffd6ee, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
  }));
  lines.frustumCulled = false;
  lines.raycast = () => {};
  scene.add(lines);

  const wind = 0.18;
  return {
    update(t: number) {
      uTime.value = t;
      const hY = area.y1 - area.y0;
      for (let i = 0; i < N; i++) {
        const [sx, sz, sy, sp] = [seeds[i * 4], seeds[i * 4 + 1], seeds[i * 4 + 2], seeds[i * 4 + 3]];
        const z = THREE.MathUtils.lerp(area.z0, area.z1, sz * sz);       // denser near the glass
        const len = 0.35 * sp * (1.2 - sz * 0.6);
        const y = area.y1 - ((sy * hY + t * 9 * sp) % hY);
        const x = THREE.MathUtils.lerp(area.x0, area.x1, sx) + (area.y1 - y) * wind;
        pos.set([x, y, z, x - wind * len, y + len, z], i * 6);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
