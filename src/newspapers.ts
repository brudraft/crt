import * as THREE from 'three';

/**
 * Old, worn newspapers lying around: procedural pages (aged paper, masthead, headline, columns of
 * text, photos, stains, creases) on slightly crumpled geometry with torn edges and a soft contact shadow.
 * All titles and headlines are fictional.
 */
const ISSUES = [
  { masthead: 'THE NEON CHRONICLE', headline: ['VIDEO STORES', 'SELL OUT!'], date: 'FRIDAY, NOVEMBER 10, 1989' },
  { masthead: 'AFTENSKJERMEN', headline: ['LUFTFILENE', 'ÅPNER I DAG'], date: 'LØRDAG 4. MARS 1988' },
  { masthead: 'METRO HERALD', headline: ['SKYLINE GOES', 'ALL NEON'], date: 'MONDAY, JUNE 12, 1990' },
  { masthead: 'THE DAILY TRANSMITTER', headline: ['TV SIGNAL', 'REACHES MOON'], date: 'SUNDAY, JULY 20, 1986' },
];

function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function page(issue: typeof ISSUES[number], seed: number, front: boolean) {
  const W = 1024, H = 1400;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed * 7919 + 13);
  // aged paper
  g.fillStyle = '#d9cba6'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = r() * H, rad = 120 + r() * 380;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, `rgba(${120 + r() * 40},${85 + r() * 30},${40},${0.12 + r() * 0.18})`); gr.addColorStop(1, 'rgba(120,85,40,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  const edge = g.createRadialGradient(W / 2, H / 2, W * 0.3, W / 2, H / 2, W * 0.85);
  edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(90,60,25,0.45)');
  g.fillStyle = edge; g.fillRect(0, 0, W, H);

  const ink = 'rgba(28,22,16,0.92)';
  g.fillStyle = ink; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  let y = 60;
  if (front) {
    g.font = 'bold 74px "Times New Roman", Georgia, serif';
    g.fillText(issue.masthead, W / 2, y + 70); y += 96;
    g.fillRect(40, y, W - 80, 4); y += 10;
    g.font = '22px "Times New Roman", Georgia, serif'; g.textAlign = 'left'; g.fillText(issue.date, 44, y + 24);
    g.textAlign = 'right'; g.fillText('PRICE 5¢', W - 44, y + 24); g.textAlign = 'center';
    y += 36; g.fillRect(40, y, W - 80, 2); y += 20;
    g.font = 'bold 150px Impact, "Arial Narrow", sans-serif';
    for (const line of issue.headline) {
      const m = g.measureText(line).width; const sx = Math.min(1, (W - 90) / m);
      g.save(); g.translate(W / 2, y + 140); g.scale(sx, 1); g.fillText(line, 0, 0); g.restore(); y += 150;
    }
    y += 20;
  } else {
    g.font = '24px "Times New Roman", Georgia, serif'; g.textAlign = 'left';
    g.fillText(issue.masthead + ' · ' + issue.date, 44, y + 10); y += 30; g.fillRect(40, y, W - 80, 2); y += 30;
  }
  // body: columns of "text", sub-heads and a couple of halftone photos
  const cols = 4, gap = 22, cw = (W - 80 - gap * (cols - 1)) / cols;
  for (let ci = 0; ci < cols; ci++) {
    const x0 = 40 + ci * (cw + gap);
    let yy = y;
    while (yy < H - 50) {
      const roll = r();
      if (roll < 0.08 && yy < H - 300) {                       // photo
        const ph = 160 + r() * 160;
        g.fillStyle = 'rgba(40,32,24,0.85)'; g.fillRect(x0, yy, cw, ph);
        for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(217,203,166,${r() * 0.5})`; g.beginPath(); g.arc(x0 + r() * cw, yy + r() * ph, 2 + r() * 6, 0, Math.PI * 2); g.fill(); }
        yy += ph + 26;
      } else if (roll < 0.16) {                                 // sub-head
        g.fillStyle = ink; g.font = 'bold 30px "Times New Roman", Georgia, serif'; g.textAlign = 'left';
        g.fillText(['LOCAL', 'WEATHER', 'MARKETS', 'TV TONIGHT', 'SPORTS', 'CLASSIFIED'][Math.floor(r() * 6)], x0, yy + 26); yy += 40;
      } else {                                                  // text lines
        g.fillStyle = 'rgba(40,32,24,0.55)';
        for (let l = 0; l < 8 + r() * 14 && yy < H - 50; l++) { const lw = cw * (l % 9 === 8 ? 0.4 + r() * 0.4 : 0.92 + r() * 0.08); g.fillRect(x0, yy, lw, 7); yy += 14; }
        yy += 14;
      }
    }
    if (ci < cols - 1) { g.fillStyle = 'rgba(40,32,24,0.4)'; g.fillRect(x0 + cw + gap / 2 - 1, y, 2, H - y - 50); }
  }
  // wear: creases, coffee ring, dirt, scuffs
  g.strokeStyle = 'rgba(70,50,25,0.35)'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(W / 2 + (r() - 0.5) * 20, 0); g.lineTo(W / 2 + (r() - 0.5) * 20, H); g.stroke();       // centre fold
  g.beginPath(); g.moveTo(0, H / 2 + (r() - 0.5) * 30); g.lineTo(W, H / 2 + (r() - 0.5) * 30); g.stroke();       // cross fold
  for (let i = 0; i < 14; i++) { g.strokeStyle = `rgba(255,250,235,${0.15 + r() * 0.2})`; g.lineWidth = 1 + r() * 2; g.beginPath(); const x = r() * W, yv = r() * H; g.moveTo(x, yv); g.lineTo(x + (r() - 0.5) * 300, yv + (r() - 0.5) * 300); g.stroke(); }
  if (r() < 0.7) { const x = 200 + r() * (W - 400), yv = 400 + r() * (H - 600); g.strokeStyle = 'rgba(110,65,25,0.35)'; g.lineWidth = 14; g.beginPath(); g.arc(x, yv, 70 + r() * 20, 0, Math.PI * 1.8); g.stroke(); }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(60,40,20,${r() * 0.12})`; g.fillRect(r() * W, r() * H, 1 + r() * 3, 1 + r() * 3); }
  return c;
}

/** Ragged, torn alpha mask (white = paper). */
function tornMask(seed: number) {
  const W = 256, H = 350;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const r = rng(seed * 104729 + 7);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#fff'; g.beginPath();
  const pts: [number, number][] = [];
  const edge = (x0: number, y0: number, x1: number, y1: number, rough: number) => {
    const n = 40;
    for (let i = 0; i < n; i++) {
      const t = i / n, nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny);
      const tear = (r() < 0.06 ? 10 + r() * 22 : r() * rough);
      pts.push([x0 + (x1 - x0) * t + (nx / l) * tear, y0 + (y1 - y0) * t + (ny / l) * tear]);
    }
  };
  const m = 4;
  edge(m, m, W - m, m, 4); edge(W - m, m, W - m, H - m, 5); edge(W - m, H - m, m, H - m, 6); edge(m, H - m, m, m, 4);
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath(); g.fill();
  // a missing corner now and then
  if (r() < 0.6) { g.fillStyle = '#000'; g.beginPath(); g.moveTo(W, H - 40 - r() * 60); g.lineTo(W - 30 - r() * 60, H); g.lineTo(W, H); g.fill(); }
  // a few holes / worn spots
  for (let i = 0; i < 3; i++) if (r() < 0.5) { g.fillStyle = '#000'; g.beginPath(); g.arc(20 + r() * (W - 40), 20 + r() * (H - 40), 2 + r() * 6, 0, Math.PI * 2); g.fill(); }
  return c;
}

/** Crumpled sheet: curled corners, folds and a little noise. Lies in XZ, +Y up. */
function sheetGeometry(w: number, d: number, seed: number, crumple: number) {
  const geo = new THREE.PlaneGeometry(w, d, 28, 36);
  geo.rotateX(-Math.PI / 2);
  const r = rng(seed * 31 + 5);
  const lift = [r(), r(), r(), r()].map((v) => v * 0.025 * crumple + 0.002);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const ph = r() * 10;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) / (w / 2), z = pos.getZ(i) / (d / 2);
    const u = (x + 1) / 2, v = (z + 1) / 2;
    const corner = lift[0] * (1 - u) ** 4 * (1 - v) ** 4 + lift[1] * u ** 4 * (1 - v) ** 4 + lift[2] * u ** 4 * v ** 4 + lift[3] * (1 - u) ** 4 * v ** 4;
    const fold = 0.004 * crumple * Math.exp(-(x * x) * 60) + 0.003 * crumple * Math.exp(-(z * z) * 60);   // raised creases
    const noise = 0.0025 * crumple * (Math.sin(x * 9 + ph) * Math.sin(z * 7 - ph) + 0.5 * Math.sin(x * 23 + z * 17 + ph));
    const edgeCurl = 0.006 * crumple * Math.max(0, Math.abs(x) - 0.8) * 5;
    pos.setY(i, corner + fold + noise + edgeCurl + 0.0015);
  }
  geo.computeVertexNormals();
  return geo;
}

