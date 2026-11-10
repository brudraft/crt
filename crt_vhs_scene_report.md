# crt_vhs_scene.glb – eksportrapport

- **Fil:** `crt_vhs_scene.glb` (6,97 MB)
- **Koordinater:** +Y opp, 1 enhet = 1 m. Forsiden av TV-en vender mot +Z i glTF (−Y i Blender).
- **Med i eksporten:** modifiers og skala er brukt. Tomme objekter, `Cam_Hero` og custom properties (`extras`) er med. Lys er ikke med.
- **Toppnoder:** `Hero` og `Scene` (collections eksportert som noder under `Scene Collection`).
- **Teksturer:** WebP via `EXT_texture_webp`, som three.js GLTFLoader støtter. Det finnes ingen PNG-reserve.
- **Utvidelser:** `KHR_materials_emissive_strength`, `KHR_materials_clearcoat`, `KHR_materials_specular`.

## Trekanter

| Collection | Trekanter | Budsjett |
|---|---|---|
| Hero | 31 122 | < 80 000 ✅ |
| Scene | 21 882 | – |
| **Totalt** | **53 004** | < 250 000 ✅ |

## Teksturer (alle ≤ 2048 px)

| Tekstur | Størrelse | Bruk |
|---|---|---|
| T_TV_BaseColor / T_TV_ORM | 2048² | TV-atlas (helt) |
| T_Cart_BaseColor / T_Cart_ORM | 2048² | Vogn (helt) |
| T_VHS_BaseColor / T_VHS_ORM | 1024² | VHS-skall, delt av alle kassettene |
| T_Props_BaseColor / T_Props_ORM | 1024² | Rekvisitter |
| T_Floor_Lightmap | 2048² | Gulv (bare emission) |
| T_Shell_Lightmap | 2048² | Vegger, tak, lister, vindusramme |
| T_Furniture_Lightmap | 2048² | Møbler |
| T_Plants_Lightmap | 2048² | Planter |
| T_Leaf_Alpha | 256×512 | Bladmaske (UV 2) |
| T_City_Near/Mid/Far_Emit | 512² hver | Byvinduer (emission) |
| T_Sky_Dusk | 8×512 | Himmelgradient |
| T_VHS_Label_Placeholder | 512×256 | **Byttes:** VHS_Label |
| T_VHS_Spine_Placeholder | 512×64 | **Byttes:** VHS_Spine |
| T_Holo_Calendar | 512×410 | **Byttes/animeres** |
| T_Holo_Energy | 512² | **Byttes/animeres** |
| T_Holo_Network | 512×320 | **Byttes/animeres** |
| T_Holo_Chart | 512×360 | **Byttes/animeres** |

ORM betyr R = AO (glTF `occlusionTexture`), G = roughness og B = metallic.

## Skjerm

- **`Screen`:** 0,340 × 0,255 m (4:3), med 2 cm kuving. UV går fra 0 til 1 over hele flaten. Materialet er `M_Screen_Glass`.
- **`extras` på `Screen`:** `screen_width_m = 0.34`, `screen_height_m = 0.255`, `aspect = "4:3"`, `bulge_m = 0.02`.

## Ankerpunkter (verdensrom)

Kolonnen for glTF er det three.js leser inn. Blender-kolonnen er bare til sammenligning.

| Ankerpunkt | glTF-posisjon (x, y, z) | glTF-kvaternion (x, y, z, w) | Retning i glTF | Blender-posisjon / rotasjon |
|---|---|---|---|---|
| ScreenAnchor | (−0.045, 1.0375, 0.227) | (0.7071, 0, 0, 0.7071) | Lokal +Y = skjermnormal = verdens **+Z** (ut mot seeren) | (−0.045, −0.227, 1.0375) / X 90° (lokal Z = normal) |
| VHS_Slot_Anchor | (0.12, 0.845, 0.23) | (0, 0, 0, 1) | Innsettingsretning = lokal **−Z** = verdens −Z (inn i TV-en) | (0.12, −0.23, 0.845) / 0° (lokal +Y = inn) |
| VHS_Slot_Inside_Anchor | (0.12, 0.845, 0.1665) | (0, 0, 0, 1) | Senter av kassetten når den er helt inne | (0.12, −0.1665, 0.845) / 0° |
| OrbitTarget | (−0.045, 1.0375, 0.227) | (0, 0, 0, 1) | Midt på skjermen | (−0.045, −0.227, 1.0375) / 0° |
| Cam_Hero | (−0.045, 1.1, 1.627) | (0.6912, 0, 0, 0.7227) | 35 mm, ser mot OrbitTarget | (−0.045, −1.627, 1.1) / X 87.44° |

