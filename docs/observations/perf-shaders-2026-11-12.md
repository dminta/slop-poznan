# Cutting opaque shadow shader variants at boot (2026-11-12)

## Result

Keep the scene shaders and simplify the **opaque shadow colour** to constant black with alpha 1. Resident programs
fall **287 → 224 on high (−63, −22%)** and **267 → 206 on low (−61, −23%)**. Median compile + warm-up falls
**1,471 → 1,359 ms high / 1,503 → 1,249 ms low** with fresh browser profiles; on the second navigation in each
profile, **1,456 → 1,296 ms high / 1,513 → 1,244 ms low**. The saving is in warm-up; the scene compile remains
about one second. Nothing is deferred past the first frame.

The 3.9 s historical compile/warm-up figure was **not reproduced** on this machine's current shader caches. These
are measured deltas against the current checkout, not a claim that the old 3.9 s boot became 1.3 s through this patch.

## Method

Baseline: `809a394`, this worktree, port **8137**, `python3 -m http.server 8137`. The three.js SHA stays
`0a980dcf032223a274fcdd60ab56330f1321cca0`. No geodata, geometry, renderer settings or time presets change.
Headless Chrome 157 on the Apple-silicon Mac, Apple WebGPU adapter, 1280 × 720, device scale 1, production tier pixel
ratios (1 high / 0.75 low). Launch flags match the earlier audits:

```
--headless=new --enable-unsafe-webgpu --no-sandbox --disable-gpu-sandbox
--ignore-gpu-blocklist --enable-features=Vulkan --disable-dev-shm-usage
```

- `?stats=1&quality=high|low`, three independent browser launches per tier per version. Every launch gets a fresh
  `--user-data-dir`; its first navigation is labelled **cold profile**, its second **warm profile**. Browser profiles
  are cold, but the OS/Metal shader cache was not erased. The short cold-profile timings show that this distinction
  matters. There was no CPU throttling. Baseline and final timing batches ran separately, without other benchmark
  processes deliberately running alongside them.
- A scratch Puppeteer runner intercepts `main.js` to expose local references and wraps backend `createProgram` and
  `createRenderPipeline` for attribution. Production builders, compile jobs and warm-up execute normally. Timings are
  the production `[init]` log; collecting shader source and serializing results happens after ready. `Math.random`
  uses seed 4242. An extra baseline attribution boot per tier confirms the same counts.
- Attribution records the first pipeline using each distinct vertex/fragment source, its scene ancestry and pass.
  `renderer.info.memory.programs` counts **shader stages**, including compute, rather than render pipelines. Counts
  therefore must not be compared directly to the number of pipeline descriptors.
- Visual runs additionally freeze shader time to 1 s and simulation to one fixed 1/60 s step, stop the animation
  loop after warm-up, and render four frames per camera/preset before capturing. All actors and trees remain visible.
  Clouds are stationary in both versions. The loading overlay is removed and two compositor frames are allowed
  before each screenshot. The first inherited harness camera `(0, 10, 140)` was obstructed; final Rynek uses the
  current application's view `(22, 7, 58)` looking at `(0, 30, 0)`, FOV 60. Centrum drone is
  `(-1150, 320, 900)` looking at `(-1100, 0, 0)`, FOV 55.
- Initial visual attempts encountered a resource socket error and then a missing CORS header in the harness's CDN
  cache. Final screenshot runs serve the exact successful CDN responses with CORS headers, without editing the
  import map or three.js. Discarded screenshots included the loading-screen fade and the obstructed old camera.

Scratch scripts, JSON and PNGs are under `.agent-task/perf-harness/`; they are not site files.

## Before and after

All times below are milliseconds, medians of three. The sum column is the median of each run's compile + warm-up,
not the sum of separately rounded medians. Ranges show all three observed sums.

