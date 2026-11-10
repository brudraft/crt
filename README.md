# CRT VHS Room

An orbitable retro apartment with a CRT TV/VCR combo. Paste YouTube links to "record" VHS tapes,
drag a tape into the slot (or click it) and the video plays on the TV screen.

Vite + TypeScript + vanilla Three.js (r187), GSAP for tweens, YouTube IFrame Player API.

## Run

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Other scripts:

| Script | What it does |
|---|---|
| `npm run build` | Type-check and build to `dist/` (the GLB is copied as-is from `public/`) |
| `npm run preview` | Serve the production build |
| `npm run check:glb` | Validate `public/crt_vhs_scene.glb` against the scene contract (exit code 1 on failure) |

You can also run the checker on another file: `node scripts/check-glb.mjs path/to/other.glb`.

## Using it

- **Record a tape:** paste a YouTube link (watch, youtu.be, shorts, embed or live URL) and press REC.
  The title comes from YouTube oEmbed. If that is blocked, the form asks for a title, and pressing REC
  again without one saves it as "Untitled tape". The label shows the thumbnail (text only if the image
  can't be loaded with CORS) and the title in marker.
- **Play:** drag a tape to the slot under the screen, click it, or use ▶ in the tape list.
- **TV buttons** (click the meshes): Play/Pause, Stop, FF/Rew (±10 s with tracking noise), Eject, Power.
  **Knobs** turn when you drag or click them. Volume sets the player volume. The VCR outputs on channel 3,
  CH 4 is a test card, CH 5 news, CH 6 adverts, and the rest is snow. Off channel 3 the tape keeps running with the sound off.
- **Keys** (when focus isn't in the form): Space/K play/pause, ←/→ rew/ff, S stop, E eject, P power, M mute, H home view.
- **Double-click the TV** (or press ⌂ VIEW) to fly back to `Cam_Hero`.
- Sound: the app tries to play with sound, because the drag or click counts as a user gesture. If the
  browser blocks that, it plays muted and shows an unmute button. SFX are procedural WebAudio and off by default.
- **Share a tape:** 🔗 in the tape list copies a link like `https://your-site/?v=wzhdzE0I8qI&title=…`.
  Whoever opens it gets the tape added to their cart and loaded into the VCR automatically. Without a
  click, browsers usually only allow muted autoplay, so the unmute button appears. `v` takes an ID or
  any YouTube URL and can be repeated (`?v=ID1&v=ID2`). Only the first tape is loaded; `title` is optional
  (otherwise oEmbed is used). Tapes that are already in the library are reused, not duplicated.
- The tape library is saved in `localStorage` (`crtvhs.tapes.v1`). ✕ erases a tape and frees its textures.

## Architecture

| File | Role |
|---|---|
| `src/main.ts` | Renderer (alpha, sRGB, ACES), GLB loading (GLTF + Draco + Meshopt, WebP native), wiring, render loop |
| `src/contract.json` | The scene contract, shared by the app and the CLI checker |
| `src/scene-contract.ts` | Validates the loaded scene, shows a checklist overlay on failure, resolves refs |
| `src/lighting.ts` | Turns the baked emission-only room into unlit `MeshBasicMaterial` (`toneMapped = false`); adds dynamic lights for hero objects |
| `src/controls.ts` | OrbitControls clamped to the room, fly-home, raycast pointer interaction (drag, buttons, knobs) |
| `src/screen.ts` | Screen "hole" + CSS3D layer (2D canvas states, YouTube iframe, CRT overlay) |
| `src/youtube.ts` | ID parsing, oEmbed, IFrame API loader, `TapePlayer` (autoplay with muted fallback) |
| `src/tapes.ts` | Tape library, persistence, label/spine canvas art, shelf layout, hover highlight |
| `src/vcr.ts` | State machine `IDLE → DRAGGING → INSERTING → LOADING → PLAYING ⇄ PAUSED → EJECTING → IDLE`, buttons, knobs, VFD display, LED |
| `src/atmosphere.ts` | Halo sprites (fake glow), animated holograms (~10 fps), flying car loop, neon flicker |
| `src/city.ts` | Procedural skyline replacing the GLB city layers (shader windows, rooftops, neon, beacons, traffic, sky clouds/stars) |
| `src/tvlight.ts` | Light from the screen on the room (rect light + floor/shelf light pools) and room dimming during playback |
| `src/rain.ts` | Rain drops/trails on the window glass and falling streaks outside |
| `src/cables.ts` | RCA cables routed into front-AV jacks on the TV's side |
| `src/channels.ts` | TV channels on the screen canvas: CH 4 test card, CH 5 news, CH 6 adverts |
| `src/dust.ts` | Dust motes in the window light, under the ceiling strip and in the TV beam |
| `src/audio.ts` | Procedural SFX: clunk, whirr, static |
| `src/ui.ts` | Loading screen, form, tape list, mute/SFX/home buttons |

### The screen hole

The WebGL canvas is transparent (`alpha: true`, clear alpha 0, `scene.background = null`) and sits **above**
a `CSS3DRenderer` layer. At `ScreenAnchor` a rounded-rect mesh is drawn with `NoBlending`, opacity 0 and
depth write on. It punches alpha 0 into the framebuffer, so the CSS layer behind it shows through only
there, and anything in front of the screen (such as a tape) still covers it. The CSS3D scene runs at
100× world scale so the tiny CSS transforms don't run into browser precision limits. The iframe sits
behind the 2D canvas, the CRT overlay and the WebGL canvas, so it never receives clicks. Playback goes
only through the IFrame API (`youtube-nocookie.com`, `controls=0`, `disablekb=1`,
`referrerpolicy=strict-origin-when-cross-origin`).

**No post-processing.** pmndrs `postprocessing` bloom was tried in milestone 5. Plain `BloomEffect` (HalfFloat
buffers) sometimes keeps the hole, but during playback the blur leaks alpha into it and greys out the video.
`SelectiveBloomEffect` fills the hole completely. So glow comes from additive halo sprites at the neon
signs (clustered from the sign meshes), `LED_Power`, `VCR_Display` and the flying car. The optional floor
reflector was not added: it would need a second scene render.

## Scene contract

Validated at load (`src/scene-contract.ts`) and by `npm run check:glb`. Names come from the Blender
export. Where the original brief and `crt_vhs_scene_report.md` disagree, the report wins.

**Required nodes:** `OrbitTarget`, `Cam_Hero` (with a camera), `TV_Root`, `Screen`, `ScreenAnchor`,
`VHS_Slot_Anchor`, `VHS_Slot_Inside_Anchor`, `VHS_Flap`, `Btn_Eject/Play/Stop/FF/Rew/Power`,
`Knob_Channel`, `Knob_Volume`, `VCR_Display`, `LED_Power`, `VHS_Tape_Root` (template, with `VHS_Label`,
`VHS_Spine`), `VHS_Tape_01`–`05` (each with `_Label`, `_Spine`, `_Shell`), `Cart_TopShelf_Ref`,
`Cart_LowerShelf_Ref`, `Holo_Calendar/Energy/Network/Chart`, `FlyingCar`, `City_Neon_Signs`,
`Ceiling_LED_Strip`, `Window_Glass`.

**Required extras:** `Screen.screen_width_m` / `screen_height_m` (4:3), `VHS_Flap.open_rotation_deg`,
`Btn_*.push_depth_m`.

**Required materials:** `M_VHS_Label`, `M_VHS_Spine`, `M_Display`, `M_LED_Red`. Textures must be WebP via
`EXT_texture_webp`. There is no PNG fallback, so never strip WebP in an optimisation step.

**Orientation** is measured at runtime and logged to the console, not assumed:

- Screen normal: the `ScreenAnchor` axis that faces `Cam_Hero` (local **+Y** in the current GLB).
- Insertion direction: `VHS_Slot_Anchor → VHS_Slot_Inside_Anchor`, checked against the anchor's local **−Z** (dot = 1.000).
- Flap: the sign of the local-X rotation that moves the flap along the insertion direction (+88°).
- Buttons are pushed along the insertion direction by `push_depth_m`. Knobs turn around the local axis facing the viewer (local +Z).

**Material conventions:** baked room/city materials have a black base colour and emissive (texture).
They become unlit `MeshBasicMaterial` with `toneMapped = false` and a 0.7 gain (`prepareMaterials` in
`main.ts`), so they match the Blender view-transformed look. Hero materials stay PBR and are lit by a
low-intensity `RoomEnvironment`, a warm rect light under the ceiling strip, and magenta/cyan point lights
at the window.

### Swapping the GLB

1. Export from Blender with the same object names, custom properties (`extras`), +Y up, WebP textures.
2. Replace `public/crt_vhs_scene.glb` and run `npm run check:glb`. Fix anything unchecked.
3. Start `npm run dev` and check the console for the `[contract]`, `[screen]` and `[vcr]` orientation logs.
4. If the room looks too bright or dark, tune the gain in `prepareMaterials(refs.root, 0.7)`. Hero lighting is in `src/lighting.ts`.

Draco and Meshopt compression are supported if you compress the GLB later. The Draco decoder loads from
the gstatic CDN.
