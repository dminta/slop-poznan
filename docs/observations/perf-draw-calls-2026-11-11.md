# Cutting draw calls structurally: roofs, street furniture and shadow stand-ins (2026-11-11)

> **Round 2 supersedes the numbers below.** The branch was rebased from `bb9a835` onto `poznan` `215f527`
> (the one-time quality choice, GPU-identity detection, `?stats=1` panel, low-tier tree profile and the boot-part-2
> indexes) and each of the four batching parts was measured separately. Round 1 was measured on the old baseline and
> includes trees/SSR noise in its pixel diffs; its structure and rejected variants remain useful history. The sections
> from **Question** onward are the Round 1 record; the Round 2 numbers above supersede them.

## Round 2: rebase, per-part ablation and final validation

### Rebase

The branch was rebased with `git stash`, `git merge --ff-only poznan` (`a299cdd` → `215f527`) and `git stash pop`.
Conflicts were limited to `docs/backlog.md` and `docs/rendering.md`; the code merged cleanly. `main.js` no longer
switches tiers at runtime, so the low tier is applied once at boot
(`qualitySettings.shadowCasters` → one loop that clears `castShadow` under the four prop roots). The prop stand-ins
are now built **only on high**: `setupSceneCulling(..., { propShadowProxies: qualitySettings.shadowCasters })`, so
low does not pay their build time or retained heap. The new `?stats=1` panel, GPU-identity quality decision, low tree
profile and boot-part-2 indexes are untouched.

### Ablation method

Each part was isolated in a copy of the rebased tree, with the other three disabled by a small local patch
(`chunkCellScale` → 1, `PROP_PROXY_MIN_TRIS` → Infinity, per-kind roof materials, separate lamp mast/housing). The
baseline is a pristine `git archive 215f527` (the ablation itself was run against `a299cdd`; the deltas are identical
in kind and are confirmed on `215f527` by the final validation below). All arms use the same production modules and
the same instrumented `perf-main.js`; high tier, 1280 × 720, WebGPU, 4 alternating runs per arm for CPU/draws, one
`gc:true` run for retained heap/GPU, and a separate `?sunshadows=0` boot for the scene/shadow split.

### Ablation table (vs the rebased baseline)

Draws and triangles are one representative run; CPU is the mean of four alternating runs; GPU/heap are after a
forced GC; the culling phase is the `[init]` timing (two runs).

| Arm | Full draws Rynek | Scene / shadow | Tris Rynek | Full draws drone | Scene / shadow | Tris drone | Render CPU Rynek | Render CPU drone | 6× Rynek render / frame | GPU MB | Heap MB | Culling ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| baseline | 1,568 | 845 / 723 | 7.87 M | 2,851 | 1,391 / 1,460 | 10.37 M | 12.74 | 20.58 | 84.8 / 96.1 | 384.4 | 908.5 | 254 |
| A roofs | 1,536 | 814 / 722 | 7.79 M | 2,821 | 1,350 / 1,471 | 10.33 M | 11.79 | 19.05 | 81.8 / 93.9 | 384.3 | 908.7 | 267 |
| B lamp merge | 1,528 | 838 / 690 | 7.94 M | 2,827 | 1,388 / 1,439 | 10.53 M | 11.09 | 19.08 | 79.2 / 91.2 | 383.6 | 901.4 | 252 |
| C cell scale | 1,497 | 810 / 687 | 8.24 M | 2,794 | 1,353 / 1,441 | 10.65 M | 11.31 | 19.28 | 83.3 / 95.1 | 385.8 | 897.3 | 232 |
| D prop shadows | 1,448 | 841 / 607 | 7.70 M | 2,763 | 1,401 / 1,362 | 10.47 M | 10.50 | 17.85 | 71.8 / 82.9 | 390.2 | 960.6 | 580 |
| all four | 1,375 | 771 / 604 | 8.04 M | 2,658 | 1,306 / 1,352 | 10.70 M | 10.06 | 17.50 | 69.5 / 81.2 | 390.3 | 937.5 | 471 |

