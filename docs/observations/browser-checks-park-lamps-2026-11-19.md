# Browser checks: narrow-walk `onLawn` park lamps — 2026-11-19

Re-audit of `parkLampSites` (`js/city-grid.js`) and headless Chrome visual verification of verified `onLawn` lamps at `899672c`.

## 1. Fresh headless audit (`tools/audit-park-lamps-trees.mjs`)

- Total `parkLampSites` (plazas + parks + Teatr Polski): **3,389** (down from 3,438 in [park-lamps-trees-2026-11-14.md](park-lamps-trees-2026-11-14.md); 3,390 after [tram-bed-surfaces-2026-11-14.md](tram-bed-surfaces-2026-11-14.md), 3,389 after `177bdc3`).
- Section 6 park-block lamps: **2,777** (was 2,823); plazas and Teatr Polski: **612** (was 615).
  - **On walk**: **2,655** (was 2,701)
  - **On walk edge (`<= 0.6 m`)**: **0**
  - **On lawn (`> 0.6 m`)**: **122** across **15** blocks (`(0.6, 1.0]`: **4**, `(1.0, 1.5]`: **117**, `(1.5, 2.0]`: **1**, `> 2.0`: **0**)
- Overlaps among the 2,777 park-block lamps: **0** tree trunk (`< 0.2 + 0.28 * scale`), **218** within tree crown (`< R_crown * scale`, was 227), **0** bench/prop, **0** building, **0** water/pond, **0** road carriageway (`< 0.2 m`), **0** rail (`< 2.0 m`), and **0** `parkLampSites` pairs `< 6 m`.
- Tightest clearances among the 122 `onLawn` lamps:
  - Deepest walk-edge offset: block 529 `(145.29, -300.99)` at **1.588 m**, block 147 `(-2284.45, -2277.35)` at **1.270 m**, block 340 `(-829.55, -1099.50)` at **1.258 m**, followed by 1.250 m sites in blocks 421 and 212.
  - Tree trunk: **0.742 m** at block 421 `(-1094.88, -612.03)`.
  - Building/wall collider: **0.334 m** at block 1301 `(2563.61, 2594.75)`.
  - Road carriageway: **1.090 m** at block 1358 `(-793.63, 2754.62)`.
  - Tram rail: **3.305 m** at block 303 `(-706.71, -1333.92)`.
- `onLawn` counts by block (15 blocks, 122 lamps): block 9 (`9`, `1.001–1.228 m`), block 146 (`4`, `1.024–1.139 m`), block 147 (`4`, `1.100–1.270 m`), block 212 (`14/14`, `1.000–1.250 m`), block 303 `Skwer Sybiraków` (`22/22`, `1.050 m`), block 312 (`8`, `1.000–1.250 m`), block 335 (`4`, `1.100–1.211 m`), block 340 (`15`, `1.048–1.258 m`), block 421 `Park Stanisława Moniuszki` (`15`, `1.000–1.250 m`), block 465 (`1`, `1.050 m`), block 529 (`3`, `1.000–1.588 m`), block 1111 (`5`, `1.043–1.133 m`), block 1301 (`8`, `1.050 m`), block 1358 (`2`, `1.200–1.220 m`), block 1372 (`8`, `1.050 m`).
- Za Cytadelą park blocks (`205, 212, 243, 251, 270, 303`, **232** lamps): block 212 (`14` `onLawn`, `0` `onWalk`), block 303 (`22` `onLawn`, `0` `onWalk`), blocks 205/243/251/270 (`196` `onWalk`, `0` `onLawn`).

## 2. Browser setup and console status

- Headless Google Chrome (`--headless=new --enable-unsafe-webgpu --use-angle=metal`, `--window-size=1280,720`, `--disable-extensions`, cache disabled) served via temporary `python3 -m http.server` on `127.0.0.1:8275`.
- Two full passes, 40 frames each (10 sites × close-up + context × midday + midnight):
  - **WebGPU high** (`/?quality=high`): `#hud-backend` = `WebGPU`, canvas `1280 × 577`, `[cityGrid] ... 3389 lampposts ...`, **0 errors, 0 warnings** across boot, midday/midnight `[data-time]` switches, player teleports, and camera moves.
  - **WebGL2 low** (`/?backend=webgl&quality=low`): `#hud-backend` = `WebGL2`, canvas `960 × 432`, `[cityGrid] ... 3389 lampposts ...`, **0 errors, 0 warnings** across boot, midday/midnight switches, player teleports, and camera moves.
- Camera framing pinned `CameraSystem.update` via CDP `Runtime.queryObjects` without modifying repository source files; player entity teleported out of the foreground (`18 m` behind the close-up eye) and HUD hidden via `#btn-toggle-hud`.