let shadowTex: THREE.Texture | null = null;
function contactShadow(w: number, d: number) {
  if (!shadowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 8, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    shadowTex = new THREE.CanvasTexture(c);
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.35, d * 1.35),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -1 }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0006;
  m.raycast = () => {};
  return m;
}

interface Spot { pos: [number, number, number]; yaw: number; issue: number; sheets: number; scale?: number; crumple?: number }

export function setupNewspapers(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const tex = (c: HTMLCanvasElement, srgb = true) => {
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
  };
  // positions chosen around the cart / room (world space, y = surface height)
  const spots: Spot[] = [
    { pos: [-0.04, 0.1502, 0.07], yaw: 1.75, issue: 0, sheets: 2, scale: 0.7, crumple: 0.5 },   // cart lower shelf, under the tapes
    { pos: [-0.85, 0.0, 0.62], yaw: -0.5, issue: 1, sheets: 2, crumple: 1.2 },                   // floor, in front of the cart
    { pos: [0.95, 0.0, 0.35], yaw: 2.4, issue: 2, sheets: 1, crumple: 1.6, scale: 0.9 },         // floor, right of the cart
    { pos: [-1.75, 0.553, 0.05], yaw: 1.2, issue: 3, sheets: 1, scale: 0.5, crumple: 0.4 },     // side table
    { pos: [1.3, 0.0, -1.25], yaw: 0.1, issue: 2, sheets: 5, crumple: 0.5 },                      // stack by the window
  ];
  const group = new THREE.Group();
  group.name = 'Newspapers';
  const masks = [0, 1, 2, 3].map((i) => tex(tornMask(i + 1), false));
  const pages = new Map<string, THREE.Texture>();
  const pageTex = (issue: number, front: boolean, seed: number) => {
    const key = `${issue}-${front}-${seed % 3}`;
    if (!pages.has(key)) pages.set(key, tex(page(ISSUES[issue], seed % 3 + issue * 5, front)));
    return pages.get(key)!;
  };
  spots.forEach((s, si) => {
    const root = new THREE.Group();
    root.position.set(...s.pos);
    root.rotation.y = s.yaw;
    const sc = s.scale ?? 1;
    const w = 0.42 * sc, d = 0.58 * sc;      // a folded broadsheet ≈ 42 × 58 cm
    root.add(contactShadow(w, d));
    for (let k = 0; k < s.sheets; k++) {
      const seed = si * 10 + k;
      const top = k === s.sheets - 1;
      const mat = new THREE.MeshStandardMaterial({
        map: pageTex(s.issue, top, seed), alphaMap: masks[seed % 4], alphaTest: 0.5,
        roughness: 0.92, metalness: 0, side: THREE.DoubleSide, envMapIntensity: 0.6,
      });
      const sheet = new THREE.Mesh(sheetGeometry(w, d, seed, (s.crumple ?? 1) * (top ? 1 : 0.6)), mat);
      // stacked sheets: each a bit higher, offset and rotated like they were dropped
      sheet.position.set((k - s.sheets / 2) * 0.012 * (si % 2 ? 1 : -1), k * 0.0028, (k % 2 ? 0.01 : -0.008) * k);
      sheet.rotation.y = (k - (s.sheets - 1)) * 0.09 * (si % 2 ? -1 : 1);
      sheet.raycast = () => {};
      root.add(sheet);
    }
    group.add(root);
  });
  scene.add(group);
  return group;
}
