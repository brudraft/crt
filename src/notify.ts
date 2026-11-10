import * as THREE from 'three';

/**
 * The apartment's assistant keeps trying to reach you: holographic notification cards that appear on the
 * wall, blink for attention, and – when ignored – collapse into a badge with a growing count.
 * Click a card to dismiss it. Messages react to the time of day, the weather, what's playing and how long
 * you've "been inside" (counted from your first visit).
 */
export interface NotifyContext {
  playing: boolean; title: string | null; channel: number; power: boolean; tapes: number;
}

interface Card { title: string; body: string; icon: string; urgent?: boolean }

const KEY = 'crtvhs.assistant.v1';
const W = 512, H = 288;

function loadMemory() {
  const now = Date.now();
  const def = { first: now, visits: 0, unread: 3, plays: {} as Record<string, number> };
  try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return def; }
}

export class Notifier {
  readonly mesh: THREE.Mesh;
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private mat: THREE.MeshBasicMaterial;
  private mem = loadMemory();
  private card: Card | null = null;
  private shownAt = 0;
  private state: 'idle' | 'showing' | 'badge' | 'dismissed' = 'idle';
  private ignored = 0;
  private next = 0;
  private lastDraw = 0;
  private dismissedAt = 0;
  private used = new Set<number>();
  private lastTitle: string | null = null;