What each part buys and costs:

- **A (roofs merged per piece):** −32 draws at Rynek (scene −31, shadow −1), −30 at the drone; triangles −0.9 %;
  renderer CPU −7 %; no GPU/heap cost; +13 ms culling. Pixel-identical (below).
- **B (lamp mast + housing):** −40 draws at Rynek (shadow −33), −24 at the drone; triangles +0.9 % (the housing now
  follows the mast's 1 km chunks); CPU −13 % (noisy); GPU/heap slightly lower (fewer meshes); culling unchanged.
- **C (cheap-prop cell scale):** −71 draws at Rynek, −57 at the drone; triangles +4.7 % / +2.7 %; CPU −11 %
  (60 Hz) but only −1.7 % at 6× in this sample; +1.4 MB GPU, −11 MB heap, culling −22 ms. This is the part with the
  least certain CPU gain per added triangle; it stays because the triangle penalty is far below the audit's rejected
  +42 % and it saves draws on the low tier too.
- **D (merged prop shadow stand-ins):** −120 draws at Rynek (shadow −116), −88 at the drone; triangles −2.2 %
  (proxy cell culling), CPU −18 % / −13 %, 6× −15 %; but **+5.8 MB GPU at boot, +52 MB retained heap and +326 ms
  culling** (the ~51 MB worst case when every stand-in cell is uploaded). This is the source of the memory/boot cost
  the task suspected, and it is why it is now built only on the high tier. On low it is skipped, so low pays nothing.
- **All four:** −193 draws (−12.3 %) at Rynek, −193 (−6.8 %) at the drone, CPU −21 % / −15 %, 6× −18 %; +2.3 %
  triangles; GPU +5.9 MB, retained heap +29 MB, culling +217 ms. A's merged meshes offset part of D's heap/boot cost.

### Deterministic pixel diffs

Round 1 compared moving clouds, tree wind and SSR and called the result "within noise". For Round 2 the harness
freezes the sky (`?detsky=1` sets `sky.cloudSpeed = 0` and re-bakes the PMREM), hides trees and dynamic actors, turns
SSR off, uses `sim=0`, waits three frames and compares four fixed views. Baseline-vs-baseline noise is now **0** on
`rynek2`, `jezyceRoof`, `centrum` and `wildaRoof`.

| Arm | Rynek street | Jeżyce roofs (34 m) | Centrum street | Wilda roofs |
|---|---|---|---|---|
| A | **0** | **0** | **0** | **0** |
| B | **0** | max 6 (1 px) | **0** | max 19 (1 px ≥8) |
| C | **0** | max 7 (3 px ≥4) | max 15 (2 px ≥8) | max 26 (2 px ≥8) |
| D | **0** | **0** | **0** | **0** |
| all four | **0** | max 7 (4 px ≥4) | max 15 (2 px ≥8) | max 26 (2 px ≥8) |

A and D are bit-identical. B's one-to-three pixels are the lamp housing's triangles moving from their own draw into the
mast draw (draw order at a silhouette); C's two-to-five pixels are a distant cheap prop crossing its new, wider cell
boundary. Neither is a surface or shadow change and neither is visible; there are no coplanar/draw-order artefacts.
The merged (`215f527`) base-vs-final diff is the same: **0** on Rynek, 4–5 pixels ≥4 levels elsewhere, mean ≤ 0.00005.

### Final merged tree (215f527 + all four parts)

Single validation runs, same harness, `quality=high` and `quality=low`:

| Tier / view | Draws before → after | Scene / shadow after | Triangles before → after | Render CPU before → after | Frame total before → after |
|---|---:|---:|---:|---:|---:|
| High Rynek | 1,547 → **1,381** (−10.7 %) | 771 / 610 | 7.85 → 8.06 M (+2.6 %) | 11.49 → **10.02** (−12.8 %) | 13.17 → **11.73** |
| High Centrum drone | 2,853 → **2,635** (−7.6 %) | 1,311 / 1,324 | 10.41 → 10.67 M (+2.6 %) | 18.18 → **16.85** (−7.3 %) | 19.66 → **18.37** |
| High 6× Rynek | 1,557 → **1,388** | — | — | 77.3 → **66.8** (−13.6 %) | 88.5 → **77.8** (−12.1 %) |
| Low Rynek | 1,005 → **934** (−7.1 %) | 667 / 267 | 6.07 → 6.37 M (+4.9 %) | 7.72 → **7.02** (−9.1 %) | 9.06 → **8.27** |
| Low Centrum drone | 1,404 → **1,298** (−7.6 %) | 811 / 487 | 6.91 → 7.09 M (+2.6 %) | 9.33 → **8.60** (−7.8 %) | 10.59 → **9.81** |
| Low 6× Rynek | 1,003 → **925** | — | — | 50.6 → **48.5** (−4.1 %) | 59.4 → **56.9** |

Boot/memory on the merged tree: high GPU 384.4 → 390.3 MB (+5.9), retained heap 962.4 → 993.9 MB (+31.5), culling
223 → 387 ms, boot 10.57 → 10.32 s (within noise). Low GPU 222.9 → 223.3 MB (+0.4), retained heap
932.9 → 920.1 MB (**−12.8 MB**, because low skips the stand-ins and the merged meshes remove chunk objects), culling
217 → 230 ms, boot 10.67 → 10.61 s.

### Recommendation

- **Keep A and B.** They are pixel-identical (A) or differ at 1–3 lamp-edge pixels (B), cost no memory or boot time,
  and together remove ~70 draws at Rynek and ~54 at the drone.
- **Keep C**, but treat the triangle penalty as the tuning knob: it removes ~70 draws for +4.7 % triangles, and the
  1.5× notch alone accounts for ~39 of those draws for ~1.4 % triangles. If weak-GPU vertex load turns out to matter,
  drop the 1.5× notch first (`chunkCellScale` → 2×/1×); dropping the 2× notch as well loses ~32 draws but returns
  ~3 % triangles.
- **Keep D on high only.** It is the biggest CPU/draw win (−120 draws, −15–18 % CPU) but also the only part with a real
  memory/boot bill (+52 MB heap, +5.8 MB GPU, +326 ms culling). Gating it on `qualitySettings.shadowCasters` means the
  low tier — the older-device target — builds none of it and keeps its heap below baseline.
- The combined tree gives −10.7 % high Rynek draws, −12.8 % renderer CPU, −12 % at 6×, and −7 % low-tier draws with
  a 12.8 MB lower low-tier heap.


## Question

The older-device audit ([perf-older-devices-2026-11-11.md](perf-older-devices-2026-11-11.md), recommendation 4)
found draw submission, not triangles, the wall: Rynek street view submitted 1,553 draws (830 scene + 717 shadow
cascades), Centrum drone 2,851, and `project` + `_renderObjectDirect` + per-draw setup were about 60% of renderer CPU.
Roofs alone cost 122 draws for 175k triangles; StreetDetails 164 draws for 2.27M triangles. Can the same scene be
submitted with far fewer draws, without visible change in the high tier and without breaking the low tier?

## Method

Headless Chrome 157 on Apple silicon, 1280 × 720, `devicePixelRatio` 1, WebGPU unless stated, served from the worktree
on port 8112. The perf island is `.agent-task/perf-harness/` (`perf.html`, `perf-main.js`, `run-perf2.mjs`): a copy of
the current `js/main.js` that adds a frozen camera, per-frame `renderer.info` sampling and `window.__perf` hooks, while
importing the production `js/` modules unchanged. The baseline is a `git archive` copy of `bb9a835` in
`/tmp/slop-poznan-base` on port 8113 with the same harness; arms were run alternately, 2 runs each after a 2.5 s settle
and 4 s sample.

- Views: `rynek` (0, 10, 140 looking at the Ratusz) and `centrumDrone` (−1150, 320, 900), the audit's fixed cameras.
- `?quality=high|low` forces a tier without persistence; the high runs therefore cannot be changed mid-run by the FPS
  watchdog. 6× runs apply `Emulation.setCPUThrottlingRate 6` after boot so load time is not multiplied.
- Draw calls and triangles are `renderer.info.render` with `autoReset = false`, reset once per frame: scene pass,
  both shadow cascades and post-processing. The scene/shadow split is a second boot with `?sunshadows=0` (sun shadows
  disabled before the first frame, so no in-run shader recompile).
- A root's contribution is measured by hiding one root for a sample; the roof family by hiding every mesh whose name
  starts with `Roof-`.
- Pixel diffs compare two independent boots with `sim=0` (traffic, pedestrians, trams and landmarks frozen in their
  deterministic build positions) at the same fixed camera and preset. Every pixel pair is also compared against a
  second baseline boot, because MSAA/SSR/alpha-tested leaf edges make even two baseline runs differ slightly.
- Boot time is `[init]` plus the GPU completion wait; GPU memory is `renderer.info.memory`; retained heap is measured
  after `HeapProfiler.collectGarbage`.

## Changes

1. **Roof family merge.** `createRoofMaterial({ kinds: ['tile','slate','copper'] })` builds one material whose kind
   parameters are selected by a per-instance `roofKind` attribute. The values are mixed with exact `step` factors
   (`step(roofKind, i + 0.5)`, 0 or 1), so a shared-material mesh renders the same uniforms as the old per-kind
   material. `createRoofs` detects a shared material and creates one mesh per unit piece (`Roof-prism`, `Roof-hipCap`,
   `Roof-gambrel`, `Roof-mansardCap`, `Roof-dormer`) instead of one per piece × kind. The family drops from 17 meshes
   (12 roof, 2 dormer bodies, window, 2 gable screens) to 8. Passing three distinct materials keeps the old per-kind
   meshes, which `tests/roofs.test.cjs` uses for the geometry checks; a new test checks the merged `roofKind` arrays.
2. **Street-lamp mast and housing merge.** The LED mast and its luminaire housing share `poleMetalMat` and the same
   instance matrix. They are now one merged geometry and one `InstancedMesh`; the separate housing mesh alone had 904
   chunks citywide because its small bounds gave it a 250 m cell, against 90 for the 10 m mast.
3. **Cheap-prop culling cells.** `chunkCellScale` gives meshes of ≤ 40 triangles per instance 2× the chunk cell and
   ≤ 120 triangles 1.5×. Tree-pit boxes, plates, signal lenses and rings are sub-pixel at those distances; hydrants
   and lamp masts keep the per-instance cell. Large meshes (roofs, dormers) deliberately keep `STATIC_CELL`.
4. **Merged prop shadow stand-ins.** Before chunking, static casters under `StreetDetails`, `TramInfrastructure` and
   `CityGrid` with 4k–300k triangles and a radius over 300 m (trees excluded, heavy hydrants excluded) are baked into
   one position-only mesh per 500 m cell and face side on `SHADOW_PROXY_LAYER`. The shadow pass needs depth only, so
   all furniture categories of a side are one draw per cell instead of one per category per 250 m chunk. Cell
   positions are counted and then written into typed arrays in two passes (keeping them in JS number arrays first
   cost ~300 MB of transient boot heap). The stand-ins are flagged `userData.propShadowProxy`. Round 1 captured them
   for the low tier and turned their `castShadow` off; Round 2 instead gates the bake itself on the tier (see above),
   so low never builds them while the building/landmark stand-ins keep casting.
5. **Doc/test updates.** `docs/rendering.md` and `docs/world.md` describe the new mesh structure; a `scene-culling`
   unit test pins the cell-scale thresholds. `node --test tests/` passes (518 tests).

## Results (high tier, WebGPU, 1280 × 720)

Two alternating runs each; ranges in parentheses.

| View | Draws before | Draws after | Triangles before | Triangles after | Renderer CPU ms before | after | Frame total ms before | after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rynek street | 1,553 | **1,390** (1,387–1,393) | 7.89 M | 8.03 M | 10.4 (10.1–10.6) | **8.6** (8.5–8.7) | 12.0 | **10.1** |
| Centrum drone | 2,856 (2,845–2,867) | **2,653** (2,647–2,658) | 10.40 M | 10.68 M | 17.1 (17.0–17.2) | **16.2** (16.1–16.2) | 18.6 | **17.6** |

Draws fall **10.5%** at Rynek and **7.1%** at Centrum drone; renderer CPU falls **17%** and **5.6%**. Triangles rise
1.8–2.7%: the merged roof chunks and the wider cheap-prop cells cover a little more off-screen geometry. Frame time at
60 Hz is the 16.67 ms cap at Rynek; Centrum drone was render-bound and falls 18.6 → 17.6 ms.

Scene/shadow split (one boot with `?sunshadows=0`):

| View | Scene draws | Shadow draws | Scene triangles | Shadow triangles |
|---|---:|---:|---:|---:|
| Rynek before | 843 | 710 | 5.15 M | 2.75 M |
| Rynek after | **774** | **616** | 5.41 M | 2.62 M |
| Centrum drone before | 1,393 | 1,463 | 7.12 M | 3.28 M |
| Centrum drone after | **1,305** | **1,348** | 7.34 M | 3.34 M |

The shadow pass loses 13.2% of draws at Rynek and 7.9% at the drone view with essentially the same triangles: the
prop stand-ins are position-only and merge categories, and the roof/cheap-cell changes also remove shadow chunks.

### 6× CPU throttle (after boot, `quality=high`)

| View | Draws before → after | Renderer CPU before → after | Frame total before → after | dt before → after |
|---|---:|---:|---:|---:|
| Rynek | 1,556 → **1,387** | 73.0 → 68.5 ms (−6%) | 86.0 → **81.9 ms** (−5%) | 89 → 85 ms |
| Centrum drone | 2,858 → **2,666** | 112 → 113 ms (flat) | 124 → 126 ms (flat) | 127 → 129 ms |

Rynek improves; the drone view is within run-to-run noise at 6×. At `quality=low` the same throttle moves Rynek from
1,093 to 984 draws and Centrum drone from 1,870 to 1,739, but renderer CPU is flat within noise (58.2 → 58.4 ms and
91.1 → 94.1 ms; total 68.5 → 68.4 ms and 101.2 → 104.0 ms), so at 6× this scene is not draw-limited on this Mac.

### Low tier

Low uses the same scene with no SSR/bloom, shorter shadows, 1024² tiles, 0.75 pixel ratio and no tree/furniture/tram/
grid casters.

| View | Draws before | Draws after | Triangles before | after | Renderer CPU before | after | Frame total before | after |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Rynek street | 1,085 (1,081–1,090) | **985** (981–988) | 6.18 M | 6.18 M | 7.9 (7.8–8.1) | **7.0** (6.9–7.1) | 9.2 | **8.3** |
| Centrum drone | 1,863 (1,860–1,866) | **1,749** (1,736–1,761) | 8.05 M | 8.22 M | 12.5 | **11.5** | 13.8 | **12.7** |

Draws fall 9.3% / 6.1%, renderer CPU 11% / 8%. Round 1 still built the stand-ins and only switched them off in low
(their `castShadow` off; scene casters 4,099 → 3,215); Round 2 skips the bake entirely. GPU memory is unchanged at
**223.1 MB**, attributes 93.7 → 93.6 MB.

### Boot, memory and structure

| Metric | Before | After |
|---|---:|---:|
| Boot to first frame, high | 11.04 / 11.08 s | 11.37 / 11.45 s (+0.35 s) |
| Boot to first frame, low | 11.20 / 11.66 s | 11.29 / 11.86 s (noise) |
| Culling/baking phase | 212–221 ms | 385–394 ms (+0.17 s) |
| Scene meshes | 41,065 | 37,826 |
| Unique geometries | 37,865 | 35,503 |
| Shadow casters, high | 36,754 | 34,684 |
| Shadow casters, low | 4,099 | 3,215 |
| GPU memory, high | 384.4 MB | 390.3 MB (+5.9 MB) |
| GPU memory, low | 223.1 MB | 223.1 MB |
| Shader programs, high | 290 | 287 |
| Retained JS heap after GC | 907.4 MB | 938.8 MB (+31 MB) |
| Boot heap peak | 1,040 MB | 1,077 MB |

The prop stand-ins hold 1.42 M baked triangles (468 cells). Each triangle is three `Float32` positions, so a player
who tours the whole city can upload at most about **51 MB** of stand-in geometry; after the eight-view run
(`rynek`, `centrumDrone`, `wide`, `malta`, `jezyce`, `wilda`, `kaponiera`, `rynekDrone`) the renderer had uploaded
only 5.9 MB more than baseline, because the cascades touch a small part of the cell set at each stop. The low tier
never uploads them.

Roof family contribution (all passes, hide `Roof-*`): Rynek 137 → 100 draws, Centrum drone 171 → 125. The merged roof
chunks draw 268k triangles at Rynek against 361k before; the merge lets one chunk cover all three kinds and cull less
per kind.

## Pixel diffs

Two independent boots per arm, `sim=0`, same camera and preset; `mean` is the mean absolute difference over RGB
(0–255). The baseline-vs-baseline column is the same comparison between two baseline boots.

| View | Max | Mean | Diff pixels | Baseline-vs-baseline max / mean / pixels |
|---|---:|---:|---:|---|
| Golden, Rynek street | 241 | 0.58 | 65,823 (7.1%) | 241 / 1.30 / 143,117 (15.5%) |
| Golden, Jeżyce roofs (34 m drone) | 57 | 0.010 | 22,175 (2.4%) | 143 / 0.14 / 121,583 (13.2%) |
| Golden, Centrum drone | 193 | 0.047 | 16,631 (1.8%) | 233 / 0.16 / 49,974 (5.4%) |
| Midnight, Rynek street | 237 | 0.50 | 93,852 (10.2%) | 237 / 0.60 / 199,465 (21.6%) |
| Midnight, Jeżyce roofs | 52 | 0.018 | 30,359 (3.3%) | 51 / 0.051 / 51,978 (5.6%) |
| Low tier, Rynek street | 84 | 0.0051 | 2,544 (0.28%) | not sampled (low has no SSR) |
| Low tier, Centrum drone | 85 | 0.0083 | 2,748 (0.30%) | not sampled |
| WebGL2, Rynek street | 231 | 0.61 | 115,646 (12.5%) | 216 / 0.46 / 101,231 (11.0%) |
| WebGL2, Centrum drone | 123 | 0.11 | 52,219 (5.7%) | 172 / 0.083 / 41,752 (4.5%) |

All residual differences are at or below the run-to-run noise of two baseline boots except the WebGL pair, which is
the same leaf-card alpha-edge sparkle pattern as the baseline-vs-baseline diff (tree leaves are not part of this
change) and a slightly higher mean from MSAA/ANGLE nondeterminism. Diff images show no object-level change: the same
roof kinds, dormers, gable screens, street furniture and shadows. No coplanar/draw-order artefacts were found. The
midnight and WebGL runs also confirm the merged `roofKind` shader on both backends.

## Low tier check

`?quality=low` boots cleanly with no console warnings. In Round 1 the stand-ins reported `propShadowProxy` with
`castShadow = 0` in low (`sceneCounts.propProxies = 468, propProxyCasters = 0`); in Round 2 low reports
`propProxies = 0` because it never builds them. The original tree/furniture/tram/grid casters remain off, and the
building/landmark stand-ins still cast. The low screenshots differ from baseline by 0.005–0.008 mean absolute RGB
(0.3% of pixels, isolated leaf edges), i.e. the same rendering.

## Rejected variants

- **`BatchedMesh`.** The pinned three.js commit (`0a980dc`) has no `isBatchedMesh`/multi-draw path in the WebGPU
  renderer; only the WebGL2 backend implements `WEBGL_multi_draw`. It is not a usable primary-backend batching tool.
- **Baking every street-furniture category per material per chunk.** Hydrants alone are 1.37 M triangles and the lamp
  masts 6.3 M; baking those into world-space geometry would add roughly 100–250 MB of vertex data for a few dozen
  scene draws. Rejected in favour of the merged *shadow* stand-ins, where depth-only positions are enough.
- **2 km cells for every low-poly mesh, including roofs and dormers.** Roof pieces are 3–14 triangles too, and this
  variant looked attractive by triangle count alone, but an early measurement with 2 km roof cells raised Rynek from
  7.73 M to 8.48 M triangles (+9.5%) and made shadow chunks coarser. Only cheap props get the wider cells.
- **One instanced shadow proxy per geometry signature per cell (first implementation).** It created 468 stand-ins but
  raised draws (Rynek 1,455 → 1,492, drone 2,723 → 2,889): each geometry signature and cell was still a separate draw.
  Replaced by merged position-only cells per face side.
- **Keeping baked cell positions in JS number arrays.** Correct, but the boot heap peak rose to ~1,370 MB. Two-pass
  typed arrays bring it to 1,077 MB with the same output.
- **Proxying hydrants and other heavy casters.** 1.37 M triangles (~49 MB) for about 10 shadow draws at Rynek; left as
  direct casters instead.
- **Disabling small-prop `castShadow` without stand-ins** would have changed the high-tier shadows; not acceptable.
- **Global coarse chunks** were already rejected by the audit (+42% triangles); the per-category cell scale is the
  version that survives the triangle check.

## Checks actually run

- `node --test tests/` — 518 pass, 0 fail (needs Node 22+; ~2 min on this shared machine).
- Browser boots: WebGPU high and low, WebGL2 fallback, golden and midnight; no `error`/`warning`/`pageerror` console
  entries, no `[compile]` warnings.
- Frozen-view pixel diffs before/after plus baseline-vs-baseline noise, at Rynek street, Jeżyce roofs (34 m), Centrum
  drone, midnight and low tier, on WebGPU and WebGL2.
- Low-tier caster counts and screenshot.

Not measured: a real phone, a real integrated-GPU laptop, or sustained thermal load. The 6× throttle is a synthetic
CPU slowdown on the same Apple GPU; GPU timestamps were not used for the comparisons because the summed three.js
query values vary more than the effect.

## Reproduction

```sh
python3 -m http.server 8112        # worktree root (a threaded server avoids module-load resets under load)
python3 -m http.server 8113        # git archive of bb9a835 in /tmp/slop-poznan-base
node .agent-task/perf-harness/run-perf2.mjs '{"query":"quality=high","steps":[{"view":"rynek","seconds":4},{"view":"centrumDrone","seconds":4}]}'
PERF_PORT=8113 node .agent-task/perf-harness/run-perf2.mjs '{"query":"quality=high","steps":[{"view":"rynek","seconds":4},{"view":"centrumDrone","seconds":4}]}'
```

`run-perf2.mjs` also takes `cpu`, `cpuAfterBoot`, `gc`, `sceneCounts`, `materialsVisible`, `hideRoofs`, `propShadows`,
`hideProxies` and per-step `screenshot`. The baseline copy must keep the same `perf-main.js` with its imports pointing
at its own `js/` (the harness uses `../../js/`).
