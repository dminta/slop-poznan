# Cheaper trees on the low quality tier (2026-11-11)

## Question

Ranked opportunity 5 in [the older-device audit](perf-older-devices-2026-11-11.md) was the tree field: 321 of 1,553 draws
(21 %) and 1.0 M triangles at Rynek street view, 950 of 2,851 (33 %) and 2.47 M triangles from the Centrum drone, with
30,259 tree meshes and 21.8 MiB of instance matrices. The task was to shorten the low tier's tree draw distance and LOD,
cut draw calls per visible cell and reduce the drone field specifically, while leaving the high tier pixel-identical.
This records the implementation, the measurements and the visual cost.

## What was found first

`LOW_CUTOFF` was not a quality-tier setting. `trees.js` already capped every tree at 1150 m whenever the camera was below
40 m (`low = cam.y < 40`), whichever tier was active; above 40 m it used the full per-site draw distance. That is why the
street view was cheaper than the drone view, and why the drone case needed its own profile rather than a new "low"
cutoff. The existing `MAX_DIST` was per site tier: 0 park/plaza, 1 wide street/leftover slab, 2 narrow street.

## What changed

- `QUALITY_TIERS` in `js/graphics-quality.js` gained a `trees` block for both tiers, and `js/main.js` applies it once
  through `configureTreeQuality` before `buildStreetDetails` plants the field. The tree field copies the profile at build
  time, so the meshes and capacities match the tier; nothing switches at runtime.
- `js/trees.js` takes `lodNear`, `lodMid`, `maxDist` (three site tiers), the street-level cap, how many LOD-1 crown
  variants to build, and which species' whole-crown geometry LOD 2 uses. Invalid or missing values fall back to the
  historical high values.
- On low, LOD-1 variant 1 trees reuse variant 0's mesh, and every species uses the lime's LOD-2 whole-crown geometry.
  A cell therefore builds 13 tree meshes (4 species × [2 LOD-0 variants + 1 LOD-1] + 1 shared LOD-2) instead of 20.
- No scene grouping, culling or `tsl-materials.js` change. No per-instance data changed; the wind, leaf atlas, shadow
  material and colliders are untouched.

| Profile | lodNear | lodMid | Draw distance (park / wide / narrow) | Street cap | LOD-1 variants | LOD-2 geometry |
|---|---:|---:|---|---:|---:|---|
| high (historical) | 105 m | 420 m | 3000 / 1600 / 950 m | 1150 m | 2 | per species |
| low | 95 m | 330 m | 2200 / 1500 / 850 m | 900 m | 1 | shared lime |

The high profile reproduces the previous constants exactly. Both LOD-1 variants and per-species far geometry are still
built on high, so its meshes, draw calls and instance data are unchanged.

## Measurement method

Headless Chrome 157, Apple-silicon Mac, 1280 × 720, WebGPU unless marked WebGL2, production modules served from the
worktree. The harness is `.agent-task/perf-harness/` (an instrumented copy of `main.js` plus a Puppeteer runner) on a
local static server. Each sample is 4 s after a 2.5 s settle, 60 Hz or `Emulation.setCPUThrottlingRate 6`; `draw` and
`tri` are `renderer.info.render.drawCalls/triangles` for the scene pass, both shadow cascades and post-processing. Tree
draws are frustum-tested visible tree meshes, not the whole field.

The low-tier **before** rows are the same low tier with the tree profile forced back to the high values through harness
URL switches (`treenear=105&treemid=420&treemax=3000,1600,950&treecut=1150&treevariants=2&treefar=none`). That isolates
the tree change from the rest of the low package (no SSR/bloom, shorter shadows, lower pixel ratio, smaller population):
the high values also reproduce the old build's tree draws and triangles exactly (Rynek 127 draws / 276,604 triangles,
drone 574 / 1,617,222). Views are the audit's Rynek street camera (0, 10, 140), the audit's Centrum drone
(−1150, 320, 900) and the scenic Cytadela camera (60, 26, −1690) looking south over the park.

The machine was shared with other worktree builds during these runs (load average around 8), so 60 Hz CPU render runs
vary by up to ~1 ms between identical builds; the 6× rows are the more stable comparison. Frame times are the rAF
interval.

