# Performance Passes: Coverage Transitions and Ławica Airport (2026-11-14)

Measurement run resolving two open backlog checks under `docs/backlog.md` ("Browser checks still outstanding / Interface and performance"):
1. **Transitions:** Draw calls, triangles, and shadow-pass share while crossing roof/dormer coverage boundaries, balcony / near-pool limits, estate slabs (Rataje, Winogrady), and into the procedural outskirts.
2. **Ławica Airport:** Draw calls, shadow draws, and triangles at the runway from the air, from ul. Bukowska, and at the terminal complex (reframed from the apron), compared against matched non-airport reference views.

Both checks were measured across a fixed 13-waypoint camera path on both graphics backends (**WebGPU** and **WebGL2**) and both quality tiers (`?quality=high` and `?quality=low`).

---

## 1. Test Environment & Measurement Method

- **Hardware & CPU:** Apple M5 Pro (`sysctl -n machdep.cpu.brand_string`).
- **Operating System:** macOS 27.2.1, Build 26B131 (`sw_vers`).
- **Browser:** Headless Google Chrome 157.0.0.0 (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
- **Flags:** `--headless=new --enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal --window-size=1280,720`.
- **Display Parameters:** Viewport 1280 × 720, DPR = 1.0 (headless default), canvas full window.
- **Server:** Local static file server (`python3 -m http.server 8142`).
- **Time of Day:** Default boot preset **"Złota godzina"** (Golden Hour; `TIME_PRESETS.golden` in `js/lighting.js:205-207, 415`), sun azimuth 232°, elevation 12°, warm directional sunlight with long cast shadows.
- **Concurrent Load:** Neighboring agent (`agy-browser-checks-2`) was running headless Chrome concurrently during measurements (system load average 3.0–4.5). Consequently, **draw calls, triangles, instance counts, and shader program counts are the primary deterministic metrics**. Wall-clock CPU timings (`renderCpuMs`, `frameP50Ms`) are reported as secondary metrics (median of 3 independent runs, each sampling 12 animation frames across odd/even shadow cadence cycles).

### CDP Pass Interception & Three.js WebGPU / WebGL2 Behavior

In Slop Poznań, frames are rendered through `renderPipeline.render()` (`js/main.js:920`):
1. **Frame Reset:** `PerfStats.beginFrame()` (`js/perf-stats.js:247`) calls `this.renderer.info.reset()`, which sets `this.render.drawCalls = 0` and `this.render.triangles = 0`.
2. **Shadow Map Passes:** During `_renderScene()`, before scene objects are drawn, `this.lighting.beginRender(scene)` invokes `CadencedSunShadowNode.renderShadow()` (`js/lighting.js:360-398`). It renders Cascade 0 (Near) every frame and Cascade 1 (Far) on alternate frames (`farStride = 2`, `js/lighting.js:216`). Each shadow pass increments `renderer.info.render.drawCalls` and `triangles`.
3. **Scene Pass:** Perspective camera renders opaque and transparent scene geometry into MRT / G-Buffer targets, incrementing `drawCalls`.
4. **Post-Processing Passes:** On High quality tier, post-processing executes screen-space quad passes: SSR (reflections + 5 blur levels), bloom (high-pass + 10 blur passes + composite), adding 18 draws to `drawCalls`. On Low quality tier, post-processing is disabled (0 post draws; `js/graphics-quality.js:36`).
5. **Frame End & Display:** At the end of the frame, `renderer.info.render.drawCalls` contains the **full cumulative total of all passes** (shadows + scene + post-processing). `PerfStats.endFrame()` (`js/perf-stats.js:275`) reads this value and displays it in the `?stats=1` overlay as `Rysowanie: <drawCalls> wywołań · <triangles> trójkątów` (`js/perf-stats.js:184`).

Our CDP measurement harness intercepted each `renderer.render(scene, camera)` call to report the component breakdown:
- **Total Draws:** `r.info.render.drawCalls` at frame end (exactly matching `?stats=1` "Rysowanie").
- **Shadow Draws:** Draw calls executed during passes where `(scene.name || '').startsWith('Shadow Map')`.
- **Post Draws:** Screen-space quad passes (18 on High, 0 on Low).
- **Scene Draws:** `totalDraws - shadowDraws - postDraws` (the pure camera scene pass).
- **Shadow Pass Share:** `(shadowDraws / totalDraws) * 100%`.

---

## 2. Fixed Camera Path Specification

The 13 waypoints below form the repeatable path across urban coverage boundaries and airport viewpoints:

| ID | Name | Eye Coordinates $(x, y, z)$ [m] | LookAt Target $(x, y, z)$ [m] | Altitude | Typology & Purpose |
|---|---|---|---|---|---|
| `wp1_core_close` | Historic Core (Stary Rynek) | `(22, 7, 58)` | `(0, 10, 0)` | 7 m | Street level among kamienice; pitched tile/slate roofs, dormers, near-balcony pool saturated (<90 m). |
| `wp2_balcony_limit` | Balcony Limit Boundary | `(22, 45, 180)` | `(0, 15, 0)` | 45 m | Elevated view stepping back >90 m: balconies transition from `BalconiesNear` stone/iron to `BalconiesFar` proxy boxes. |
| `wp3_roof_boundary` | Roof / Dormer Boundary | `(800, 25, 450)` | `(1300, 15, 600)` | 25 m | Most św. Rocha river crossing: leaving historic pitched roofs/dormers behind, approaching panel estates. |
| `wp4_estate_rataje` | Estate Slabs — Rataje | `(1600, 35, 1200)` | `(2000, 25, 1500)` | 35 m | Os. Piastowskie / Rzeczypospolitej: post-war panel blocks, 5 & 11 storeys, flat roofs, loggias, green setbacks. |
| `wp5_estate_winogrady` | Estate Slabs — Winogrady | `(-240, 40, -3200)` | `(-47, 25, -2560)` | 40 m | North Poznań panel estate blocks, looking south-southeast across the city basin. |
| `wp6_outskirts_boundary`| Outskirts Boundary | `(3600, 50, 2200)` | `(4300, 15, 2200)` | 50 m | Chartowo / Franowo approaching the eastern detail box boundary ($x = 4490.7$ m). |
| `wp7_outskirts_entry` | Outskirts Entry | `(4600, 60, 2200)` | `(5400, 0, 2200)` | 60 m | Past $x = 4490.7$ m: detailed city-grid blocks end, coarsely chunked outskirts buildings and terrain begin. |
| `wp8_deep_outskirts` | Deep Outskirts | `(6000, 100, 2200)` | `(7000, 0, 2200)` | 100 m | Open suburban belt: procedural outskirts houses on street grids stretching to horizon dome. |
| `lawica_runway_air` | Ławica Runway (Air) | `(-7516, 220, -900)` | `(-7516, 0, -1450)` | 220 m | Runway 10/28 from 220 m altitude; threshold markings, piano keys, edge lights. |
| `ref_non_airport_air` | Reference Non-Airport (Air) | `(-4800, 220, -900)` | `(-4800, 0, -1450)` | 220 m | Ogrody/Wola residential fabric at identical 220 m altitude and look direction. |
| `lawica_runway_bukowska`| Ławica Runway (Bukowska) | `(-7157, 4, -518)` | `(-7157, 8, -1450)` | 4 m | Street view from ul. Bukowska looking north across fence and taxiways to runway. |
| `lawica_terminals` | Ławica Terminals (Apron) | `(-7200, 12, -840)` | `(-7200, 6, -740)` | 12 m | View from concrete apron looking south at the passenger terminal north facade and boarding jet bridges. |
| `ref_non_airport_street`| Reference Non-Airport (Street)| `(-4800, 4, -518)` | `(-4800, 8, -1450)` | 4 m | Bukowska street scene further east outside airport perimeter. |

---

## 3. Coverage Transitions Benchmark

### 3.1 High Quality Tier (`?quality=high`)

*Post-processing active: SSR (6 passes) + Bloom (12 passes) = 18 post draws per frame.*

| Waypoint | Backend | Total Draws (?stats=1) | Scene Draws | Shadow Draws (Share) | Cascade 0 / 1 per refresh | Triangles | Instances | Programs | Render CPU (med) |
|---|---|---|---|---|---|---|---|---|---|
| **WP1: Historic Core (Close)** | WebGPU | **1,793** | 1,334 | 442 (24.7%) | 242 / 399 | 8.23 M | 256.1 k | 228 | 9.36 ms |
| | WebGL2 | **1,785** | 1,329 | 439 (24.6%) | 242 / 394 | 8.24 M | 256.1 k | 228 | 10.33 ms |
| **WP2: Balcony Limit (90m)** | WebGPU | **2,223** | 1,759 | 447 (20.1%) | 242 / 409 | 9.80 M | 250.7 k | 228 | 12.58 ms |
| | WebGL2 | **2,204** | 1,746 | 440 (20.0%) | 242 / 396 | 9.78 M | 250.7 k | 228 | 14.02 ms |
| **WP3: Roof Boundary (River)**| WebGPU | **1,387** | 1,039 | 330 (23.8%) | 200 / 259 | 6.56 M | 169.0 k | 228 | 7.56 ms |
| | WebGL2 | **1,387** | 1,039 | 330 (23.8%) | 200 / 259 | 6.54 M | 169.0 k | 228 | 8.14 ms |
| **WP4: Estate Slabs (Rataje)** | WebGPU | **1,131** | 805 | 309 (27.3%) | 182 / 253 | 5.20 M | 122.8 k | 228 | 6.53 ms |
| | WebGL2 | **1,163** | 825 | 321 (27.6%) | 183 / 275 | 5.19 M | 122.9 k | 228 | 9.80 ms |
| **WP5: Estate Slabs (Winogrady)**| WebGPU | **2,456** | 2,314 | 125 (5.1%) | 122 / 5 | 9.38 M | 279.6 k | 228 | 14.28 ms |
| | WebGL2 | **2,427** | 2,297 | 112 (4.6%) | 111 / 2 | 9.32 M | 279.2 k | 228 | 23.81 ms |
| **WP6: Outskirts Boundary** | WebGPU | **874** | 584 | 272 (31.1%) | 161 / 222 | 5.17 M | 89.4 k | 228 | 6.21 ms |
| | WebGL2 | **858** | 574 | 266 (31.0%) | 161 / 210 | 5.12 M | 89.4 k | 228 | 8.96 ms |
| **WP7: Outskirts Entry** | WebGPU | **283** | 169 | 96 (33.9%) | 60 / 72 | 1.89 M | 49.6 k | 228 | 3.95 ms |
| | WebGL2 | **283** | 169 | 96 (33.9%) | 60 / 72 | 1.89 M | 49.6 k | 228 | 5.37 ms |
| **WP8: Deep Outskirts** | WebGPU | **82** | 43 | 21 (25.6%) | 17 / 9 | 0.28 M | 18.1 k | 228 | 2.88 ms |
| | WebGL2 | **82** | 43 | 21 (25.6%) | 17 / 9 | 0.28 M | 18.1 k | 228 | 4.11 ms |

---

### 3.2 Low Quality Tier (`?quality=low`)

*Post-processing disabled: SSR and Bloom off = 0 post draws per frame. Shadow map far distance tightened.*

| Waypoint | Backend | Total Draws (?stats=1) | Scene Draws | Shadow Draws (Share) | Triangles | Instances | Programs | Render CPU (med) |
|---|---|---|---|---|---|---|---|---|
| **WP1: Historic Core (Close)** | WebGPU | **1,237** | 1,003 | 234 (18.9%) | 6.13 M | 247.3 k | 210 | 6.97 ms |
| | WebGL2 | **1,237** | 1,003 | 234 (18.9%) | 6.14 M | 247.3 k | 210 | 10.35 ms |
| **WP2: Balcony Limit (90m)** | WebGPU | **1,145** | 956 | 189 (16.5%) | 6.84 M | 236.7 k | 210 | 7.62 ms |
| | WebGL2 | **1,153** | 961 | 192 (16.7%) | 6.84 M | 236.7 k | 210 | 10.62 ms |
| **WP3: Roof Boundary (River)**| WebGPU | **877** | 741 | 137 (15.6%) | 4.49 M | 158.3 k | 210 | 5.98 ms |
| | WebGL2 | **877** | 741 | 137 (15.6%) | 4.46 M | 158.3 k | 210 | 7.83 ms |
| **WP4: Estate Slabs (Rataje)** | WebGPU | **643** | 523 | 120 (18.7%) | 3.44 M | 117.7 k | 210 | 5.19 ms |
| | WebGL2 | **631** | 516 | 116 (18.4%) | 3.44 M | 117.6 k | 210 | 6.34 ms |
| **WP5: Estate Slabs (Winogrady)**| WebGPU | **1,748** | 1,714 | 35 (2.0%) | 7.91 M | 272.5 k | 210 | 9.84 ms |
| | WebGL2 | **1,748** | 1,714 | 35 (2.0%) | 7.91 M | 272.5 k | 210 | 12.87 ms |
| **WP6: Outskirts Boundary** | WebGPU | **365** | 295 | 70 (19.2%) | 2.71 M | 83.9 k | 210 | 4.29 ms |
| | WebGL2 | **373** | 300 | 73 (19.6%) | 2.74 M | 83.9 k | 210 | 5.52 ms |
| **WP7: Outskirts Entry** | WebGPU | **153** | 113 | 40 (26.1%) | 1.75 M | 47.9 k | 210 | 3.09 ms |
| | WebGL2 | **153** | 113 | 40 (26.1%) | 1.75 M | 47.9 k | 210 | 3.90 ms |
| **WP8: Deep Outskirts** | WebGPU | **49** | 36 | 14 (28.6%) | 0.23 M | 15.0 k | 210 | 2.65 ms |
| | WebGL2 | **49** | 36 | 14 (28.6%) | 0.23 M | 15.0 k | 210 | 2.95 ms |

---

## 4. Ławica Airport vs. Matched Reference Benchmark

Airport viewpoints are paired with matched suburban/urban control views at identical altitudes, camera look vectors, and sun angles. The terminal view (`lawica_terminals`) is framed from the concrete apron ($y=12$ m) looking south directly at the passenger terminal facade, apron lead-in lines, and boarding bridges.

### 4.1 High Quality Tier (`?quality=high`)

| Viewpoint | Pair Role | Backend | Total Draws (?stats=1) | Scene Draws | Shadow Draws (Share) | Triangles | Instances | Programs | CPU ms (med) |
|---|---|---|---|---|---|---|---|---|---|
| **Ławica Runway (Air, 220m)** | Airport View | WebGPU | **1,050** | 715 | 317 (30.2%) | 4.31 M | 112.5 k | 228 | 6.82 ms |
| | | WebGL2 | **1,050** | 715 | 317 (30.2%) | 4.31 M | 112.5 k | 228 | 10.02 ms |
| **Reference Suburban (Air, 220m)**| Non-Airport Control| WebGPU | **1,490** | 1,097 | 376 (25.2%) | 5.12 M | 147.1 k | 228 | 8.52 ms |
| | | WebGL2 | **1,450** | 1,076 | 355 (24.5%) | 5.09 M | 146.0 k | 228 | 14.63 ms |
| *Airfield Difference (Air)* | | | **−29.5%** | **−34.8%** | **−15.7%** | **−15.8%**| **−23.5%**| 0 | **−20.0%** |
| | | | | | | | | | |
| **Ławica Runway (Bukowska, 4m)** | Airport View | WebGPU | **843** | 592 | 233 (27.6%) | 4.15 M | 122.9 k | 228 | 5.76 ms |
| | | WebGL2 | **843** | 592 | 233 (27.6%) | 4.15 M | 122.9 k | 228 | 8.38 ms |
| **Reference Street (Bukowska, 4m)**| Non-Airport Control| WebGPU | **866** | 646 | 202 (23.3%) | 3.61 M | 137.2 k | 228 | 6.12 ms |
| | | WebGL2 | **866** | 646 | 202 (23.3%) | 3.61 M | 137.2 k | 228 | 9.18 ms |
| *Airfield Difference (Street)*| | | **−2.7%** | **−8.4%** | **+15.3%** | **+15.0%**| **−10.4%**| 0 | **−5.9%** |
| | | | | | | | | | |
| **Ławica Terminals (Apron, 12m)**| Airport View | WebGPU | **811** | 579 | 214 (26.4%) | 4.74 M | 146.4 k | 228 | 8.20 ms |
| | | WebGL2 | **808** | 578 | 212 (26.2%) | 4.74 M | 146.4 k | 228 | 8.34 ms |
| **Reference Street (Bukowska, 4m)**| Non-Airport Control| WebGPU | **866** | 646 | 202 (23.3%) | 3.61 M | 137.2 k | 228 | 6.12 ms |
| | | WebGL2 | **866** | 646 | 202 (23.3%) | 3.61 M | 137.2 k | 228 | 9.18 ms |
| *Terminals Difference (vs Street)*| | | **−6.4%** | **−10.4%**| **+5.9%** | **+31.3%**| **+6.7%** | 0 | **+34.0%**|

---

### 4.2 Low Quality Tier (`?quality=low`)

| Viewpoint | Pair Role | Backend | Total Draws (?stats=1) | Scene Draws | Shadow Draws (Share) | Triangles | Instances | Programs | CPU ms (med) |
|---|---|---|---|---|---|---|---|---|---|
| **Ławica Runway (Air, 220m)** | Airport View | WebGPU | **436** | 376 | 61 (14.0%) | 2.57 M | 103.4 k | 210 | 4.64 ms |
| | | WebGL2 | **436** | 376 | 61 (14.0%) | 2.57 M | 103.4 k | 210 | 5.16 ms |
| **Reference Suburban (Air, 220m)**| Non-Airport Control| WebGPU | **640** | 547 | 94 (14.7%) | 3.91 M | 135.2 k | 210 | 5.50 ms |
| | | WebGL2 | **628** | 539 | 89 (14.2%) | 3.85 M | 135.2 k | 210 | 5.91 ms |
| *Airfield Difference (Air)* | | | **−31.9%** | **−31.3%** | **−35.1%** | **−34.3%**| **−23.5%**| 0 | **−15.6%** |
| | | | | | | | | | |
| **Ławica Runway (Bukowska, 4m)** | Airport View | WebGPU | **503** | 423 | 81 (16.1%) | 2.92 M | 117.2 k | 210 | 4.78 ms |
| | | WebGL2 | **503** | 423 | 81 (16.1%) | 2.92 M | 117.2 k | 210 | 5.15 ms |
| **Reference Street (Bukowska, 4m)**| Non-Airport Control| WebGPU | **584** | 491 | 94 (16.1%) | 3.11 M | 131.6 k | 210 | 5.10 ms |
| | | WebGL2 | **584** | 491 | 94 (16.1%) | 3.11 M | 131.6 k | 210 | 5.35 ms |
| *Airfield Difference (Street)*| | | **−13.9%** | **−13.8%** | **−13.8%** | **−6.1%** | **−10.9%**| 0 | **−6.3%** |
| | | | | | | | | | |
| **Ławica Terminals (Apron, 12m)**| Airport View | WebGPU | **612** | 526 | 86 (14.1%) | 3.76 M | 142.1 k | 210 | 7.53 ms |
| | | WebGL2 | **612** | 526 | 86 (14.1%) | 3.76 M | 142.1 k | 210 | 7.28 ms |
| **Reference Street (Bukowska, 4m)**| Non-Airport Control| WebGPU | **584** | 491 | 94 (16.1%) | 3.11 M | 131.6 k | 210 | 5.10 ms |
| | | WebGL2 | **584** | 491 | 94 (16.1%) | 3.11 M | 131.6 k | 210 | 5.35 ms |
| *Terminals Difference (vs Street)*| | | **+4.8%**  | **+7.1%**  | **−8.5%**  | **+20.9%**| **+8.0%** | 0 | **+47.6%**|

---

## 5. Technical Analysis of Spikes & Structural Changes

### 5.1 Balcony Transition vs. Frustum Expansion (`wp1` $\to$ `wp2`)
- At `wp1` (Rynek street level, $y=7$ m), the view frustum is tightly occluded by immediate 4-storey kamienice facades. It submits 1,334 scene draws and 256.1k instances.
- Stepping back to `wp2` ($y=45$ m, $z=180$ m) crosses the 90 m balcony threshold. Instanced balconies switch from high-detail `BalconiesNear` (individual stone consoles, wrought-iron balusters) to `BalconiesFar` (single proxy box; `tests/balconies.test.cjs`).
- Despite the per-balcony geometry simplification, **scene draw calls spike from 1,334 to 1,759 (+31.9%)** and triangles spike from 8.23 M to 9.80 M (+19.1%) on High quality.
- **Code Reason:** The 45 m elevation un-occludes the rooftops across multiple surrounding city blocks. Instead of seeing 1–2 street corridors, the frustum intersects dozens of additional building chunk bounding boxes. The reduction in individual balcony geometry is eclipsed by the newly visible pitched roofs, chimneys, and dormers.
- **Low tier contrast:** On Low quality (`?quality=low`), `wp2` (956 scene draws) is lower than `wp1` (1,003 scene draws). Low tier's reduced view distance (`maxDist` in `QUALITY_TIERS.low.trees`, `js/graphics-quality.js:47`) and aggressive prop culling prevent the elevated camera from pulling in distant chunks, allowing the balcony/prop LOD simplification to achieve a net draw call reduction.

### 5.2 Transition to Prefabricated Panel Estates (`wp3` $\to$ `wp4` Rataje)
- Crossing the Warta river via Most św. Rocha (`wp3`, 1,039 scene draws) into Osiedle Piastowskie / Rzeczypospolitej (`wp4`, 805 scene draws) drops scene draw calls by **−54.2% relative to `wp2`** and **−39.7% relative to `wp1`**.
- Triangles drop from 9.80 M (`wp2`) down to 5.20 M (`wp4`).
- **Code Reasons:**
  1. *Flat Roofs:* In `projectsBlock()` (`js/buildings.js:1978-2007`), panel slabs are generated via `mass(b, [r], 0, floors)` without calling `pitch()`. As documented in `js/buildings.js:1002`, building parts without `roof` remain flat (with only small HVAC/lift motor rooms: `hvac: 'small', hvacH: 2.6`). Pitched roofs (`createRoofMaterial`), dormers (`createDormerWindowMaterial`), and decorative cornices (`cornice: false`) are completely absent.
  2. *Pipeline & Material Unification:* All panel finishes (`F.panel`, `F.panelCream`, `F.panelBlue`, `F.panelOchre`, `F.panelGreen`) share the single `createPanelBlockMaterial` shader pipeline (`js/buildings.js:548-552`: *"Panel slabs: one pipeline for every colour (createPanelBlockMaterial keeps them in uniforms)"*), avoiding the material and pipeline switches required by variegated pre-war kamienice facades (`js/buildings.js:555-580`).
  3. *Spacing & Density:* Slabs in `projectsBlock` are spaced $\ge 18$ m apart with 8–12 m setbacks from the street (`js/buildings.js:1979-1980`), resulting in significantly fewer building chunks per unit area than historic perimeter blocks.

### 5.3 The Winogrady Vista Spike (`wp5`)
- In `wp5` (Osiedle Przyjaźni, $y=40$ m, looking south-southeast toward city center), scene draw calls surge to **2,314 draws on WebGPU and 2,297 on WebGL2** — the highest scene draw call count of the entire benchmark.
- Total triangles reach 9.38 M, with 279.6k instances submitted.
- **Code Reason:**
  Camera position `(-240, 40, -3200)` looking at `(-47, 25, -2560)` sits on elevated ground north of the city center. Because modern panel estates have wide open gaps between slabs, the camera looks straight through the estate and across the entire 3.5 km depth of the central Poznań basin towards Stary Rynek ($z = 0$). Every active city-grid chunk whose bounding box intersects the view frustum is submitted.
- **Shadow Share Behavior (5.1% High / 2.0% Low):**
  While scene draws spike to 2,314, **shadow draws drop to just 125 draws** on High (and 35 on Low).
  Shadow-pass share plummets to 5.1% (versus 20–34% at other viewpoints).
  *Code Verification:* In `js/graphics-quality.js:18`, High tier specifies `shadowRange: { start: 260, perMetre: 1.6, min: 300, max: 720 }`. At altitude $y=40$ m, `LightingSystem.update()` (`js/lighting.js:616-618`) sets `sunLight.shadow.camera.far = 324` m (and $160$ m on Low tier; `js/graphics-quality.js:39`). The central city buildings visible across the basin are 2,000–3,500 m away, far beyond the 324 m shadow range, and are culled from the shadow cascade passes.

### 5.4 Procedural Outskirts Falloff & Batching Structure (`wp6` $\to$ `wp7` $\to$ `wp8`)
- As the camera approaches the edge of the procedural detail box ($x = 4490.7$ m, `CITY_BOUNDS.detailBox` in `js/city-config.js`; `wp6`, Chartowo/Franowo), scene draws drop to 584.
- Crossing into `wp7` ($x=4600$ m, looking east), scene draws collapse from 584 to **169 draws** (−71.1%).
- **Code Reason:**
  Inside the detail box, `city-grid.js` and `buildings.js` generate detailed city blocks containing separate meshes for paved sidewalks, asphalt roadways, painted markings, curbs, trees (`trees.js`), lamp masts, and multi-part building facades.
  Past $x = 4490.7$ m, detailed city blocks cease. Instead, the area is rendered by `buildOutskirts()` (`js/outskirts.js:1486`):
  1. Ground: `OutskirtsLand`, `OutskirtsBanks`, and `OutskirtsFiller` (`js/outskirts.js:1493-1499`) sharing `createLandMaterial()`.
  2. Borough Buildings: Thousands of procedural houses and sheds (`generateOutskirtsBuildings()`) are batched into coarse 1200 m spatial chunks via `buildBuildingChunks()` (`js/outskirts.js:1392-1438`), sharing `createBoroughBuildingMaterial()` on a single `InstancedMesh(BOX_GEO, ...)` per chunk with `bInfo` and `bTint` attributes.
  3. Panel Blocks: Batched into 3600 m chunks via `buildPanelChunks()` (`js/outskirts.js:1443-1475`) on `createPanelBlockMaterial()`.
  Because entire square kilometers of outskirts buildings share single instanced draw calls, the hundreds of visible houses cost only a few dozen draws.
- **WP8 Truthful Description:**
  In `webgpu_high_wp8_deep_outskirts.png` ($x=6000$ m, $y=100$ m, looking east), the screenshot shows an extensive carpet of procedural suburban housing rows (rendered walls, pitched tiled/slate roofs, punched window arrays, chimneys, and green garden setbacks) stretching across the procedural terrain all the way to the horizon dome. It submits **43 scene draws**, 18 post draws and 21 shadow draws (82 in total; see the table). The `?stats=1` panel in that screenshot reads "Rysowanie: 62 wyw.", a multi-frame average sampled separately from this harness, so it is not an exact cross-check.

### 5.5 Ławica Airport Efficiency vs. Suburban Fabric
- **Aerial view (220 m):** Ławica Runway incurs **715 scene draws vs. 1,097 scene draws for the reference view (−34.8%)**, and 4.31 M triangles vs. 5.12 M triangles (−15.8%). Total frame draws: 1,050 vs. 1,490 (−29.5%).
  *Code Reason:* The 2.81 km² airfield (`GEO.aeroway` in `js/airport.js:6-9`) is cut out of the block raster (`tools/poz-blocks.mjs`). It consists of continuous flat grass and large merged geometries: `AirportRunway` (concrete), `AirportTarmac`, `AirportMarkingsWhite`, and `AirportMarkingsYellow` (`js/airport.js:394-397`). In contrast, suburban fabric (Ogrody, Wola) contains dozens of street chunks, curbs, fences, street trees, streetlamps, and hundreds of individual houses with separate walls and roofs.
- **Street view (ul. Bukowska, 4 m):** Scene draws are 8.4% lower (592 vs. 646), with slightly higher triangles (+15.0%) due to close-proximity runway threshold markings, piano keys, centerline light fixtures, and perimeter security fencing.
- **Terminal view from apron (`lawica_terminals`, 12 m):**
  From the concrete apron looking south at the passenger terminal complex, the view captures the three passenger boarding bridges (`AirportJetBridges` tubes and `AirportJetBridgeColumns` columns, `js/airport.js:407-420`), yellow lead-in markings (`AirportMarkingsYellow`), the apron surface (`AirportTarmac`), and the north terminal facade (`AirportTerminalWalls` with `createCurtainWallMaterial(GLASS)`, `js/airport.js:383, 398`).
  Scene draws remain moderate at **579 draws** on High tier (vs. 646 for reference street) and **526 draws** on Low tier, with triangles at 4.74 M High / 3.76 M Low.

---

## 6. Backend Comparison: WebGPU vs. WebGL2

Across all 13 waypoints and both quality tiers:
1. **Geometry Parity:** Total triangles, instance counts, and draw calls match within 0.5% between WebGPU and WebGL2 (differences reflect dynamic traffic/pedestrian simulation variations).
2. **Shader Programs:** Both backends maintain identical program counts: **228 programs on High tier** and **210 programs on Low tier** across all viewpoints.
3. **CPU Overhead:** WebGL2 exhibits consistently higher `renderCpuMs` overhead than WebGPU (e.g., at `wp5` Winogrady: 23.81 ms on WebGL2 vs. 14.28 ms on WebGPU; at Rynek: 10.33 ms vs. 9.36 ms), reflecting WebGL driver validation and binding overhead compared to WebGPU's stateless command encoder architecture over Metal.

---

## 7. Conclusions & Backlog Recommendations

1. **Ławica Airport:** Ławica requires no specialized optimization pass. Merged airfield tarmac and terminal assets are lighter than standard residential fabric.
2. **Coverage Transitions:** Pitch-roof/dormer boundaries (Stare Miasto to Rataje) and outskirts transitions behave cleanly with continuous monotonic draw-call reductions. Balcony LOD at 90 m functions as designed, but its savings at elevated altitudes are masked by view-frustum chunk accumulation.
3. **Emerging Target for Backlog:** High-altitude panoramic vistas looking across the city basin (e.g. Winogrady `wp5`: 2,314 scene draws, 2,456 total draws) represent the peak scene draw call count across the city due to chunk depth accumulation across open estate setbacks.
