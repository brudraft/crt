import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import { bestLocalAxis, type SceneRefs } from './scene-contract';
import { TapePlayer, type PlayerEvents } from './youtube';
import { drawTestCard, drawNews, drawAds } from './channels';
import type { Game, GameInput } from './game';

export type ScreenMode = 'off' | 'idle' | 'static' | 'video' | 'blank' | 'error' | 'testcard' | 'news' | 'ads' | 'game';

const PX_W = 640, PX_H = 480;
const CANVAS_W = 320, CANVAS_H = 240;
/** CSS3D works in a scaled-up copy of world space so tiny CSS scales don't hit browser precision limits. */
const K = 100;

export class TVScreen {
  readonly player: TapePlayer;
  private css: CSS3DRenderer;
  private cssScene = new THREE.Scene();
  private cssCamera = new THREE.PerspectiveCamera();
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mode: ScreenMode = 'idle';
  private osdText = '';
  private osdUntil = 0;
  private trackingUntil = 0;
  private glitchUntil = 0;
  private lastDraw = 0;
  private noise: ImageData;
  private message = 'INSERT TAPE';
  readonly hole: THREE.Mesh;
  private content: HTMLDivElement;
  private glassMat: THREE.ShaderMaterial;
  private glass: THREE.Mesh;
  private afterglow = 0;
  private lastFrame = performance.now();
  private game: Game | null = null;
  private gameInput: () => GameInput = () => ({ x: 0, y: 0, fire: false });
  private lastGame = 0;
  /** Channel 7: the arcade game draws into the screen canvas. */
  setGame(game: Game, input: () => GameInput) { this.game = game; this.gameInput = input; }
  private powerAnimUntil = 0;
  private powered = true;
  private scene = { level: 0.7, next: 0, tint: new THREE.Color(0.75, 0.85, 1) };

