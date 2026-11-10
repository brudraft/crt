import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SceneRefs } from './scene-contract';

/**
 * The city outside the window.
 *
 * The GLB city (flat boxes with a pixel window texture) is replaced by a procedural skyline:
 *  - ~400 buildings in street blocks, three facade styles (concrete, glass curtain wall, brick),
 *    setbacks on tall towers, rooftop clutter (AC units, lift housings, water tanks, antennas)
 *  - facades shaded in one shader: real window grids with frames, per-window lights that switch on/off
 *    over time, blinds, TV flicker, sky reflections with fresnel in dark glass, anti-aliased to an
 *    average colour when windows get smaller than a pixel (no moiré)
 *  - aerial perspective + warm light pollution rising from the streets
 *  - blinking red aviation lights, neon signs (canvas) with halos, sky traffic lanes
 * The GLB sky keeps its gradient and gets stars + drifting clouds.
 */
export interface City { update(t: number): void; horizon: THREE.Color }

const uTime = { value: 0 };

// ---------------------------------------------------------------- seeded RNG
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- facade shader
const facadeVert = /* glsl */ `
  attribute vec4 aB0; // min corner xyz, seed
  attribute vec4 aB1; // max corner xyz, style (-1 detail, 0 concrete, 1 glass, 2 brick)
  varying vec3 vWP; varying vec3 vN; varying vec4 vB0; varying vec4 vB1;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vB0 = aB0; vB1 = aB1;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const facadeFrag = /* glsl */ `
  uniform float uTime; uniform vec3 uHaze; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec2 uHazeRange;
  varying vec3 vWP; varying vec3 vN; varying vec4 vB0; varying vec4 vB1;
  // Hoskins hash: stable for large inputs (sin-based hashes speckle when a varying is interpolated)
  float h3(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
  float h1(float n) { return h3(vec3(n, 1.7, 9.2)); }

  void main() {
    vec3 n = normalize(vN);
    vec3 V = normalize(cameraPosition - vWP);
    float seed = floor(vB0.w + 0.5), style = floor(vB1.w + 0.5);
    float glass = step(0.5, style) * step(style, 1.5);
    float brick = step(1.5, style);
    vec3 base = mix(vec3(0.016, 0.015, 0.019), vec3(0.042, 0.037, 0.036), h1(seed * 7.1));
    base = mix(base, vec3(0.012, 0.017, 0.026), glass);
    base = mix(base, vec3(0.045, 0.024, 0.02), brick);
    float skyAmb = 0.5 + 0.5 * n.y;
    vec3 col;

    if (style < -0.5) {                       // rooftop clutter
      col = vec3(0.05, 0.045, 0.055) * (0.5 + 0.8 * skyAmb) + uHorizon * 0.03 * max(n.z, 0.0);
    } else if (n.y > 0.5) {                   // roof
      vec2 e = min(vWP.xz - vB0.xz, vB1.xz - vWP.xz);
      col = base * 0.8 + uZenith * 0.06;
      col += 0.025 * (1.0 - smoothstep(0.25, 0.4, min(e.x, e.y)));  // parapet catches sky light
      col *= 0.85 + 0.3 * h3(floor(vWP * 1.5));                     // gravel / patches
    } else if (n.y < -0.5) {
      col = base * 0.3;
    } else {                                  // facade
      bool sideX = abs(n.x) > 0.5;
      float u = sideX ? vWP.z - vB0.z : vWP.x - vB0.x;
      float W = sideX ? vB1.z - vB0.z : vB1.x - vB0.x;
      float v = vWP.y - vB0.y, H = vB1.y - vB0.y;
      float faceId = sideX ? (n.x > 0.0 ? 1.0 : 2.0) : (n.z > 0.0 ? 3.0 : 4.0);
      float floorH = mix(mix(3.3, 3.0, brick), 3.8, glass);
      float colW = mix(mix(2.5, 1.9, brick), 1.55, glass);
      float margin = mix(0.9, 0.2, glass);
      float uu = u - margin, usable = W - 2.0 * margin;
      float nCols = max(1.0, floor(usable / colW));
      float cw = usable / nCols;
      float ci = floor(uu / cw), fu = fract(uu / cw);
      float fi = floor(v / floorH), fv = fract(v / floorH);
      float inside = step(0.0, uu) * step(uu, usable) * step(floorH * 1.3, v) * step(v, H - 1.4);
      vec2 lo = mix(vec2(0.2, 0.3), vec2(0.04, 0.12), glass);
      vec2 hi = mix(vec2(0.8, 0.84), vec2(0.96, 0.94), glass);
      vec2 q = vec2(fu, fv);
      vec2 fw = fwidth(q) + 1e-4;
      vec2 m = smoothstep(lo - fw, lo + fw, q) * (1.0 - smoothstep(hi - fw, hi + fw, q));
      float win = m.x * m.y * inside;

      vec3 cell = vec3(seed * 13.7 + faceId, fi, ci);
      float r = h3(cell);
      float floors = H / floorH;
      float litRatio = mix(0.15, 0.5, h1(seed * 3.3)) * (1.0 - 0.3 * fi / (floors + 1.0));
      float slot = floor(uTime / (35.0 + r * 70.0) + r * 11.0);
      float lit = step(h3(cell + vec3(slot * 1.7, 0.0, 0.0)), litRatio);
      vec3 tint = r < 0.5 ? vec3(1.0, 0.66, 0.34) : r < 0.8 ? vec3(1.0, 0.84, 0.6) : r < 0.93 ? vec3(0.78, 0.88, 1.0) : vec3(0.5, 0.68, 1.0);
      float lamp = mix(0.45, 1.15, h3(cell + 5.0)) * (0.7 + 0.4 * (1.0 - fv));
      float blind = step(0.65, h3(cell + 9.0));
      lamp *= mix(1.0, 0.25 + 0.75 * step(0.55 + 0.35 * h3(cell + 3.0), fv), blind);   // half-drawn blinds
      lamp *= 1.0 - step(0.965, r) * (0.3 + 0.3 * sin(uTime * 8.0 + r * 50.0) * sin(uTime * 2.7 + r * 9.0));
      float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
      vec3 refl = mix(uZenith, uHorizon, 0.35 + 0.5 * fres) * (0.07 + 0.55 * fres) * mix(0.7, 1.5, glass);
      vec3 glassCol = vec3(0.008, 0.01, 0.018) + refl;
      vec3 winCol = mix(glassCol, tint * lamp, lit);

      // wall: slab lines between floors, darker towards the street
      float slab = smoothstep(0.0, 0.05, fv) * (1.0 - smoothstep(0.05, 0.1, fv));
      vec3 wall = base * (0.55 + 0.45 * skyAmb) + uHorizon * 0.02;
      wall += base * slab * 0.6;
      wall *= 0.65 + 0.35 * smoothstep(0.0, 45.0, v);
      wall = mix(wall, glassCol * 0.8 + base * 0.6, glass * 0.7);  // spandrel glass

      // when a window cell gets smaller than ~1px, fade to its average to avoid moiré
      float px = max(fwidth(uu / cw), fwidth(v / floorH));
      float cover = (hi.x - lo.x) * (hi.y - lo.y) * inside;
      vec3 avgWin = mix(glassCol, vec3(1.0, 0.76, 0.48) * 0.75, litRatio);
      col = mix(mix(wall, winCol, win), mix(wall, avgWin, cover), smoothstep(0.3, 0.85, px));
    }

    // aerial perspective + sodium light pollution from the streets below
    float d = distance(vWP, cameraPosition);
    float f = smoothstep(uHazeRange.x, uHazeRange.y, d);
    float low = 1.0 - smoothstep(-58.0, -12.0, vWP.y);
    col += vec3(1.0, 0.42, 0.16) * 0.025 * low;
    col = mix(col, uHaze, clamp(f * 0.78 + low * 0.12 * f, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

// ---------------------------------------------------------------- geometry
function boxPiece(min: THREE.Vector3, max: THREE.Vector3, seed: number, style: number): THREE.BufferGeometry {
  const s = new THREE.Vector3().subVectors(max, min);
  const g = new THREE.BoxGeometry(s.x, s.y, s.z);
  g.translate((min.x + max.x) / 2, (min.y + max.y) / 2, (min.z + max.z) / 2);
  return tag(g, min, max, seed, style);
}
function cylPiece(cx: number, cz: number, y0: number, h: number, r: number, seed: number) {
  const g = new THREE.CylinderGeometry(r, r, h, 10, 1);
  g.translate(cx, y0 + h / 2, cz);
  return tag(g, new THREE.Vector3(cx - r, y0, cz - r), new THREE.Vector3(cx + r, y0 + h, cz + r), seed, -1);
}
function tag(g: THREE.BufferGeometry, min: THREE.Vector3, max: THREE.Vector3, seed: number, style: number) {
  g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  const a0 = new Float32Array(n * 4), a1 = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    a0.set([min.x, min.y, min.z, seed], i * 4);
    a1.set([max.x, max.y, max.z, style], i * 4);
  }
  g.setAttribute('aB0', new THREE.BufferAttribute(a0, 4));
  g.setAttribute('aB1', new THREE.BufferAttribute(a1, 4));
  return g;
}

interface Building { min: THREE.Vector3; max: THREE.Vector3; style: number }

function generate(r: () => number) {
  const pieces: THREE.BufferGeometry[] = [];
  const buildings: Building[] = [];
  const beacons: THREE.Vector3[] = [];
  const BASE = -62;
  const block = 30, street = 9;
  for (let gz = -22; gz > -300; gz -= block) {
    for (let gx = -60; gx < 150; gx += block) {
      // lots inside the block
      const cols = 1 + Math.floor(r() * 3), rows = 1 + Math.floor(r() * 2);
      const bw = (block - street) / cols, bd = (block - street) / rows;
      for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
        if (r() < 0.08) continue; // empty lot / plaza
        const x0 = gx + i * bw + 0.6 + r() * 1.5, x1 = gx + (i + 1) * bw - 0.6 - r() * 1.5;
        const z1 = gz - j * bd - 0.6 - r() * 1.5, z0 = gz - (j + 1) * bd + 0.6 + r() * 1.5;
        const dist = -((z0 + z1) / 2);
        // skyline: low near the window, a downtown cluster far away
        // the apartment is high up: nearby roofs sit well below eye level (y≈1),
        // the skyline rises with distance to a downtown cluster
        const down = Math.exp(-(((x0 - 60) / 60) ** 2 + ((dist - 190) / 80) ** 2));
        let top = THREE.MathUtils.lerp(-34, -6, Math.min(1, dist / 160)) + r() * r() * 22 + down * (30 + r() * 50);
        if (dist < 60) top = Math.min(top, -12 + r() * 6);
        const style = top > 30 && r() < 0.6 ? 1 : r() < 0.35 ? 2 : 0;
        const seed = Math.floor(r() * 1000);
        const min = new THREE.Vector3(x0, BASE, z0), max = new THREE.Vector3(x1, top, z1);
        pieces.push(boxPiece(min, max, seed, style));
        buildings.push({ min, max, style });
        let roofY = top;
        let rx0 = x0, rx1 = x1, rz0 = z0, rz1 = z1;
        // setbacks on taller towers
        if (top - BASE > 70 && r() < 0.7) {
          const k = 0.18 + r() * 0.15;
          rx0 = x0 + (x1 - x0) * k; rx1 = x1 - (x1 - x0) * k; rz0 = z0 + (z1 - z0) * k; rz1 = z1 - (z1 - z0) * k;
          const t2 = top + 6 + r() * 18;
          pieces.push(boxPiece(new THREE.Vector3(rx0, top, rz0), new THREE.Vector3(rx1, t2, rz1), seed + 1, style));
          roofY = t2;
          if (r() < 0.5) { // crown
            const c = 0.3;
            const cx0 = rx0 + (rx1 - rx0) * c, cx1 = rx1 - (rx1 - rx0) * c, cz0 = rz0 + (rz1 - rz0) * c, cz1 = rz1 - (rz1 - rz0) * c;
            pieces.push(boxPiece(new THREE.Vector3(cx0, roofY, cz0), new THREE.Vector3(cx1, roofY + 4, cz1), seed + 2, -1));
            roofY += 4;
            rx0 = cx0; rx1 = cx1; rz0 = cz0; rz1 = cz1;
          }
        }
        // rooftop clutter
        const n = 1 + Math.floor(r() * 4);
        for (let k = 0; k < n; k++) {
          const w = 1 + r() * 3, d = 1 + r() * 3, h = 0.8 + r() * 2.5;
          const cx = THREE.MathUtils.lerp(rx0 + w, rx1 - w, r()), cz = THREE.MathUtils.lerp(rz0 + d, rz1 - d, r());
          if (rx1 - rx0 < 2 * w + 0.5 || rz1 - rz0 < 2 * d + 0.5) continue;
          if (r() < 0.25) pieces.push(cylPiece(cx, cz, roofY + 1.2, 2 + r() * 2, 0.9 + r() * 0.6, seed)); // water tank on legs
          else pieces.push(boxPiece(new THREE.Vector3(cx - w / 2, roofY, cz - d / 2), new THREE.Vector3(cx + w / 2, roofY + h, cz + d / 2), seed, -1));
        }
        // antennas + aviation beacons on tall ones
        if (roofY > 15 && r() < 0.6) {
          const ax = (rx0 + rx1) / 2, az = (rz0 + rz1) / 2, ah = 5 + r() * 14;
          pieces.push(cylPiece(ax, az, roofY, ah, 0.12, seed));
          beacons.push(new THREE.Vector3(ax, roofY + ah + 0.2, az));
        } else if (roofY > 8 && r() < 0.5) {
          beacons.push(new THREE.Vector3(x0 + 0.3, roofY + 0.3, z1 - 0.3), new THREE.Vector3(x1 - 0.3, roofY + 0.3, z1 - 0.3));
        }
      }
    }
  }
  return { geo: mergeGeometries(pieces, false)!, buildings, beacons, count: pieces.length };
}

// ---------------------------------------------------------------- neon signs
const NEON: { text: string; color: string; vertical?: boolean }[] = [
  { text: 'HOTEL', color: '#ff3fbf' }, { text: 'VIDEO', color: '#3ff0ff' }, { text: '24H', color: '#ffb02e' },
  { text: 'ビデオ', color: '#ff3fbf', vertical: true }, { text: 'BAR', color: '#46ffb4' }, { text: 'RAMEN', color: '#ff5a3c' },
  { text: 'ネオン', color: '#3ff0ff', vertical: true }, { text: 'ARCADE', color: '#c86bff' }, { text: 'MOTEL', color: '#ff3f6c' },
];

function neonTexture(text: string, color: string, vertical: boolean) {
  const chars = vertical ? [...text] : [text];
  const fs = 90;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = `bold ${fs}px "Arial Black", "Helvetica Neue", sans-serif`;
  const w = vertical ? fs * 1.3 : ctx.measureText(text).width + fs * 0.8;
  const h = vertical ? chars.length * fs * 1.1 + fs * 0.4 : fs * 1.5;
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  ctx.font = `bold ${fs}px "Arial Black", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const draw = (blur: number, style: string, line: number) => {
    ctx.shadowColor = color; ctx.shadowBlur = blur;
    ctx.strokeStyle = style; ctx.lineWidth = line;
    chars.forEach((ch, i) => {
      const y = vertical ? fs * 0.75 + i * fs * 1.1 : h / 2;
      ctx.strokeText(ch, w / 2, y);
    });
  };
  draw(28, color, 9);       // glow
  draw(10, color, 6);       // tube
  draw(0, '#fff8ff', 2);    // hot core
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { tex: t, aspect: w / h };
}

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function setupNeon(scene: THREE.Scene, buildings: Building[], r: () => number) {
  // front faces (+Z, towards the apartment) of nearer buildings that rise above the street haze
  const cands = buildings.filter((b) => b.max.z > -110 && b.max.y > -14 && b.max.x > -20 && b.min.x < 90 && b.max.x - b.min.x > 7);
  const signs: { mat: THREE.MeshBasicMaterial; halo: THREE.SpriteMaterial; phase: number; base: number }[] = [];
  const glow = glowTexture();
  for (let i = 0; i < NEON.length && cands.length; i++) {
    const b = cands.splice(Math.floor(r() * cands.length), 1)[0];
    const def = NEON[i];
    const { tex, aspect } = neonTexture(def.text, def.color, !!def.vertical);
    const width = b.max.x - b.min.x;
    const h = def.vertical ? Math.min(14, (b.max.y - b.min.y) * 0.3) : Math.min(4.5, (width * 0.7) / aspect);
    const w = h * aspect;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    const x = def.vertical ? (r() < 0.5 ? b.min.x + w / 2 + 0.4 : b.max.x - w / 2 - 0.4) : (b.min.x + b.max.x) / 2;
    const y = def.vertical ? b.max.y - h / 2 - 2 : b.max.y - h / 2 - 1 - r() * 4;
    mesh.position.set(x, y, b.max.z + 0.08);
    mesh.raycast = () => {};
    scene.add(mesh);
    const haloMat = new THREE.SpriteMaterial({ map: glow, color: def.color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.set(w * 1.6, h * 2.2, 1);
    halo.position.copy(mesh.position).add(new THREE.Vector3(0, 0, 0.3));
    halo.raycast = () => {};
    scene.add(halo);
    signs.push({ mat, halo: haloMat, phase: r() * 10, base: 0.35 });
  }
  let dropUntil = 0, drop = -1;
  return (t: number) => {
    if (t > dropUntil && Math.random() < 0.012) { dropUntil = t + 0.05 + Math.random() * 0.3; drop = Math.floor(Math.random() * signs.length); }
    signs.forEach((s, i) => {
      let k = 0.92 + 0.08 * Math.sin(t * 14 + s.phase) * Math.sin(t * 2.3 + s.phase);
      if (i === drop && t < dropUntil) k *= Math.random() < 0.5 ? 0.15 : 0.6;
      s.mat.opacity = k;
      s.halo.opacity = s.base * k;
    });
  };
}

// ---------------------------------------------------------------- aviation beacons + traffic (points)
function setupBeacons(scene: THREE.Scene, beacons: THREE.Vector3[]) {
  const geo = new THREE.BufferGeometry().setFromPoints(beacons);
  const mat = new THREE.PointsMaterial({ color: 0xff2010, size: 1.4, map: glowTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.raycast = () => {};
  scene.add(pts);
  return (t: number) => { const p = (t % 2.2) / 2.2; mat.opacity = p < 0.12 ? 1 : p < 0.3 ? 1 - (p - 0.12) / 0.18 : 0.05; };
}

interface Lane { from: THREE.Vector3; to: THREE.Vector3; speed: number; n: number }
function setupTraffic(scene: THREE.Scene) {
  const lanes: Lane[] = [
    { from: new THREE.Vector3(-30, 6, -38), to: new THREE.Vector3(90, 7, -38), speed: 6, n: 10 },
    { from: new THREE.Vector3(120, 14, -68), to: new THREE.Vector3(-40, 13, -68), speed: 8, n: 14 },
    { from: new THREE.Vector3(-40, 22, -98), to: new THREE.Vector3(140, 24, -98), speed: 9, n: 16 },
    { from: new THREE.Vector3(160, 34, -150), to: new THREE.Vector3(-40, 32, -150), speed: 11, n: 20 },
  ];
  const total = lanes.reduce((s, l) => s + l.n * 2, 0);
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.PointsMaterial({ size: 0.55, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false; pts.raycast = () => {};
  scene.add(pts);
  const seeds = lanes.map((l) => Array.from({ length: l.n }, (_, i) => (i + Math.random() * 0.6) / l.n));
  const head = new THREE.Color(1, 0.93, 0.82), tail = new THREE.Color(1, 0.1, 0.08);
  const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
  return (t: number) => {
    let k = 0;
    lanes.forEach((l, li) => {
      const len = l.from.distanceTo(l.to);
      dir.subVectors(l.to, l.from).normalize();
      for (let i = 0; i < l.n; i++) {
        const u = (seeds[li][i] + (t * l.speed) / len) % 1;
        tmp.lerpVectors(l.from, l.to, u);
        tmp.y += Math.sin(t * 0.7 + i * 1.3 + li) * 0.2;
        const fade = Math.min(1, Math.min(u, 1 - u) * 12);
        for (const [off, c] of [[0.45, head], [-0.45, tail]] as const) {
          pos.set([tmp.x + dir.x * off, tmp.y, tmp.z + dir.z * off], k * 3);
          col.set([c.r * fade, c.g * fade, c.b * fade], k * 3);
          k++;
        }
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  };
}

// ---------------------------------------------------------------- sky (patch the GLB material)
function patchSky(mat: THREE.MeshBasicMaterial) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkyWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSkyWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */ `#include <common>
        varying vec3 vSkyWP; uniform float uTime;
        float sH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float sN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(sH(i), sH(i + vec2(1, 0)), f.x), mix(sH(i + vec2(0, 1)), sH(i + vec2(1, 1)), f.x), f.y); }
        float sF(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * sN(p); p *= 2.03; a *= 0.5; } return v; }`)
      .replace('#include <opaque_fragment>', /* glsl */ `{
        vec3 c = outgoingLight;
        vec3 dir = normalize(vSkyWP - cameraPosition);
        float up = clamp(dir.y, 0.0, 1.0);
        c += vec3(1.0, 0.45, 0.32) * pow(1.0 - up, 10.0) * 0.22;
        vec2 cp = dir.xz / max(dir.y + 0.1, 0.04) * 1.4 + vec2(uTime * 0.01, uTime * 0.003);
        float cl = smoothstep(0.5, 0.82, sF(cp));
        vec3 cloudCol = mix(vec3(0.18, 0.07, 0.2), vec3(1.0, 0.5, 0.55), pow(1.0 - up, 2.5));
        c = mix(c, cloudCol, cl * 0.6 * smoothstep(0.0, 0.1, up));
        vec2 sp = floor(dir.xz / max(dir.y, 0.05) * 240.0);
        float star = step(0.9968, sH(sp)) * smoothstep(0.2, 0.6, up) * (1.0 - cl);
        c += vec3(star) * (0.5 + 0.4 * sin(uTime * 3.0 + sH(sp + 7.0) * 30.0));
        outgoingLight = c;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'city-sky';
  mat.needsUpdate = true;
}

