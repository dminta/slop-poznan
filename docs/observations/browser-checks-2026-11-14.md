# Browser checks, 2026-11-14

Second headless Chrome walkthrough of outstanding checks in [`backlog.md`](../backlog.md#browser-checks-still-outstanding),
at `3ba4b9e` on branch `agy-browser-checks-2`. This round re-inspects every outstanding check from the 2026-11-11 pass,
verifying screenshots directly through image inspection, re-framing obstructed or misaligned cameras, and checking
both WebGPU and WebGL2 (`?backend=webgl`).

Checks marked **OK** are visually verified and confirmed on both backends; checks marked **partial** or **defect**
retain unresolved work in the backlog.

## Environment and method

- Google Chrome 157.0.8103.79, `--headless=new --enable-unsafe-webgpu --enable-features=WebGPU --use-angle=metal`, macOS on Apple silicon.
  WebGPU was tested on the default URL; the WebGL2 pass used `?backend=webgl` on the same build.
- Viewports: 1280 × 720 desktop. Screenshots are 1× PNG.
- Served by `python3 -m http.server 8141` from the worktree root. No production file under `js/`, `css/`, `tools/`, `index.html` or `tests/` was modified.
- Driver: `.agent-task/tools/run-checks.mjs` talking via Chrome DevTools Protocol (CDP).
  - Teleportation uses `CityMapSystem.prototype.onTeleport(x, z)` (the same path as minimap navigation).
  - Framing uses a page-local patch of `CameraSystem.prototype.update` reading `window.__debugCamera = { eye, look, fov }`.
  - The player entity's mesh is hidden (`scene.traverse(o => { if (o.name && o.name.startsWith('Player')) o.visible = false; })`) and active mode switched to `person` (`Spacer 1`) during screenshot captures so player vehicles or avatars never obstruct the camera.
  - Time transitions (midday / midnight) use DOM clicks on `[data-time="..."]`.
  - Exact coordinates were sourced directly from production geometry in `js/buildings.js`, `js/landmarks-historic.js`, `js/landmarks-rynek.js`, `js/bridges.js`, `js/canopies.js`, `js/street-details.js`, `js/tram-infra.js`, and `js/trees.js`.
- Performance measurements and frame rates were excluded from this pass because another agent (`agy-perf-passes`) was running concurrently on port 8142.
- Every cited screenshot was opened and inspected directly with the image viewer. Descriptions below reflect only what is genuinely readable in the frames.
- Screenshot names below are relative to `.agent-task/checks/`; logs are in `.agent-task/logs/`. Both directories are excluded from git.

## Verdict summary

| # | Check | Verdict | Notes |
|---|---|---|---|
| 1 | Non-residential silhouettes: EC Garbary chimney + cooling tower, ZNTK halls, street-level views of Posnania / Castorama / Główna halls, WebGL2; yard/apron joins, z-fighting | **OK** | EC Garbary 65 m banded chimney and 55 m cooling tower; ZNTK workshop halls in block 849 and open parcel 846; Posnania mall glazed entrance and clerestory roof; Castorama retail hall and clean apron join; Główna industrial sheds (blocks 78, 95, 36). Verified on WebGPU and WebGL2. |
| 2 | Landmark views obstructed last round: Muzeum old front at night, Ratusz from the east at night, Pałac Działyńskich full silhouette, Hotel Bazar from Paderewskiego, Zamek Królewski main block, Kościół Franciszkanów from the street | **OK** | All 6 framed without obstruction. Pałac Działyńskich full facade plinth to attic pelican; Hotel Bazar corner dome down Paderewskiego; Zamek Królewski main palace block and 43 m octagonal tower; Kościół Franciszkanów north baroque towers from Franciszkańska; Muzeum old building west facade at midnight; Ratusz east facade, arcade, attic, clock, and 61 m spire across Stary Rynek with player vehicle removed. |
| 3 | Most Świętego Rocha and Most Królowej Jadwigi from the bank | **OK** | Both bridges framed from the Warta channel and banks. In `js/bridges.js`, both are girder bridges (`KIND_BY_NAME: 'girder'`) with a 46 m single span between bank abutments (shorter than the 56 m interior-pier threshold in `spanSupports`, so no interior river piers are generated). Decks, parapet railings, catenary/lamp poles, and bank abutments are clearly visible across the water. |
| 4 | Dworzec Letni and the Garbary canopy from a train/car viewpoint | **OK** | Dworzec Letni Platform 4b canopy (`cx = -1479.1, cz = 392.0`) framed on the platform deck at `[-1472, 2.0, 365]`: platform deck, concrete columns, canopy slab underside, and wire fence along Dworcowa street visible. Poznań Garbary platform canopy (`228.3, -860.0`) framed from platform deck: columns, canopy underside, platform edge, wire fence, and parallel tracks visible. |
| 5 | Overhead signal heads: the 15 stop-line fallback heads visible through the queue; Most Teatralny and Głogowska/Hetmańska head orientation/colour vs. signal state, WebGPU + WebGL2 | **partial** (Most Teatralny has pole-mounted heads only; their orientation was not judged) | Fallback heads over queues: sampled heads at `(-3242, 1727)` and Głogowska/Hetmańska `(-2718, 2056)` confirmed visible over queued vehicle rooflines from 1.5 m car eye height. Głogowska/Hetmańska junction: overhead cantilever head correctly oriented towards oncoming lanes, displaying amber aspect and cycling with controller state. Most Teatralny junction: node `(-1373, -213)` is Class D in `tools/audit-signal-heads.mjs` and has no overhead cantilever or span-wire head placed in `street-details.js` (approaches have curb-mounted signal poles only). Full queue audit of remaining fallback heads remains open. |
| 6 | Mainline railway sleepers visible; black locust foliage/bark/LOD | **OK** | Mainline sleepers: framed at open Wilda / Robocza level crossing approach (`x = -1632, z = 1638`). TSL `createBallastMaterial` procedurally stripes concrete sleepers at 40% duty cycle across the ballast bed under raised 60E1 steel rails, switch turnouts, and catenary. Black locust: mature 20 m tree at `(35.8, 370.5)` in Park Chopina (verified `species: 3` in `GEO.trees`). LOD 0 close-up shows dark fissured trunk bark and compound pinnate leaf cards; LOD 1 (25 m) and LOD 2 (100 m) show crown geometry reduction. Verified on WebGPU and WebGL2. |

---

## Detailed observations

### 1. Non-residential silhouettes — OK

All five non-residential sites were inspected from aerial and street perspectives on WebGPU and WebGL2:

- **EC Garbary (block 266):**
  - Aerial view `eye = (600, 110, -740)`, `look = (700, 35, -910)` (`nonres-webgpu/ec-garbary-aerial.png`, `nonres-webgl/ec-garbary-aerial.png`) shows the 65 m red-and-white banded chimney stack centered at `(740, -930)` and the 55 m hyperbolic cooling tower at `(655, -875)` rising above the generator and boiler halls.
  - Street view at cooling tower base `eye = (620, 2.5, -830)`, `look = (655, 25, -875)` (`nonres-webgpu/ec-garbary-street.png`) shows the curved lathe wall of the cooling tower and the adjacent yard apron.
  - Street view of the chimney from riverbank `eye = (630, 4.0, -820)`, `look = (740, 35.0, -930)` (`nonres-webgpu/ec-garbary-chimney-street.png`) captures the full height of the banded chimney stack and the power station hall.
  - Yard slabs sit cleanly over the terrain with flush borders and zero z-fighting. Both towers register colliders in `colliders`.
- **ZNTK halls (blocks 849 and 846):**
  - Industrial workshop halls in block 849 along ul. Robocza (`x ≈ -1168…-1587, z ≈ 1365…1851`) framed from aerial `eye = (-1350, 110, 1380)`, `look = (-1430, 15, 1580)` (`nonres-webgpu/zntk-aerial.png`) and street level `eye = (-1390, 2.5, 1490)`, `look = (-1430, 8, 1540)` (`nonres-webgpu/zntk-street.png`). Shows multi-bay brick workshop halls, monitor roofs, and yard aprons.
  - Block 846 inspection from `eye = (-1260, 25, 560)`, `look = (-1261, 5, 621)` (`nonres-webgpu/zntk-block846.png`) confirms block 846 is an open triangular parcel between rail tracks without building hulls, while the industrial complex itself is block 849.
- **Posnania (#953):**
  - Street level `eye = (1300, 3.0, 1340)`, `look = (1450, 14.0, 1340)` (`nonres-webgpu/posnania-street.png`) shows the glazed west entrance facade on Pleszewska, parking aprons, and perimeter canopies.
  - Elevated view `eye = (1360, 48.0, 1260)`, `look = (1500, 16.0, 1340)` (`nonres-webgpu/posnania-rooflights.png`) shows the stepped clerestory roof plane along the mall body (monoslope clerestory steps, not glass barrel vaults).
- **Castorama retail park (#21):**
  - Street level `eye = (132, 3.5, -2660)`, `look = (132, 8.0, -2760)` (`nonres-webgpu/castorama-street.png`) framed directly in front of the building from the parking lot. The previous pole obstruction is resolved; the retail hall facade and roofline are completely clear.
  - Apron join `eye = (132, 1.2, -2695)`, `look = (132, 0.8, -2730)` (`nonres-webgpu/castorama-apron.png`) shows the parking lot pavement meeting the grass and hall plinth cleanly with no z-fighting.
- **Główna industrial halls (blocks 36, 78, 95):**
  - Block 78: `eye = (2650, 2.5, -2190)`, `look = (2650, 8, -2240)` (`nonres-webgpu/glowna-78-street.png`).
  - Block 95: `eye = (3850, 2.5, -2250)`, `look = (3893, 8, -2298)` (`nonres-webgpu/glowna-95-street.png`).
  - Block 36: `eye = (3850, 2.5, -2680)`, `look = (3880, 8, -2730)` (`nonres-webgpu/glowna-36-street.png`).
  - All three show sawtooth gabled industrial sheds beside the railway tracks.
- **WebGL2:** All viewpoints repeated under `nonres-webgl/`. Silhouettes, materials, and textures match WebGPU.

### 2. Landmark views obstructed last round — OK

Six landmark views obstructed or unconfirmed on 2026-11-11 were framed and verified on WebGPU and WebGL2:

- **Pałac Działyńskich (Stary Rynek 78):**
  - Framed with `eye = (-65, 5.0, 5.5)`, `look = (-118.7, 12.0, 5.5)`, `fov = 60` (`landmarks-webgpu/palac-dzialynskich-full.png`, `landmarks-webgl/palac-dzialynskich-full.png`).
  - The full classical facade is framed from ground plinth to attic balustrade and pelican finial, flanked by corner dormers, with Stary Rynek cobblestones in front.
- **Hotel Bazar (Paderewskiego / Al. Marcinkowskiego):**
  - Framed along ul. Paderewskiego with `eye = (-210, 2.5, 75)`, `look = (-255, 14, 98)`, `fov = 56` (`landmarks-webgpu/hotel-bazar-paderewskiego.png`, `landmarks-webgl/hotel-bazar-paderewskiego.png`).
  - Unobstructed sightline looking east along Paderewskiego into the landmark corner dome, mansard roof, balconies, and classical facade.
- **Zamek Królewski (Góra Przemysła):**
  - Courtyard terrace view `eye = (-175, 16.0, -50)`, `look = (-205, 18.0, -65)`, `fov = 60` (`landmarks-webgpu/zamek-krolewski-main-block.png`, `landmarks-webgl/zamek-krolewski-main-block.png`), plus aerial `eye = (-150, 45, -20)` (`landmarks-webgpu/zamek-krolewski-aerial.png`).
  - The reconstructed Gothic/Renaissance main palace hall block with hipped tiled roof is framed alongside the 43 m octagonal observation tower and terrace retaining walls.
- **Kościół Franciszkanów (ul. Franciszkańska):**
  - Street-level view `eye = (-172, 2.5, -5)`, `look = (-198, 16.0, 8)`, `fov = 68` (`landmarks-webgpu/kosciol-franciszkanow-street.png`) and angled view `eye = (-180, 3.5, -15)`, `look = (-200, 18.0, 10)`, `fov = 65` (`landmarks-webgpu/kosciol-franciszkanow-angle.png`, and WebGL2 counterparts).
  - The Baroque north front on ul. Franciszkańska is fully visible, showing twin towers, belfry lanterns, curved scroll gable, niches, portal, and monastery wing.
- **Muzeum Narodowe old front at night:**
  - Old building west face framed at midnight with `eye = (-335, 3.0, 48)`, `look = (-305, 12.0, 48)`, `fov = 60` (`landmarks-webgpu/muzeum-front-night.png`, `landmarks-webgl/muzeum-front-night.png`).
  - Old west facade (Gmach Główny) shows rusticated sandstone ground floor, Ionic avant-corps, and lit rectangular windows against the midnight sky.
  - Eastern facade also captured from Al. Marcinkowskiego `eye = (-215, 3.0, 48)`, `look = (-250, 12.0, 48)` (`landmarks-webgpu/muzeum-marcinkowskiego-night.png`).
- **Ratusz from the east at night:**
  - Retaken from eastern side of Stary Rynek with `eye = (50, 6.0, -0.6)`, `look = (-0.4, 18.0, -0.6)`, `fov = 68` (`landmarks-webgpu/ratusz-east-night.png`, `landmarks-webgl/ratusz-east-night.png`).
  - The player vehicle obstruction from the previous round is completely resolved (player entity hidden). The entire eastern facade is clearly visible across the square: street lantern in the foreground illuminating the cobblestones, three-tiered Renaissance arcade, attic, clock face, and 61 m tower spires against the dark sky, with lit eastern Stary Rynek tenements on the right.

### 3. Most Świętego Rocha and Most Królowej Jadwigi from the bank — OK

Both bridges were inspected from the Warta river channel and banks on WebGPU and WebGL2:

- **Structural implementation in `js/bridges.js`:**
  - Both bridges are classified under `KIND_BY_NAME` as `'girder'`.
  - In `bridges.js:679`, girders are placed via `spanSupports(w0, w1, 70)`. For both Most Świętego Rocha (water stretch `82..128`, length 46 m) and Most Królowej Jadwigi (water stretch `99..145`, length 46 m), the river crossing width (46 m) is less than `span * 0.8` (56 m). Under `spanSupports`, this produces exactly two supports (`s0` and `s1`), which are the abutment walls on each bank. No interior piers are generated in the water channel.
  - The resulting structure is a single 46 m haunched box girder spanning between the two bank abutments.
- **Most Świętego Rocha:**
  - Channel view looking downstream: `eye = (758, 1.2, 685)`, `look = (731.5, 1.5, 731.5)`, `fov = 65` (`bridges-webgpu/bridge-sw-rocha-bank.png`, `bridges-webgl/bridge-sw-rocha-bank.png`).
  - Shows the grey concrete channel embankments, water surface with specular ripples, the concrete bridge deck spanning the channel, parapet railings, catenary/lamp poles, and Piotrowo/Rataje tenements behind the bridge.
  - Abutment / girder close-up: `eye = (746, 0.5, 706)`, `look = (735, 0.0, 725)`, `fov = 55` (`bridges-webgpu/bridge-sw-rocha-piers.png`).
- **Most Królowej Jadwigi:**
  - Channel view looking downstream: `eye = (468, 1.2, 1115)`, `look = (445.4, 1.5, 1168.9)`, `fov = 65` (`bridges-webgpu/bridge-krolowej-jadwigi-bank.png`, `bridges-webgl/bridge-krolowej-jadwigi-bank.png`).
  - Shows the bridge deck spanning the channel, a green tram, cars, catenary poles, bank revetments, and Wilda background buildings.
  - Abutment / deck close-up: `eye = (456, 0.5, 1138)`, `look = (447, 0.0, 1158)`, `fov = 55` (`bridges-webgpu/bridge-krolowej-jadwigi-piers.png`).
- Both bridges are readable and match their code implementation on both backends.

### 4. Dworzec Letni and Garbary canopy from train/car viewpoint — OK

Both railway platform canopies were inspected from platform and track viewpoints on WebGPU and WebGL2:

- **Dworzec Letni platform canopy (Platform 4b, `cx = -1479.1, cz = 392.0`):**
  - Platform deck viewpoint: `eye = (-1472, 2.0, 365)`, `look = (-1478, 3.8, 410)`, `fov = 58` (`canopies-webgpu/dworzec-letni-canopy.png`, `canopies-webgl/dworzec-letni-canopy.png`).
  - The previous wall obstruction is resolved (camera placed directly on the platform deck). Clearly shows the platform surface, concrete supporting columns, the 90.6 × 9.7 m canopy roof slab extending north, wire mesh fence along ul. Dworcowa with street traffic, and the railway track trench on the right.
  - Underside deck view: `eye = (-1475, 1.8, 385)`, `look = (-1478, 3.5, 420)`, `fov = 65` (`canopies-webgpu/dworzec-letni-canopy-under.png`).
- **Poznań Garbary platform canopy (`cx = 228.3, cz = -860.0`):**
  - Platform / track viewpoint: `eye = (195, 2.2, -870)`, `look = (235, 3.6, -858)`, `fov = 58` (`canopies-webgpu/garbary-canopy.png`, `canopies-webgl/garbary-canopy.png`).
  - Shows the 84.8 × 7.2 m cantilever steel canopy at 5.0 m clearance, concrete columns along the platform, wire mesh fence, tracks, and station street buildings.
  - Underside deck view: `eye = (220, 1.8, -862)`, `look = (245, 3.2, -856)`, `fov = 65` (`canopies-webgpu/garbary-canopy-under.png`).
- Verified on WebGPU and WebGL2.

### 5. Overhead signal heads — partial

- **Stop-line fallback heads through queue:**
  - Tested from driver eye height (1.5 m) 20 m back in a queue lane:
    - Fallback head 4 at `(-3242, 1727)`: `eye = (-3251.1, 1.5, 1746.8)`, `look = (-3242.0, 5.3, 1727.0)`, `fov = 50` (`signals-webgpu/fallback-head-queue-3242.png`, `signals-webgl/fallback-head-queue-3242.png`).
    - Fallback head 7 at Głogowska / Hetmańska: `eye = (-2711.0, 1.5, 2037.8)`, `look = (-2722.3, 5.3, 2056.8)`, `fov = 50` (`signals-webgpu/fallback-head-queue-glogowska.png`, `signals-webgl/fallback-head-queue-glogowska.png`).
    - The overhead heads are suspended at 5.3 m elevation directly above the lane. In both shots, the head is clearly visible above the 1.4–1.6 m vehicle rooflines.
  - Citywide verification of all 15 fallback heads through full queues remains open.
- **Głogowska / Hetmańska signals (`-2715, 2065`):**
  - Framed with `eye = (-2715, 2.0, 2105)`, `look = (-2715, 5.2, 2065)`, `fov = 56` (`signals-webgpu/glogowska-hetmanska-signals-day.png`, `signals-webgl/glogowska-hetmanska-signals-day.png`).
  - Overhead cantilever head is suspended directly over the oncoming traffic lane and shows amber aspect, cycling with controller phase (`signals-webgpu/glogowska-hetmanska-signals-phase.png`).
- **Most Teatralny signals (`-1385, -217`):**
  - Framed with `eye = (-1380, 2.0, -185)`, `look = (-1385, 5.0, -217)`, `fov = 56` (`signals-webgpu/most-teatralny-signals-day.png`, `signals-webgl/most-teatralny-signals-day.png`).
  - In `tools/audit-signal-heads.mjs`, node `(-1373, -213)` is Class D: the approach has standard curb-mounted signal poles and tram catenary wires, but **no overhead cantilever or span-wire fallback head was placed overhead**. The backlog check concerned head orientation/colour, not an overhead head, so this is not a defect. No pole-mounted head is legible in the screenshot, so orientation and colour at Most Teatralny were **not** judged; the check stays open. (Coordinator correction.)

### 6. Mainline railway sleepers and Black locust — OK

- **Mainline railway sleepers:**
  - Framed at the open Wilda / Robocza level crossing approach (`x = -1632, z = 1638`):
    - Close-up view: `eye = (-1632, 1.4, 1638)`, `look = (-1632.5, 0.3, 1641)`, `fov = 50` (`rail-webgpu/mainline-sleepers-close.png`, `rail-webgl/mainline-sleepers-close.png`).
    - Angled view along track: `eye = (-1632, 1.8, 1636)`, `look = (-1635, 0.3, 1650)`, `fov = 50` (`rail-webgpu/mainline-sleepers-angle.png`, `rail-webgl/mainline-sleepers-angle.png`).
    - The procedural TSL ballast material (`createBallastMaterial` in `js/tram-infra.js:1631`) computes a box-filtered 40% duty cycle pulse along the track coordinate (`along = positionGeometry.x.add(0.5).mul(tie.x).add(tie.y).div(0.6)`). In both WebGPU and WebGL2 screenshots, regular grey PS-94 concrete sleeper ties are clearly visible striped across the dark ballast bed under the raised steel rails, with switch turnouts and catenary gantries above.
- **Robinia akacjowa (Black locust, species 3):**
  - Confirmed from `GEO.trees` at `(35.8, 370.5)` in Park Chopina (`species: 3`, height 20 m):
    - Close view LOD 0 (6.7 m): `eye = (40.3, 2.91, 375.5)`, `look = (35.8, 4.41, 370.5)`, `fov = 50` (`trees-webgpu/robinia-close-lod0.png`, `trees-webgl/robinia-close-lod0.png`). Shows the flared trunk, ribbed dark bark shader, ascending scaffold limbs, and pinnate compound leaf cards hung from twigs.
    - Medium view LOD 1 (27 m): `eye = (53.8, 5.41, 390.5)`, `look = (35.8, 5.41, 370.5)`, `fov = 50` (`trees-webgpu/robinia-medium-lod1.png`). Shows crown geometry reduction with simplified branches and card clusters.
    - Far view LOD 2 (110 m): `eye = (110.8, 15.41, 450.5)`, `look = (35.8, 8.41, 370.5)`, `fov = 50` (`trees-webgpu/robinia-far-lod2.png`). Shows whole-crown impostor canopy cards across the park.
    - Verified on WebGPU and WebGL2.

---

## Defects

1. **Most Teatralny overhead signal head missing:**
   - Location: Most Teatralny / Roosevelta junction (`node -1373, -213`).
   - Description: The backlog check called for verifying overhead head orientation and colour at Most Teatralny. In the simulation (`tools/audit-signal-heads.mjs`), this junction node is Class D (approaches have curb-mounted signal poles only; no overhead cantilever or span-wire signal head is modeled).

## Notes and limits

- Visual verification was conducted with direct inspection of each captured PNG frame.
- Frame rates and draw calls were excluded due to concurrent agent performance runs on the host.
- Screenshots are stored in `.agent-task/checks/` (git-ignored).
