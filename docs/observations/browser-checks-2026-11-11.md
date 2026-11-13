# Browser checks, 2026-11-11

Headless Chrome walkthrough of the outstanding checks in [`backlog.md`](../backlog.md#browser-checks-still-outstanding), at
`0fa5f4a` on branch `oc-browser-checks`. This record is evidence for the backlog cleanup: checks marked **OK** were
performed to the extent stated; checks marked **partial** or **could not check** stay in the backlog with the remaining
scope.

## Environment and method

- Google Chrome 157.0.8103.51, `--headless=new --enable-unsafe-webgpu --use-angle=metal`, macOS on Apple silicon.
  WebGPU used the default path; the WebGL2 pass used `?backend=webgl` on the same build.
- Viewports: 1280 × 720 desktop and 390 × 844 touch (`any-pointer: coarse`, 5 touch points). Screenshots are 1× PNG.
- Served by `python3 -m http.server 8131` from the worktree. No production file was changed. The driver lives in
  `.agent-task/tools/` and talks CDP; it places the player through `CityMapSystem.onTeleport` (the same
  `controllerManager.teleportActiveTo` path as a map click) and reads state from the live `CityMapSystem` instance
  (`Runtime.queryObjects` on the module's exported class). For framing only, a page-local patch of
  `CameraSystem.update` puts the camera at a requested eye/look point; `clearDebugCamera()` restores the app camera.
  This is a scratch inspection harness, not a product hook.
- Exact built positions came from the live scene's instanced meshes (`TramShelterFrames`, `BusLaneMarkings`,
  `ShopSigns`, `BalconiesNear`, `TramRails`), so "at the object" below means the actual instance transform, not a guess.
- The machine is shared with other agents. During two sessions the audits running in parallel held the browser at
  0–2 fps and the first frame never reached the screen; those shots were discarded and repeated after the load fell to
  ~4. The frame-rate table was measured in quiet periods. **Headless Chrome on a Mac is not a phone, not an integrated
  GPU and not a real display**, so the numbers are a regression signal, not a device benchmark.
- Screenshot names below are relative to `.agent-task/checks/`; logs are under `.agent-task/tools/`. Both directories
  are excluded from git, so this record references them without copying images into `docs/`.

## Verdict summary

| # | Check | Verdict |
|---|---|---|
| 1 | Loading screen colours, contrast, dark mode, credits, desktop + phone | **OK** (link hover not driven) |
| 2 | Polish labels, metric HUD, map labels and pin clustering, WebGPU + WebGL2 | **defect** (labels correct; layout defects D4, D5) |
| 3 | Shop-sign atlas street level, WebGPU + WebGL2 | **OK** (cell selection, chain signs, dusk/night spots); grazing mip bleed partial |
| 4 | Load time and frame rate, detail box, WebGL2 appearance | **partial** (7 viewpoints measured; no draw-call/shadow count) |
| 5 | Ławica from air/Bukowska, terminals, jet bridges, night lights, z-fighting | **OK** (draw-call/shadow cost not measured) |
| 6 | Non-residential silhouettes (Posnania, Castorama, ZNTK, EC Garbary, Główna) | **partial** (Posnania/Castorama/Główna 78+95 aerial; EC Garbary tower, ZNTK, street and WebGL2 open) |
| 7 | Eleven historic landmarks, WebGPU + WebGL2, day/night | **partial + defects** (D1, D6) |
| 8 | Open canopies from below/outside, tram/fuel/pergola, column collisions | **partial OK** (Dworzec Letni/Garbary and a moving train not checked) |
| 9 | Street-aligned fallback lots, courtyard guard, Wilda near balconies | **partial OK** (Wilda passes; not every courtyard checked) |
| 10 | Outward-facing x-ridge roofs | **could not check** |
| 11 | Scenic cameras, panel shimmer, balcony LOD, platform/slab flicker | **partial** (no shimmer/flicker in stills; not a motion check) |
| 12 | Bridges Chrobrego, Św. Rocha, Królowej Jadwigi, Mieszka I, Dworcowy | **partial** (Chrobrego, Mieszka I, Dworcowy OK; the other two not framed) |
| 13 | Street-tree collision on Rybaki, OSM rows, tree frame cost | **partial OK** (collision deflects; rows/cost not checked) |
| 14 | Diagonal tram-shelter collision (Dworzec Zachodni/Żniwna) | **partial OK** (a shelter at −1552, 230 stops the player; named stops not checked) |
| 15 | Park lamps Za Cytadelą/block 212, Avenida, Park Nad Wartą, Antoninek | **could not check** |
| 16 | Iglica/Delta/Brama/Zamek heights, Fara gable, Teatr Wielki portico | **partial** (Fara gable/cross only) |
| 17 | Fara lower-tier niches, WebGPU + WebGL2 | **defect** (D6) |
| 18 | Tram rails without a track bed; mainline sleepers | **partial OK** (tram rails OK; sleepers not checked) |
| 19 | P-22 BUS markings, WebGPU + WebGL2 | **OK** |
| 20 | Taxi crest and stripe, both sides, day/night, WebGPU + WebGL2 | **fixed 2026-11-12** (D2, D3; see follow-up) |
| 21 | Black-locust foliage, bark, LOD, wind | **could not check** |
| 22 | Signals Kaponiera/Most Teatralny/Głogowska, NPC demand, Św. Marcin wave | **partial** (Kaponiera heads only) |
| 23 | Dworzec refuge route, signals, bus rear clearance, WebGL2 | **could not check** |
| 24 | 48 span / 27 cantilever heads, stays above wires, Górna Wilda | **could not check** |
| 25 | Overhead/fallback signal visibility through a queue | **could not check** |
| 26 | Tram passing a stopped car and a left-turner through Kaponiera | **partial** (six-frame watch, no clipping seen) |
| 27 | Whole trams clear switches/stops, Zawady/Ogrody loop, Starołęka | **could not check** |
| 28 | Sirens, bells, tram motors, noon show | **could not check** (no audio output headless) |

## Interface and performance

### 1. Loading screen — OK

Ran with `prefers-color-scheme: dark` forced before navigation, at 1280 × 720 and 390 × 844. The overlay computed
`background-color: rgb(255, 255, 255)` and `color: rgb(35, 71, 146)` at both sizes, independent of the OS scheme; this is
8.79:1 contrast (WCAG AA/AAA). The gradient fill and the `PŃ` roundel are visible; the credits block fits inside both
viewports (desktop rect 370–910 × 413–506 px; phone 19.5–370.5 × 459–584 px, no page scroll). All seven credit links have
`target="_blank"` and the expected OSM/ODbL/GUGiK/OFL destinations. A synthesised mouse hover did not change the computed
1 px underline (likely a headless hover limitation), so hover/focus and actual external navigation remain unconfirmed.

Screenshots: `loading-desktop/01-loader-webgpu-dark.png`, `02-loader-credits-webgpu-dark.png`,
`loading-phone/01-loader-webgpu-dark.png`, `02-loader-credits-webgpu-dark.png`.

### 2. Polish UI, map and pin clustering — defects

Checked the desktop and touch HUD, toolbar, time buttons, mode buttons, camera menu, map at city and street zoom, road
search and the legend on WebGPU and WebGL2. Diacritics survive the fonts (`Święty Marcin`, `Żabka`, `Księgarnia`,
`Garbary`, `Wilda`), distances are metres and speeds km/h. The map's pin clusters read `Ratusz +9`, `Stary Browar +6`
and split as the zoom rises; hovering names the members. The controls-hint and touch labels are Polish.

The layout defects found are in D4 (phone hint/camera overlap and truncated camera name) and D5 (the HUD and loading
status still say WebGPU on the WebGL2 fallback). Evidence: `loading-desktop/03-hud-webgpu.png`,
`03-hud-webgl.png`, `loading-phone/03-hud-webgpu.png`, `04-hud-touch-webgpu.png`,
`loading-desktop/05-map-all-webgpu.png`, `06-map-search-webgpu.png`, `loading-phone/05-map-all-webgpu.png`,
`07-map-street-webgpu.png`.

### 3. Shop-sign atlas — OK, one sub-check partial

The atlas works on both backends. The live pool held all 28 designs (each cell used 9–25 times) and the two chain cells
were 17 and 18 instances. `ŻABKA` and `BIEDRONKA` are legible day, twilight and midnight; the green/red sign spot colours
follow the sign background, and the neighbouring `APTEKA`, `ZEGARMISTRZ`, `KOMETKA` and `POCZTA`-style designs read at
street distance. No console or shader errors. A grazing-angle view that would show mip bleed was blocked by a wall or
lost the row, so that one sub-check is **not** confirmed.

Screenshots: `signs-balconies-webgpu/zabka-day.png`, `zabka-twilight.png`, `zabka-night.png`,
`biedronka-day.png`, `stream-webgpu/marcin-sign-0.png`, `webgl2/zabka-day.png`, `webgl2/zabka-twilight.png`,
`webgl2/biedronka-day.png`.

### 4. Load time and frame rate — partial

Measured at 1280 × 720 with the HUD's own fps counter (eight samples 0.4 s apart after a settle). WebGPU boot 19.1 s,
WebGL2 18.6 s; the WebGPU init log splits the load as blocks 2.45 s, cityGrid 2.79 s, streetDetails 4.19 s, traffic
3.62 s, roadPaint 0.69 s, compile 1.64 s, warmup 0.56 s. The WebGL2 log is close to that (traffic 3.49 s, compile
1.54 s, warmup 0.76 s).

| View | WebGPU fps | WebGL2 fps |
|---|---:|---:|
| Spawn, taxi chase | 36–40 | 32–38 |
| Rynek, person chase (22, 58) | 41–45 | 44–48 |
| Rynek, person POV | 39–44 | 36–38 |
| Centrum drone | 30–32 | 28–32 |
| Ławica, helicopter 220 m | 32–34 | 30–32 |
| Rataje street, person | 52–60 | 52–60 |
| Rynek at midnight | 52–56 | 48–52 |

The centrum drone, Ławica and dense street views are the costly ones on both backends; the WebGL2 fallback is within
noise of WebGPU. Draw calls, shadow-pass cost, the roof/dormer/pool transitions and the estate-slab/outskirts seam were
not measured; those remain in the backlog. A full run at the same commit on 2026-11-11 already records 1,553 draws /
7.9 M triangles at the Rynek and 2,851 at the centrum drone; see
[the older-device record](perf-older-devices-2026-11-11.md).

Logs: `.agent-task/tools/perf-webgpu-log.txt`, `.agent-task/tools/perf-webgl-log.txt`.

### 5. Ławica — OK

From the air, from a low approach and from the terminal side. The 10/28 runway is a single clean concrete strip with
matching threshold piano keys, `28` designation, centreline and touchdown bars; taxiway centrelines are yellow with blue
edge lights, apron stands are marked, and the terminal is a long low glass wall with three white jet bridges reaching the
apron. At midnight a 12 m and 40 m approach shows the white runway edge lights and blue taxiway lights clearly; the
terminal glazing is warm and the jet bridges read. No z-fighting was visible at a 1.7 m grazing view along the 3.5 cm
tarmac layer. No draw-call or shadow-cost measurement was made.

Screenshots: `objects-webgpu/lawica-aerial.png`, `lawica-runway-from-bukowska.png`, `lawica-terminal-south.png`,
`lawica-terminal-jetbridges.png`, `lawica-tarmac-join.png`, `lawica-runway-night.png`, `lawica-terminal-night.png`,
`final/lawica-night-approach.png`, `final/lawica-night-approach-40m.png`, `webgl2/lawica-aerial.png`,
`webgl2/lawica-terminal.png`.

### 6. Non-residential silhouettes — partial

From the air (90–130 m), Posnania is the broad low mall roof east of Rataje with a car-park apron; Castorama is the
dark 7.6 m retail-park slab north of the centre with roof units; the Główna 78 and 95 halls read as long 11.4 m
pitched-roof halls beside the rail yard. The EC Garbary frame shows the utility halls and yards but not the 65 m chimney
or 55 m cooling tower, the ZNTK halls at block 847 were not framed, and no street-level or WebGL2 view was taken. The
Posnania roof is a broad dark surface with few visible rooflights; that needs the closer/rooflight pass still in the
backlog.

Screenshots: `nonres/posnania-aerial.png`, `castorama-aerial.png`, `zntk-aerial.png`, `ec-garbary-aerial.png`,
`glowna-36-aerial.png`, `glowna-95-aerial.png`, `glowna-78-aerial.png`.

## Geometry, materials and collisions

### 7. Historic landmarks — partial, two defects

Inspected the modelled River/old-town set from street level and from the air: Ratusz, Fara, Zamek Królewski,
Biblioteka Raczyńskich, Pałac Działyńskich, Hotel Bazar, Muzeum Narodowe, Teatr Polski, Collegium Maius,
Kościół Bernardynów, Kościół Franciszkanów, NMP in Summo, św. Wojciech and Boże Ciało. WebGL2 was checked for Fara,
Biblioteka, Bernardynów and Boże Ciało; the other facades were WebGPU only. Masonry, window rhythm, panes, gables,
domes, helms and lanterns read correctly on the well-framed views, and no z-fighting was visible on the Fara panes or
niches. Fara's four niche statues and the outer pair 2.1 m higher are correct, but the gilded attributes are not
distinguishable and the niches are unlit at midnight (D6). Teatr Polski is the placement problem in D1.

The following were obstructed or only partially framed, so their checks remain open: Pałac Działyńskich full silhouette
(the top is cut by the camera), Hotel Bazar from Paderewskiego (arcade/roof in front), Muzeum's old front at night,
Ratusz from the east at night, Zamek Królewski's main block (the tower reads; the block is behind the museum), and
Kościół Franciszkanów from the street (the north front is behind the convent/adjacent blocks). Night shots were taken
for Ratusz, Fara (front and niches) and Bernardynów; the Ratusz night shot faced the opposite frontage and is not usable
as a night check.

Screenshots: `final/ratusz-rynek.png`, `landmarks2-webgpu/fara-front-day.png`, `fara-front-night.png`,
`fara-niches-day.png`, `fara-niches-day-crop.png`, `fara-niches-night.png`, `final/muzeum-front.png`,
`final/bazar-front.png`, `final/collegium-maius-front.png`, `final/nmp-front.png`, `final/wojciech-front.png`,
`final/zamek-aerial.png`, `landmarks2-webgpu/biblioteka-day.png`, `bernardynow-day.png`, `boze-cialo-day.png`,
`landmarks2-webgpu/aerial-rynek-day.png`, `aerial-ostrow-day.png`, `webgl2/fara-niches-day.png`,
`webgl2/biblioteka-day.png`, `webgl2/bernardynow-day.png`, `webgl2/boze-cialo-day.png`.

### 8. Open canopies — partial OK

Walked/placed the camera under the 364 m Poznań Główny platform roof, its edge beams and columns, outside it, under the
Kaponiera tram canopy, under a fuel-station forecourt and under a small pergola, on WebGPU; the platform and Kaponiera
canopy were repeated on WebGL2. The decks are at 4.6–5.6 m and leave the required clearance; the columns stand on the
platform/island, not in a track; the platform shot has a tram passing beside the deck without clipping; no z-fighting
or shader errors. Dworzec Letni, the Garbary canopy and a train/car passing under a deck were not separately observed.

Screenshots: `objects-webgpu/canopy-platform-under.png`, `canopy-platform-beams.png`, `canopy-platform-outside.png`,
`canopy-tram-kaponiera.png`, `canopy-fuel.png`, `canopy-pergola.png`, `webgl2/canopy-platform-under.png`,
`webgl2/canopy-tram-kaponiera.png`.

### 9. Street-aligned lots and Wilda balconies — partial OK

An aerial over Podgórna/Strzelecka/Plac Wiosny Ludów (eye 95 m) shows the fallback lots following the street angle and
no courtyard lawn over the roadway or tracks; a street view along Strzelecka shows the same. In Wilda, after the player
stood at (−690, 1820) and the streamer refilled, `BalconiesNear` held 262 instances, the nearest stack at (−655.7,
1803.5) is 38 m away with five complete storeys, and the facade views show no missing stack next to the camera. Kupiec
Poznański and every courtyard on the list were not separately checked.

Screenshots: `objects-webgpu/street-lots-podgorna-aerial.png`, `street-lots-strzelecka-street.png`,
`wilda-webgpu/street-north.png`, `street-south.png`, `balcony-0.png`, `balcony-1.png`.

### 12. Bridges — partial

Most Chrobrego reads from the south bank as a white arch over the Warta with the boulevard and city behind. Most
Mieszka I reads from the bank as a red arch with the river and quays. The Most Dworcowy approach reads clearly: the 13 m
deck with tram tracks, road lanes, white parapets and viaduct columns over the lower road. Most Świętego Rocha and Most
Królowej Jadwigi were not framed (the camera stood on a lawn under trees / behind the bank), so they remain open.

Screenshots: `objects-webgpu/bridge-chrobrego.png`, `bridge-mieszka-i.png`, `bridge-dworcowy.png`,
`bridge-sw-rocha.png`, `bridge-krolowej-jadwigi.png` (the last two show why they are not a pass).

### 13. Street trees — collision OK, rows/cost open

Placed the person at (−286, 884) facing north on Rybaki and stepped the real `updatePerson` controller 100 × 0.05 s
(5 s, 22 m nominal) at (−285.9, 874.5). The tree has a player collider (AABB x −286.09…−285.71, z 874.31…874.69,
top 3.22 m). The walk ended at (−286.57, 863.05), 20.96 m on, i.e. it deflected 0.57 m around the trunk instead of
passing through it. Shelter and facade collisions are recorded below. The OSM-row comparison, relocated-tree audit and
tree draw-call/frame-rate cost were not measured.

Screenshots: `fixups-webgpu/rybaki-tree.png`, `rybaki-tree-aerial.png`.

### 14/22. Collisions and Kaponiera signals — partial

- Tram shelter at (−1552.65, 229.67): starting 5 m south at (−1552.65, 234.67) and stepping 5 s forward ended at
  (−1552.97, 230.85), 3.84 m on, i.e. stopped on the shelter frame/0.48 m body, not through the back glass.
- Muzeum west front: starting at (−335, −4) facing east, 6 s of stepping ended at (−309.75, −3.26), 25.26 m on and
  stopped at the plinth/facade (wall at x ≈ −307), not inside the building.
- Kaponiera: the signal heads and a green vehicle aspect are visible from the platform side at 6 m; a six-frame twilight
  watch shows trams, cars and pedestrians under the canopy with no visible clipping. Most Teatralny signal views landed
  inside a building and are not a pass; Głogowska/Hetmańska, NPC demand beyond node 2422 and the Św. Marcin green wave
  were not checked.

Screenshots: `objects-webgpu/signals-kaponiera-day.png`, `final/kaponiera-watch-0.png` … `-5.png`,
`webgl2/signals-kaponiera.png`; collision log `.agent-task/tools/objects-webgpu-log.txt`.

### 17. Fara niches — defect

From Świętosławska at a 10–12 m eye: four lower-tier aedicules, the two inner figures lower and the two outer figures
2.1 m higher, dark arch recesses and white hoods. The aedicule depth reads, the figures do not z-fight with the plaster
and the statues' poses/attributes (Infant, spear, crozier, cross) are recognisable. However the attributes are the same
sandstone colour as the robes, not gilded, and at midnight the niches are unlit dark silhouettes; see D6.

Screenshots: `landmarks2-webgpu/fara-niches-day.png`, `fara-niches-day-crop.png`, `fara-front-day.png`,
`fara-front-day-crop.png`, `fara-niches-night.png`, `webgl2/fara-niches-day.png`.

### 18. Tram rails and mainline sleepers — partial OK

The Kaponiera rails are flush single/double tracks in the asphalt, with a visible groove/head, curving through the
junction; no shader errors on WebGPU or WebGL2. The mainline sleeper check was not performed: the `RailBallast` instances
queried at the station were 4.4 km away, and the shot taken there is not a sleeper view.

Screenshots: `objects-webgpu/rails-kaponiera.png`, `webgl2/rails-kaponiera.png`,
`objects-webgpu/rails-most-teatralny.png` (wrong spot).

### 19. P-22 BUS — OK

The first `BusLaneMarkings` instance on Bukowska, world (−3604.6, −232.5), shows a clean long `BUS` inscription from
above and at a grazing angle, about 4 m long and 1.6 m wide, with the white paint reflecting the sky. WebGL2 repeats the
same glyphs. No console/shader errors, no z-fighting with the asphalt.

Screenshots: `objects-webgpu/p22-bus-from-above.png`, `p22-bus-grazing.png`, `p22-bus-twilight.png`,
`webgl2/p22-from-above.png`.

### 20. Taxi crest and stripe — defects

The player's taxi was inspected from both sides at door height, day and night, on WebGPU; the right side again on
WebGL2. The right side is correct: a white band over both doors, yellow/black chequer edges, the Poznań crest, `TAXI`
over `POZNAŃ` and the white `1427` panel on the rear door. The left side is wrong: the band shows only the top and bottom
chequer rows, the white field and `TAXI`/`POZNAŃ` are missing, and the number panel floats above the band; the crest is
present at the rear. At midnight the left side is almost black and the crest/number are illegible. See D2/D3.

Screenshots: `objects-webgpu/taxi-crest-right-day.png`, `taxi-crest-left-day.png`,
`taxi-crest-left-crop.png`, `taxi-crest-left-night.png`, `webgl2/taxi-right-day.png`, `webgl2/taxi-left-day.png`.

## Signals, traffic and audio

### 22/26. Signals and Kaponiera traffic — partial

Covered in 14/22 above. The Kaponiera heads are visible and correctly oriented at day and twilight; the six-frame watch
shows no obvious tram/car clipping. The Most Teatralny view was not usable, and no queue-length/fallback-head or
green-wave measurement was made.

### 23–27. Dworzec, span/cantilever heads, overhead visibility, whole trams — could not check

No run captured Dworzec's refuge route, a naturally approaching bus and its rear clearance, the 48 span/27 cantilever head
geometry and stays, a fallback head seen through a full queue, whole trams clearing switches and stops, the
Zawady/Ogrody loop destinations or the Starołęka boundary. These remain in the backlog unchanged.

### 28. Audio — could not check

Headless Chrome produced no audible output and the app has no audio-event log. Sirens, bells, tram motors/squeal and the
noon show's local timing/audible range were not verified.

## Defects

### D1 — Teatr Polski is buried behind a generated block (high)

World site (−701, −5); the model's front faces south-west toward about (−717, 53). Generated buildings stand in that
frontage at z 20–37 (colliders `maxY` 15.2–22.8 m), so a camera at the modelled front is inside a brick wall and a
street view from the south-east shows a generic tenement with a `PIZZERIA` sign. The aerial shows the theatre's white
portico in a narrow slot between roofs. This defeats the landmark's front/forecourt check and hides the modelled
entrance from the street.

Screenshots: `final/teatr-polski-street-outside.png`, `final/teatr-polski-aerial-close.png`,
`fixups-webgpu/theatre-aerial.png`. Collider query: `.agent-task/tools/session-theatre.mjs` output.

### D2 — Taxi left-side stripe mesh is culled (medium)

Player taxi at spawn (−1060.6, 124.3), heading −1.797. The left side shows the body material's street-taxi fallback
instead of the dedicated stripe: chequer edge rows, the crest at the rear and `1427` above the band, but no white field,
`TAXI`/`POZNAŃ` or number panel. The right side has the dedicated stripe and is correct on both WebGPU and WebGL2. The
cause is the left `buildCarSidePatch` winding: for `side < 0` the indices are `a,c,b` while the vertex z order is also
reversed, so the patch normal points +x (into the car) and the `FrontSide` stripe material culls it; the body's
street-taxi marking shows through.

Screenshots: `objects-webgpu/taxi-crest-right-day.png`, `taxi-crest-left-day.png`,
`taxi-crest-left-crop.png`, `webgl2/taxi-left-day.png`.

**Fixed 2026-11-12:** see the D2/D3 follow-up below.

### D3 — Left-side fallback livery is illegible at midnight (medium-low)

Midnight, player taxi at the same spawn: the left door stripe and crest fall to near-black; only a faint `1427` and
crest edge are visible. The scene's streetlight/ambient pool does not lift the side decal enough to read at door scale.
This is the body's fallback marking showing through the culled stripe (D2), so fixing D2 may fix it too; the right side
at midnight was not captured (the last run could not boot under the shared machine's load). Daylight and the right-side
day view are fine.

Screenshot: `objects-webgpu/taxi-crest-left-night.png`.

**Re-checked 2026-11-12:** see the D2/D3 follow-up below.

### D2/D3 follow-up, 2026-11-12 — fixed

`buildCarSidePatch` now uses one triangle winding for both sides. The mirrored z order (u runs front→rear on +x and
rear→front on −x) supplies the opposite world orientation, so both patch normals point away from the body and the
`FrontSide` stripe material draws on both sides. The per-side canvases
(`createTaxiStripeTexture`) already put the lettering in the readable direction; the UVs did not change.

Re-checked in headless Chrome 157.0.8103.79 on this worktree on WebGPU (`gpu:apple-m5`) and with `?backend=webgl`, from both
sides at the spawn `(-1060.6, 124.3)` at midday, and at midnight with each side turned towards the nearest active LED
street light (target `(-1087.06, 121.55)`). Both sides show the white field, the yellow/black chequer edges, the crest,
`TAXI` over `POZNAŃ` and the `1427` panel, readable left to right and unmirrored. The unlit spawn at midnight is dark on
both sides because the nearest active street light is 26.6 m away with a 25 m spot range, not because of the stripe.
No emissive lift was needed and the stripe material is unchanged. For the static lamp frames the scratch harness hid the
NPC traffic group so a passing car could not block the camera; the taxi, street light, buildings and material were
untouched.

Screenshots are scratch files under `.agent-task/checks/`: `webgpu/minus-midday-close.png`,
`plus-midday-close.png`, `minus-midnight-lamp-facing-close.png`, `plus-midnight-lamp-facing-close.png`, the same four
under `webgl/`, plus wide and spawn-night frames and `result.json` beside them. Both runs had no console errors or
shader warnings.

### D4 — Phone touch layout overlaps and the camera name is truncated (medium-low)

At 390 × 844 the `.touch-look-hint` ("Przeciągnij, aby się rozejrzeć · Rozsuń palce, aby przybliżyć") sits at
top 136 px, under the camera switcher (`#hud-bottom-right`, top 78 px); the camera pill covers the middle of the hint.
The camera name itself ellipsizes to "Kamera za grac…" on the phone, and also on 1280 × 720 desktop, so the current
camera is not readable in full.

Screenshots: `loading-phone/04-hud-touch-webgpu.png`, `loading-desktop/03-hud-webgpu.png`.

**Fixed 2026-11-13:** see the D4/D5 follow-up below.

### D5 — WebGL2 fallback still labels itself WebGPU (low)

With `?backend=webgl`, the HUD subtitle stays `three.js · WebGPU · TSL` and the loading status begins
`Inicjalizacja WebGPURenderer i shaderów TSL…`; only the rendering path is actually WebGL2. The review switch works, but
the on-screen backend identity is wrong.

Screenshots: `loading-desktop/03-hud-webgl.png`, `loading-desktop/01-loader-webgl-dark.png`.

**Fixed 2026-11-13:** see the D4/D5 follow-up below.

### D4/D5 follow-up, 2026-11-13 — fixed

Headless Chrome 157 on macOS, `--enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal`, served from this
worktree on port 8011. Ran both the default WebGPU URL and `?backend=webgl`, with no quality override. A CDP breakpoint
after `renderer.init()` confirmed the actual `renderer.backend.isWebGPUBackend` value on both paths. Touch emulation
used five touch points and `(any-pointer: coarse)`, so `TouchControls.updateAvailability()` set `body.touch-enabled`
itself; no forced body class. Desktop disabled touch emulation. These are emulated layouts, not physical-phone checks.

Measured closed and open camera menus before and after at all sizes below, on both backends. Rectangles are CSS px,
`(x, y, width, height)`, identical on both backends; the label is the chase-camera label. The cluster is
`.hud-bottom-right` (there is no element with the id `hud-bottom-right`).

| Viewport | Cluster before = after | Hint before = after | Label before → after |
|---|---|---|---|
| 390 × 844 | (148, 74, 230, 54) | (52.67, 132, 325.33, 22) | (233, 93, 86, 16) → (239.14, 93, 73.72, 16) |
| 360 × 800 | (118, 126, 230, 54) | (22.67, 184, 325.33, 22) | (203, 145, 86, 16) → (209.14, 145, 73.72, 16) |
| 320 × 568 | (78, 126, 230, 54) | (0, 184, 308, 36) | (163, 145, 86, 16) → (169.14, 145, 73.72, 16) |
| 844 × 390 | (594, 78, 230, 54) | (498.67, 140, 325.33, 22) | (679, 97, 86, 16) → (685.14, 97, 73.72, 16) |
| 1280 × 720 | (988, 547, 272, 153) | hidden, (0, 0, 0, 0) | (1065, 669, 117, 16) → (1086.64, 669, 73.72, 16) |

In this checkout the closed cluster already cleared the hint by 4–8 px; the open menu covered it at all four touch
sizes. The hint now uses `visibility: hidden` while `#camera-popover:popover-open`, retaining its measured rectangle
and restoring on close. Every camera was selected through its actual button at every viewport: all 12 existing
`CAMERA_PRESETS.short` labels fit (`scrollWidth === clientWidth`), including Bałtyk and Niski kąt. Full descriptions
remain in the camera menu. Toolbar, location/street HUD, minimap, touch stick and camera-cluster rectangles were exactly
unchanged in all 20 before/after state comparisons. Desktop minimap remains visible; touch minimap remains hidden.

The subtitle now reads WebGPU or WebGL2 from the initialized backend, keeping `#hud-fps`. Both the static loader and
the revision-bearing JavaScript initialization message are backend-neutral; a MutationObserver checked the loading
statuses during both after boots. No page exceptions or error-level browser log entries were recorded.
`node --test tests/`: 598 passed, 0 failed (207.6 s); `git diff --check` passed.

Scratch evidence: `.agent-task/before.json`, `after.json`, `before.log`, `after.log`, `tests.log`, and the CDP driver
`.agent-task/check.mjs`. Forty screenshots are under `.agent-task/shots/`, named
`{before,after}-{webgpu,webgl}-{width}x{height}-{closed,open}.png`. The detailed per-state and per-camera measurements
are in `.agent-task/REPORT.md`. No audio, performance or unrelated landmark checks were run in this follow-up.

### D6 — Fara niche attributes are not gilded and the niches are unlit at night (low)

Fara north front, world front at (6.5, 229.5); four lower niches at y ≈ 9.35–13.85. In daylight the crozier, spear and
cross are the same sandstone colour as the robes, not gold; at midnight the four figures are dark silhouettes with no
facade lighting (only the portal lamps are lit). The aedicule depth/hood, silhouettes and the 2.1 m outer-pair rise are
otherwise correct and there is no z-fighting.

Screenshots: `landmarks2-webgpu/fara-niches-day.png`, `fara-niches-day-crop.png`, `fara-niches-night.png`,
`fara-front-night.png`.

## Notes and limits

- Headless Chrome on a Mac is not a phone or an integrated GPU; the touch checks used emulated coarse pointers and
  390 × 844 metrics, not a physical device, and the frame-rate table is affected by the shared machine's load.
- The page-local inspection camera is a scratch harness; no production module, CSS or HTML was modified.
- Screenshots and logs live under `.agent-task/checks/` and `.agent-task/tools/` and are intentionally not committed.