  constructor(scene: THREE.Scene, refs: SceneRefs, cssHost: HTMLElement, events: PlayerEvents) {
    const { w, h } = refs.screenSize;
    refs.screen.visible = false;

    // Screen normal: the ScreenAnchor axis that faces the hero camera. Logged instead of assumed.
    const anchorPos = refs.screenAnchor.getWorldPosition(new THREE.Vector3());
    const toCam = refs.camHero.getWorldPosition(new THREE.Vector3()).sub(anchorPos).normalize();
    const axis = bestLocalAxis(refs.screenAnchor, toCam);
    const normal = axis.world.clone().normalize();
    console.info(`[screen] ScreenAnchor normal = local ${axis.name} → world (${normal.toArray().map((v) => v.toFixed(3))}), ${w}×${h} m`);

    const up = new THREE.Vector3(0, 1, 0).projectOnPlane(normal).normalize();
    const right = new THREE.Vector3().crossVectors(up, normal).normalize();
    const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));

    // The "hole": writes alpha 0 + depth, so the CSS layer behind the canvas shows through exactly here.
    const r = Math.min(w, h) * 0.09;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 + r, -h / 2);
    shape.lineTo(w / 2 - r, -h / 2); shape.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
    shape.lineTo(w / 2, h / 2 - r); shape.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
    shape.lineTo(-w / 2 + r, h / 2); shape.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
    shape.lineTo(-w / 2, -h / 2 + r); shape.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
    const holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, transparent: false, blending: THREE.NoBlending, depthWrite: true });
    holeMat.name = 'M_ScreenHole';
    this.hole = new THREE.Mesh(new THREE.ShapeGeometry(shape, 8), holeMat);
    this.hole.name = 'ScreenHole';
    this.hole.position.copy(anchorPos).addScaledVector(normal, -0.003);
    this.hole.quaternion.copy(quat);
    this.hole.renderOrder = -1;
    scene.add(this.hole);

    // A faint curved-glass sheen on top of the hole (transparent, so it blends over the video).
    const glassGeo = new THREE.PlaneGeometry(w, h, 16, 12);
    const pos = glassGeo.attributes.position as THREE.BufferAttribute;
    const bulge = Number(refs.screen.userData.bulge_m ?? 0.02);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) / (w / 2), y = pos.getY(i) / (h / 2);
      pos.setZ(i, bulge * (1 - 0.5 * (x * x + y * y)) - bulge * 0.5);
    }
    glassGeo.computeVertexNormals();
    // Glass: reflects a cube capture of the room (see captureReflection) with fresnel, plus the phosphor
    // afterglow that lingers after the picture goes off. Clipped to the same rounded rect as the hole.
    this.glassMat = new THREE.ShaderMaterial({
      uniforms: {
        uEnv: { value: null }, uHasEnv: { value: 0 }, uGlow: { value: 0 }, uDim: { value: 1 },
        uSize: { value: new THREE.Vector2(w, h) }, uRadius: { value: r },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform samplerCube uEnv; uniform float uHasEnv; uniform float uGlow; uniform float uDim;
        uniform vec2 uSize; uniform float uRadius;
        varying vec3 vWP; varying vec3 vN; varying vec2 vUv;
        void main() {
          vec2 p = (vUv - 0.5) * uSize;
          vec2 q = abs(p) - (uSize * 0.5 - uRadius);
          if (length(max(q, 0.0)) > uRadius) discard;          // rounded corners like the tube
          vec3 V = normalize(vWP - cameraPosition);
          vec3 n = normalize(vN);
          float fres = pow(1.0 - max(dot(-V, n), 0.0), 2.5);
          vec3 refl = uHasEnv > 0.5 ? textureCube(uEnv, reflect(V, n)).rgb : vec3(0.3);
          float lum = dot(refl, vec3(0.3, 0.59, 0.11));
          // only bright things (window, holograms, ceiling strip) show up clearly in a dark tube
          float a = (0.03 + 0.22 * fres) * uDim + smoothstep(0.35, 1.2, lum) * 0.12 * uDim;
          vec3 col = refl * 1.1;
          // phosphor afterglow: a soft bluish-white blob in the middle that fades out
          float d = length(p / (uSize * 0.5));
          float glow = uGlow * exp(-d * d * mix(18.0, 3.0, uGlow));
          col = mix(col, vec3(0.75, 0.85, 1.0), clamp(glow * 1.5, 0.0, 1.0));
          a = max(a, glow * 0.8);
          gl_FragColor = vec4(col, a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
    });
    this.glassMat.toneMapped = false;
    const glass = new THREE.Mesh(glassGeo, this.glassMat);
    this.glass = glass;
    glass.name = 'ScreenGlassSheen';
    glass.position.copy(anchorPos).addScaledVector(normal, 0.0);
    glass.quaternion.copy(quat);
    glass.renderOrder = 2;
    scene.add(glass);

    // --- CSS3D layer (behind the WebGL canvas) ---
    this.css = new CSS3DRenderer({ element: cssHost as HTMLDivElement });
    const root = document.createElement('div');
    root.className = 'tv-screen';
    root.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_W; this.canvas.height = CANVAS_H;
    this.ctx = this.canvas.getContext('2d')!;
    const overlay = document.createElement('div');
    overlay.className = 'crt-overlay';
    // everything that is "the picture" lives in .tv-content so the CRT power on/off effect can squash it
    this.content = document.createElement('div');
    this.content.className = 'tv-content';
    this.content.append(this.canvas);
    root.append(this.content, overlay);
    const obj = new CSS3DObject(root);
    obj.position.copy(anchorPos).addScaledVector(normal, -0.003).multiplyScalar(K);
    obj.quaternion.copy(quat);
    obj.scale.setScalar((w / PX_W) * K * 1.0);
    // keep 4:3 – CSS div is 640×480, physical screen should be 4:3 too
    obj.scale.y = (h / PX_H) * K;
    this.cssScene.add(obj);

    this.noise = this.ctx.createImageData(CANVAS_W, CANVAS_H);
    this.player = new TapePlayer(this.content, events);
    this.setMode('idle');
  }

  setSize(w: number, h: number) { this.css.setSize(w, h); }

  setMode(mode: ScreenMode, message?: string) {
    this.mode = mode;
    if (message) this.message = message;
    else if (mode === 'idle') this.message = 'INSERT TAPE';
    this.player.setVisible(mode === 'video');
    this.lastDraw = 0;
  }
  getMode() { return this.mode; }

  /** CRT switch-off: the picture collapses to a bright line, then a dot that fades. */
  powerOff(): Promise<void> {
    this.powered = false;
    this.powerAnimUntil = performance.now() + 650;
    setTimeout(() => { this.afterglow = 1; }, 450);
    this.content.classList.remove('crt-on');
    void this.content.offsetWidth; // restart animation
    this.content.classList.add('crt-off');
    return new Promise((r) => setTimeout(r, 650));
  }

  /** CRT switch-on: a line grows out of the centre and opens into the picture. */
  powerOn() {
    this.powered = true;
    this.powerAnimUntil = performance.now() + 550;
    this.content.classList.remove('crt-off');
    void this.content.offsetWidth;
    this.content.classList.add('crt-on');
    setTimeout(() => this.content.classList.remove('crt-on'), 600);
  }

  /**
   * Approximate light the screen throws into the room. The iframe is cross-origin so its pixels can't be
   * read; for video we fake "shots" that change brightness/tint every few seconds plus a fast flicker.
   */
  emission(now: number, out: THREE.Color): number {
    const flick = 0.92 + 0.08 * Math.sin(now * 0.06) * Math.sin(now * 0.017);
    if (now < this.powerAnimUntil) { out.setRGB(0.9, 0.95, 1); return this.powered ? 0.6 : 1.4 * ((this.powerAnimUntil - now) / 650); }
    if (!this.powered) { out.setRGB(0, 0, 0); return 0; }
    switch (this.mode) {
      case 'off': out.setRGB(0, 0, 0); return 0;
      case 'idle': case 'error': out.setRGB(0.15, 0.25, 1); return 0.8 * flick;
      case 'static': case 'blank': out.setRGB(0.85, 0.88, 0.95); return 0.45 + Math.random() * 0.25;
      case 'testcard': out.setRGB(0.8, 0.8, 0.9); return 0.95;
      case 'game': out.setRGB(0.55, 0.25, 0.75); return 0.55 * flick;
      case 'news': out.setRGB(0.35, 0.5, 1.0); return 0.6 * flick;
      case 'ads': { const i = Math.floor(now / 6000) % 3; out.setRGB(...([[1, 0.3, 0.35], [0.45, 0.4, 1], [0.6, 0.6, 0.9]][i] as [number, number, number])); return 0.75 * flick; }
      case 'video': {
        if (now > this.scene.next) {
          this.scene.next = now + 900 + Math.random() * 3800;
          this.scene.level = 0.35 + Math.random() * 0.75;
          const warm = Math.random();
          this.scene.tint.setRGB(0.65 + warm * 0.35, 0.75 + Math.random() * 0.2, 1 - warm * 0.35);
        }
        out.copy(this.scene.tint);
        const glitch = now < this.trackingUntil ? 0.3 * Math.random() : 0;
        return this.scene.level * flick + glitch;
      }
    }
  }

  osd(text: string, ms = 2000) { this.osdText = text; this.osdUntil = performance.now() + ms; this.lastDraw = 0; }
  tracking(ms = 700) { this.trackingUntil = Math.max(this.trackingUntil, performance.now() + ms); }
  glitch(ms = 400) { this.glitchUntil = Math.max(this.glitchUntil, performance.now() + ms); }

  /** Render a small cube map of the room from in front of the screen, for the glass reflection. */
  captureReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
    const rt = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cam = new THREE.CubeCamera(0.05, 200, rt);
    cam.position.copy(this.glass.position).add(new THREE.Vector3(0, 0, 0.06).applyQuaternion(this.glass.quaternion));
    this.glass.visible = false; this.hole.visible = false;
    cam.update(renderer, scene);
    this.glass.visible = true; this.hole.visible = true;
    this.glassMat.uniforms.uEnv.value = rt.texture;
    this.glassMat.uniforms.uHasEnv.value = 1;
  }
  /** Reflections follow the room brightness (dimmed during films). */
  setReflectionLevel(k: number) { this.glassMat.uniforms.uDim.value = k; }

  /** Brief phosphor glow, e.g. when a picture is cut. */
  flashAfterglow(amount = 0.5) { this.afterglow = Math.max(this.afterglow, amount); }

  render(camera: THREE.PerspectiveCamera) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000); this.lastFrame = now;
    if (this.afterglow > 0) { this.afterglow = Math.max(0, this.afterglow - dt * 0.55); }
    this.glassMat.uniforms.uGlow.value = this.afterglow * this.afterglow;
    this.cssCamera.fov = camera.fov;
    this.cssCamera.aspect = camera.aspect;
    this.cssCamera.near = camera.near * K;
    this.cssCamera.far = camera.far * K;
    this.cssCamera.updateProjectionMatrix();
    this.cssCamera.position.copy(camera.position).multiplyScalar(K);
    this.cssCamera.quaternion.copy(camera.quaternion);
    this.cssCamera.updateMatrixWorld();
    this.css.render(this.cssScene, this.cssCamera);
    this.draw();
  }

  // ---------- 2D canvas states ----------
  private draw() {
    const now = performance.now();
    if (this.mode === 'game' && this.game) {            // 60 fps, own timing
      const dt = this.lastGame ? (now - this.lastGame) / 1000 : 0.016;
      this.lastGame = now;
      this.game.frame(this.ctx, dt, this.gameInput());
      if (now < this.osdUntil) this.text(this.osdText, 20, 40, 18, '#7dff8a', 'left', true);
      return;
    }
    this.lastGame = 0;
    const animated = this.mode === 'static' || this.mode === 'blank' || this.mode === 'news' || this.mode === 'ads' || now < this.trackingUntil || now < this.glitchUntil;
    const fps = animated ? 30 : 4; // idle screen still needs the blinking cursor
    if (now - this.lastDraw < 1000 / fps) return;
    this.lastDraw = now;
    const c = this.ctx;
    c.clearRect(0, 0, CANVAS_W, CANVAS_H);

    switch (this.mode) {
      case 'off':
        c.fillStyle = '#000'; c.fillRect(0, 0, CANVAS_W, CANVAS_H);
        break;
      case 'idle':
      case 'error':
        this.drawBlue(now, this.mode === 'error');
        break;
      case 'static':
        this.drawStatic(1);
        break;
      case 'blank':
        this.drawStatic(0.85);
        this.text('NO SIGNAL', CANVAS_W / 2, CANVAS_H / 2, 22, '#fff', 'center');
        break;
      case 'video':
        break; // canvas stays transparent → iframe shows
      case 'testcard': drawTestCard(c, now, CANVAS_W, CANVAS_H); break;
      case 'news': drawNews(c, now, CANVAS_W, CANVAS_H); break;
      case 'ads': drawAds(c, now, CANVAS_W, CANVAS_H); break;
    }
    if (now < this.trackingUntil) this.drawTracking(now);
    if (now < this.glitchUntil) this.drawGlitch();
    if (now < this.osdUntil && this.mode !== 'off') this.text(this.osdText, 20, 26, 20, '#7dff8a', 'left', true);
  }

  private drawBlue(now: number, err: boolean) {
    const c = this.ctx;
    c.fillStyle = err ? '#1a1aa8' : '#0b17c8';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
    const blink = Math.floor(now / 600) % 2 === 0;
    this.text(this.message, CANVAS_W / 2, CANVAS_H / 2 - 4, 24, '#fff', 'center');
    if (!err) this.text(blink ? '▶ ▶ ▶' : '', CANVAS_W / 2, CANVAS_H / 2 + 26, 16, '#fff', 'center');
    this.text('CH 03', CANVAS_W - 20, 26, 18, '#fff', 'right');
  }

  private drawStatic(amount: number) {
    const d = this.noise.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255 * amount) | 0;
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
    // rolling darker band
    const band = (performance.now() / 8) % CANVAS_H | 0;
    for (let y = band; y < Math.min(CANVAS_H, band + 18); y++) {
      for (let x = 0; x < CANVAS_W; x++) { const k = (y * CANVAS_W + x) * 4; d[k] *= 0.5; d[k + 1] *= 0.5; d[k + 2] *= 0.5; }
    }
    this.ctx.putImageData(this.noise, 0, 0);
  }

  private drawTracking(now: number) {
    const c = this.ctx;
    const y0 = (CANVAS_H * 0.7 + Math.sin(now / 90) * 20) | 0;
    for (let i = 0; i < 3; i++) {
      const y = (y0 + i * 9 + Math.random() * 6) % CANVAS_H;
      const h = 3 + Math.random() * 5;
      for (let x = 0; x < CANVAS_W; x += 2) {
        const v = Math.random() * 255 | 0;
        c.fillStyle = `rgba(${v},${v},${v},${0.55 + Math.random() * 0.4})`;
        c.fillRect(x + (Math.random() * 6 - 3), y, 2 + Math.random() * 4, h);
      }
    }
    c.fillStyle = 'rgba(255,255,255,0.05)';
    c.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  private drawGlitch() {
    const c = this.ctx;
    for (let i = 0; i < 6; i++) {
      const y = Math.random() * CANVAS_H, h = 2 + Math.random() * 10;
      c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,0,90' : '0,220,255'},${0.15 + Math.random() * 0.25})`;
      c.fillRect(0, y, CANVAS_W, h);
    }
  }

  private text(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign, shadow = false) {
    const c = this.ctx;
    c.font = `${size}px 'VT323', monospace`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    if (shadow) { c.fillStyle = '#000'; c.fillText(s, x + 2, y + 2); }
    c.fillStyle = color;
    c.fillText(s, x, y);
  }
}
