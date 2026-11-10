import * as THREE from 'three';
import gsap from 'gsap';
import type { SceneRefs } from './scene-contract';
import type { Sfx } from './audio';
import type { Inspector } from './inspect';

/**
 * Things on (and in) the sideboard:
 *  - a table lamp you can switch on and off (warm light + glow on the baked wall/sideboard)
 *  - an answering machine with one old message from Mom (speech synthesis + subtitles)
 *  - a drawer that slides open, with a photo and a letter you can pick up and look at
 * Every clickable object gets `userData.onUse`, which the pointer/crosshair interaction calls.
 */
export interface SideboardHooks { caption(text: string | null): void }

const mat = (color: number, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const additive = (tex: THREE.Texture, color: THREE.ColorRepresentation) => new THREE.MeshBasicMaterial({
  map: tex, color, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});

// ---------------------------------------------------------------- printed things
function photoTexture(front: boolean) {
  const W = 512, H = 600;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#efe9dc'; g.fillRect(0, 0, W, H);
  if (front) {
    // faded beach photo: two figures, one of them bleached out by the sun
    const x = 36, y = 36, w = W - 72, h = H - 170;
    const sky = g.createLinearGradient(0, y, 0, y + h);
    sky.addColorStop(0, '#d9b58f'); sky.addColorStop(0.55, '#e7c9a3'); sky.addColorStop(0.56, '#8aa1a3'); sky.addColorStop(1, '#c9b08a');
    g.fillStyle = sky; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,240,210,0.55)'; g.beginPath(); g.arc(x + w * 0.75, y + h * 0.28, 40, 0, Math.PI * 2); g.fill();
    const fig = (fx: number, s: number, a: number) => {
      g.fillStyle = `rgba(60,45,40,${a})`;
      g.beginPath(); g.arc(fx, y + h * 0.5, 22 * s, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(fx, y + h * 0.72, 38 * s, 70 * s, 0, 0, Math.PI * 2); g.fill();
    };
    fig(x + w * 0.38, 1.05, 0.85);
    fig(x + w * 0.6, 0.95, 0.85);
    // sun-bleached patch over the second face
    const b = g.createRadialGradient(x + w * 0.6, y + h * 0.5, 4, x + w * 0.6, y + h * 0.5, 90);
    b.addColorStop(0, 'rgba(250,240,220,0.95)'); b.addColorStop(1, 'rgba(250,240,220,0)');
    g.fillStyle = b; g.fillRect(x, y, w, h);
    // grain + fade
    for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`; g.fillRect(x + Math.random() * w, y + Math.random() * h, 2, 2); }
    g.fillStyle = 'rgba(255,220,170,0.18)'; g.fillRect(x, y, w, h);
    g.fillStyle = '#2a2a6a'; g.font = "40px 'Permanent Marker', cursive"; g.textAlign = 'center';
    g.fillText('sommer -84', W / 2, H - 70);
  } else {
    g.fillStyle = '#e4dccb'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#26306e'; g.font = "38px 'Permanent Marker', cursive"; g.textAlign = 'left';
    ['Oss to på Lista.', 'Du lovte å komme', 'tilbake neste år.', '', '— M'].forEach((l, i) => g.fillText(l, 50, 120 + i * 62));
    g.fillStyle = 'rgba(120,90,40,0.12)'; g.fillRect(0, 0, W, H);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function letterTexture() {
  const W = 600, H = 800;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f2ecdc'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(80,110,170,0.25)'; g.lineWidth = 2;
  for (let y = 120; y < H - 40; y += 46) { g.beginPath(); g.moveTo(40, y); g.lineTo(W - 40, y); g.stroke(); }
  g.fillStyle = '#1e2a66'; g.font = "34px 'Permanent Marker', cursive";
  const lines = ['Kjære deg,', '', 'Jeg vet du har det travelt.', 'Byen er så stor nå, og', 'alt går så fort.', 'Men det er lov å komme hjem', 'en tur. Jeg har tatt vare på', 'de gamle kassettene dine.', '', 'Glad i deg.', '— Mamma'];
  lines.forEach((l, i) => g.fillText(l, 52, 110 + i * 46));
  // fold lines + coffee stain
  g.strokeStyle = 'rgba(120,100,60,0.25)'; g.lineWidth = 3;
  [H / 3, (2 * H) / 3].forEach((y) => { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); });
  g.strokeStyle = 'rgba(140,90,40,0.3)'; g.lineWidth = 10; g.beginPath(); g.arc(W - 140, H - 160, 60, 0.3, Math.PI * 1.7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

function lcdTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 32;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return { c, t };
}

// ---------------------------------------------------------------- setup
export function setupSideboard(scene: THREE.Scene, refs: SceneRefs, sfx: Sfx, inspector: Inspector, hooks: SideboardHooks) {
  const board = refs.find('Sideboard');
  if (!board) return null;
  const box = new THREE.Box3().setFromObject(board);
  const top = box.max.y, front = box.max.z, back = box.min.z;
  const glow = glowTexture();
  const group = new THREE.Group(); group.name = 'SideboardProps'; scene.add(group);

  // ---------------- lamp
  const lamp = new THREE.Group(); lamp.name = 'Lamp';
  const lampX = box.min.x + 0.22, lampZ = back + 0.18;
  lamp.position.set(lampX, top, lampZ);
  const brass = mat(0xb08d57, 0.35, 0.8);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.025, 28), brass); base.position.y = 0.0125;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.3, 12), brass); stem.position.y = 0.17;
  const shadeMat = new THREE.MeshStandardMaterial({ color: 0xe9dcc0, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffb060, emissiveIntensity: 0 });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.13, 0.16, 32, 1, true), shadeMat); shade.position.y = 0.33;
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.025, 16, 12), new THREE.MeshBasicMaterial({ color: 0x332a20, toneMapped: false })); bulb.position.y = 0.3;
  lamp.add(base, stem, shade, bulb);
  group.add(lamp);
  const lampLight = new THREE.PointLight(0xffb366, 0, 3.2, 1.6);
  lampLight.position.set(lampX, top + 0.3, lampZ);
  scene.add(lampLight);
  // fake bounce on the baked (unlit) sideboard top and the wall behind it
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), additive(glow, 0xffaa55)); pool.rotation.x = -Math.PI / 2; pool.position.set(lampX + 0.1, top + 0.002, lampZ + 0.04);
  const wallGlow = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.4), additive(glow, 0xffa050)); wallGlow.position.set(lampX, top + 0.45, box.min.z - 0.13);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffc070, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  halo.scale.setScalar(0.5); halo.position.set(lampX, top + 0.32, lampZ);
  for (const m of [pool, wallGlow]) { m.raycast = () => {}; m.renderOrder = 3; group.add(m); }
  halo.raycast = () => {}; group.add(halo);
  let lampOn = false;
  const setLamp = (on: boolean) => {
    lampOn = on;
    sfx.click();
    gsap.to(lampLight, { intensity: on ? 2.2 : 0, duration: on ? 0.12 : 0.3 });
    gsap.to(shadeMat, { emissiveIntensity: on ? 0.9 : 0, duration: 0.15 });
    (bulb.material as THREE.MeshBasicMaterial).color.set(on ? 0xfff0c8 : 0x332a20);
    gsap.to(pool.material, { opacity: on ? 0.32 : 0, duration: 0.2 });
    gsap.to(wallGlow.material, { opacity: on ? 0.28 : 0, duration: 0.2 });
    gsap.to(halo.material, { opacity: on ? 0.5 : 0, duration: 0.2 });
  };
  lamp.userData.onUse = () => setLamp(!lampOn);
  lamp.userData.hint = 'Lamp';

  // ---------------- answering machine
  const am = new THREE.Group(); am.name = 'AnsweringMachine';
  am.position.set(box.max.x - 0.2, top, front - 0.14);
  am.rotation.y = -0.25;
  const shell = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.055, 0.15), mat(0x1c1b1f, 0.5));
  shell.position.y = 0.0275;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.004, 0.06), new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.1, transparent: true, opacity: 0.7 }));
  lid.position.set(-0.04, 0.057, -0.02);
  const cassette = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.003, 0.04), mat(0xdedbd0, 0.8)); cassette.position.set(-0.04, 0.054, -0.02);
  const btn = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.025), mat(0xb02020, 0.5)); btn.position.set(0.05, 0.059, 0.03);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff2010, toneMapped: false });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.004, 10, 8), ledMat); led.position.set(0.075, 0.057, -0.045);
  const lcd = lcdTexture();
  const lcdMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.015), new THREE.MeshBasicMaterial({ map: lcd.t, toneMapped: false }));
  lcdMesh.rotation.x = -Math.PI / 2; lcdMesh.position.set(0.045, 0.0556, -0.035);
  const ledHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xff3020, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  ledHalo.scale.setScalar(0.04); ledHalo.position.copy(led.position); ledHalo.raycast = () => {};
  am.add(shell, lid, cassette, btn, led, lcdMesh, ledHalo);
  group.add(am);

  const MESSAGE = [
    'Hei, det er mamma.',
    'Jeg har prøvd å ringe deg flere ganger nå.',
    'Jeg vet du har mye å gjøre, men … du svarer aldri.',
    'Jeg fant de gamle videokassettene dine på loftet. Bursdagen din, og den sommeren på Lista.',
    'Ring meg når du hører dette, vennen. Ha det.',
  ];
  let unheard = true, playing = false;
  const drawLcd = (txt: string) => {
    const g = lcd.c.getContext('2d')!;
    g.fillStyle = '#0d1a0d'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = '#ff4030'; g.font = "28px 'VT323', monospace"; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, 32, 17);
    lcd.t.needsUpdate = true;
  };
  drawLcd('1');
  const voice = () => {
    const vs = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : [];
    return vs.find((v) => /^(nb|no|nn)/i.test(v.lang)) ?? null;
  };
  const playMessages = async () => {
    if (playing) { speechSynthesis?.cancel(); playing = false; hooks.caption(null); return; }
    playing = true;
    sfx.clunk(0.4);
    gsap.to(btn.position, { y: 0.056, duration: 0.05, yoyo: true, repeat: 1 });
    const say = (text: string, ms: number) => new Promise<void>((resolve) => {
      hooks.caption(text);
      const v = voice();
      if (v && typeof SpeechSynthesisUtterance !== 'undefined') {
        const u = new SpeechSynthesisUtterance(text);
        u.voice = v; u.lang = v.lang; u.rate = 0.92; u.pitch = 0.95; u.volume = 0.8;
        u.onend = () => resolve(); u.onerror = () => resolve();
        speechSynthesis.speak(u);
      } else setTimeout(resolve, ms); // no Norwegian voice → subtitles only
    });
    await say(unheard ? 'Du har én ny melding.' : 'Ingen nye meldinger. Gammel melding:', 1800);
    sfx.blip(1000, 0.45, 'sine');
    await new Promise((r) => setTimeout(r, 600));
    for (const line of MESSAGE) { if (!playing) return; await say(line, 1200 + line.length * 55); }
    if (!playing) return;
    sfx.blip(1000, 0.3, 'sine');
    await say('Slutt på meldinger.', 1500);
    hooks.caption(null);
    unheard = false; playing = false;
    drawLcd('0');
  };
  am.userData.onUse = () => { playMessages(); };
  am.userData.hint = 'Answering machine';

  // ---------------- drawer with a photo and a letter
  const drawer = new THREE.Group(); drawer.name = 'Drawer';
  const dw = 0.42, dh = 0.11, dd = 0.32;
  const dx = (box.min.x + box.max.x) / 2 - 0.15, dy = top - 0.1;
  drawer.position.set(dx, dy, front - dd / 2 + 0.006);
  const wood = mat(0x6a3c26, 0.8); // close to the baked sideboard brown under the dynamic lights
  const frontPanel = new THREE.Mesh(new THREE.BoxGeometry(dw, dh, 0.018), wood); frontPanel.position.z = dd / 2;
  const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 14), brass); knob.rotation.x = Math.PI / 2; knob.position.set(0, 0, dd / 2 + 0.018);
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.03, 0.008, dd), mat(0x5a3a26, 0.8)); bottom.position.y = -dh / 2 + 0.01;
  const sideL = new THREE.Mesh(new THREE.BoxGeometry(0.01, dh - 0.02, dd), wood); sideL.position.x = -dw / 2 + 0.02;
  const sideR = sideL.clone(); sideR.position.x = dw / 2 - 0.02;
  const backP = new THREE.Mesh(new THREE.BoxGeometry(dw - 0.03, dh - 0.02, 0.01), wood); backP.position.z = -dd / 2;
  drawer.add(frontPanel, knob, bottom, sideL, sideR, backP);
  group.add(drawer);

  // contents
  const photoFront = photoTexture(true), photoBack = photoTexture(false);
  const photo = new THREE.Group(); photo.name = 'Photo';
  const pf = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.105), new THREE.MeshStandardMaterial({ map: photoFront, roughness: 0.5 }));
  const pb = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.105), new THREE.MeshStandardMaterial({ map: photoBack, roughness: 0.8 }));
  pb.rotation.y = Math.PI; pb.position.z = -0.0005;
  photo.add(pf, pb);
  photo.rotation.set(-Math.PI / 2, 0, 0.3);
  photo.position.set(-0.08, -dh / 2 + 0.016, 0.02);
  const letter = new THREE.Mesh(new THREE.PlaneGeometry(0.105, 0.14), new THREE.MeshStandardMaterial({ map: letterTexture(), roughness: 0.85, side: THREE.DoubleSide }));
  letter.name = 'Letter';
  letter.rotation.set(-Math.PI / 2, 0, -0.15);
  letter.position.set(0.08, -dh / 2 + 0.015, -0.03);
  const batteries = new THREE.Group();
  for (let i = 0; i < 3; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.05, 10), mat(i === 1 ? 0xc8a040 : 0x202020, 0.4, 0.5)); b.rotation.z = Math.PI / 2; b.position.set(0, 0, i * 0.016); batteries.add(b); }
  batteries.position.set(0.0, -dh / 2 + 0.02, 0.1);
  const key = new THREE.Mesh(new THREE.TorusGeometry(0.01, 0.003, 8, 16), mat(0xa08a50, 0.3, 0.9)); key.rotation.x = Math.PI / 2; key.position.set(-0.15, -dh / 2 + 0.016, 0.1);
  drawer.add(photo, letter, batteries, key);

  let open = false;
  const closedZ = drawer.position.z;
  const setDrawer = (o: boolean) => {
    open = o;
    sfx.whirr(0.25);
    gsap.to(drawer.position, { z: closedZ + (o ? 0.24 : 0), duration: 0.45, ease: o ? 'power2.out' : 'power2.in', onComplete: () => sfx.clunk(0.25) });
  };
  for (const part of [frontPanel, knob]) part.userData.onUse = () => setDrawer(!open);
  frontPanel.userData.hint = knob.userData.hint = 'Drawer';
  photo.userData.onUse = () => { if (open) inspector.pickUp(photo, 'An old photo — the back has writing on it', new THREE.Euler(0, 0, 0), 1); };
  letter.userData.onUse = () => { if (open) inspector.pickUp(letter, 'A letter from Mom', new THREE.Euler(0, 0, 0), 1.1); };
  photo.userData.hint = 'Photo'; letter.userData.hint = 'Letter';

  // ---------------- per frame: blinking message LED
  return {
    meshes: [] as THREE.Object3D[],
    root: group,
    update(now: number) {
      const blink = unheard ? (Math.floor(now / 500) % 2 === 0 ? 1 : 0.15) : 0.25;
      ledMat.color.setRGB(blink, 0.05 * blink, 0.03 * blink);
      (ledHalo.material as THREE.SpriteMaterial).opacity = unheard ? blink * 0.9 : 0.1;
    },
  };
}