| Tier / profile | Compile before → after | Warm-up before → after | Sum before → after | Sum ranges before / after | Programs before → after |
|---|---:|---:|---:|---|---:|
| High cold | 1,000 → 1,061 | 468 → 298 | **1,471 → 1,359 (−7.6%)** | 1,462–1,477 / 1,306–1,404 | 287 → 224 |
| High warm | 1,023 → 1,040 | 429 → 254 | **1,456 → 1,296 (−11.0%)** | 1,420–1,465 / 1,294–1,301 | 287 → 224 |
| Low cold | 1,027 → 997 | 476 → 252 | **1,503 → 1,249 (−16.9%)** | 1,429–1,523 / 1,244–1,286 | 267 → 206 |
| Low warm | 1,107 → 1,015 | 421 → 229 | **1,513 → 1,244 (−17.8%)** | 1,454–1,528 / 1,124–1,335 | 267 → 206 |

Warm-up alone improves 36% / 41% on high and 47% / 46% on low (cold / warm). High scene compilation does not improve;
its extra 17–61 ms may include the wrapper's graph-build overhead and shared-machine noise. The low compile-time
change is also too small and variable to attribute confidently. Program counts and the warm-up improvement are the
consistent signal.

### All init phases

Each cell is the before → after median. Phase totals exclude module evaluation/network time before `initApp` and
are not navigation-to-ready measurements.

| Phase | High cold | High warm | Low cold | Low warm |
|---|---:|---:|---:|---:|
| renderer | 9 → 11 | 36 → 38 | 9 → 10 | 38 → 40 |
| quality | 4 → 8 | 3 → 2 | 6 → 5 | 3 → 2 |
| lighting | 23 → 23 | 11 → 12 | 24 → 23 | 11 → 11 |
| landmarks | 59 → 60 | 51 → 54 | 62 → 61 | 52 → 52 |
| blocks | 1,224 → 1,237 | 1,264 → 1,285 | 1,282 → 1,264 | 1,302 → 1,289 |
| cityGrid | 1,391 → 1,421 | 1,370 → 1,419 | 1,432 → 1,446 | 1,461 → 1,406 |
| airport | 3 → 4 | 2 → 2 | 4 → 4 | 3 → 2 |
| canopies | 1 → 1 | 1 → 1 | 1 → 1 | 0 → 0 |
| outskirts | 53 → 54 | 55 → 57 | 55 → 54 | 61 → 57 |
| bridges | 80 → 85 | 82 → 85 | 86 → 84 | 88 → 83 |
| streetDetails | 1,605 → 1,682 | 1,572 → 1,651 | 1,724 → 1,640 | 1,691 → 1,580 |
| traffic | 1,541 → 1,582 | 1,573 → 1,695 | 1,655 → 1,607 | 1,708 → 1,636 |
| roadPaint | 30 → 32 | 27 → 29 | 32 → 33 | 30 → 32 |
| tramInfra | 67 → 69 | 71 → 72 | 70 → 70 | 76 → 71 |
| trams | 117 → 136 | 134 → 140 | 132 → 129 | 142 → 143 |
| controllers | 7 → 7 | 17 → 19 | 7 → 7 | 20 → 19 |
| culling | 363 → 383 | 372 → 374 | 236 → 248 | 244 → 234 |
| ui | 22 → 25 | 20 → 22 | 26 → 23 | 18 → 18 |
| postFX | 16 → 18 | 14 → 15 | 6 → 6 | 4 → 4 |
| compile | 1,000 → 1,061 | 1,023 → 1,040 | 1,027 → 997 | 1,107 → 1,015 |
| warmup | 468 → 298 | 429 → 254 | 476 → 252 | 421 → 229 |
| firstFrame | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| gpu | 63 → 47 | 73 → 54 | 104 → 44 | 112 → 51 |
| phase sum | 8,147 → 8,303 | 8,147 → 8,381 | 8,456 → 8,087 | 8,539 → 7,963 |

Whole-boot phase sums **do not improve on high** in these separate batches: unrelated builders vary by hundreds of
milliseconds. The result claimed here is the reduction in time spent compiling/warming, not a demonstrated high-tier
navigation-to-ready improvement. GPU ready-wait also decreases, but is a separate measure from warm-up CPU time.

## Program attribution and the selected change

These are **program creations during boot**, first-owner attribution of shared stage sources. High creates four
transient stages which are released, so creations total 291 / 228 while resident programs are 287 / 224. Low retains
all 267 / 206. Pipeline counts likewise count backend creations, not scene objects or draw calls.

