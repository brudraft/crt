/* Broadcast channels drawn on the 320×240 screen canvas. All brands and headlines are fictional. */

type Ctx = CanvasRenderingContext2D;

const font = (size: number, family = "'VT323', monospace") => `${size}px ${family}`;
function txt(c: Ctx, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', family?: string) {
  c.font = font(size, family); c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(s, x, y);
}
const clock = (d = new Date()) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// ------------------------------------------------------------------ CH 4 – test card
export function drawTestCard(c: Ctx, now: number, W: number, H: number) {
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0'];
  const bw = W / bars.length;
  bars.forEach((b, i) => { c.fillStyle = b; c.fillRect(i * bw, 0, bw + 1, H * 0.66); });
  const rev = ['#0000c0', '#131313', '#c000c0', '#131313', '#00c0c0', '#131313', '#c0c0c0'];
  rev.forEach((b, i) => { c.fillStyle = b; c.fillRect(i * bw, H * 0.66, bw + 1, H * 0.08); });
  // pluge + grey steps
  const y = H * 0.74, h = H * 0.26;
  c.fillStyle = '#00214c'; c.fillRect(0, y, W * 0.18, h);
  c.fillStyle = '#fff'; c.fillRect(W * 0.18, y, W * 0.18, h);
  c.fillStyle = '#32006a'; c.fillRect(W * 0.36, y, W * 0.18, h);
  c.fillStyle = '#131313'; c.fillRect(W * 0.54, y, W * 0.46, h);
  ['#090909', '#131313', '#1d1d1d'].forEach((g, i) => { c.fillStyle = g; c.fillRect(W * 0.72 + i * W * 0.06, y, W * 0.06, h); });
  // centre circle with station ID + clock
  const cx = W / 2, cy = H * 0.38, r = H * 0.27;
  c.save(); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.clip();
  c.fillStyle = '#111'; c.fillRect(cx - r, cy - r, r * 2, r * 2);
  for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#fff' : '#111'; c.fillRect(cx - r + (i * r) / 4, cy - r * 0.15, r / 4, r * 0.3); }
  c.restore();
  c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  txt(c, 'VISTRON TV', cx, cy - r * 0.55, 20, '#fff', 'center');
  txt(c, clock(), cx, cy + r * 0.55, 22, '#fff', 'center');
  if (Math.floor(now / 1000) % 2) txt(c, 'CH 04', W - 8, 12, 16, '#000', 'right');
}