## Results

### Rynek street and Centrum drone, low tier

| View | Draws | Tree draws | Tree triangles | Total triangles | CPU render 60 Hz | CPU total 60 Hz |
|---|---:|---:|---:|---:|---:|---:|
| Rynek before | 1084 | 127 | 276,604 | 6,209,622 | 8.35 ms | 9.58 ms |
| Rynek after | **999** | **42** | **195,798** | 6,073,202 | 7.65 ms | 8.84 ms |
| Rynek change | −85 (−7.8 %) | −85 (−66.9 %) | −29.2 % | −2.2 % | −8 % | −7.7 % |
| Drone before | 1879 | 574 | 1,617,222 | 8,076,265 | 13.70 ms | 14.87 ms |
| Drone after | **1391** | **99** | **446,040** | 6,881,841 | 10.07 ms | 11.32 ms |
| Drone change | −488 (−26.0 %) | −475 (−82.8 %) | −72.4 % | −14.8 % | −26.5 % | −23.9 % |

Tree instances drawn fell from 1,105 to 849 at Rynek and from 13,730 to 4,130 at the drone view. The park view (scenic
Cytadela) went from 1,114 draws / 1,564,598 tree triangles to 995 / 1,326,222: −119 draws (−10.7 %), −15.2 % tree
triangles. Its 60 Hz CPU render was noise-bound (8.21 → 8.74 ms, inside the run-to-run spread), so it was re-measured at
6×: renderer CPU 75.4 → 64.2 ms, total frame 84.7 → 73.4 ms (−13.4 %), 1,114 → 995 draws.

### 6× CPU throttle

Same low tier, before (high tree profile) and after:

| View | Draws | CPU render | CPU total | Frame time |
|---|---:|---:|---:|---:|
| Rynek before | 1088 | 70.1 ms | 80.7 ms | 83.3 ms |
| Rynek after | **1005** | **57.7 ms** | **68.2 ms** | **70.4 ms** |
| Drone before | 1856 | 102.6 ms | 112.6 ms | 115.3 ms |
| Drone after | **1404** | **73.8 ms** | **83.7 ms** | **86.8 ms** |

Rynek total frame falls 15.5 % and the drone view 25.6 % from the tree change alone (`dt` includes the same simulation
work in both rows). For reference, the high tier at 6× measures 100.3 ms total at Rynek and 150.7 ms at the drone view.

### WebGL2 fallback, low tier

| View | Draws before | Draws after | Change | Triangles before → after |
|---|---:|---:|---:|---|
| Rynek | 1228 | 1126 | −8.3 % | 6.50 M → 6.35 M (−2.3 %) |
| Park Cytadela | 1161 | 1041 | −10.3 % | 7.07 M → 6.81 M (−3.6 %) |
| Centrum drone | 1779 | 1302 | −26.8 % | 7.93 M → 6.76 M (−14.8 %) |

The console was clean on both backends (no warnings or page errors).

### High tier is unchanged

The tree field keeps its own draw calls and triangles exactly: Rynek (the audit camera) 127 draws / 276,604 triangles
before and after, Centrum drone 574 / 1,617,222 before and after, park 172 / 1,564,598. The high-tier pixel comparison,
taken with the scenic Rynek camera, the scenic Cytadela camera and the Centrum drone:

| View | Pixel diff before → after |
|---|---:|
| Rynek (scenic square camera) | 0 differing pixels |
| Park Cytadela (scenic) | 0 differing pixels |
| Centrum drone | 1 differing pixel |

The screenshots freeze shader time and hide the dynamic actors (traffic, trams, goats, player) so the comparison is
static. Two runs of the same after build still differ by 143 pixels at the drone view, so the single pixel is
frame-to-frame GPU noise, not a tree change. Total draw counts in the high 60 Hz runs vary by a few because traffic and
pedestrian placement use unseeded `Math.random`; the tree field's own draws and triangles are identical.

### Scene and memory

