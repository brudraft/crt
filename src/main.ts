import * as THREE from 'three';
import gsap from 'gsap';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { validateScene, ContractError, type SceneRefs } from './scene-contract';
import { prepareMaterials, setupLighting } from './lighting';
import { setupCamera, Interaction } from './controls';
import { loadingUI, showContractError, setupUI } from './ui';
import { TVScreen } from './screen';
import { TapeLibrary } from './tapes';
import { VCR, type ButtonName, type KnobName } from './vcr';
import { Sfx } from './audio';
import { setupAtmosphere } from './atmosphere';
import { setupCity } from './city';
import { setupCables } from './cables';
import { setupTVLight } from './tvlight';
import { setupRain } from './rain';
import { setupDust } from './dust';
import { initialTier, QualityGovernor, settingsFor, applyPixelRatio, TIERS, type Tier } from './quality';
import { parseVideoId, fetchTitle } from './youtube';
import { readSharedTapes, shareUrl, copyShareLink } from './share';

// Keep animations on wall-clock time: the VCR state machine awaits them, so a throttled/background tab must not stall them.
gsap.ticker.lagSmoothing(0);

const canvas = document.getElementById('webgl') as HTMLCanvasElement;

// alpha: true + transparent clear → the CSS3D layer behind shows through the screen "hole".
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = null;
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.02, 600);

async function loadScene() {
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  // EXT_texture_webp is handled natively by GLTFLoader (the GLB has no PNG fallback).
  const gltf = await loader.loadAsync('/crt_vhs_scene.glb', (e) => {
    if (e.total) loadingUI.progress((e.loaded / e.total) * 0.9);
  });
  draco.dispose();
  return gltf;
}

