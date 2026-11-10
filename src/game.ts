/**
 * SKYLANE – a small original arcade game for TV channel 7, drawn on the 320×240 screen canvas.
 * Fly a hover car up the sky-lanes between the towers, grab VHS tapes, zap drones, dodge billboards.
 */
export interface GameInput { x: number; y: number; fire: boolean }
export interface GameSfx { blip(freq: number, dur: number, type?: OscillatorType): void }

type Kind = 'drone' | 'tape' | 'board';
interface Thing { kind: Kind; x: number; y: number; w: number; h: number; vx: number; vy: number; hp: number; t: number; gap?: number }
interface Shot { x: number; y: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; color: string }

const W = 320, H = 240;
const HI_KEY = 'crtvhs.skylane.hi';

export class Game {
  state: 'title' | 'play' | 'over' = 'title';
  private px = W / 2; private py = H - 40;
  private things: Thing[] = []; private shots: Shot[] = []; private sparks: Spark[] = [];
  private score = 0; private lives = 3; private hi = 0;
  private speed = 60; private spawn = 0; private time = 0; private inv = 0; private cool = 0;
  private lastFire = false; private shake = 0;
  private stars = Array.from({ length: 40 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: 0.3 + Math.random() }));
  private towers = Array.from({ length: 10 }, (_, i) => ({ x: (i * 37) % W, w: 16 + Math.random() * 26, h: 40 + Math.random() * 90, side: i % 2 }));

  constructor(private sfx?: GameSfx) {
    try { this.hi = Number(localStorage.getItem(HI_KEY)) || 0; } catch { /* storage blocked */ }
  }

  /** Called every frame while channel 7 is on screen. */
  frame(c: CanvasRenderingContext2D, dt: number, inp: GameInput) {
    dt = Math.min(dt, 0.05);
    const pressed = inp.fire && !this.lastFire;
    this.lastFire = inp.fire;
    if (this.state !== 'play') {
      if (pressed) this.reset();
    } else this.update(dt, inp, pressed);
    this.draw(c);
  }

  private reset() {
    Object.assign(this, { state: 'play', px: W / 2, py: H - 40, score: 0, lives: 3, speed: 60, spawn: 0, time: 0, inv: 1.5 });
    this.things = []; this.shots = []; this.sparks = [];
    this.sfx?.blip(660, 0.08); setTimeout(() => this.sfx?.blip(990, 0.12), 90);
  }

  private update(dt: number, inp: GameInput, pressed: boolean) {
    this.time += dt;
    this.speed = 60 + this.time * 2.2;
    this.px = Math.max(10, Math.min(W - 10, this.px + inp.x * 150 * dt));
    this.py = Math.max(H * 0.45, Math.min(H - 14, this.py - inp.y * 110 * dt));
    this.inv = Math.max(0, this.inv - dt);
    this.cool -= dt;
    this.shake = Math.max(0, this.shake - dt * 4);
    if ((pressed || (inp.fire && this.cool <= 0)) && this.cool <= 0) {
      this.shots.push({ x: this.px, y: this.py - 10 });
      this.cool = 0.22;
      this.sfx?.blip(1400, 0.04, 'square');
    }

    // spawn waves
    this.spawn -= dt;
    if (this.spawn <= 0) {
      const r = Math.random();
      if (r < 0.5) this.things.push({ kind: 'drone', x: 20 + Math.random() * (W - 40), y: -10, w: 14, h: 8, vx: (Math.random() - 0.5) * 40, vy: 0, hp: 1, t: 0 });
      else if (r < 0.8) this.things.push({ kind: 'tape', x: 20 + Math.random() * (W - 40), y: -10, w: 14, h: 8, vx: 0, vy: 0, hp: 1, t: 0 });
      else this.things.push({ kind: 'board', x: 0, y: -12, w: W, h: 8, vx: 0, vy: 0, hp: 99, t: 0, gap: 40 + Math.random() * (W - 120) });
      this.spawn = Math.max(0.35, 1.1 - this.time * 0.012);
    }

    for (const s of this.shots) s.y -= 260 * dt;
    this.shots = this.shots.filter((s) => s.y > -10);
    for (const t of this.things) {
      t.t += dt;
      t.y += (this.speed + (t.kind === 'drone' ? 20 : 0)) * dt;
      if (t.kind === 'drone') { t.x += t.vx * dt + Math.sin(t.t * 4) * 0.6; if (t.x < 10 || t.x > W - 10) t.vx *= -1; }
    }
    // shots vs drones
    for (const s of this.shots) for (const t of this.things) {
      if (t.kind === 'drone' && t.hp > 0 && Math.abs(s.x - t.x) < 9 && Math.abs(s.y - t.y) < 7) {
        t.hp = 0; s.y = -99; this.score += 25; this.burst(t.x, t.y, '#ff4fd8', 12); this.sfx?.blip(220, 0.12, 'sawtooth');
      }
    }
    // player collisions
    for (const t of this.things) {
      if (t.hp <= 0) continue;
      const hitY = Math.abs(t.y - this.py) < (t.h / 2 + 6);
      if (t.kind === 'board') {
        if (hitY && !(this.px > t.gap! && this.px < t.gap! + 56) && this.inv <= 0) this.hurt();
        else if (t.y > this.py + 8 && t.hp === 99) { t.hp = 98; this.score += 5; }
      } else if (hitY && Math.abs(t.x - this.px) < (t.w / 2 + 7)) {
        if (t.kind === 'tape') { t.hp = 0; this.score += 10; this.burst(t.x, t.y, '#ffe14d', 8); this.sfx?.blip(880, 0.06); setTimeout(() => this.sfx?.blip(1320, 0.08), 60); }
        else if (this.inv <= 0) { t.hp = 0; this.burst(t.x, t.y, '#ff4fd8', 10); this.hurt(); }
      }
    }
    this.things = this.things.filter((t) => t.y < H + 20 && (t.hp > 0 || t.kind === 'board'));
    for (const p of this.sparks) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    this.sparks = this.sparks.filter((p) => p.life > 0);
  }

  private hurt() {
    this.lives--; this.inv = 1.6; this.shake = 1;
    this.burst(this.px, this.py, '#3ff0ff', 18);
    this.sfx?.blip(110, 0.35, 'sawtooth');
    if (this.lives <= 0) {
      this.state = 'over';
      if (this.score > this.hi) { this.hi = this.score; try { localStorage.setItem(HI_KEY, String(this.hi)); } catch { /* ignore */ } }
    }
  }

  private burst(x: number, y: number, color: string, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 30 + Math.random() * 90;
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.4, color });
    }
  }

  // ------------------------------------------------------------- drawing
  private draw(c: CanvasRenderingContext2D) {
    c.save();
    if (this.shake > 0) c.translate((Math.random() - 0.5) * 6 * this.shake, (Math.random() - 0.5) * 6 * this.shake);
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#12052a'); g.addColorStop(0.7, '#3a0d4a'); g.addColorStop(1, '#7a1e55');
    c.fillStyle = g; c.fillRect(-4, -4, W + 8, H + 8);
    const scroll = this.state === 'play' ? this.time * this.speed : performance.now() / 1000 * 40;
    for (const s of this.stars) { c.fillStyle = `rgba(255,255,255,${0.3 + s.s * 0.4})`; c.fillRect(s.x, (s.y + scroll * s.s * 0.2) % H, 1, 1); }
    // side towers scrolling down (parallax)
    for (const t of this.towers) {
      const y = ((scroll * 0.6 + t.x * 7) % (H + t.h)) - t.h;
      const x = t.side ? W - t.w * 0.9 : -t.w * 0.1;
      c.fillStyle = '#0c0718'; c.fillRect(x, y, t.w, t.h);
      c.fillStyle = 'rgba(255,190,110,0.55)';
      for (let wy = y + 4; wy < y + t.h - 4; wy += 7) for (let wx = x + 3; wx < x + t.w - 3; wx += 6) if ((wx * 13 + wy * 7) % 5 < 2) c.fillRect(wx, wy, 2, 3);
    }
    // lane markers
    c.fillStyle = 'rgba(63,240,255,0.18)';
    for (let i = 0; i < 12; i++) { const y = (i * 24 + scroll) % H; c.fillRect(W / 2 - 1, y, 2, 10); }

    for (const t of this.things) {
      if (t.kind === 'board') {
        c.fillStyle = '#ff4fd8'; c.fillRect(0, t.y - 4, t.gap!, 8); c.fillRect(t.gap! + 56, t.y - 4, W, 8);
        c.fillStyle = '#fff'; c.font = "10px 'VT323', monospace"; c.textAlign = 'left'; c.textBaseline = 'middle';
        c.fillText('NEO COLA  NEO COLA  NEO COLA', 4, t.y); c.fillText('VIDEO 24H  VIDEO 24H', t.gap! + 60, t.y);
      } else if (t.kind === 'drone' && t.hp > 0) {
        c.fillStyle = '#c9c3d8'; c.fillRect(t.x - 7, t.y - 2, 14, 4);
        c.fillStyle = '#ff2040'; c.fillRect(t.x - 1, t.y - 1, 2, 2);
        c.fillStyle = 'rgba(200,200,255,0.6)'; c.fillRect(t.x - 9 + (t.t * 60) % 4, t.y - 4, 5, 1); c.fillRect(t.x + 4 - (t.t * 60) % 4, t.y - 4, 5, 1);
      } else if (t.kind === 'tape' && t.hp > 0) {
        const b = Math.sin(t.t * 8) * 1;
        c.fillStyle = '#111'; c.fillRect(t.x - 7, t.y - 4 + b, 14, 8);
        c.fillStyle = '#efe6cf'; c.fillRect(t.x - 5, t.y - 3 + b, 10, 3);
        c.fillStyle = 'rgba(255,225,77,0.35)'; c.fillRect(t.x - 9, t.y - 6 + b, 18, 12);
      }
    }
    c.fillStyle = '#3ff0ff';
    for (const s of this.shots) c.fillRect(s.x - 1, s.y - 4, 2, 7);
    for (const p of this.sparks) { c.globalAlpha = Math.max(0, p.life * 2); c.fillStyle = p.color; c.fillRect(p.x, p.y, 2, 2); }
    c.globalAlpha = 1;

    if (this.state === 'play' && (this.inv <= 0 || Math.floor(this.inv * 12) % 2 === 0)) this.drawCar(c, this.px, this.py);

    // HUD
    c.font = "16px 'VT323', monospace"; c.textBaseline = 'top'; c.fillStyle = '#fff';
    c.textAlign = 'left'; c.fillText(`SCORE ${String(this.score).padStart(5, '0')}`, 8, 6);
    c.textAlign = 'right'; c.fillText(`HI ${String(this.hi).padStart(5, '0')}`, W - 8, 6);
    if (this.state === 'play') { c.textAlign = 'center'; c.fillStyle = '#ff4fd8'; c.fillText('♥'.repeat(Math.max(0, this.lives)), W / 2, 6); }
    c.restore();

    if (this.state !== 'play') {
      c.fillStyle = 'rgba(0,0,0,0.45)'; c.fillRect(0, 0, W, H);
      const blink = Math.floor(performance.now() / 500) % 2 === 0;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      if (this.state === 'title') {
        c.fillStyle = '#3ff0ff';
        c.font = "26px 'Press Start 2P', monospace"; c.fillText('SKYLANE', W / 2, H * 0.36);
        c.font = "16px 'VT323', monospace"; c.fillStyle = '#ffe14d';
        c.fillText('Grab tapes · zap drones · dodge billboards', W / 2, H * 0.52);
      } else {
        c.font = "22px 'Press Start 2P', monospace"; c.fillStyle = '#ff4fd8'; c.fillText('GAME OVER', W / 2, H * 0.38);
        c.font = "18px 'VT323', monospace"; c.fillStyle = '#fff'; c.fillText(`SCORE ${this.score}   HI ${this.hi}`, W / 2, H * 0.52);
      }
      c.font = "16px 'VT323', monospace"; c.fillStyle = '#fff';
      if (blink) c.fillText('PRESS FIRE', W / 2, H * 0.68);
      c.fillStyle = 'rgba(255,255,255,0.6)';
      c.fillText('Joystick or arrows/WASD · button or Space', W / 2, H * 0.82);
    }
  }

  private drawCar(c: CanvasRenderingContext2D, x: number, y: number) {
    c.fillStyle = 'rgba(255,79,216,0.35)'; c.fillRect(x - 10, y + 5, 20, 4 + Math.random() * 3); // thruster glow
    c.fillStyle = '#e8e4f0'; c.fillRect(x - 8, y - 3, 16, 7);
    c.fillStyle = '#5ab4ff'; c.fillRect(x - 4, y - 6, 8, 4);
    c.fillStyle = '#ff2040'; c.fillRect(x - 8, y + 2, 3, 2); c.fillRect(x + 5, y + 2, 3, 2);
    c.fillStyle = '#fff8c0'; c.fillRect(x - 7, y - 4, 2, 1); c.fillRect(x + 5, y - 4, 2, 1);
  }
}