| | High | Low |
|---|---:|---:|
| Tree meshes (cell × species × variant × level) | 30,259 | **20,376** (−32.7 %) |
| Tree instance capacity | 356,682 | 356,682 |
| Tree instance matrices + tree data | 21.8 + 5.4 MiB | 21.8 + 5.4 MiB |
| All scene meshes | 41,065 | **31,182** (−9,883) |
| Tree geometry buffers | 7.0 MB | 6.8 MB |
| GPU memory | 384.4 MB | 222.9 MB (was 223.1) |

The instance buffers do not shrink. Capacity is allocated per cell / species / level, and every tree can become the
nearest tree of some camera position, so the shorter draw distance removes no instance that could never be active.
Skipping LOD 1 on low would have saved about 7.3 MiB of instance data, but would replace carded branches with
whole-crown cards from 95 m out, through the main street-tree band; that is left in reserve. What the profile does remove
is 9,883 mesh objects from the scene graph and the per-cell draw calls.

Boot times were 11.5–11.6 s at 1× for both low profiles and 67.8–89.5 s at 6× on the shared machine; the
`streetDetails` build phase was 1.97–2.03 s at 1×. The 6× spread follows the machine load between those two boots and
is not a usable regression signal: the profile creates fewer meshes and does the same per-site work. GPU memory for the
low tier is unchanged (222.9 vs 223.1 MB).

## Visual cost

Screenshots are in `.agent-task/shots/` (`before-low-*`, `after-low-*`, `before-webgl-*`, `after-webgl-*`,
`before-high-*`, `after-high-*`); they are scratch evidence, not part of the site.

- **Rynek square (scenic camera):** unchanged. The square has only one distant tree in this view.
- **Park Cytadela (26 m over the lawns):** the near and middle tree lines read the same. The horizon band thins where the
  street-level cap falls from 1150 to 900 m and the 330 m LOD boundary replaces the 420 m one; at the 0.75 low-tier pixel
  ratio it is a thin stipple behind the buildings, not a visible tree line. No hard cutoff edge is visible on the lawn.
- **Park path at eye level:** the tree line is effectively identical to the previous low tier. The 900 m street cap and
  the 330 m LOD boundary are not visible as a pop or a band in the static frames; the farthest crowns are simply coarser.
- **Centrum drone:** the honest cost. Distant parks (upper right and north of the centre) show sparser, flatter tree
  bands than before, and crowns in the middle distance are the shared lime whole-crown shape, tinted per tree with the
  species colour. The foreground park, streets and near blocks look the same. The 33 % tree-draw share falls to 7 %.
- **Twilight:** unchanged; the tree field is near the camera and the light pools are untouched.
- **WebGL2:** the same differences at the same views.

A per-tree dither fade at the cutoff was considered and not added: it needs a new per-instance attribute and a change to
the shared tree material, and the static street and park views showed no hard edge at these distances. A moving flight
along a park edge, and a real phone/integrated GPU, remain for a browser review; the audit's caveat that this Mac is not
a low-end device still applies.

## Reproduction

Serve the worktree at the repo root and run the harness on another port (the audit's 8111 may be serving a different
worktree):

```sh
python3 -m http.server 8123
node .agent-task/perf-harness/run-perf.mjs '{"port":8123,"query":"quality=low","steps":[{"view":"rynek","seconds":4,"trees":true},{"view":"centrumDrone","seconds":4,"trees":true}]}'
node .agent-task/perf-harness/run-perf.mjs '{"port":8123,"query":"quality=low&treenear=105&treemid=420&treemax=3000,1600,950&treecut=1150&treevariants=2&treefar=none","steps":[{"view":"rynek","seconds":4,"trees":true}]}'
node .agent-task/perf-harness/run-perf.mjs '{"port":8123,"query":"quality=high&sim=0","steps":[{"view":"centrumDrone","seconds":1,"deterministic":true,"shot":".agent-task/shots/drone.png"}]}'
```

`quality=low|high` is the production switch; `treenear` / `treemid` / `treemax` / `treecut` / `treevariants` / `treefar`
are perf-island-only overrides for A/B runs. `sim=0` stops the simulation, `deterministic` freezes shader time and hides
the moving actors, and `shot` saves a PNG.

`node --test tests/` passes; `tests/graphics-quality.test.cjs` pins the tier → tree profile mapping and
`tests/trees.test.cjs` checks the profile fallback.