async function start() {
  let refs: SceneRefs;
  try {
    const gltf = await loadScene();
    refs = validateScene(gltf.scene, gltf.cameras);
    scene.add(gltf.scene);
  } catch (err) {
    if (err instanceof ContractError) { showContractError(err.checklist); loadingUI.fail('CONTRACT ERROR'); }
    else { console.error(err); loadingUI.fail('LOAD ERROR – see console'); }
    return;
  }

  // Canvas text (labels, OSD, VFD) needs the web fonts before first draw.
  await Promise.allSettled(['20px VT323', '20px "Permanent Marker"', '12px "Press Start 2P"'].map((f) => document.fonts.load(f)));
  scene.updateMatrixWorld(true);

  // Glow is faked with additive halo sprites (atmosphere.ts). pmndrs bloom was tried in milestone 5 and
  // dropped: its blur leaks alpha into the screen hole and greys out the video (see README).
  prepareMaterials(refs.root, 0.7);
  const lights = setupLighting(renderer, scene, refs);
  const rig = setupCamera(camera, canvas, refs);
  const sfx = new Sfx();
  setupCables(scene, refs);
  const city = setupCity(scene, refs); // before atmosphere: it hides the GLB neon signs
  const atmosphere = setupAtmosphere(scene, refs, () => {
    const rec = vcr?.current?.record;
    return {
      title: rec?.title ?? null, state: vcr?.state ?? 'IDLE', time: rec ? tv.player.time() : 0, duration: rec ? tv.player.duration() : 0,
      volume: vcr?.volume ?? 80, channel: vcr?.channel ?? 3, power: vcr?.power ?? true,
    };
  });

  let vcr!: VCR;
  const tv = new TVScreen(scene, refs, document.getElementById('css3d')!, {
    onState: (s) => vcr?.onPlayerState(s),
    onError: (c) => vcr?.onPlayerError(c),
  });
  const tapes = new TapeLibrary(refs, renderer);
  const tvLight = setupTVLight(scene, refs, tv);
  const rain = setupRain(scene, refs, city.horizon);
  const dust = setupDust(scene, refs);

  let userMuted = false;
  let autoMuted = false;
  const ui = setupUI({
    async onAddTape(url, title) {
      const id = parseVideoId(url);
      if (!id) return { ok: false, msg: 'That doesn’t look like a YouTube link.' };
      let t = title ?? (await fetchTitle(id));
      if (!t) {
        if (title === null) return { ok: false, needTitle: true, msg: 'Couldn’t fetch the title – type one, or press REC again for “Untitled tape”.' };
        t = 'Untitled tape';
      }
      await tapes.add(id, t);
      sfx.clunk(0.5);
      return { ok: true, msg: `Recorded “${t}” – it’s on the cart.` };
    },
    onRemoveTape(id) {
      const t = tapes.byId(id);
      if (t) vcr.forget(t);
      tapes.remove(id);
    },
    onPlayTape(id) { const t = tapes.byId(id); if (t) vcr.insert(t); },
    async onShareTape(id) {
      const rec = tapes.byId(id)?.record;
      if (!rec) return;
      const how = await copyShareLink(shareUrl(rec.videoId, rec.title), rec.title);
      ui.say(how === 'copied' ? `Link copied – whoever opens it gets “${rec.title}” in the VCR.` : how === 'shared' ? 'Link shared.' : 'Copy the link from the dialog.');
    },
    onToggleMute() {
      userMuted = !(userMuted || autoMuted);
      autoMuted = false;
      if (userMuted) tv.player.mute(); else tv.player.unMute();
      ui.setMuted(userMuted);
      ui.showUnmuteHint(false);
    },
    onToggleSfx() { ui.setSfx(sfx.toggle()); },
    onHome() { rig.flyHome(); },
    onUnmuteHint() { autoMuted = false; userMuted = false; tv.player.unMute(); ui.setMuted(false); ui.showUnmuteHint(false); },
  });

  vcr = new VCR(refs, tv, tapes, sfx, {
    onState: (s) => tvLight.setFilmMode(s === 'PLAYING'),
    onChannelAudio(on) {
      if (!on) tv.player.mute();
      else if (!(userMuted || autoMuted)) tv.player.unMute();
    },
    onMutedFallback(muted) {
      autoMuted = muted && !userMuted;
      if (userMuted) tv.player.mute();
      ui.setMuted(userMuted || autoMuted);
      ui.showUnmuteHint(autoMuted);
    },
  });
  vcr.attachHalos(atmosphere.ledHalo, atmosphere.displayHalo);

  // Interaction: raycast against hero meshes (interactive + occluders).
  const occluders: THREE.Object3D[] = [];
  for (const n of ['TV_Root', 'Cart']) refs.get(n).traverse((o) => { if ((o as THREE.Mesh).isMesh) occluders.push(o); });
  const interaction = new Interaction(camera, canvas, rig.controls, {
    tapeAt: (o) => tapes.byNode(o)?.node ?? null,
    canDrag: (node) => { const t = tapes.byNode(node); return !!t?.record && !t.node.userData.busy && !vcr.busy; },
    onHoverTape: (node) => tapes.setHighlight(node ? tapes.byNode(node) ?? null : null),
    onDragStart: (node) => { gsap.killTweensOf(node.position); vcr.beginDrag(); },
    onDragMove: (_node, near) => vcr.hoverSlot(near),
    onDrop: (node, near) => {
      const t = tapes.byNode(node)!;
      vcr.hoverSlot(false);
      if (near) vcr.insert(t);
      else { vcr.cancelDrag(); tapes.returnHome(t, 0.6); }
    },
    onTapeClick: (node) => { const t = tapes.byNode(node); if (t) vcr.insert(t); },
    onButton: (n) => vcr.press(n as ButtonName),
    onKnobDrag: (n, d) => vcr.setKnob(n as KnobName, vcr.knobAngle(n as KnobName) + d),
    onKnobClick: (n) => vcr.stepKnob(n as KnobName),
    onTVDoubleClick: () => rig.flyHome(),
    slotWorld: () => vcr.slotWorld(),
    setCursor: (c) => ui.setCursor(c),
  });
  const refreshTargets = () => interaction.setTargets([...occluders, tv.hole, ...tapes.interactiveMeshes()]);

  // Keyboard: transport controls when focus isn't in a text field.
  addEventListener('keydown', (e) => {
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, button, select') || e.ctrlKey || e.metaKey || e.altKey) return;
    const map: Record<string, ButtonName> = { ' ': 'Btn_Play', k: 'Btn_Play', s: 'Btn_Stop', e: 'Btn_Eject', ArrowRight: 'Btn_FF', ArrowLeft: 'Btn_Rew', p: 'Btn_Power' };
    const b = map[e.key];
    if (b) { e.preventDefault(); vcr.press(b); }
    else if (e.key === 'm') ui.toggleMute();
    else if (e.key === 'h') rig.flyHome();
  });

  tapes.setOnChange(() => {
    ui.setTapes(tapes.list().map((r) => ({ id: r.id, title: r.title })));
    refreshTargets();
  });
  await tapes.sync();

  // Shared link (?v=…): make sure those tapes exist (reusing ones already in the library).
  const shared = readSharedTapes();
  for (const s of shared) {
    if (tapes.byVideoId(s.videoId)) continue;
    const title = s.title ?? (await fetchTitle(s.videoId)) ?? 'Untitled tape';
    await tapes.add(s.videoId, title);
  }

  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    rig.resize(w, h);
    tv.setSize(w, h);
  };
  addEventListener('resize', resize);
  resize();

  // Compile + upload before revealing to avoid a first-frame hitch.
  await renderer.compileAsync(scene, camera);
  tv.captureReflection(renderer, scene); // static cube map of the room for the screen glass
  loadingUI.progress(1);
  loadingUI.done();

  // …and load the first shared tape straight into the VCR. Without a user gesture the browser usually
  // only allows muted playback, so the unmute button appears.
  const first = shared[0] && tapes.byVideoId(shared[0].videoId);
  if (first) {
    ui.say(`Shared tape: “${first.record!.title}”`);
    setTimeout(() => vcr.insert(first), 900);
  }

  // ---- quality tiers (manual via ⚙ button / ?quality=, automatic step-down when frames get slow)
  const LABEL: Record<Tier, string> = { high: 'HQ', medium: 'MQ', low: 'LQ' };
  const applyTier = (tier: Tier, reason: string) => {
    const s = settingsFor(tier);
    applyPixelRatio(renderer, s.pixelRatio);
    dust.setDensity(s.dust);
    rain.setDensity(s.rain);
    atmosphere.setHoloInterval(s.holoInterval);
    ui.setQuality(LABEL[tier], tier);
    if (reason === 'auto') ui.say(`Lowered graphics quality to ${tier} to keep things smooth.`);
  };
  const initial = initialTier();
  const governor = new QualityGovernor(initial.tier, initial.locked, applyTier);
  applyTier(initial.tier, "init");
  ui.onQuality(() => governor.set(TIERS[(TIERS.indexOf(governor.tier) + 1) % TIERS.length], true));

  // ---- one failing subsystem must not kill the render loop: log once, keep going
  const failed = new Set<string>();
  const safe = (name: string, fn: () => void) => {
    try { fn(); } catch (e) { if (!failed.has(name)) { failed.add(name); console.error(`[loop] ${name} failed`, e); } }
  };

  const timer = new THREE.Timer();
  timer.connect(document);
  const frame = () => {
    timer.update();
    const t = timer.getElapsed(), dt = timer.getDelta(), now = performance.now();
    governor.frame(dt);
    safe('interaction', () => interaction.update());
    rig.update();
    safe('lights', () => lights.update(t));
    safe('atmosphere', () => atmosphere.update(t));
    safe('city', () => city.update(t));
    safe('rain', () => rain.update(t));
    safe('tvLight', () => { tvLight.update(now, dt); tv.setReflectionLevel(tvLight.state.dim); });
    safe('dust', () => dust.update(t, renderer.domElement.height * 0.5, tvLight.state.k, tvLight.state.color, tvLight.state.dim));
    safe('vcr', () => vcr.update(now));
    renderer.render(scene, camera);
    safe('screen', () => tv.render(camera));
  };
  renderer.setAnimationLoop(frame);

  // ---- stop rendering in background tabs (battery); the video keeps playing in its iframe
  document.addEventListener('visibilitychange', () => {
    renderer.setAnimationLoop(document.hidden ? null : frame);
  });

  // ---- GPU reset / driver crash: tell the user instead of freezing on a black canvas
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    ui.showFatal('The graphics card was reset. Reload to continue — your tapes are saved.');
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  Object.assign(window as any, { __app: { scene, camera, renderer, refs, rig, tv, tapes, vcr, interaction, governor } });
}

start();