| Pass / family | High stages before → after | Low stages before → after |
|---|---:|---:|
| Environment / PMREM | 6 → 6 | 6 → 6 |
| Scene | 179 → 179 | 177 → 177 |
| Sun-shadow depth (additional stages) | **85 → 22** | **81 → 20** |
| SSR (including empty-pass setup variants) | 9 → 9 | 0 → 0 |
| Bloom | 9 → 9 | 0 → 0 |
| Final grading / output | 2 → 2 | 2 → 2 |
| Clustered-light compute | 1 → 1 | 1 → 1 |
| Total creations | **291 → 228** | **267 → 206** |
| Resident programs | **287 → 224** | **267 → 206** |
| Render pipeline creations | **160 → 128** | **143 → 112** |

The 97 scene pipeline creations per tier cover curtain walls, pre-war and panel facades, roofs/dormers/gables,
landmark stone/glass/windows, road and pavement surfaces, water, terrain and outskirts, tree LODs, street and tram
furniture, decals/signs/lamp glows, people, cars/buses/trams and the player models. They remain unchanged.
The sun's two cascades already share their program sources.

Before the change, the first owners of high-tier shadow pipelines were traffic/pedestrians (14), CityBlocks (12),
bridges (6), airport (2), static shadow proxies (2), landmarks (2), player taxi (2), street details (2), helicopter,
cyclist, trams and tram infrastructure (one each). These sum to 46 shadow pipeline creations; the new total is 14.
These are first-owner counts: a later family can reuse an earlier family's pipeline.

The pinned renderer's
[`_getShadowNodes`](https://github.com/mrdoob/three.js/blob/0a980dcf032223a274fcdd60ab56330f1321cca0/src/renderers/common/Renderer.js)
multiplies shadow alpha by `material.colorNode.a`. A procedural `Fn` returning RGB still generates the entire colour
graph to obtain that alpha. For opaque normal-blended materials the eventual shader forces alpha to 1. This produced
shadow variants containing facade parallax interiors and car liveries: expensive work whose result cannot affect
opaque shadow coverage.

`prepareOpaqueShadows(scene)` wraps each eligible caster material once before compilation. During graph building,
`builder.material.isShadowPassMaterial` selects constant `(0, 0, 0, 1)`; scene building selects the exact original node.
This is a **build-time choice**, with no extra per-pixel branch. The simpler depth graphs share programs across colours,
facade styles and vehicle specifications. Position/depth nodes, culling, face sides, cascade cadence, geometry and the
warm-up traversal stay unchanged. Alpha test/map/hash/coverage, mask nodes, custom shadow colour, opacity nodes,
transmission, backdrop and non-normal blending are excluded. Tree leaf cutouts therefore keep their original path.

The downloaded pinned build was byte-identical to the prior audit's local vendor copy (SHA-1
`421d6fa90f65a5dead4559e0b5d05fd88d381163`). Its `compileAsync(scene, camera, targetScene, onProgress)` exists, schedules
8 ms build slices and permits asynchronous pipeline creation. The existing 16-worker boot path remains intact.

## Experiments rejected

- **Batch all plain meshes of a material into one compile traversal.** One preliminary run per tier/profile:
  compile high 966 / 936 ms and low 991 / 920 ms (cold / warm), warm-up high 464 / 441 and low 448 / 420.
  Counts stay 287 / 267. The scheduling gain is small beside run-to-run variation; no borrowed-child groups ship.
- **Skip duplicate plain-mesh vertex layouts before compiling.** One preliminary run: high compile 946 / 911,
  low 985 / 899 ms; warm-up high 478 / 455, low 456 / 436. It avoided 458 render-object builds but needed a second
  definition of renderer layout equivalence. The final patch avoids that maintenance obligation.
- **64 workers instead of 16.** High compile 1,030 / 1,030 and low 1,032 / 1,039 ms; warm-up high 505 / 451,
  low 470 / 421. Counts unchanged. No useful gain.
- **Facade dimension uniforms plus both traversal changes.** Three runs per tier/profile. Median high compile
  1,009 / 882, warm-up 475 / 447; low compile 896 / 928, warm-up 478 / 405. Programs only fell 287 → 285 and
  267 → 265: two curtain-wall variants differing in spandrel dimensions merged; the masonry change alone saved no
  programs. This was a much larger change for a smaller and less consistent gain than removing unused shadow RGB.
  No facade dimensions or material-cache keys change in the final patch.