Kassetten passer med identitetsrotasjon i `VHS_Slot_Anchor`. Kassettens innsettingsakse er Blender +Y, som blir glTF lokal −Z. Langsiden ligger langs X, og etiketten vender opp.

## Pivoter og egenskaper (extras)

- **`VHS_Flap`:** pivot på hengsellinjen, rotasjon om lokal X. Lukket = 0°, åpen = 88°. En positiv rotasjon i Blender svinger luken inn i TV-en.
- **`Btn_*`:** origo i midten, trykkes inn i TV-en (Blender +Y, glTF −Z), `push_depth_m = 0.004`.
- **`Knob_Channel` / `Knob_Volume`:** origo på rotasjonsaksen (Blender lokal Y), fra −135° til +135°.
- **`VCR_Display`:** 0,06 × 0,02 m med UV fra 0 til 1.
- **`VHS_Tape_01`–`05`:** egenskapene `youtube_url` og `title` (tomme) og `shelf` (top eller lower).
- **`VHS_Tape_Root`:** malen (`template = true`). Den er parkert inne i VCR-hulrommet ved `VHS_Slot_Inside_Anchor`, skjult bak den lukkede luken.
- **`Holo_*`:** egenskapene `animatable`, `holo_width_m` og `holo_height_m`. `Holo_Energy` har i tillegg `value_percent = 47`.

## Objekter og tomme objekter

### Hero (96)
**Tomme objekter:** TV_Root, ScreenAnchor, VHS_Slot_Anchor, VHS_Slot_Inside_Anchor, OrbitTarget, VHS_Tape_Root, VHS_Tape_01, VHS_Tape_02, VHS_Tape_03, VHS_Tape_04, VHS_Tape_05

**TV:** TV_Body, Screen, VHS_Flap, Btn_Eject, Btn_Play, Btn_Stop, Btn_FF, Btn_Rew, Btn_Power, Knob_Channel, Knob_Volume, VCR_Display, VCR_Display_Bezel, VCR_Slot_Trim, LED_Power, Badge_Vistron, Label_TVVideo, Foot_1–4, Rear_Panel, Rear_Coax_Socket, Rear_Coax_Plug, Rear_Power_StrainRelief, Rear_AV_Jack_L, Rear_AV_Jack_V, Power_Plug, Coax_Plug_End, Cable_Power, Cable_Coax

**VHS-malen** (barn av VHS_Tape_Root): VHS_Shell, VHS_Lid, VHS_Window, VHS_Hubs, VHS_TapePack, VHS_Screws, VHS_WriteProtect_Tab, VHS_Label, VHS_Spine

**Kassettene** VHS_Tape_01–05 har hver de samme barna med prefiks, for eksempel `VHS_Tape_01_Shell`: _Shell, _Lid, _Window, _Hubs, _TapePack, _Screws, _WriteProtect_Tab, _Label, _Spine. Alle deler mesh med malen.

### Scene (55)
**Tomme objekter og kamera:** Cart_TopShelf_Ref, Cart_LowerShelf_Ref, CityBackdrop, Cam_Hero (kamera)

**Vogn og rekvisitter:** Cart, Cart_Caster_1–4, Cart_Wheel_1–4, Prop_Joystick, Prop_Controller, Prop_Cartridge_01–03, Prop_Cable_Controller, Prop_Cable_Joystick, Prop_Cable_RCA_Yellow, Prop_Cable_RCA_White, Prop_Cable_RCA_Red, Prop_RCA_Plug_1–3

**Rommet:** Floor, Walls, Ceiling, Ceiling_LED_Strip, Baseboards, Window_Frame, Window_Glass, Divider_Panel, Door, Wall_Shelf, Shelf_Books, Shelf_Books_Stack, Sideboard, Side_Table, Glass_Tablet, Plant_Large_01, Plant_Large_02, Plant_Small_Sideboard

**Hologrammer:** Holo_Calendar, Holo_Energy, Holo_Network, Holo_Chart

**Byen:** City_Layer_Near, City_Layer_Mid, City_Layer_Far, City_Neon_Signs, City_Ground, City_Sky, FlyingCar

## Merknader for nettviseren

- **Statiske materialer:** de har Base Color svart og bakt lys som emission (styrke 1.0). Sørg for at de ikke tonemappes dobbelt eller lyses opp på nytt i viseren.
- **Gulvet:** det har ikke glans etter bakingen. Legg eventuelt på en `MeshReflectorMaterial` eller en svak refleksjon i viseren.
- **Neon og LED:** de har emission på 1.0. Bruk bloom (UnrealBloomPass) for gløden.
- **Lys:** de fire LED-lysene i taket og vinduslysene er bare med i .blend-fila. Helteobjektene trenger lys i viseren, for eksempel et miljøkart (environment map) med en varm og en kjølig retningslyskilde.