function skyColors(sky?: THREE.Object3D) {
  const horizon = new THREE.Color(0.62, 0.28, 0.42), zenith = new THREE.Color(0.15, 0.06, 0.2);
  const m = (sky as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
  const img = m?.map?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (img) try {
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!; g.drawImage(img, 0, 0);
    const a = g.getImageData(0, Math.floor(img.height * 0.05), 1, 1).data, b = g.getImageData(0, Math.floor(img.height * 0.95), 1, 1).data;
    const [hz, zn] = a[0] - a[2] > b[0] - b[2] ? [a, b] : [b, a];
    const gain = m!.color.r; // baked gain already applied to the material colour
    horizon.setRGB(hz[0] / 255, hz[1] / 255, hz[2] / 255, THREE.SRGBColorSpace).multiplyScalar(gain);
    zenith.setRGB(zn[0] / 255, zn[1] / 255, zn[2] / 255, THREE.SRGBColorSpace).multiplyScalar(gain);
  } catch { /* fallback colours */ }
  return { horizon, zenith };
}

// ---------------------------------------------------------------- public
export function setupCity(scene: THREE.Scene, refs: SceneRefs): City {
  for (const n of ['City_Layer_Near', 'City_Layer_Mid', 'City_Layer_Far', 'City_Neon_Signs']) {
    const o = refs.find(n); if (o) o.visible = false;
  }
  const sky = refs.find('City_Sky');
  const { horizon, zenith } = skyColors(sky);
  const skyMat = (sky as THREE.Mesh | undefined)?.material as THREE.MeshBasicMaterial | undefined;
  if (skyMat?.isMeshBasicMaterial) patchSky(skyMat);

  const r = rng(20261110);
  const city = generate(r);
  const mat = new THREE.ShaderMaterial({
    vertexShader: facadeVert, fragmentShader: facadeFrag,
    uniforms: {
      uTime, uHaze: { value: horizon.clone().multiplyScalar(0.92) }, uHorizon: { value: horizon }, uZenith: { value: zenith },
      uHazeRange: { value: new THREE.Vector2(30, 320) },
    },
  });
  mat.toneMapped = false;
  const mesh = new THREE.Mesh(city.geo, mat);
  mesh.name = 'ProceduralCity';
  mesh.raycast = () => {};
  scene.add(mesh);

  const neon = setupNeon(scene, city.buildings, r);
  const beacons = setupBeacons(scene, city.beacons);
  const traffic = setupTraffic(scene);
  console.info(`[city] ${city.buildings.length} buildings, ${city.count} pieces, ${(city.geo.index!.count / 3) | 0} tris, ${city.beacons.length} beacons`);

  return {
    horizon,
    update(t: number) {
      uTime.value = t;
      neon(t); beacons(t); traffic(t);
    },
  };
}