- **Defer off-screen/night materials.** Not implemented or benchmarked. Night uses live uniforms in the same graphs;
  a camera jump can expose any district immediately. Deferral would need a scheduling/readiness guarantee and could
  shift the stall into interaction. The selected change saves programs while keeping full precompile and warm-up.

The one-run scheduling experiments are exploratory figures, not statistically established improvements; only the
baseline, combined facade experiment and final patch received three runs per configuration.

## Visual and runtime checks

All 24 required comparisons completed: two backends × two tiers × Rynek / Centrum drone × midday / golden / midnight.
Screenshots are 1280 × 720 (the low internal render target retains its normal 0.75 pixel ratio).

| Backend / tier | Comparisons | RGB pixel differences |
|---|---:|---|
| WebGPU high | 6 | Exactly zero in every view/preset |
| WebGPU low | 6 | Exactly zero in every view/preset |
| WebGL2 high | 6 | Five exact; golden Centrum drone differs in 2 pixels, max 3/255, mean 0.00000217 |
| WebGL2 low | 6 | Exactly zero in every view/preset |

No pixel differs by more than 4 in any comparison. Both backends retain building/actor shadows, tree cutouts and the
near/far cascade behaviour. The actual fallback was verified as `WebGLBackend`, `isWebGPUBackend === false`.
Final browser runs have no console errors, warnings, page errors or `[compile]` warnings.

Program counts remain 287 / 267 before and 224 / 206 after throughout all six camera/preset combinations per backend.
No first-use shader compile was moved into a camera jump or night transition. The largest measured CPU render after a
camera/preset switch was 60.7 → 61.4 ms (WebGPU high), 24.5 → 25.5 (WebGPU low), 52.7 → 52.5 (WebGL2 high),
23.1 → 21.9 (WebGL2 low). These are one-off geometry/visibility transitions with GPU completion awaited separately;
the ±1 ms changes are not evidence of new shader stalls. No asynchronous deferred path ships.

PNG captures, per-frame CPU times, console logs and the 24 pixel-diff rows are in `visual-final/`, `visual-gl/` and
`pixel-diffs.json` under the scratch harness. Visual inspection used the Rynek daylight view and the golden Centrum
panorama as well as the quantitative comparisons.

## Limits and reproduction

- No real phone, integrated-GPU laptop, Safari, thermal or sustained-load test. Timings are this Mac's current caches.
  Fresh Chrome profiles do not prove a cold OS/Metal shader compiler cache; no shared OS caches were deleted.
- The runtime depends on the pinned renderer's shadow-material flag and its opaque-alpha behaviour. Recheck the helper
  together with `SunShadowNode` after a three.js bump. Materials created after boot would need the same preparation;
  the current city and pools create their materials before it.
- No programs are deferred, so there is no background compilation completion or deferred first-use frame to time.
  Camera/preset transition CPU times are diagnostic, not an unloaded real-time frame-rate benchmark.
- `node --test tests/`: **567 pass, 0 fail** (110.3 s). The new regression checks the scene/shadow build branch and
  exclusions that preserve cutouts, transmission and other alpha-dependent shadows. Browser pixel comparisons cover
  actual shader compilation and appearance. `git diff --check` passes.

Scratch reproduction (Puppeteer Core from the previous audit's `/private/tmp/slop-poznan-base/.agent-task/node_modules`):

```sh
python3 -m http.server 8137
node .agent-task/perf-harness/run.mjs '{"main":".agent-task/perf-harness/before-main.js","materials":".agent-task/perf-harness/before-materials.js","out":".agent-task/perf-harness/before"}'
node .agent-task/perf-harness/run.mjs '{"out":".agent-task/perf-harness/after"}'
node .agent-task/perf-harness/visual.mjs '{"backends":["webgpu"],"out":".agent-task/perf-harness/visual-final"}'
node .agent-task/perf-harness/visual.mjs '{"backends":["webgl"],"out":".agent-task/perf-harness/visual-gl"}'
node --test tests/
```

`before-main.js` and `before-materials.js` are original-source fixtures from this task's base. The runners use request
interception; no instrumentation or global hooks ship in `js/`. All changes are left uncommitted in this worktree.