## 3. Framed `onLawn` sites

All 10 framed lamps sit at `y = 0.41` (`BED_Y`), with street-level close-ups (`eye y = 1.65`, `look y = 1.85`, `fov = 56°`) and elevated context views (`eye y = 5.20`, `look y = 1.60`, `fov = 56°`) from the walk/road side:

| Site | Block | Lamp `(x, y, z)` | Walk offset | Close-up eye `(x, y, z)` | Context eye `(x, y, z)` | Heading | Notes |
|---|---|---|---|---|---|---|---|
| `b212_south` | 212 `(unnamed)` | `(-817.47, 0.41, -1447.86)` | 1.250 m | `(-812.96, 1.65, -1450.33)` | `(-805.79, 5.20, -1452.31)` | -61.3° | Park lawn beside narrow walk & road |
| `b212_north` | 212 `(unnamed)` | `(-975.89, 0.41, -1836.83)` | 1.200 m | `(-979.56, 1.65, -1840.44)` | `(-983.54, 5.20, -1846.72)` | 45.5° | Grass median strip between Za Cytadelą carriageways |
| `b303_west` | 303 `Skwer Sybiraków` | `(-735.84, 0.41, -1256.60)` | 1.050 m | `(-738.30, 1.65, -1261.12)` | `(-740.26, 5.20, -1268.29)` | 28.5° | Narrow walk beside tram corridor (`rail 3.49 m`) |
| `b303_north` | 303 `Skwer Sybiraków` | `(-585.22, 0.41, -1086.72)` | 1.050 m | `(-589.95, 1.65, -1084.68)` | `(-597.27, 5.20, -1083.37)` | 113.4° | Narrow walk edge; close-up midday caught a passing van in foreground, context view clear |
| `b421_trunk` | 421 `Park Stanisława Moniuszki` | `(-1094.88, 0.41, -612.03)` | 1.250 m | `(-1097.04, 1.65, -616.70)` | `(-1098.54, 5.20, -623.98)` | 24.9° | Tightest `onLawn` trunk gap (`0.742 m`, centre-to-centre `1.29 m`) |
| `b421_open` | 421 `Park Stanisława Moniuszki` | `(-1021.48, 0.41, -424.63)` | 1.250 m | `(-1025.90, 1.65, -421.99)` | `(-1032.99, 5.20, -419.75)` | 120.8° | Corner/open narrow-walk lawn edge |
| `b529_worst` | 529 `(unnamed)` | `(145.29, 0.41, -300.99)` | 1.588 m | `(149.13, 1.65, -304.42)` | `(155.66, 5.20, -307.98)` | -48.2° | #1 deepest walk-edge offset citywide (`trunk 2.10 m`) |
| `b147_2nd` | 147 `(unnamed)` | `(-2284.45, 0.41, -2277.35)` | 1.270 m | `(-2285.88, 1.65, -2282.30)` | `(-2286.25, 5.20, -2289.72)` | 16.1° | #2 deepest walk-edge offset (`trunk 2.08 m`) |
| `b340_3rd` | 340 `(unnamed)` | `(-829.55, 0.41, -1099.50)` | 1.258 m | `(-832.09, 1.65, -1103.98)` | `(-834.18, 5.20, -1111.12)` | 29.6° | #3 deepest walk-edge offset (`trunk 2.44 m`) |
| `b1301_bld` | 1301 `(unnamed)` | `(2563.61, 0.41, 2594.75)` | 1.050 m | `(2558.50, 1.65, 2595.37)` | `(2551.11, 5.20, 2594.56)` | 97.0° | Tightest building/wall gap (`0.334 m` in front of low white arched park wall) |

## 4. Visual verdict — clean (pass)

- **Grounding & walk clearance:** every sampled `onLawn` lamp stands flush on the raised grass bed (`y = 0.41`) inside the coping ring (`1.050–1.588 m` from the walk edge), leaving the narrow park walks and tram-corridor sidewalks unobstructed. No floating bases, z-fighting, or buried pedestals on either WebGPU high or WebGL2 low.
- **Clearance from trunks, walls, and carriageways:** even at the tightest geometric clearances (`0.742 m` trunk gap at `b421_trunk` and `0.334 m` low arched wall gap at `b1301_bld`), visible air separates the lamp mast and base from trunks, foliage limbs, walls, and roadways.
- **Midnight illumination:** on both WebGPU high and WebGL2 low, the luminaire globes light cleanly at midnight and cast warm pools across the grass, coping, and adjacent narrow walk/roadway without light clipping or dark lamps.
