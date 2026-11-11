# Performance on older and weaker devices (2026-11-11)

## Question

Users of older phones and laptops with integrated GPUs (including the WebGL2 fallback) report that the app is slow.
This investigation measures where frame time goes, counts the scene cost, and ranks the optimisations that would help
those devices most. It is an investigation only: no production behaviour was changed.

## Method

### Browser runs (real rendering, headless Chrome)

All browser numbers below are from **headless Chrome 157 on an Apple-silicon Mac** (`--headless=new`,
`--enable-unsafe-webgpu`, `navigator.gpu` adapter `apple`), serving the worktree with `python3 -m http.server`. The
production modules are imported unchanged; `.agent-task/perf-main.js` is a copy of `js/main.js` that adds URL
switches, per-frame timing and `window.__perf` hooks, and `.agent-task/perf-post.js` can omit bloom. Nothing under
`js/` was modified.

- Default viewport 1280 × 720, `devicePixelRatio` 1, `renderer.setPixelRatio(1)` as in production. One mobile-sized
  run used 390 × 844.
- Time of day `golden` unless stated; one run at `midnight`.
- `?backend=webgl` selects the production WebGL2 fallback.
- `Emulation.setCPUThrottlingRate 6` approximates a CPU roughly six times slower than this Mac (not a specific phone).
- Views: `rynek` (camera at 0, 10, 140 looking at the Ratusz), `centrum` (street level near Św. Marcin),
  `kaponiera`, `jezyce`, `rynekDrone` (0, 180, 520), `centrumDrone` (−1150, 320, 900), `wide` (0, 400, 5000).
  These are static camera points, not the chase camera, so they are reproducible.
- Each sample is 3–4 s at 60 Hz after a 1.5–2 s settle. `dt` is the rAF interval; CPU times are `performance.now()`
  around each subsystem, measured inside the animation loop.
- Draw calls and triangles are `renderer.info.render.drawCalls/triangles` with `info.autoReset = false`, reset once
  per frame, so they include the scene pass, the two shadow cascades and post-processing draws. The scene-pass /
  shadow split was measured by running the same build with `renderer.shadowMap.enabled = false` and subtracting.
- **GPU timestamps** are three.js `trackTimestamp` query results. They sum every render context in the pool, including
  nested scene/shadow/post contexts, so absolute values are larger than the frame interval; use the **ratios and
  deltas**, not the absolute number. This is called out again in "Limits".
- The low-tier runs combine settings behind URL switches (no SSR, no bloom, shorter shadows, lower shadow map, pixel
  ratio 0.75, static matrices). They are experiments, not a shipped mode.

### Scene counts and CPU-only benchmarks