// ------------------------------------------------------------------ CH 5 – news
const HEADLINES = [
  'Neon-regn ventet over byen hele natten',
  'Ny luftfil åpnet mellom sentrum og havna',
  'Videosjapper melder rekordsalg av VHS',
  'Strømprisen faller – 47 % lagret i nettet',
  'Holo-kalendere nå i alle nye leiligheter',
  'Trafikkork i 300 meters høyde i rushtida',
];
export function drawNews(c: Ctx, now: number, W: number, H: number) {
  const t = now / 1000;
  // studio
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b1f4d'); g.addColorStop(1, '#03091c');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x += 24) { c.fillStyle = 'rgba(80,140,255,0.06)'; c.fillRect(x, 0, 12, H * 0.7); }
  // background monitor with a "map"
  c.fillStyle = '#14306e'; c.fillRect(W * 0.56, H * 0.1, W * 0.38, H * 0.34);
  c.strokeStyle = '#6fa8ff'; c.lineWidth = 1; c.strokeRect(W * 0.56, H * 0.1, W * 0.38, H * 0.34);
  c.fillStyle = '#2d6be0';
  c.beginPath(); c.moveTo(W * 0.62, H * 0.38); c.lineTo(W * 0.7, H * 0.16); c.lineTo(W * 0.8, H * 0.22); c.lineTo(W * 0.88, H * 0.36); c.closePath(); c.fill();
  c.fillStyle = '#ff4060'; c.beginPath(); c.arc(W * 0.75, H * 0.27, 3 + Math.sin(t * 5) * 1, 0, Math.PI * 2); c.fill();
  // anchor (simple silhouette, breathing + head motion)
  const ax = W * 0.3, ay = H * 0.5, bob = Math.sin(t * 1.3) * 1.5;
  c.fillStyle = '#1d1d2a';
  c.beginPath(); c.ellipse(ax, ay + 18, 52, 36, 0, Math.PI, 0); c.fill();            // shoulders
  c.fillStyle = '#c99a7a'; c.beginPath(); c.ellipse(ax + Math.sin(t * 0.7) * 2, ay - 26 + bob, 15, 19, 0, 0, Math.PI * 2); c.fill(); // head
  c.fillStyle = '#3a2418'; c.beginPath(); c.ellipse(ax + Math.sin(t * 0.7) * 2, ay - 38 + bob, 16, 10, 0, Math.PI, 0); c.fill();     // hair
  c.fillStyle = '#e8e8f0'; c.beginPath(); c.moveTo(ax - 8, ay - 6); c.lineTo(ax, ay + 10); c.lineTo(ax + 8, ay - 6); c.fill();       // collar
  c.fillStyle = '#b01030'; c.fillRect(ax - 2, ay - 4, 4, 16);                          // tie
  // desk
  c.fillStyle = '#0d1630'; c.fillRect(0, H * 0.7, W, H * 0.1);
  c.fillStyle = '#5a8cff'; c.fillRect(0, H * 0.7, W, 2);
  // lower third
  const idx = Math.floor(t / 7) % HEADLINES.length;
  c.fillStyle = '#e8e8f0'; c.fillRect(8, H * 0.58, W * 0.62, 18);
  c.fillStyle = '#c4102e'; c.fillRect(8, H * 0.58, 46, 18);
  txt(c, 'NYHET', 31, H * 0.58 + 9, 16, '#fff', 'center');
  c.save(); c.beginPath(); c.rect(56, H * 0.58, W * 0.62 - 48, 18); c.clip();
  txt(c, HEADLINES[idx].toUpperCase(), 60, H * 0.58 + 9, 15, '#0b1f4d');
  c.restore();
  // logo, LIVE, clock
  c.fillStyle = '#c4102e'; c.fillRect(8, 8, 62, 18);
  txt(c, 'KANAL 5', 39, 17, 17, '#fff', 'center');
  if (Math.floor(t * 1.2) % 2) { c.fillStyle = '#ff2040'; c.beginPath(); c.arc(84, 17, 4, 0, Math.PI * 2); c.fill(); }
  txt(c, 'DIREKTE', 92, 17, 15, '#fff');
  txt(c, clock(), W - 10, 17, 18, '#fff', 'right');
  // ticker
  c.fillStyle = '#c4102e'; c.fillRect(0, H - 22, W, 22);
  const ticker = HEADLINES.join('   ◆   ') + '   ◆   ';
  c.font = font(16);
  const tw = c.measureText(ticker).width;
  const off = (t * 40) % tw;
  txt(c, ticker, -off, H - 11, 16, '#fff');
  txt(c, ticker, -off + tw, H - 11, 16, '#fff');
}