  constructor(scene: THREE.Scene, pos: THREE.Vector3, yaw: number, private hooks: { chime(urgent: boolean): void; pulse(): void }) {
    this.mem.visits++;
    this.save();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    this.ctx = c.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(c); this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, opacity: 0 });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.36), this.mat);
    this.mesh.name = 'Holo_Notify';
    this.mesh.position.copy(pos);
    this.mesh.rotation.y = yaw;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this.next = performance.now() + 14000; // first attempt soon after you arrive
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.mem)); } catch { /* ignore */ } }

  private daysInside() { return 9 + Math.floor((Date.now() - this.mem.first) / 86400000); }

  /** Pick a message that fits the moment. */
  private compose(c: NotifyContext): Card {
    const h = new Date().getHours();
    const time = new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' });
    const pool: (Card & { when?: boolean; weight?: number })[] = [
      { icon: '✉', title: this.mem.unread === 1 ? '1 ulest melding' : `${this.mem.unread} uleste meldinger`, body: 'Den eldste er fra Mamma, 6 dager siden.' },
      { icon: '⌂', title: `Du har ikke vært ute på ${this.daysInside()} dager`, body: 'Det er 2 °C og lett regn. Fint gåvær?', weight: 2 },
      { icon: '🍜', title: 'Vil du bestille middag?', body: 'Nudelbaren på hjørnet leverer på 4 min.', when: h >= 16 && h <= 22, weight: 2 },
      { icon: '🍜', title: 'Du har ikke spist i dag', body: 'Skal jeg bestille noe?', when: h >= 12 },
      { icon: '☾', title: `Klokka er ${time}`, body: 'Søvnrytmen din er 4 timer forskjøvet.', when: h >= 0 && h < 5, weight: 3 },
      { icon: '☂', title: 'Det regner over hele byen', body: 'Paraply anbefales. Ikke at du skal noe sted.' },
      { icon: '☎', title: 'Ubesvart anrop: Mamma (3)', body: '«Ring meg når du ser dette.»', weight: 2 },
      { icon: '⚡', title: 'Strømregningen forfaller i morgen', body: 'Autobetaling er slått av siden mars.' },
      { icon: '💡', title: 'Lysnivå i rommet: 12 %', body: 'Skal jeg skru på taklyset?' },
      { icon: '♥', title: 'Puls 58 · Steg i dag: 41', body: 'Anbefalt: 6 000. Kanskje en tur til vinduet?' },
      { icon: '⌁', title: 'Sosial aktivitet: lav', body: '0 samtaler denne uka. Vil du at jeg finner en klubb?' },
      { icon: '▶', title: `Du har sett «${c.title}» ${(this.mem.plays[c.title ?? ''] ?? 1)} ganger`, body: 'Vil du ha et nytt forslag?', when: c.playing && !!c.title, weight: 3 },
      { icon: '▶', title: 'Gammel teknologi oppdaget', body: 'VHS-spilleren kan erstattes med HoloStream™ (gratis i 30 dager).', when: c.playing },
      { icon: '◐', title: 'Skjermtid i dag: 7 t 40 min', body: 'Alt på samme skjerm.', when: c.power },
      { icon: '✉', title: 'Ny melding fra Mamma', body: '«Er du ok? Du svarer aldri.»', urgent: true },
      { icon: '◎', title: 'Naboen har bedt om en prat', body: 'Gjelder lyd etter kl. 23.', when: h >= 20 || h < 3 },
      { icon: '★', title: 'Påminnelse: Bursdag i morgen', body: 'Ingen gave valgt.' },
    ];
    const ok = pool.map((p, i) => ({ p, i })).filter(({ p, i }) => p.when !== false && !this.used.has(i));
    if (!ok.length) { this.used.clear(); return this.compose(c); }
    const total = ok.reduce((s, { p }) => s + (p.weight ?? 1), 0);
    let r = Math.random() * total;
    for (const { p, i } of ok) { r -= p.weight ?? 1; if (r <= 0) { this.used.add(i); return p; } }
    return ok[0].p;
  }

  /** Called by main when a tape starts playing (keeps the "you've watched this N times" count). */
  notePlay(title: string) {
    if (title === this.lastTitle) return;
    this.lastTitle = title;
    this.mem.plays[title] = (this.mem.plays[title] ?? 0) + 1;
    this.save();
  }

  /** Click on the card: dismiss it (and reset the badge). */
  click() {
    if (this.state === 'showing' || this.state === 'badge') {
      this.state = 'dismissed';
      this.dismissedAt = performance.now();
      if (/ulest/.test(this.card?.title ?? '')) { this.mem.unread = 0; this.save(); }
      this.ignored = 0;
      this.next = performance.now() + 40000 + Math.random() * 40000;
    }
  }

  update(now: number, c: NotifyContext) {
    // schedule the next attempt
    if (now > this.next && (this.state === 'idle' || this.state === 'badge')) {
      if (Math.random() < 0.3) { this.mem.unread++; this.save(); }
      this.card = this.compose(c);
      this.state = 'showing';
      this.shownAt = now;
      this.hooks.chime(!!this.card.urgent);
      this.hooks.pulse();
      this.next = now + 45000 + Math.random() * 45000;
    }
    const age = now - this.shownAt;
    if (this.state === 'showing' && age > 16000) { this.state = 'badge'; this.ignored++; }  // ignored…
    if (this.state === 'showing' && age > 6000 && age < 6100) this.hooks.pulse();          // second nudge
    if (this.state === 'dismissed' && now - this.dismissedAt > 1500) this.state = 'idle';

    // opacity / scale envelope
    let target = 0;
    if (this.state === 'showing') target = 0.95;
    else if (this.state === 'badge') target = 0.75;
    else if (this.state === 'dismissed') target = Math.max(0, 1 - (now - this.dismissedAt) / 1200);
    this.mat.opacity += (target - this.mat.opacity) * 0.12;
    const appear = this.state === 'showing' ? Math.min(1, age / 350) : 1;
    this.mesh.scale.set(1, 0.05 + 0.95 * appear, 1);
    this.mesh.visible = this.mat.opacity > 0.01;

    if (this.mesh.visible && now - this.lastDraw > 50) { this.lastDraw = now; this.draw(now, age); this.tex.needsUpdate = true; }
  }

  private draw(now: number, age: number) {
    const g = this.ctx;
    g.clearRect(0, 0, W, H);
    const cyan = '#5fe8ff', pink = '#ff5fd0';
    const blink = 0.5 + 0.5 * Math.sin(now / 160);
    if (this.state === 'badge') {
      // collapsed: a bell with the number of ignored notifications, slowly blinking
      const cx = W - 70, cy = 70, r = 44;
      g.fillStyle = `rgba(6,28,52,${0.7 + 0.2 * blink})`; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = cyan; g.lineWidth = 3; g.stroke();
      g.font = "46px 'VT323', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = cyan;
      g.fillText('🔔', cx, cy - 2);
      g.fillStyle = pink; g.beginPath(); g.arc(cx + 30, cy - 30, 20, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = "30px 'VT323', monospace"; g.fillText(String(this.ignored), cx + 30, cy - 29);
      g.font = "22px 'VT323', monospace"; g.textAlign = 'right'; g.fillStyle = `rgba(95,232,255,${0.5 + 0.4 * blink})`;
      g.fillText('ubesvart', W - 24, cy + 64);
      return;
    }
    const card = this.card;
    if (!card) return;
    const urgent = !!card.urgent;
    const accent = urgent ? pink : cyan;
    // panel
    // dark tinted glass so the card reads against the pale wall
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, urgent ? 'rgba(70,8,50,0.86)' : 'rgba(6,28,52,0.86)'); bg.addColorStop(1, urgent ? 'rgba(40,4,30,0.8)' : 'rgba(4,16,32,0.8)');
    g.fillStyle = bg;
    g.fillRect(8, 8, W - 16, H - 16);
    g.strokeStyle = accent; g.lineWidth = 3 + (this.state === 'showing' ? 2 * blink : 0); g.strokeRect(8, 8, W - 16, H - 16);
    // attention ring around the icon
    const ix = 70, iy = 92;
    for (let k = 0; k < 2; k++) {
      const p = ((now / 1200 + k * 0.5) % 1);
      g.strokeStyle = `rgba(${urgent ? '255,95,208' : '95,232,255'},${(1 - p) * 0.8})`; g.lineWidth = 2;
      g.beginPath(); g.arc(ix, iy, 30 + p * 34, 0, Math.PI * 2); g.stroke();
    }
    g.fillStyle = accent; g.font = "50px 'VT323', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(card.icon, ix, iy);
    // text
    g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = '#ffffff'; g.font = "38px 'VT323', monospace";
    wrap(g, card.title, 132, 40, W - 150, 36, 3);
    g.fillStyle = 'rgba(190,240,255,0.95)'; g.font = "28px 'VT323', monospace";
    wrap(g, card.body, 32, 168, W - 64, 26, 3);
    // footer: dismiss hint + countdown bar until it gives up
    const left = Math.max(0, 1 - age / 16000);
    g.fillStyle = 'rgba(95,232,255,0.35)'; g.fillRect(24, H - 34, (W - 48) * left, 4);
    g.fillStyle = `rgba(200,240,255,${0.35 + 0.35 * blink})`; g.font = "20px 'VT323', monospace";
    g.fillText(this.state === 'dismissed' ? 'OK.' : 'TRYKK FOR Å AVVISE', 24, H - 62);
    g.textAlign = 'right'; g.fillText('ASSISTENT', W - 24, H - 62);
    // scanlines + glitch on appear
    g.fillStyle = 'rgba(95,232,255,0.06)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
    if (age < 500 && this.state === 'showing') {
      for (let i = 0; i < 6; i++) { const y = Math.random() * H; g.drawImage(g.canvas, 0, y, W, 6, (Math.random() - 0.5) * 30, y, W, 6); }
    }
  }
}

function wrap(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(' '); let line = ''; let n = 0;
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y + n * lh); line = w; if (++n >= maxLines) return; }
    else line = t;
  }
  if (line) g.fillText(line, x, y + n * lh);
}
