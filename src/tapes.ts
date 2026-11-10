import * as THREE from 'three';
import gsap from 'gsap';
import type { SceneRefs } from './scene-contract';
import { thumbUrl } from './youtube';

export interface TapeRecord { id: string; videoId: string; title: string; createdAt: number }

export interface Tape {
  /** null = blank GLB decor tape. */
  record: TapeRecord | null;
  node: THREE.Object3D;
  meshes: THREE.Mesh[];
  labelMat: THREE.MeshStandardMaterial;
  spineMat: THREE.MeshStandardMaterial;
  home: { pos: THREE.Vector3; quat: THREE.Quaternion };
  isClone: boolean;
  glbIndex: number; // 0..4 for VHS_Tape_0X, -1 for clones
  glbHome: { pos: THREE.Vector3; quat: THREE.Quaternion };
}

/** Placeholder textures from the GLB (kept outside userData: Material.clone JSON-copies userData). */
const placeholders = new WeakMap<THREE.Material, THREE.Texture | null>();

const STORAGE_KEY = 'crtvhs.tapes.v1';

function loadLibrary(): TapeRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.videoId === 'string') : [];
  } catch { return []; }
}
function saveLibrary(list: TapeRecord[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* private mode / quota */ }
}

const uid = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36));

/** Deterministic pseudo-random from a string, for per-tape label variation. */
function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }

// ---------------------------------------------------------------- label art
function loadThumb(id: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'strict-origin-when-cross-origin';
    const to = setTimeout(() => resolve(null), 6000);
    img.onload = () => { clearTimeout(to); resolve(img); };
    img.onerror = () => { clearTimeout(to); resolve(null); };
    img.src = thumbUrl(id);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (ctx.measureText(t).width <= maxW) cur = t;
    else { if (cur) lines.push(cur); cur = w; }
    if (lines.length === maxLines) break;
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    let last = lines[maxLines - 1];
    while (ctx.measureText(last + '…').width > maxW && last.length > 1) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
  }
  return lines;
}