The scene inventory is a browser traversal of the live scene after load: meshes, instanced meshes, instance counts,
unique geometries/materials, texture sizes from material textures, `renderer.info.memory`, and a pass-by-pass
frustum inventory (`THREE.Frustum` against each mesh's bound) for visible draws, triangles and off-screen instances.
It uses the real renderer and the real scene graph.

The pedestrian cost is `node tools/benchmark-pedestrians.mjs .agent-task/vendor/three.core.js` (the pinned dev build):
340 rigs, before/after the hidden-rig pose deferral. Load-time attribution is a Chrome CPU profile of the whole boot
(200 µs sampling), reported as self time and inclusive-by-file time.

### What is a real browser number

- **Real browser runs:** every `ms`, `drawCalls`, `triangles`, `dt`, `renderer.info.memory` and scene-count number in
  this document, unless labelled "headless" or "profile estimate". Texture MB values are computed from the live
  textures' dimensions and mipmap settings (4 bytes/pixel, ×4/3 for mips), not read from a GPU allocator.
- **Headless / CPU-only:** `tools/benchmark-pedestrians.mjs` (`1.12 ms/frame` for 340 rigs) and the Node module-load
  memory check (`geodata` 24.5 MB heap / `city-config` 73.1 MB heap and 116.8 MB external after import). These are not
  browser frame timings.
- **Profile estimates:** CPU profile percentages are sample shares of the measured window, not wall-clock guarantees.
- **Estimates:** "old phone ≈ 6× CPU" is a synthetic throttle, not a device measurement. No real phone was tested.

## Baseline (default quality)

### Load

Warm run, 1280 × 720, WebGPU:

```
renderer 10ms · lighting 21ms · landmarks 60ms · blocks 2285ms · cityGrid 2597ms ·
airport 4ms · canopies 1ms · outskirts 54ms · bridges 83ms · streetDetails 3799–3893ms ·
traffic 3306–3365ms · roadPaint 615–631ms · tramInfra 73ms · trams 123–145ms ·
controllers 8ms · culling 220–263ms · compile 1257–1308ms · warmup 479–513ms
```

Total load to first frame: **16.5–17.2 s** on this Mac (the `[init]` log excludes only the GPU completion wait,
which adds a few hundred ms). At CPU throttle 6× the same boot takes **99.6–101.6 s**: blocks 14.2 s, cityGrid
16.0 s, streetDetails 24.5 s, traffic 20.3 s, compile 8.2 s, culling 1.3 s. A phone-level CPU therefore spends over
a minute before the first frame; a slower GPU shader cache adds more.

`js/geodata.js` is 4.55 MB of source. A Node import of the generated module parses it in **44 ms** and leaves a
24.5 MB heap; importing `city-config.js` (which builds the block/road/park indexes) takes another **466 ms** and
leaves 73.1 MB of heap plus 116.8 MB of external/typed-array memory. Those are Node numbers, not browser numbers,
but they set the floor before any scene geometry exists. The three.js scene build then dominates: blocks 2.3 s,
cityGrid 2.6 s, streetDetails 3.8 s, traffic 3.3 s. `compile` is 1.26–1.31 s in the warm runs and 4.2–4.7 s in the
first cold-shader-cache runs, for 290 programs.

The whole-boot CPU profile (75,483 samples) attributes the build as follows (inclusive by file, so rows overlap):

| File / area | Inclusive share | Main self-time |
|---|---:|---|
| `street-details.js` (furniture, trees, plaza/park predicates) | 35.2% | `inPlaza` 3.6%, `pointInPark` 5.1% |
| `city-config.js` (blocks, parks, roads, water queries) | 32.1% | **`pointInPoly` 18.8%** |
| `city-grid.js` (curbs, sidewalks, parks, props) | 15.7% | `pointInPolygonXZ` 1.8%, `railClearance` 1.0% |
| `three.webgpu.js` (renderer, shader build) | 13.0% | — |
| `buildings.js` (lots, facades, roofs) | 12.0% | `insideCurbIsland` 2.4%, `outlineDist` 1.3% |
| `pedestrian-routes.js` (crossings, links, routes) | 9.5% | — |
| `three.tsl.js` (node graph build) | 10.3% | — |
| `road-network.js` | 5.0% | `crossingRuns` 2.3% |
| `trams.js` | 4.2% | `buildTrackGraph` 2.8% |
| `road-paint.js` | 3.6% | `layoutBusMarkings` 3.3% |
| `tram-infra.js` | 3.2% | — |
| `traffic.js` | 1.4% | — |
| `trees.js` | 1.3% | — |

Garbage collection is 2.2% of the boot profile; the heap climbs to **~1.15 GB** before the compile/warm-up GC and
settles at **~903 MB after a forced GC** (`HeapProfiler.collectGarbage`). The peak is already ~770 MB after
`cityGrid`. On a phone this is a real OOM/eviction risk before the first frame.

### Scene inventory

After load, default `golden` view:

| Item | Count |
|---|---:|
| Meshes (all types) | 41,065 |
| Instanced meshes | 40,166 |
| Instances (capacity × count; drawn count varies) | 830,644 |
| Unique geometries in the scene graph | 37,865 |
| Materials | 215 |
| Textures tracked by the renderer | 53 |
| Objects with `castShadow` | 36,754 |
| Lights (total / active at golden) | 227 / 24 |
| Pedestrians (pool / placed) | 340 / 340 |
| Cars (pool / driving) | 200 / 61 |
| Buses (pool / driving) | 12 / 4 |
| Trams | 23 |
| Render targets | 17 |
| Shader programs | 290 |
| Shadow atlas | 6144 × 3072 (2 × 3072² tiles) |

The tree field alone is 30,259 mesh objects (per 200 m cell × species × variant × LOD) and the city/prop culling
turns the rest into thousands of chunks. Most of the 41k meshes are culled every frame by `visible = false` at a
cell or chunk level, but the scene graph is still traversed and matrix-updated.

### Per-frame cost by view

Default quality, WebGPU, 1280 × 720. `draw` and `tri` include all passes; CPU `render` is the JS time spent inside
`renderPipeline.render()` (WebGPU command encoding and scene traversal, not GPU execution).

| View | Draw calls | Triangles | CPU render ms | CPU traffic ms | CPU total ms |
|---|---:|---:|---:|---:|---:|
| Rynek, street | 1,553 | 7.90 M | 11.0–13.3 | 1.0–1.2 | 12.5–15.5 |
| Centrum, street | 1,801 | 9.51 M | 12.5 | 1.1 | 14.0 |
| Kaponiera, street | 2,128 | 9.48 M | 13.7 | 1.2 | 15.3 |
| Jeżyce, street | 1,651 | 8.34 M | 11.7 | 1.0 | 13.1 |
| Rynek, drone (180 m) | 2,469 | 10.27 M | 16.1 | 1.0 | 17.3 |
| Centrum, drone (320 m) | 2,851–2,876 | 10.4 M | 17.4–18.2 | 1.0–1.1 | 18.8–19.7 |
| Wide (400 m, 5 km out) | 2,108 | 10.97 M | 14.1 | 0.8 | 15.2 |
| Rynek, 390 × 844 (phone portrait) | 950 | 5.52 M | 8.7 | 1.0 | 10.0 |
| Centrum drone, 390 × 844 | 1,575 | 6.97 M | 11.5 | 1.0 | 12.8 |
| Rynek, WebGL2 fallback | 1,556 | 7.85 M | 12.6 | 1.0 | 14.0 |
| Centrum drone, WebGL2 | 2,882 | 10.45 M | 19.2 | 1.0 | 20.5 |
| Rynek, CPU throttle 6× | 1,553 | 7.91 M | **84.7** | **8.1** | **96.0** |

`scene` (buildings/street details/lighting/map/audio/landmarks) is 0.23–0.32 ms and culling is 0.02–0.1 ms on the
unthrottled runs. `dt` is 16.67 ms on almost every unthrottled sample; the 33.4 ms steps in the drone views are the
CPU render crossing the 16.7 ms budget, not GPU stalls.

At 6× CPU the frame is 96 ms: **88% is renderer CPU**, 8% traffic, 2% scene updates, 0.4% culling. That ordering is the
most important result in this report: on a slow CPU the app is limited by scene traversal/draw submission, not by the
traffic or pedestrian simulation.

### Draw calls by pass and by root

Rynek at street level. The shadow split is the same camera with sun shadows disabled; the root split is the scene
pass with one root hidden at a time (relative to a 1,547-draw baseline).

| Bucket | Draw calls | Triangles |
|---|---:|---:|
| Scene pass (incl. sky and post-processing) | ~830 | ~5.13 M |
| Sun shadow cascades | ~717 | ~2.75 M |
| StreetDetails (furniture, signals, lamps, pits) | 164 | 2.27 M |
| CityBlocks + roofs (roof meshes are named separately) | 138 + 122 | 0.38 M + 0.18 M |
| Trees (scene pass) | 127 | 0.28 M |
| Landmarks | 55 | 0.07 M |
| CityGrid (land, curbs, parks) | 29 | 1.13 M |
| TramInfrastructure | 79 | 0.40 M |
| Shadow proxies | 184 | 0.75 M |
| TrafficAndPedestrians + Trams + player | ~32 | < 0.1 M |

Shadow casting is the single largest pass by draw count: **46% of draws and 35% of triangles at street level**; on
the Centrum drone view it is **51% of draws** (1,461 of 2,851). Of the shadow draws, 194 are trees at street level
(measured by disabling tree shadow casting) and 184 are the building shadow proxies; the remaining ~339 are street
furniture, roofs, trams, traffic and grid chunks. Turning off tree shadows alone removes **194 draws, 0.75 M
triangles and 1.7 ms of CPU render** at Rynek; turning off the StreetDetails/TramInfrastructure/CityGrid casters
(which includes the tree group nested under StreetDetails) removes **307 draws, 1.23 M triangles and 2.0 ms** while
keeping building proxies — of those 307, 194 are trees and the remaining 113 are street furniture, tram and grid
chunks. Turning off all sun shadows removes 717 draws at Rynek and 1,461 at the drone view.

Roofs cost **122 draws for only 175k triangles** at Rynek (12 roof material/type meshes, each split into chunks).
Trees cost 321 draws (21%) and 1.0 M triangles in the full street frame, and **950 draws (33%)** and 2.47 M
triangles at the Centrum drone view.

### Instances drawn but off screen

The culling units are chunks, not instances. At Rynek, 741 visible instanced meshes draw **176,258 instances**, of
which **119,834 (68%) have their centre outside the camera frustum**, carrying 2.15 M of 3.87 M instanced triangles.
At the Centrum drone view, 1,277 visible instanced meshes draw 220,495 instances, 114,080 (52%) off screen, 2.26 M of
5.96 M instanced triangles. Finer chunking would remove that vertex work but add draw calls; see the chunk-size
experiment below.

### CPU profile (5 s at Rynek, simulation running)

| Function | Self time |
|---|---:|
| `project` (scene graph traversal + frustum + render list) | 18.5% |
| `updateMatrixWorld` (scene graph matrix update) | 18.4% |
| `_renderObjectDirect` (per-draw object setup) | 9.7% |
| `isCulled` (part of `project`) | 6.3% |
| `get` (render-object cache lookup per draw) | 3.9% |
| `_update` (render-object uniform/state update) | 3.6% |
| `_draw`, `draw`, `setVertexBuffer`, `setBindGroup`, `submit` | 7.0% combined |
| `street-details.update` (signal state) | 1.3% |
| `traffic.update` (cars + peds + trams proxy) | 1.45% |
| `trams.js drive` | 0.7% |
| `pedestrians.js update` (rig pose solve) | 0.6% |
| `indexRoutePeds` / `walk` (traffic) | 0.9% combined |
| `updateSceneCulling` | 0.42% |

The renderer's own traversal and per-draw bookkeeping account for roughly **60% of all CPU time**; the game
simulation is a small remainder. This is why reducing draw calls and scene-graph size is worth more than tuning traffic.

### Per-frame allocations

Chrome allocation sampling over 5 s at 60 Hz found **0.6 MB allocated** in total (about 2 KB/frame). The largest
stacks are lazy pedestrian-route `links()` construction, `indexRoutePeds`, `renderPed`, `bendSpeed` Maps and
`project`/`pushLight`. There is no evidence of a per-frame allocation leak; the 903 MB retained heap is built at load,
not grown per frame. The hot-path scratch-object rule in AGENTS.md is holding.

### Post-processing, shadows and memory

Each row changes one thing from the default at Rynek (1280 × 720, golden). GPU timestamps are the summed
three.js query values, so compare rows, not the absolute ms.

| Variant | Draw calls | Triangles | CPU render ms | GPU timestamp ms | GPU memory MB | RTs | Programs |
|---|---:|---:|---:|---:|---:|---:|---:|
| Default | 1,553 | 7.90 M | 11.0–13.3 | 34.7 | 412.5 | 17 | 290 |
| No SSR | 1,556 | 7.87 M | 12.8 | 23.3 | 408.4 | 15 | 285 |
| No bloom | 1,541 | 7.90 M | 11.8 | 16.5 | 406.0 | 6 | 281 |
| No SSR + no bloom | 1,535 | 7.88 M | 12.2 | **8.4** | 401.9 | 4 | 276 |
| Shadow map 1024² per tile | 1,571 | 7.87 M | 16.7* | 33.8 | **284.5** | 17 | 290 |
| All sun shadows off | 845 | 5.13 M | 9.5 | 15.5 | — | 17 | — |
| Shadow reach 150 m | 1,275 | 7.25 M | 10.4 | n/c | — | 17 | — |
| Shadow reach 100 m | 1,203 | 6.94 M | 10.0 | n/c | — | 17 | — |
| `antialias: false` | 1,568 | 7.92 M | 14.0 | 34.9 | 412.5 | 17 | 290 |
| Pixel ratio 0.75 | 1,559 | 7.87 M | 10.9 | 32.8 | 380.9 | 17 | 290 |

\* The 1024² row ran while the machine was busy; its CPU number is not comparable. The GPU timestamp and memory are
the usable results. The shadow-reach rows are marked n/c for the GPU timestamp: two runs recorded 40.0 and 46.1 ms
while draws and CPU fell, which is run-to-run variance in the summed query, not evidence of a GPU regression. Use
their draw/triangle/CPU numbers. `antialias: false` changed nothing measurable (textures, render targets, draw calls
and GPU timestamp all identical), so the `antialias` constructor flag is not a usable quality knob in this build.
Setting `scenePass.renderTarget.samples` after the pass is created is also overwritten by `renderer.samples` each
frame.

**GPU memory at baseline is 412.5 MB**, of which 281.7 MB is textures, 94.2 MB vertex attributes, 31.5 MB storage
buffers (the WebGPU instance-matrix swap) and 3.6 MB programs. The 3072² × 2 shadow atlas is at least 75 MB of depth
storage; the measured 3072² → 1024² tile change saves **128 MB** in total, so the shadow resources are a large part of
the texture budget. The largest material textures seen are 17.3 MB, 14.4 MB and 12.9 MB canvases (2048 × 1664,
2048 × 1383 and 1440 × 1764), plus the 7.35 MB 3612 × 400 shop-sign atlas. JavaScript retains **903 MB after a forced
GC** (1.15 GB used before GC). A low-quality render tier cut GPU memory to **259.2 MB** (textures 132.4 MB, 4 render
targets, 2048 × 1024 shadow atlas) but the JS heap stayed at **899 MB**: render settings do not fix the
memory problem, because it is the scene graph/geometry and build data that remains resident.

### Mobile-sized viewport

At 390 × 844 (portrait phone, still `pixelRatio = 1`) the camera sees a narrower slice:

| Variant | Draw calls | Triangles | CPU render ms | GPU timestamp ms |
|---|---:|---:|---:|---:|
| Default, Rynek | 950 | 5.52 M | 8.7 | 27.6 |
| Default, Centrum drone | 1,575 | 6.97 M | 11.5 | 32.6 |
| Low tier, Rynek | 527 | 3.62 M | **3.4** | **4.8** |
| Low tier, Centrum drone | 645 | 4.89 M | **4.2** | **6.8** |

The narrow view cuts draw calls because fewer chunks fit horizontally. A phone in landscape (≈ 844 × 390) would
see more of the width and land nearer the 1280 × 720 numbers. Even at 390 × 844, default CPU render is 8.7 ms
(52% of a 16.7 ms budget) on this Mac; a 4–6× slower phone CPU is already over budget before the GPU does anything.

### Low-tier package

A package of settings that do not change gameplay: no SSR, no bloom, shadows at 150 m, shadow map 1024² per tile,
pixel ratio 0.75, static matrices, tree shadows off, street-furniture shadows off.

| | Default | Low tier |
|---|---:|---:|
| Rynek draw calls | 1,553 | 1,181 |
| Rynek triangles | 7.90 M | 6.41 M |
| Rynek CPU render | 11.0–13.3 ms | **7.9 ms** |
| Centrum drone draw calls | 2,851 | 1,526 |
| Centrum drone CPU render | 17.4–18.2 ms | **10.9 ms** |
| 6× CPU throttle, Rynek, CPU total | 96.0 ms | **60.2 ms** |
| GPU memory | 412.5 MB | **259.2 MB** |
| Render targets / programs | 17 / 290 | 4 / 276 |
| JS heap after GC | 903 MB | 899 MB |

On the 6× CPU proxy that moves ~10 fps to ~16 fps; on mid-range phone GPUs the post-processing removal is a larger
relative win than on this Apple GPU. The low tier still does not reach 30 fps on the 6× proxy, because draw calls and
scene traversal remain the wall.

## Ranked opportunities

The expected gains are on the measured views. "Risk" means risk to visuals or behaviour, not implementation risk;
"effort" is engineering effort in this repo's terms.

| # | Opportunity | Evidence | Expected gain | Risk | Effort |
|---|---|---|---|---|---|
| 1 | **Freeze the static scene graph** after the build (`scene.matrixWorldAutoUpdate = false`, then update only the player, traffic/tram instance data, landmarks-dynamic and the sun/camera each frame) | `updateMatrixWorld` is 18.4% of the 60 Hz CPU profile; the prototype removed it and cut Rynek CPU render 13.3 → 10.8 ms (−19%) and the 6× throttle frame 96.0 → 76.4 ms (−20%). No visual cost if the dynamic whitelist is complete | ~20% CPU render on every view; more on slow CPUs; no draw-call change | **Medium**: a missing dynamic root freezes visibly (player, goats, shadow focus). Needs the whitelist and a browser check | Medium |
| 2 | **Short shadow reach + drop prop/tree shadow casters** (low tier: 100–150 m cascades; no tree, furniture, tram or grid shadows; keep building proxies) | Shadow pass is 46% of draws / 35% of triangles at Rynek and 51% at the drone view. 150 m reach: 1,553 → 1,275 draws, 10.4 ms CPU; tree shadows off: −194 draws / −1.7 ms; all StreetDetails/TramInfrastructure/CityGrid casters off (incl. trees): −307 draws / −2.0 ms; all shadows off: 845 draws / 9.5 ms | 25–45% fewer draws and 15–30% CPU render; large GPU saving; shadow tile reduction takes GPU memory 412.5 → 284.5 MB (measured) | High visual: shorter/softer shadows and missing small-prop shadows. Acceptable only in a labelled low tier | Low–medium |
| 3 | **Drop SSR and bloom on weak GPUs** (or keep bloom at 0.25 resolution and disable SSR) | With both off the GPU timestamp sum falls 34.7 → 8.4 ms at Rynek; 17 → 4 render targets; 290 → 276 programs. Bloom alone accounts for 11 of the 17 render targets and 34.7 → 16.5 ms; SSR 34.7 → 23.3 ms. CPU render is unchanged | 3–4× GPU headroom on this GPU; fewer render targets and shader programs; less mobile bandwidth/power | Medium visual: no screen-space reflections, no lamp bloom. Night scenes lose the wet-road sparkle | Low |
| 4 | **Cut draw calls structurally** (merge roof kinds per chunk, batch street-furniture categories, reduce chunk count; longer term `BatchedMesh`) | 41,065 meshes, 37,865 geometries, 830k instances; 830 scene draws at Rynek and 1,390 at the drone view. Roofs cost 122 draws for 175k triangles; StreetDetails 164 draws / 2.27 M triangles. Coarser chunks alone took Rynek 1,553 → 1,269 draws and CPU render −18% but raised triangles 42%. `project` + `_renderObjectDirect` + per-draw overhead ≈ 60% of CPU | 20–40% of renderer CPU if draw calls fall by half; more on slow phones | Low visual if chunking only; medium if merging changes sorting/instancing. Coarser chunks hurt weak GPUs (more triangles) | Medium–high |
| 5 | **Tree LOD and draw-distance tier** (fewer variants/LODs, shorter `MAX_DIST`, no tree shadows) | Trees are 321 of 1,553 draws (21%) and 1.0 M triangles at Rynek; 950 of 2,851 (33%) and 2.47 M triangles at the drone view. Hiding the whole field saves 1.8 ms CPU at Rynek and 5.9 ms at the drone view; tree shadows alone save 194 draws / 1.7 ms at street level | 10–30% of draws and triangles at street level; up to 30% CPU at drone views; tree-shadow removal alone is cheap and mostly invisible from above | Medium visual: sparser crowns at distance; no tree shadows on the ground | Medium |
| 6 | **Shadow map resolution 3072² → 1024² (or 2048²) per cascade** | 412.5 → 284.5 MB GPU memory at 1024², textures 281.7 → 153.7 MB; no measurable fps change on this GPU (GPU timestamp 33.8 vs 34.7) | Saves 75–128 MB GPU memory and shadow fill on mobile; no proven frame-time gain on a fast GPU | Low–medium: softer/blockier shadows, especially on the helicopter view | Low |
| 7 | **Memory diet** (downscale the 2048-wide landmark canvas textures, release build-time data after construction, reduce dormant tree LOD meshes/instance buffers, shrink pools on low tier) | JS heap is 903 MB after GC; GPU 412.5 MB. Three canvas textures are 17.3 / 14.4 / 12.9 MB; the 30,259 tree meshes hold 21 MB of instance buffers for three LOD copies. A render-only low tier left the heap at 899 MB | ~100–300 MB less GPU memory with texture downscales; heap reduction requires scene/build changes; prevents OOM tab kills on 2–4 GB phones | Low visual if textures are halved only on low tier; build-data release must keep the collider/route data the runtime reads | Medium |
| 8 | **Index and cache the load-time spatial predicates** (`pointInPoly`, `pointInPark`, `inPlaza`, `insideCurbIsland`) | `pointInPoly` is 18.8% of boot self time and 32% of inclusive samples; park/plaza predicates add ~9%; boot is 16.5 s (100 s at 6× CPU). `insideCurbIsland` 2.4%, `crossingRuns` 2.3%, `layoutBusMarkings` 3.3%, `buildTrackGraph` 2.8% | 15–25% shorter load (2.5–4 s desktop, 15–25 s at 6×) if predicate cost halves; also less GC | Low if exact (bbox/edge index preserving exact results); medium implementation | Medium |
| 9 | **Population scaling on low tier** (peds 340 → 150–200, vehicle density / near target halved) | 340 pedestrians are all placed; the measured rig solve is 1.12 ms/frame for 340 rigs, and `traffic.update` is 1.0–1.2 ms at 60 Hz / 8.1 ms at 6×. Traffic draws are only ~32 meshes | ~0.3–0.6 ms/frame at 60 Hz, ~3–5 ms at 6×; no meaningful draw-call saving | Low–medium behaviour: emptier streets; must keep crosswalk/tram regression bounds | Low |
| 10 | **Dynamic resolution / pixel-ratio cap** | 0.75 pixel ratio: GPU timestamp 34.7 → 32.8 at 1280 × 720 (small on this GPU); at 390 × 844 the low tier already runs 4.8 ms GPU. Fill-rate is not the main wall on this Mac, but weak mobile GPUs are bandwidth-bound | 10–35% GPU fill on a bandwidth-bound device; no CPU change | Low visual: softer image; DPR-aware cap needed | Low |
| 11 | **Reduce MSAA** | `antialias: false` changed no measured metric (identical draw calls, render targets, texture memory and GPU timestamp) | None proven; possibly memory/fill on other drivers | Low if it works; unknown | Low (needs device test) |
| 12 | **HUD/map/audio** | `mapSystem.update` + `audioSystem.update` + buildings/landmarks/lighting are inside the 0.23–0.32 ms `scene` bucket; audio is 10 Hz and early-returns when disabled; DOM HUD is throttled to 250 ms | < 1 ms/frame; not a bottleneck | — | — |

Opportunity 8 (the load-time spatial predicates) was implemented on 2026-11-11; the measured before/after boot times
and equivalence checks are in [perf-boot-predicates-2026-11-11.md](perf-boot-predicates-2026-11-11.md).

## What the numbers mean for the low-quality tier

A low tier is **worth adding**, but it should be a package, not one switch:

- **Worth it now (largest measured wins):** freeze static matrices, disable SSR and bloom, shorten shadow reach,
  turn off tree and small-prop shadow casters, use 1024² shadow tiles, and reduce the pedestrian/vehicle population.
  This is the difference between 96 ms and 60 ms per frame at 6× CPU, and between 412 MB and 259 MB of GPU memory.
- **Auto-detection:** start the tier on the WebGL2 fallback, when `navigator.hardwareConcurrency <= 4`, when
  `navigator.deviceMemory <= 4`, or after a measured 2 s window below ~30 fps. Expose a user toggle and persist it in
  the existing `localStorage` pattern; the user may prefer sharp shadows over frame rate.
- **Not worth it as tier controls alone:** antialias sample count (no measured effect), clustered-light capacity
  (64/32/16/16 did not measure differently at 24–42 active lights), SSR resolution scale (0.25 did not change the
  timestamp or CPU at this view), and pixel ratio on a fast Apple GPU (small). These need real device measurements.
- **What still holds the low tier back:** draw calls and scene-graph size. Even with every quality knob above, Rynek
  is 1,181 draws and the drone view 1,526 draws; the 6× CPU run is still 60 ms. A second phase should merge chunks /
  roof kinds / furniture categories and reduce the 41k scene-graph objects. Without that, weak phones will remain
  around 15–20 fps in the low tier.

## Limits and what was not measured

- **No real phone, old laptop or integrated-GPU machine was tested.** The browser runs use an Apple-silicon GPU.
  The 6× CPU throttle is a synthetic JS-only slowdown; it does not slow the GPU, the driver or shader compilation.
- **GPU timestamps are summed three.js query results.** They include nested scene/shadow/post contexts and exceed the
  frame interval, so they are useful for ratios (default vs no SSR/bloom/shadows) but not as absolute frame times.
  The synchronous `queue.onSubmittedWorkDone` bench measured 19.5 ms p50 at baseline; the same bench could not be
  trusted for the low tier because three.js stopped re-evaluating the graph outside the animation loop.
- **No thermal throttling, no sustained-load run, no battery measurement, no iOS Safari, no Android Chrome.** The
  WebGL2 path was exercised only through Chrome's desktop ANGLE backend (`?backend=webgl`), with GPU timer values
  that did not move consistently with post-processing changes; do not use the WebGL2 GPU ms as a device estimate.
- **No visual A/B for the low tier.** Shadows off/soft, no reflections and no bloom were measured for cost, not
  reviewed in screenshots; a browser review of each tier is still required.
- **No build-time heap attribution by object type.** Phase memory (`performance.memory` at each `markInit`) and the
  post-GC total are measured; the exact composition of the 903 MB retained heap is inferred from counts, not from a
  full heap snapshot.
- **Draw-call counts include all passes and all objects three.js submits**, including post-processing quads and shadow
  stand-ins; they are not "visible street props". The shadow/scene split was derived by disabling sun shadows.
- **Off-screen instance counts use instance centres and a point-in-frustum test**, not GPU culling or covered pixels.
- **Audio output was not measured**; headless Chrome has no audible output and the Web Audio context is not started.
  Source inspection shows a 10 Hz ambience tick and an early return when muted, with no per-frame allocation.
- **Shader compile timings vary** with the OS/Chrome shader cache (1.26–4.7 s across runs; the slow runs were cold).
  No phone shader compile was measured.

## Reproduction

`.agent-task/perf-main.js` (instrumented copy of `main.js`), `.agent-task/perf-post.js` (optional bloom),
`.agent-task/perf-scene-culling.js` (chunk/cull overrides), `.agent-task/perf.html`, `.agent-task/run-perf.mjs`
(Puppeteer runner) and `.agent-task/vendor/` (the pinned three.js builds) are left in the worktree for reruns. They are
not loaded by `index.html` and are not part of production. Serve the repo root on port 8111 and run, for example:

```sh
node .agent-task/run-perf.mjs '{"query":"","steps":[{"view":"rynek","seconds":3}]}'
node .agent-task/run-perf.mjs '{"query":"ssr=0&bloom=0&shadows=0&staticmatrix=1&pr=0.75","steps":[{"view":"rynek","seconds":3}]}'
node .agent-task/run-perf.mjs '{"query":"","cpu":6,"steps":[{"view":"rynek","seconds":3}]}'
node tools/benchmark-pedestrians.mjs .agent-task/vendor/three.core.js
```

URL switches in `perf-main.js`: `ssr=0`, `bloom=0`, `shadows=0`, `sunshadows=0`, `shadowfar=150`,
`shadowtile=1024`, `samples=0`, `pr=0.75`, `staticmatrix=1`, `msaa=0`, `time=midnight`, `lights=64,32,16,16`,
`cullmin`, `cullmax`, `cullper`, `staticcell`, `smallcell`, `proxycell`.
