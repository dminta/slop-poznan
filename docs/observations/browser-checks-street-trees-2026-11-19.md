# Browser checks: street trees OSM overlay, WebGL2 low and frame/GPU timing — 2026-11-19

Completion of the outstanding street-trees browser check from [browser-checks-props-2026-11-17.md](browser-checks-props-2026-11-17.md#4-street-trees-vs-osm-frame-rate-and-draw-calls) at `dfdcf6f` (`poznan`). No production `js/`, `css/`, `tools/` or `index.html` file was modified.

## Environment and method

- **Browser:** headless Google Chrome `157.0.8103.79` (`--headless=new --enable-unsafe-webgpu --use-angle=metal --window-size=1280,720 --disable-extensions`, cache disabled, Apple M5 Pro, CSS viewport `1280 × 577`, DPR 1), served locally via `python3 -m http.server`.
- **Harness:** ephemeral CDP Node script using `Runtime.queryObjects` to access the live `Scene`, `WebGPURenderer`, `CameraSystem`, `ThirdPersonControllerManager` and `PerfStats` instances without editing source files.
- **Lighting:** switched to `midday` (`Południe`) after boot; `person` mode (`Spacer`) for all views.
- **Console status:**
  - **WebGPU high** (`/?quality=high` and `/?quality=high&stats=1`, including the overlay, perf and timestamp-query runs): **0 errors, 0 warnings**.
  - **WebGL2 low** (`/?backend=webgl&quality=low&stats=1`, clean production run across boot and all views): **0 errors, 0 warnings**. (Note: toggling Three.js's diagnostic `renderer.backend.trackTimestamp = true` mid-run for the WebGL2 timer-query probe emitted Chrome `WebGL: INVALID_OPERATION: beginQuery: a query is already active for target` / `endQuery: target query is not active` warnings from Three.js's single-active-query `WebGLTimestampQueryPool`; those do not occur in normal execution.)

## 1. Root cause of the 2026-11-17 overlay failure

In `js/main.js`, `freezeStaticMatrices(scene, dynamicRoots)` (`js/static-matrices.js`) calls `scene.updateMatrixWorld(true)` once after city build and sets `scene.matrixWorldAutoUpdate = false` so Three.js skips walking the static city graph each frame.

Verified directly in headless Chrome on WebGPU high (`/?quality=high`):
- Adding a `THREE.Mesh` (`MeshBasicMaterial`) directly to `scene` after boot with `position.set(-318.5, 2.0, -71.5)` **without** calling `updateMatrixWorld(true)` leaves `mesh.matrixWorld` at the identity position `[0, 0, 0]` (at Stary Rynek / Ratusz), so nothing appears in the target avenue or Cytadela frames.
- Calling `updateMatrixWorld(true)` on the added mesh or overlay group places it at the intended world coordinates. Both `MeshBasicMaterial` (cyan torus ring) and `MeshBasicNodeMaterial` (`transparent: true, opacity: 0.85`, yellow cylinder, without `mrtNode`) rendered cleanly in the WebGPU high scene pass with **0 console errors and 0 warnings**.

## 2. In-frame OSM point overlay on street-tree pits (WebGPU high)

Placed cyan ground rings (`TorusGeometry(0.65, 0.055)`, `y = 0.34` on street sidewalks and `0.45` on park beds) plus `16.0 m` vertical poles (`CylinderGeometry(0.045, 0.045, 16.0)`) and `0.28 m` top spheres (`yBase + 16.1`, `MeshBasicMaterial({ color: 0x00ffff })`) for all **1,037** deduplicated `GEO.trees` nodes within `220 m` of `(-318.5, -71.5)` (old town / centrum-west) and `(-694.8, -1416.3)` (Cytadela), calling `overlayGroup.updateMatrixWorld(true)` before `scene.add(overlayGroup)`. HUD hidden.

| Area & view | Eye `(x, y, z)` | Look `(x, y, z)` | FOV | Visual finding |
|---|---|---|---:|---|
| Old town / centrum-west street | `(-318.5, 2.2, -60.5)` | `(-318.5, 0.7, -71.5)` | 56° | Cyan rings sit concentrically around every trunk on the curb-edged soil pits; vertical poles rise through trunk centres. |
| Old town / centrum-west OSM vs procedural pair | `(-328.0, 1.8, -56.0)` | `(-328.0, 0.8, -67.2)` | 58° | Central promenade OSM pits (`(-326.0, -67.2)` and avenue rows) carry cyan rings/poles; the procedural-row pit `4.01 m` west on the promenade's west curb (`(-330.0, -66.99)`) and outer sidewalk trees across the carriageway carry no markers. |
| Old town / centrum-west oblique | `(-332.0, 26.0, -35.0)` | `(-322.0, 2.0, -72.0)` | 54° | Double row of OSM pits down the promenade marked with poles/caps above the crowns; outer sidewalk procedural rows on both sides and an unmapped south-west edge pit remain unmarked. |
| Old town / centrum-west top-down | `(-322.0, 48.0, -68.0)` | `(-322.0, 0.0, -72.0)` | 54° | Plan alignment confirms cyan rings sit centred on the promenade pits while adjacent procedural sidewalk pits are unmarked. |
| Cytadela street | `(-689.5, 2.3, -1425.0)` | `(-694.8, 0.8, -1416.3)` | 56° | Cyan rings sit centred around tree trunks inside the street pits; vertical poles rise cleanly along the trunks. |
| Cytadela OSM vs procedural pair | `(-685.5, 2.6, -1393.0)` | `(-694.2, 0.8, -1393.2)` | 58° | Along the same sidewalk, OSM pits `(-694.6, -1401.7)` and `(-694.5, -1396.4)` carry cyan rings/poles while the procedural-row pit `6.49 m` north (`(-693.76, -1389.95)`) is unmarked. |
| Cytadela oblique | `(-670.0, 26.0, -1440.0)` | `(-694.8, 2.0, -1410.0)` | 54° | OSM street pits (including beside the tram shelter around `(-696.5, -1437.8)`) and Cytadela park trees carry markers; procedural pits `(-693.76, -1389.95)` and `(-691.92, -1438.68)` (`4.66 m` from nearest OSM node) and cross-street procedural trees remain unmarked. |
| Cytadela top-down | `(-694.8, 48.0, -1414.0)` | `(-694.8, 0.0, -1415.0)` | 54° | Confirms concentric ring alignment on both the street-pit row and Park Cytadela lawn trees, with procedural pits unmarked. |

## 3. WebGL2 low vs WebGPU high on the tree scene (`?stats=1`)

Each view settled for `3.5 s` before resetting `PerfStats.window` and measuring a `6.0 s` production window (`trackTimestamp` off). Afterwards, `renderer.backend.trackTimestamp = true` was sampled over `6` frames with `await renderer.resolveTimestampsAsync('render')`. Boot logged `117954 trees (33280 street trees, 32744 OSM mapped, 7173 OSM street, 6015 mapped dropped, 7 kept as plaza planters)` on both backends.

### WebGPU high (`/?quality=high&stats=1`)

Canvas buffer `1280 × 577`, GPU `apple · metal-3`, `243` programs, `18` RT, `53` textures, GPU memory `342.8–365.7 MB`, JS heap `956.5–1008.5 MB`.

| View | Player `(x, y, z)` | Camera `(x, y, z)` | Look `(x, y, z)` | FOV | FPS (p50 / p95 / max ms) | CPU render / sim / total | Draws | Triangles | GPU ts pool sum (6 frames) |
|---|---|---|---|---:|---|---:|---:|---:|---:|
| `street-rynek` | `(-2.22, 0.22, 63.33)` | `(-2.22, 2.50, 67.61)` | `(-2.22, 3.32, 58.13)` | 56° | 60 (16.7 / 16.7 / 16.8) | 6.92 / 1.05 / 8.28 ms | 1,090 | 7.10 M | 18.08–32.46 ms |
| `street-centrum` | `(-314, 0, -71)` | `(-314, 2.28, -66.72)` | `(-314, 3.10, -76.20)` | 56° | 60 (16.7 / 16.7 / 16.8) | 6.75 / 1.06 / 8.10 ms | 952 | 6.92 M | 22.71–38.12 ms |
| `street-cytadela` | `(-595, 0, -1416)` | `(-595, 2.28, -1411.72)` | `(-595, 3.10, -1421.20)` | 56° | 60 (16.7 / 16.7 / 16.8) | 6.26 / 1.11 / 7.67 ms | 869 | 12.28 M | 27.79–45.24 ms |
| `drone-rynek` | `(-2.22, 0.22, 63.33)` | `(-1180.21, 144.64, 135.30)` | `(-450, 30, 350)` | 50° | 60 (16.7 / 16.8 / 16.8) | 9.46 / 1.21 / 10.98 ms | 1,467 | 8.69 M | 48.12–58.50 ms |
| `drone-cytadela` | `(-595, 0, -1416)` | `(-779.07, 125.00, -142.03)` | `(-450, 30, 350)` | 50° | 60 (16.7 / 16.7 / 16.8) | 8.58 / 1.15 / 9.99 ms | 1,226 | 7.41 M | 27.77–55.47 ms |
| `scenic-cytadela` | `(-595, 0, -1416)` | `(64.56, 26.00, -1690.00)` | `(60.57, 2.00, -1439.90)` | 52° | 60 (16.7 / 16.8 / 16.8) | 7.02 / 0.76 / 8.05 ms | 1,015 | 11.15 M | 23.37–49.63 ms |

### WebGL2 low (`/?backend=webgl&quality=low&stats=1`)

Canvas buffer `960 × 432` (0.75× scale), GPU `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)`, `225` programs, `5` RT, `47` textures, GPU memory `253.4–272.1 MB`, JS heap `925.3–965.3 MB`.

| View | Player `(x, y, z)` | Camera `(x, y, z)` | Look `(x, y, z)` | FOV | FPS (p50 / p95 / max ms) | CPU render / sim / total | Draws | Triangles | GPU ts `r:1:2` (6 frames) |
|---|---|---|---|---:|---|---:|---:|---:|---:|
| `street-rynek` | `(-2.22, 0.22, 63.33)` | `(-2.22, 2.50, 67.61)` | `(-2.22, 3.32, 58.13)` | 56° | 60 (16.7 / 16.7 / 16.8) | 8.45 / 0.69 / 9.43 ms | 820 | 5.57 M | 3.37–3.99 ms |
| `street-centrum` | `(-314, 0, -71)` | `(-314, 2.28, -66.72)` | `(-314, 3.10, -76.20)` | 56° | 60 (16.7 / 16.7 / 16.8) | 7.35 / 0.80 / 8.44 ms | 684 | 5.16 M | 1.08–1.53 ms |
| `street-cytadela` | `(-595, 0, -1416)` | `(-595, 2.28, -1411.72)` | `(-595, 3.10, -1421.20)` | 56° | 60 (16.7 / 16.7 / 16.8) | 6.43 / 0.78 / 7.47 ms | 513 | 5.76 M | 0.67–0.78 ms |
| `drone-rynek` | `(-2.22, 0.22, 63.33)` | `(-1179.48, 144.60, 134.61)` | `(-450, 30, 350)` | 50° | 60 (16.7 / 16.8 / 16.8) | 10.46 / 0.85 / 11.63 ms | 1,004 | 6.37 M | 4.45–4.79 ms |
| `drone-cytadela` | `(-595, 0, -1416)` | `(-780.44, 125.00, -140.34)` | `(-450, 30, 350)` | 50° | 60 (16.7 / 16.7 / 16.8) | 8.42 / 0.77 / 9.45 ms | 786 | 5.54 M | 2.97–3.57 ms |
| `scenic-cytadela` | `(-595, 0, -1416)` | `(64.49, 26.00, -1690.00)` | `(60.57, 2.00, -1439.90)` | 52° | 60 (16.7 / 16.7 / 16.8) | 7.62 / 0.59 / 8.45 ms | 683 | 7.38 M | 2.50–3.82 ms |

### Visual & GPU timestamp notes

- **WebGL2 low visual check:** trees, curb-edged pits, bark tubes, leaf-spray cards, and LOD transitions render cleanly across street-level Rynek, centrum-west avenue, Cytadela interior, `scenic-cytadela` and the `drone` preset (`960 × 432` buffer). As designed for `low`, trees cast no shadows (buildings and landmarks keep shadow proxies), reducing draws by `25–41%` (`513–1,004` vs `869–1,467`) and triangles by `22–53%` (`5.16–7.38 M` vs `6.92–12.28 M`, largest drop inside Cytadela's dense canopy `12.28 → 5.76 M`).
- **GPU timestamp measurement limits:**
  - Headless Chrome saturates at the `60 Hz` vsync (`16.7 ms` p50, `0` dropped frames on both tiers).
  - On **WebGPU high**, `GPUDevice.features` exposes `timestamp-query`, and `resolveTimestampsAsync('render')` sums every context in `WebGPUTimestampQueryPool`, including `18–19` nested post-processing/SSR/bloom passes (`r:4..22:4` reading `0.08–2.68 ms` each), so the pool sum (`18.08–58.50 ms`) double-counts nested passes and exceeds the `16.7 ms` wall-clock frame interval (same behaviour noted in [perf-older-devices-2026-11-11.md](perf-older-devices-2026-11-11.md#method)). Individual primary passes read `r:1:2` `0.11–2.72 ms` (varies with the 2-frame far shadow cascade cadence), `r:2:3` `3.86–6.13 ms`, `r:3:7` `0.38–1.91 ms`, and `r:4:7` `1.20–2.10 ms` on even frames.
  - On **WebGL2 low**, `EXT_disjoint_timer_query_webgl2` is exposed, but `WebGLTimestampQueryPool` permits only one active `TIME_ELAPSED_EXT` query per frame (`r:1:2:f*`), skipping subsequent nested/post passes; that single outer query measured `0.67–4.79 ms`.