function paperBase(ctx: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  ctx.fillStyle = '#efe6cf';
  ctx.fillRect(0, 0, w, h);
  // worn/aged: speckle + soft stains + scuffed edges
  let s = seed * 1e6;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(90,70,40,${rnd() * 0.08})`;
    ctx.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let i = 0; i < 4; i++) {
    const g = ctx.createRadialGradient(rnd() * w, rnd() * h, 2, rnd() * w, rnd() * h, 40 + rnd() * 90);
    g.addColorStop(0, 'rgba(150,110,50,0.10)'); g.addColorStop(1, 'rgba(150,110,50,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }
  const edge = ctx.createLinearGradient(0, 0, 0, h);
  edge.addColorStop(0, 'rgba(80,60,30,0.18)'); edge.addColorStop(0.08, 'rgba(0,0,0,0)');
  edge.addColorStop(0.92, 'rgba(0,0,0,0)'); edge.addColorStop(1, 'rgba(80,60,30,0.22)');
  ctx.fillStyle = edge; ctx.fillRect(0, 0, w, h);
  return rnd;
}

const STRIPES = [['#e2462f', '#f6a623', '#2f6fe2'], ['#1f9e7a', '#f2c94c', '#e2462f'], ['#7b3fe4', '#ff4fd8', '#3ff0ff'], ['#222', '#e2462f', '#f6a623']];

async function drawLabel(rec: TapeRecord | null): Promise<HTMLCanvasElement> {
  const W = 512, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const seed = hash(rec?.id ?? 'blank');
  const rnd = paperBase(ctx, W, H, seed);
  const stripes = STRIPES[Math.floor(seed * STRIPES.length)];

  // retro header stripes
  stripes.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(0, 10 + i * 9, W, 6); });
  ctx.font = "16px 'Press Start 2P', monospace"; ctx.fillStyle = '#2a2420'; ctx.textBaseline = 'top';
  ctx.fillText('VHS', 14, 44);
  ctx.textAlign = 'right'; ctx.fillText('T-120  SP', W - 14, 44); ctx.textAlign = 'left';

  if (!rec) {
    // blank tape: ruled lines only
    ctx.strokeStyle = 'rgba(60,80,140,0.35)'; ctx.lineWidth = 2;
    for (let y = 110; y < H - 20; y += 34) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(W - 20, y); ctx.stroke(); }
    return c;
  }

  const thumb = await loadThumb(rec.videoId);
  let textX = 20;
  if (thumb) {
    // Taped-on polaroid-ish thumbnail; hqdefault is 4:3 with letterbox bars → crop the middle 16:9.
    const tw = 200, th = 150;
    ctx.save();
    ctx.translate(26 + tw / 2, 74 + th / 2);
    ctx.rotate((rnd() - 0.5) * 0.08);
    ctx.fillStyle = '#fbf8ef'; ctx.fillRect(-tw / 2 - 6, -th / 2 - 6, tw + 12, th + 12);
    const sy = thumb.naturalHeight * 0.125, sh = thumb.naturalHeight * 0.75;
    try {
      ctx.drawImage(thumb, 0, sy, thumb.naturalWidth, sh, -tw / 2, -th / 2, tw, th);
      ctx.getImageData(0, 0, 1, 1); // throws if the canvas got tainted (no CORS) → text-only label
      ctx.fillStyle = 'rgba(255,220,150,0.12)'; ctx.fillRect(-tw / 2, -th / 2, tw, th); // faded print
      textX = 26 + tw + 22;
    } catch {
      textX = 20;
    }
    ctx.restore();
    if (textX === 20) { // tainted: redraw a clean canvas
      return drawLabel({ ...rec, videoId: '__nothumb__' }).then((cc) => cc);
    }
    // bit of masking tape
    ctx.fillStyle = 'rgba(240,230,190,0.75)';
    ctx.save(); ctx.translate(40, 78); ctx.rotate(-0.6); ctx.fillRect(-20, -8, 40, 16); ctx.restore();
  }

  // Handwritten title in marker
  const maxW = W - textX - 18;
  let size = 40;
  let lines: string[] = [];
  for (; size >= 22; size -= 3) {
    ctx.font = `${size}px 'Permanent Marker', cursive`;
    lines = wrap(ctx, rec.title, maxW, thumb ? 3 : 2);
    if (lines.length * size * 1.05 <= (H - 92)) break;
  }
  ctx.fillStyle = '#1b1f5c';
  ctx.textBaseline = 'top';
  const top = 80 + Math.max(0, ((H - 92) - lines.length * size * 1.05) / 2);
  lines.forEach((l, i) => {
    ctx.save();
    ctx.translate(textX, top + i * size * 1.05);
    ctx.rotate((rnd() - 0.5) * 0.04);
    ctx.fillText(l, 0, 0);
    ctx.restore();
  });
  return c;
}

function drawSpine(rec: TapeRecord | null): HTMLCanvasElement {
  const W = 512, H = 64;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  const seed = hash(rec?.id ?? 'blank');
  paperBase(ctx, W, H, seed);
  const stripes = STRIPES[Math.floor(seed * STRIPES.length)];
  stripes.forEach((col, i) => { ctx.fillStyle = col; ctx.fillRect(6 + i * 10, 0, 6, H); });
  if (rec) {
    let size = 40;
    ctx.textBaseline = 'middle';
    for (; size > 18; size -= 2) { ctx.font = `${size}px 'Permanent Marker', cursive`; if (ctx.measureText(rec.title).width < W - 60) break; }
    let t = rec.title;
    while (ctx.measureText(t).width > W - 60 && t.length > 1) t = t.slice(0, -2) + '…';
    ctx.fillStyle = '#1b1f5c';
    ctx.fillText(t, 46, H / 2 + 2);
  }
  return c;
}

function toTexture(c: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // glTF UV convention
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}

// ---------------------------------------------------------------- library + scene tapes
export class TapeLibrary {
  readonly tapes: Tape[] = [];
  private records: TapeRecord[] = loadLibrary();
  private shelfY: number;
  private onChange: () => void = () => {};
  private tplLabelMap: THREE.Texture | null;
  private tplSpineMap: THREE.Texture | null;

  constructor(private refs: SceneRefs, private renderer: THREE.WebGLRenderer) {
    refs.tapeTemplate.visible = false;
    this.tplLabelMap = ((refs.get('VHS_Label') as THREE.Mesh).material as THREE.MeshStandardMaterial).map;
    this.tplSpineMap = ((refs.get('VHS_Spine') as THREE.Mesh).material as THREE.MeshStandardMaterial).map;
    this.shelfY = refs.get('Cart_TopShelf_Ref').getWorldPosition(new THREE.Vector3()).y;
    refs.glbTapes.forEach((node, i) => this.tapes.push(this.wrapNode(node, false, i)));
  }

  setOnChange(fn: () => void) { this.onChange = fn; }
  list() { return this.records.slice(); }
  byNode(o: THREE.Object3D): Tape | undefined {
    let n: THREE.Object3D | null = o;
    while (n) { const t = this.tapes.find((tp) => tp.node === n); if (t) return t; n = n.parent; }
    return undefined;
  }
  byId(id: string) { return this.tapes.find((t) => t.record?.id === id); }
  byVideoId(videoId: string) { return this.tapes.find((t) => t.record?.videoId === videoId); }
  /** Meshes of tapes that carry a recording (interactive). */
  interactiveMeshes(): THREE.Mesh[] { return this.tapes.filter((t) => t.record).flatMap((t) => t.meshes); }

  private wrapNode(node: THREE.Object3D, isClone: boolean, glbIndex: number): Tape {
    const meshes: THREE.Mesh[] = [];
    let labelMat!: THREE.MeshStandardMaterial, spineMat!: THREE.MeshStandardMaterial;
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes.push(m);
      if ((m.material as THREE.Material).userData.__own) { m.material = (m.material as THREE.Material).clone(); }
      // Clone label/spine materials per tape so each gets its own texture.
      if (/_?Label$/.test(m.name)) { labelMat = (m.material as THREE.MeshStandardMaterial).clone(); m.material = labelMat; }
      if (/_?Spine$/.test(m.name)) { spineMat = (m.material as THREE.MeshStandardMaterial).clone(); m.material = spineMat; }
    });
    // Placeholder = the untouched template's texture (a clone of a recorded tape would otherwise share its canvas).
    labelMat.map = this.tplLabelMap; spineMat.map = this.tplSpineMap;
    placeholders.set(labelMat, this.tplLabelMap);
    placeholders.set(spineMat, this.tplSpineMap);
    labelMat.userData.__own = true; spineMat.userData.__own = true;
    return {
      record: null, node, meshes, labelMat, spineMat, isClone, glbIndex,
      home: { pos: node.position.clone(), quat: node.quaternion.clone() },
      glbHome: { pos: node.position.clone(), quat: node.quaternion.clone() },
    };
  }

  /** Home transform for the n-th recorded tape (top shelf, two stacks to the right of the TV). */
  private slot(n: number): { pos: THREE.Vector3; quat: THREE.Quaternion } | null {
    if (n < 3) return null; // use GLB tape 01–03 own transforms
    const j = n - 3;
    const stackB = j % 2 === 0;
    const level = stackB ? Math.floor(j / 2) : 3 + Math.floor(j / 2);
    const x = stackB ? 0.4 : 0.395, z = stackB ? -0.075 : 0.085;
    const parent = this.refs.glbTapes[0].parent!;
    const world = new THREE.Vector3(x, this.shelfY + 0.0125 + level * 0.025, z);
    const pos = parent.worldToLocal(world.clone());
    const yaw = (hash('slot' + n) - 0.5) * 0.2;
    return { pos, quat: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw) };
  }

  /** Build/refresh scene tapes from the record list. */
  async sync() {
    // free tapes that no longer have a record
    const wanted = new Set(this.records.map((r) => r.id));
    for (const t of this.tapes.slice()) {
      if (t.record && !wanted.has(t.record.id)) this.release(t);
    }
    const tasks: Promise<void>[] = [];
    this.records.forEach((rec, n) => {
      let tape = this.byId(rec.id);
      if (!tape) {
        // record onto GLB tape 01–03 if blank, else clone VHS_Tape_01
        const glb = n < 3 ? this.tapes.find((t) => !t.isClone && t.glbIndex === 2 - n && !t.record) : undefined; // fill the stack top-down so labels show
        if (glb) tape = glb;
        else {
          const src = this.refs.glbTapes[0];
          const node = src.clone(true);
          node.name = 'VHS_Tape_' + rec.id.slice(0, 6);
          src.parent!.add(node);
          tape = this.wrapNode(node, true, -1);
          this.tapes.push(tape);
        }
        tape.record = rec;
        tasks.push(this.paint(tape));
      }
      const s = this.slot(n);
      if (s) { tape.home.pos.copy(s.pos); tape.home.quat.copy(s.quat); }
      else if (!tape.isClone) { tape.home.pos.copy(tape.glbHome.pos); tape.home.quat.copy(tape.glbHome.quat); }
      if (!tape.node.userData.busy) {
        if (tape.node.userData.placed) {
          gsap.to(tape.node.position, { x: tape.home.pos.x, y: tape.home.pos.y, z: tape.home.pos.z, duration: 0.5, ease: 'power2.out' });
          tape.node.quaternion.copy(tape.home.quat);
        } else {
          tape.node.position.copy(tape.home.pos).add(new THREE.Vector3(0, 0.12, 0));
          tape.node.quaternion.copy(tape.home.quat);
          tape.node.visible = true;
          gsap.to(tape.node.position, { y: tape.home.pos.y, duration: 0.6, ease: 'bounce.out' });
          tape.node.userData.placed = true;
        }
      }
    });
    await Promise.all(tasks);
    this.onChange();
  }

  private async paint(t: Tape) {
    const [label, spine] = [await drawLabel(t.record), drawSpine(t.record)];
    this.setMap(t.labelMat, toTexture(label, this.renderer));
    this.setMap(t.spineMat, toTexture(spine, this.renderer));
  }

  private setMap(mat: THREE.MeshStandardMaterial, tex: THREE.Texture | null) {
    if (mat.map && mat.map !== placeholders.get(mat)) mat.map.dispose();
    mat.map = tex;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  }

  private release(t: Tape) {
    gsap.killTweensOf(t.node.position);
    if (t.isClone) {
      t.node.removeFromParent();
      if (t.labelMat.map) t.labelMat.map.dispose();
      if (t.spineMat.map) t.spineMat.map.dispose();
      t.labelMat.dispose(); t.spineMat.dispose();
      this.tapes.splice(this.tapes.indexOf(t), 1);
    } else {
      t.record = null;
      this.setMap(t.labelMat, placeholders.get(t.labelMat) ?? null);
      this.setMap(t.spineMat, placeholders.get(t.spineMat) ?? null);
      t.home.pos.copy(t.glbHome.pos); t.home.quat.copy(t.glbHome.quat);
      t.node.position.copy(t.glbHome.pos);
      t.node.quaternion.copy(t.glbHome.quat);
      t.node.visible = true;
    }
  }

  async add(videoId: string, title: string): Promise<TapeRecord> {
    const rec: TapeRecord = { id: uid(), videoId, title, createdAt: Date.now() };
    this.records.push(rec);
    saveLibrary(this.records);
    await this.sync();
    return rec;
  }

  async remove(id: string) {
    this.records = this.records.filter((r) => r.id !== id);
    saveLibrary(this.records);
    await this.sync();
  }

  /** Animate a tape back to its shelf spot. */
  returnHome(t: Tape, duration = 0.8) {
    t.node.visible = true;
    const p = t.home.pos, q = t.home.quat.clone();
    const startQ = t.node.quaternion.clone();
    const k = { v: 0 };
    return gsap.timeline()
      .to(t.node.position, { x: p.x, y: p.y + 0.08, z: p.z, duration: duration * 0.7, ease: 'power2.inOut' }, 0)
      .to(k, { v: 1, duration: duration * 0.7, onUpdate: () => t.node.quaternion.slerpQuaternions(startQ, q, k.v) }, 0)
      .to(t.node.position, { y: p.y, duration: duration * 0.3, ease: 'power2.in' });
  }

  /** Spine/shell hover highlight. */
  setHighlight(t: Tape | null) {
    for (const tp of this.tapes) {
      const on = tp === t;
      for (const m of tp.meshes) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats as THREE.MeshStandardMaterial[]) {
          if (!mat.emissive) continue;
          if (on && !mat.userData.__hl) {
            // clone shared shell material for this tape before tinting
            if (!mat.userData.__own) {
              const own = mat.clone(); own.userData.__own = true; m.material = own;
              own.emissive.set(0x3ff0ff); own.emissiveIntensity = 0.18; own.userData.__hl = true;
              continue;
            }
            mat.emissive.set(0x3ff0ff); mat.emissiveIntensity = 0.18; mat.userData.__hl = true;
          } else if (!on && mat.userData.__hl) {
            mat.emissive.set(0x000000); mat.emissiveIntensity = 1; mat.userData.__hl = false;
          }
        }
      }
    }
  }
}
