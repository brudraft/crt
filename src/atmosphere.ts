import * as THREE from 'three';
import type { SceneRefs } from './scene-contract';

// ---------------------------------------------------------------- fake glow (additive halo sprites)
let haloTex: THREE.Texture | null = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.12)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  haloTex = new THREE.CanvasTexture(c);
  haloTex.colorSpace = THREE.SRGBColorSpace;
  return haloTex;
}

export function makeHalo(color: THREE.ColorRepresentation, size: number, opacity = 0.6) {
  const mat = new THREE.SpriteMaterial({
    map: haloTexture(), color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
  });
  const s = new THREE.Sprite(mat);
  s.scale.setScalar(size);
  s.renderOrder = 5;
  s.raycast = () => {}; // never block picking
  return s;
}

/**
 * Neon sign meshes are big merged meshes spread across the city. Cluster their vertices on a coarse grid
 * and drop one halo per cluster so each sign glows.
 */
function neonHalos(scene: THREE.Scene, signs: THREE.Object3D) {
  const halos: THREE.Sprite[] = [];
  signs.updateWorldMatrix(true, true);
  signs.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = mesh.material as THREE.MeshBasicMaterial;
    const col = mat.color.clone();
    const pos = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const cell = 1.6;
    const buckets = new Map<string, { sum: THREE.Vector3; n: number; box: THREE.Box3 }>();
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const key = `${Math.floor(v.x / cell)},${Math.floor(v.y / cell)},${Math.floor(v.z / cell)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { sum: new THREE.Vector3(), n: 0, box: new THREE.Box3() }));
      b.sum.add(v); b.n++; b.box.expandByPoint(v);
    }
    for (const b of buckets.values()) {
      if (b.n < 4) continue;
      const c = b.sum.divideScalar(b.n);
      const size = b.box.getSize(new THREE.Vector3());
      const s = Math.max(1.2, Math.max(size.x, size.y, size.z) * 1.8);
      const h = makeHalo(col, s, 0.32);
      h.position.copy(c);
      scene.add(h);
      halos.push(h);
    }
  });
  return halos;
}

// ---------------------------------------------------------------- holograms (canvas textures @ ~10 fps)
interface Holo { mat: THREE.MeshStandardMaterial; ctx: CanvasRenderingContext2D; tex: THREE.CanvasTexture; draw: (c: CanvasRenderingContext2D, t: number) => void; w: number; h: number }

// Holograms sit on a pale wall, so they use normal blending with saturated cyan (additive would wash out).
const HOLO = '#19b2ec';
const HOLO_DIM = 'rgba(25,178,236,0.28)';

function frame(c: CanvasRenderingContext2D, w: number, h: number, title: string) {
  c.clearRect(0, 0, w, h);
  c.fillStyle = 'rgba(120,215,255,0.22)'; c.fillRect(0, 0, w, h);
  c.strokeStyle = HOLO; c.lineWidth = 3; c.strokeRect(4, 4, w - 8, h - 8);
  c.fillStyle = HOLO; c.font = "22px 'VT323', monospace"; c.textBaseline = 'top'; c.textAlign = 'left';
  c.fillText(title, 16, 12);
  // scanlines
  c.fillStyle = 'rgba(25,178,236,0.10)';
  for (let y = 0; y < h; y += 4) c.fillRect(0, y, w, 1);
}

/** Live data the holograms show (set from main via setupAtmosphere's getInfo). */
export interface HoloInfo {
  title: string | null; state: string; time: number; duration: number;
  volume: number; channel: number; power: boolean;
}
let info: HoloInfo = { title: null, state: 'IDLE', time: 0, duration: 0, volume: 80, channel: 3, power: true };

const fmtTime = (sec: number) => {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(ss).padStart(2, '0');
};
function wrapLines(c: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number) {
  const words = text.split(/s+/); const lines: string[] = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (c.measureText(t).width <= maxW) cur = t; else { if (cur) lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && lines.join(' ').length < text.length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.?$/, '…');
  return lines;
}

const holoDrawers: Record<string, (c: CanvasRenderingContext2D, t: number, w: number, h: number) => void> = {
  // real date + clock
  Holo_Calendar(c, t, w, h) {
    const d = new Date();
    frame(c, w, h, d.toLocaleString('nb-NO', { month: 'long', year: 'numeric' }).toUpperCase());
    c.font = "30px 'VT323', monospace"; c.textAlign = 'right'; c.textBaseline = 'top'; c.fillStyle = HOLO;
    c.fillText(d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), w - 16, 8);
    const first = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7; // Monday first
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const gx = 16, gy = 70, cw = (w - 32) / 7, ch = (h - gy - 14) / 6;
    c.font = "18px 'VT323', monospace"; c.textAlign = 'center'; c.textBaseline = 'top';
    ['MA', 'TI', 'ON', 'TO', 'FR', 'LØ', 'SØ'].forEach((n, i) => { c.fillStyle = i > 4 ? 'rgba(255,90,170,0.9)' : HOLO; c.fillText(n, gx + i * cw + cw / 2, 46); });
    c.font = "20px 'VT323', monospace";
    for (let i = 0; i < days; i++) {
      const k = i + first, x = gx + (k % 7) * cw, y = gy + Math.floor(k / 7) * ch;
      const today = i + 1 === d.getDate();
      c.strokeStyle = HOLO_DIM; c.lineWidth = 1; c.strokeRect(x + 2, y + 2, cw - 4, ch - 4);
      if (today) { c.fillStyle = `rgba(25,178,236,${0.55 + 0.35 * Math.sin(t * 4)})`; c.fillRect(x + 2, y + 2, cw - 4, ch - 4); }
      c.fillStyle = today ? '#fff' : HOLO; c.fillText(String(i + 1), x + cw / 2, y + ch / 2 - 9);
    }
  },
  // volume ring that follows the volume knob
  Holo_Energy(c, t, w, h) {
    frame(c, w, h, info.power ? 'VOLUM' : 'VOLUM · AV');
    const pct = info.power ? info.volume : 0;
    const cx = w / 2, cy = h / 2 + 14, r = Math.min(w, h) * 0.32;
    c.lineWidth = 22; c.strokeStyle = HOLO_DIM; c.lineCap = 'butt';
    c.beginPath(); c.arc(cx, cy, r, 0.75 * Math.PI, 2.25 * Math.PI); c.stroke();
    c.strokeStyle = HOLO;
    c.beginPath(); c.arc(cx, cy, r, 0.75 * Math.PI, 0.75 * Math.PI + (pct / 100) * 1.5 * Math.PI); c.stroke();
    // level meter ticks dance while something is playing
    if (info.state === 'PLAYING' && info.channel === 3) {
      for (let i = 0; i < 9; i++) {
        const v = (0.3 + 0.7 * Math.abs(Math.sin(t * (3 + i) + i))) * pct / 100;
        c.fillStyle = HOLO; c.fillRect(cx - 54 + i * 12, cy + r * 0.55 - v * 30, 8, v * 30);
      }
    }
    c.fillStyle = HOLO; c.font = "64px 'VT323', monospace"; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(String(Math.round(pct)), cx, cy - 6);
  },
  // now playing
  Holo_Network(c, t, w, h) {
    const playing = info.state === 'PLAYING' || info.state === 'PAUSED';
    frame(c, w, h, playing ? (info.state === 'PLAYING' ? '▶ SPILLES NÅ' : '❚❚ PAUSE') : info.state === 'LOADING' || info.state === 'INSERTING' ? 'LASTER INN…' : 'INGEN KASSETT');
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = HOLO;
    if (info.title) {
      c.font = "34px 'VT323', monospace";
      wrapLines(c, info.title, w - 40, 3).forEach((l, i) => c.fillText(l, 20, 52 + i * 34));
      // progress bar
      const y = h - 54, bw = w - 40;
      const p = info.duration > 0 ? Math.min(1, info.time / info.duration) : 0;
      c.strokeStyle = HOLO; c.lineWidth = 2; c.strokeRect(20, y, bw, 12);
      c.fillRect(22, y + 2, (bw - 4) * p, 8);
      c.font = "22px 'VT323', monospace";
      c.fillText(fmtTime(info.time), 20, y + 18);
      c.textAlign = 'right'; c.fillText(info.duration ? fmtTime(info.duration) : '--:--', w - 20, y + 18);
    } else {
      c.font = "26px 'VT323', monospace";
      c.fillText('Dra en kassett inn i spilleren', 20, 70);
      c.fillStyle = HOLO_DIM; c.fillText(Math.floor(t * 2) % 2 ? '▮' : '', 20, 104);
    }
  },
  // tuner: channel + signal strength
  Holo_Chart(c, t, w, h) {
    const names: Record<number, string> = { 3: 'VIDEO', 4: 'TESTBILDE', 5: 'KANAL 5 NYHETER', 6: 'REKLAME' };
    frame(c, w, h, `KANAL ${String(info.channel).padStart(2, '0')} · ${names[info.channel] ?? 'INGEN SIGNAL'}`);
    const known = info.power && info.channel in names;
    const n = 8, bw = (w - 60) / n;
    for (let i = 0; i < n; i++) {
      const base = known ? 0.55 + 0.4 * ((i + 1) / n) : 0.08 + 0.12 * Math.random();
      const v = base * (0.9 + 0.1 * Math.sin(t * 2 + i));
      const bh = v * (h - 80);
      c.fillStyle = i === n - 1 ? HOLO : 'rgba(25,178,236,0.65)';
      c.fillRect(30 + i * bw + 4, h - 20 - bh, bw - 8, bh);
    }
    c.strokeStyle = HOLO_DIM; c.lineWidth = 1;
    c.beginPath(); c.moveTo(24, h - 20); c.lineTo(w - 20, h - 20); c.stroke();
  },
};

function setupHolos(refs: SceneRefs): Holo[] {
  const out: Holo[] = [];
  for (const name of Object.keys(holoDrawers)) {
    const mesh = refs.find(name) as THREE.Mesh | undefined;
    if (!mesh?.isMesh) continue;
    const src = mesh.material as THREE.MeshStandardMaterial;
    const img = (src.map?.image ?? src.emissiveMap?.image) as { width: number; height: number } | undefined;
    const w = img?.width ?? 512, h = img?.height ?? 400;
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      toneMapped: false, opacity: 0.9,
    });
    mat.name = src.name + '_Live';
    mesh.material = mat;
    out.push({ mat: mat as unknown as THREE.MeshStandardMaterial, ctx: canvas.getContext('2d')!, tex, w, h, draw: (c, t) => holoDrawers[name](c, t, w, h) });
  }
  return out;
}

// ---------------------------------------------------------------- flying car
function setupCar(refs: SceneRefs) {
  const car = refs.find('FlyingCar');
  if (!car) return { update: () => {}, halo: new THREE.Sprite() };
  const start = car.position.clone();
  const parent = car.parent!;
  // Loop: drift across the window from right to left and back behind the far layer.
  // Loop across the window (window spans x≈0.2…2.9 at z≈-1.6; seen from the TV this maps to x≈1…20 at z≈-20).
  const curve = new THREE.CatmullRomCurve3([
    // far enough that the low-poly model reads as a silhouette with lights
    new THREE.Vector3(30, 9.0, -42),
    new THREE.Vector3(48, 10.5, -48),
    new THREE.Vector3(26, 12.0, -58),
    new THREE.Vector3(2, 10.0, -46),
    new THREE.Vector3(12, 8.0, -62),
    new THREE.Vector3(40, 8.5, -66),
  ], true, 'catmullrom', 0.5);
  void start;
  car.scale.multiplyScalar(0.6);
  const tmp = new THREE.Vector3();
  const look = new THREE.Vector3();
  const halo = makeHalo(0xff5ad8, 2.2, 0.5);
  parent.add(halo);
  const update = (t: number) => {
    const u = (t / 45) % 1;
    curve.getPointAt(u, tmp);
    car.position.copy(tmp);
    car.position.y += Math.sin(t * 1.7) * 0.08;
    curve.getPointAt((u + 0.005) % 1, look);
    car.lookAt(parent.localToWorld(look.clone()));
    car.rotateY(Math.PI / 2); // model's long axis is X
    halo.position.copy(car.position);
  };
  return { update, halo };
}

// ---------------------------------------------------------------- neon flicker
function setupFlicker(refs: SceneRefs, halos: THREE.Sprite[]) {
  const mats: { m: THREE.MeshBasicMaterial; base: THREE.Color; phase: number }[] = [];
  refs.find('City_Neon_Signs')?.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined;
    if (m?.color) mats.push({ m, base: m.color.clone(), phase: Math.random() * 10 });
  });
  const haloBase = halos.map((h) => (h.material as THREE.SpriteMaterial).opacity);
  let dropUntil = 0, dropIdx = 0;
  return (t: number) => {
    // occasional hard flicker on one sign colour
    if (t > dropUntil && Math.random() < 0.01) { dropUntil = t + 0.08 + Math.random() * 0.25; dropIdx = Math.floor(Math.random() * mats.length); }
    mats.forEach((e, i) => {
      // MeshBasic has no emissiveIntensity: modulate colour (baked emissive) instead
      let k = 0.93 + 0.07 * Math.sin(t * 13 + e.phase) * Math.sin(t * 2.1 + e.phase);
      if (i === dropIdx && t < dropUntil) k *= Math.random() < 0.5 ? 0.25 : 0.7;
      e.m.color.copy(e.base).multiplyScalar(k);
    });
    halos.forEach((h, i) => { (h.material as THREE.SpriteMaterial).opacity = haloBase[i] * (0.85 + 0.15 * Math.sin(t * 9 + i)); });
  };
}

// ---------------------------------------------------------------- public API
export interface Atmosphere {
  ledHalo: THREE.Sprite;
  displayHalo: THREE.Sprite;
  update(t: number): void;
  setHalosVisible(v: boolean): void;
  setHoloInterval(sec: number): void;
}

export function setupAtmosphere(scene: THREE.Scene, refs: SceneRefs, getInfo?: () => HoloInfo): Atmosphere {
  // halos at LED_Power + VCR_Display (milestones 1–4 glow)
  const wp = (n: string) => refs.get(n).getWorldPosition(new THREE.Vector3());
  const ledHalo = makeHalo(0xff2a10, 0.05, 0.3);
  ledHalo.position.copy(wp('LED_Power')).add(new THREE.Vector3(0, 0, 0.004));
  scene.add(ledHalo);
  const displayHalo = makeHalo(0x4dffe0, 0.11, 0.35);
  displayHalo.scale.set(0.12, 0.05, 1);
  displayHalo.position.copy(wp('VCR_Display')).add(new THREE.Vector3(0, 0, 0.004));
  scene.add(displayHalo);

  const signs = refs.find('City_Neon_Signs');
  // city.ts hides the GLB signs when it builds its own city → no halos for them then
  const neon = signs && signs.visible ? neonHalos(scene, signs) : [];
  // the warm ceiling strip gets a soft glow line too
  const holos = setupHolos(refs);
  const { update: car, halo: carHalo } = setupCar(refs);
  const flicker = setupFlicker(refs, neon);
  console.info(`[atmosphere] ${neon.length} neon halos, ${holos.length} holograms`);

  let lastHolo = -1;
  let holoInterval = 0.1;
  return {
    ledHalo, displayHalo,
    setHoloInterval(sec: number) { holoInterval = sec; },
    setHalosVisible(v: boolean) { for (const h of [...neon, ledHalo, displayHalo, carHalo]) h.visible = v; },
    update(t: number) {
      car(t);
      flicker(t);
      if (t - lastHolo >= holoInterval) { // ~10 fps
        lastHolo = t;
        if (getInfo) info = getInfo();
        for (const h of holos) { h.draw(h.ctx, t); h.tex.needsUpdate = true; }
      }
    },
  };
}