// ------------------------------------------------------------------ CH 6 – adverts
const ADS = [
  (c: Ctx, p: number, W: number, H: number) => {          // Neo Cola
    const g = c.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, '#ff3355'); g.addColorStop(1, '#5a0014');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    for (let i = 0; i < 12; i++) { c.fillStyle = 'rgba(255,255,255,0.08)'; c.save(); c.translate(W / 2, H / 2); c.rotate(i * Math.PI / 6 + p * 0.8); c.fillRect(0, -6, W, 12); c.restore(); }
    const by = H * 0.55 + Math.sin(p * 9) * 4;
    c.fillStyle = '#2a0b0b'; c.beginPath(); c.roundRect(W * 0.22 - 18, by - 60, 36, 100, 10); c.fill();
    c.fillStyle = '#fff'; c.fillRect(W * 0.22 - 18, by - 20, 36, 22);
    txt(c, 'NEO', W * 0.22, by - 9, 14, '#c4102e', 'center');
    txt(c, 'NEO COLA', W * 0.62, H * 0.4, 44, '#fff', 'center', "'Permanent Marker', cursive");
    txt(c, 'Smaken av 1989', W * 0.62, H * 0.62, 22, '#ffe0e6', 'center');
  },
  (c: Ctx, p: number, W: number, H: number) => {          // VHS sale
    c.fillStyle = '#1a1066'; c.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) { c.fillStyle = y % 16 ? '#22168a' : '#1a1066'; c.fillRect(0, y, W, 8); }
    txt(c, 'VHS-KASSETTER', W / 2, H * 0.22, 34, '#ffe14d', 'center');
    // starburst price
    const cx = W * 0.5, cy = H * 0.6, s = 1 + Math.sin(p * 12) * 0.05;
    c.save(); c.translate(cx, cy); c.scale(s, s); c.rotate(p * 0.5);
    c.fillStyle = '#ff3a2e'; c.beginPath();
    for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2, r = i % 2 ? 46 : 62; c.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    c.closePath(); c.fill(); c.restore();
    txt(c, '3 for', cx, cy - 16, 20, '#fff', 'center');
    txt(c, '99,-', cx, cy + 10, 34, '#fff', 'center');
    txt(c, 'Kun i din lokale videosjappe', W / 2, H - 16, 16, '#c8c4ff', 'center');
  },
  (c: Ctx, p: number, W: number, H: number) => {          // Vistron TV
    const g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#0d0d12'); g.addColorStop(1, '#2b2a33');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    // little TV with glowing screen
    const x = W * 0.12 + Math.min(1, p * 2) * 10, y = H * 0.25;
    c.fillStyle = '#e8dcc4'; c.beginPath(); c.roundRect(x, y, 110, 88, 8); c.fill();
    const sg = c.createLinearGradient(x, y, x + 80, y + 70);
    sg.addColorStop(0, '#5ab4ff'); sg.addColorStop(1, '#ff6ad5');
    c.fillStyle = sg; c.beginPath(); c.roundRect(x + 8, y + 8, 74, 56, 10); c.fill();
    c.fillStyle = '#333'; c.beginPath(); c.arc(x + 96, y + 22, 6, 0, Math.PI * 2); c.arc(x + 96, y + 42, 6, 0, Math.PI * 2); c.fill();
    const a = Math.min(1, Math.max(0, (p - 0.2) * 3));
    c.globalAlpha = a;
    txt(c, 'VISTRON', W * 0.7, H * 0.38, 38, '#fff', 'center');
    txt(c, 'Bildet du fortjener.', W * 0.7, H * 0.56, 20, '#cfd6ff', 'center');
    c.globalAlpha = 1;
    // lens flare sweep
    const fx = (p * 1.4 % 1) * W * 1.4 - W * 0.2;
    const fg = c.createLinearGradient(fx - 30, 0, fx + 30, 0);
    fg.addColorStop(0, 'rgba(255,255,255,0)'); fg.addColorStop(0.5, 'rgba(255,255,255,0.18)'); fg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fg; c.fillRect(fx - 30, 0, 60, H);
  },
];
export function drawAds(c: Ctx, now: number, W: number, H: number) {
  const dur = 6000;
  const i = Math.floor(now / dur) % ADS.length;
  const p = (now % dur) / dur;
  ADS[i](c, p, W, H);
  // wipe transition at the start of each spot
  if (p < 0.06) { c.fillStyle = '#fff'; c.fillRect(0, 0, W * (1 - p / 0.06), H); }
  txt(c, 'REKLAME', W - 8, 12, 14, 'rgba(255,255,255,0.7)', 'right');
}
