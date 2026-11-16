# Bridge and outskirts draws at vistas (2026-11-16)

At the Winogrady vista wp5, bridge section batching reduces Bridges from **138 to 90 scene draws**, and a far merge
of borough-building cells reduces Outskirts from **97 to 41**. Materials, geometry shapes, LOD distances and tier
profiles are unchanged. No city-wide bridge batch is introduced.

## Diagnosis before editing

The first measurement ran on the untouched working tree. A scratch `renderer.renderObject` hook recorded every wp5
scene draw with its root, mesh name, material UUID, instancing and shadow flags. Bridges reproduced the historical
**138** exactly; Outskirts was **97**, rather than the earlier record's 98. These family counts were stable across
backends and tiers. The initial notes are `/tmp/cx-vista-bridges/diagnosis/NOTES.md`; final corrected per-draw records
are under `/tmp/cx-vista-bridges/verified/`.

- **Bridges:** 138 batches across 11 materials. Beam sets already instance unit boxes per straight section and material;
  shaped parts already merge per section and material. Curved bridges repeat those batches: Bolesława Krzywoustego
  alone submits 40 draws, Most Uniwersytecki 10, Mosty Berdychowskie 12. These are local batches below the automatic
  city-wide chunking thresholds; they never enter `largeMeshes` and have no far copies. The cause is repeated section
  batches, not uninstanced individual beams.
- **Outskirts:** 68 borough-building chunks, 26 panel-block chunks and three ground meshes. Borough buildings share
  one material and a unit box with `bInfo` / `bTint` instance attributes, but the builder splits them into 1.2 km cells
  before scene culling. Panel blocks use 3.6 km cells per finish. These pre-existing local chunks miss the automatic
  triangle/radius thresholds too, so the far merge never sees their common family.

## Change

`bridges.js` shares the beam box geometry and joins sections of the **same named bridge, material and shadow flags**.
Instanced batches copy their packed matrices unchanged; shaped parts concatenate the already world-space geometry
without another transform. Transparent parts stay separate. Each resulting batch remains bounded by one bridge.

`outskirts.js` now hands scene culling one borough-building family marked `userData.staticChunkSize = 1200`.
`scene-culling.js` bypasses the automatic size thresholds for this explicit static family, keeps its original fine
cells, and builds nested **4.8 km** copies. `addFarMerges` takes the coarse cell size explicitly for both membership
and instance grouping. The existing 1,500 m distance, two-in-view-chunks and ≤ 2× triangle-waste rules are unchanged.
Fine-cell traversal order is retained inside the source family. Panel blocks and all three ground meshes keep their
existing construction. Nothing new is allocated per frame.

## Rejected attempts and harness corrections

- A city-wide bridge batch would keep unrelated bridges visible together and add street-level work; not attempted.
  Registering each tiny bridge batch with the existing far merge would not join its repeated section/material draws.
- Increasing the borough fine-cell size would change near culling. Using 4 km coarse cells over the existing 1.2 km
  grid would split fine cells across coarse boundaries. Nested 4.8 km blocks avoid both problems.
- The first borough source kept generator order instead of fine-cell traversal order. Centrum showed 20 far-merge
  pixels differing by up to 2/255 on WebGPU High. Preserving fine traversal reduced that difference.
- The initial scratch hook counted recursive shadow/post draws twice in aggregate. Nested draw accounting was corrected
  before the cost runs; the Bridges/Outskirts family counts were unaffected.
- The first screenshot selector hid the canvas container along with the HUD. Visual inspection caught it; those
  images were discarded. Approximate street poses were also replaced with coordinates from `bridgeStructures()`.
- Intermediate WebGL2 Low base/candidate images had tree depth-tie differences from different initial camera histories.
  The final runs pin the camera before precompile and from the first animation frame. Capture arrays are cleared before
  retained-heap collection. Only the final consistent harness runs are used below.

## Method

Chrome headless, ANGLE Metal, WebGPU and `?backend=webgl`, `?quality=high|low`, 1280 × 720 viewport, DPR 1,
`Network.setCacheDisabled(true)`, golden hour. Low retains its prescribed 0.75 internal pixel ratio. Baseline is
`git archive poznan` at `d985b3f40eb624549740a564cd1b03acbb03032c`, served on **8210**, candidate on **8211**;
CDP **9410/9411**, separate profiles below `/tmp/cx-vista-bridges/`. No port 8000 was used.

Three fresh boots per backend × tier × side, 60 settling and 30 measured frames per view. Tables use medians of the
three per-boot means. Scene, shadow and post draws are attributed by the actual render scene/camera; nested draws are
subtracted from their enclosing callback. Renderer CPU surrounds the render-pipeline call and includes the scratch
hook's attribution overhead. Actors run during timing; shadow counts average the alternating cascade cadence.
GPU execution time is not measured. The full Node suite runs separately from these measurements.

| View | Eye → target (metres), fov 55° |
|---|---|
| wp5 | `(-240,40,-3200) → (-47,25,-2560)` |
| Centrum drone | `(-1150,320,900) → (-1100,0,0)` |
| Rynek | `(22,7,58) → (0,10,0)` |
| Most Teatralny | `(-1300,2.2,-196) → (-1270,2,-185)` |
| Most Świętego Rocha | `(730,2.2,733) → (820,2,780)` |
| Outskirts, east of detail box | `(4600,3,2700) → (4900,5,2700)` |

For pixels, the loop is gated, actors and HUD hidden, elapsed / performance / Date / TSL time frozen. Each pose gets
8 frames before the automatic screenshot and 4 frames with far merges forced off. Centrum also gets a screenshot
with only the new borough merge disabled, and one with borough geometry hidden, to isolate differing pixels.

## Regression coverage

`tests/bridge-batching.test.cjs` verifies matrix preservation, bridge/material/geometry separation, shadow flags,
transparent exclusions and shaped-part concatenation. The existing parapet audit records emitted members before
batching; its construction recording remains independent of the packed-buffer copy.

`tests/scene-culling.test.cjs` exercises the real setup, fine split, coarse registration, both instance attributes and
near → far → near visibility exclusivity on a family below the automatic thresholds, plus negative 1.2/4.8 km grid
boundaries. The new integration regression fails on the archived baseline (`1 !== 4` meshes) and passes here.

## Results (medians of three boots)

| Config / view | Scene draws | Shadow draws | Total draws | Triangles M | Renderer CPU ms |
|---|---:|---:|---:|---:|---:|
| webgpu high wp5 | 1022 → 918 | 102.0 → 102.0 | 1143.0 → 1039.0 | 8.320 → 8.325 | 6.96 → 6.51 |
| webgpu high centrum | 868 → 822 | 458.0 → 450.5 | 1345.0 → 1291.5 | 8.213 → 8.196 | 8.04 → 7.56 |
| webgpu high rynek | 692 → 637 | 351.0 → 351.0 | 1062.0 → 1007.0 | 6.999 → 7.014 | 6.89 → 6.66 |
| webgpu high teatralny | 1016 → 925 | 373.2 → 366.5 | 1407.7 → 1310.5 | 8.382 → 8.405 | 8.00 → 7.49 |
| webgpu high rocha | 605 → 537 | 319.5 → 314.0 | 943.5 → 870.0 | 6.163 → 6.176 | 6.59 → 6.12 |
| webgpu high outskirts | 72 → 70 | 72.0 → 72.0 | 163.0 → 161.0 | 2.563 → 2.560 | 3.33 → 3.12 |
| webgpu low wp5 | 818 → 714 | 32.0 → 32.0 | 851.0 → 747.0 | 7.251 → 7.256 | 5.85 → 5.58 |
| webgpu low centrum | 668 → 630 | 123.5 → 128.0 | 792.5 → 759.0 | 5.371 → 5.381 | 5.92 → 5.74 |
| webgpu low rynek | 628 → 575 | 169.0 → 166.0 | 798.0 → 742.0 | 5.557 → 5.574 | 5.89 → 5.63 |
| webgpu low teatralny | 945 → 862 | 124.5 → 131.0 | 1070.5 → 994.0 | 6.371 → 6.354 | 6.61 → 6.40 |
| webgpu low rocha | 538 → 474 | 107.0 → 104.0 | 646.0 → 579.0 | 4.445 → 4.395 | 5.29 → 5.15 |
| webgpu low outskirts | 72 → 70 | 28.5 → 28.5 | 101.5 → 99.5 | 2.079 → 2.076 | 2.85 → 2.88 |
| webgl high wp5 | 1022 → 918 | 102.0 → 102.0 | 1143.0 → 1039.0 | 8.320 → 8.325 | 8.07 → 7.84 |
| webgl high centrum | 867 → 817 | 456.5 → 446.0 | 1342.5 → 1282.0 | 8.220 → 8.192 | 9.23 → 9.13 |
| webgl high rynek | 693 → 632 | 352.5 → 343.5 | 1064.5 → 994.5 | 6.994 → 6.989 | 7.91 → 7.66 |
| webgl high teatralny | 1009 → 924 | 364.5 → 366.5 | 1392.2 → 1309.5 | 8.392 → 8.398 | 9.10 → 9.03 |
| webgl high rocha | 601 → 537 | 313.5 → 312.5 | 933.5 → 867.5 | 6.150 → 6.157 | 6.80 → 6.57 |
| webgl high outskirts | 72 → 70 | 72.0 → 72.0 | 163.0 → 161.0 | 2.563 → 2.560 | 3.16 → 3.10 |
| webgl low wp5 | 818 → 714 | 32.0 → 32.0 | 851.0 → 747.0 | 7.251 → 7.256 | 6.67 → 5.60 |
| webgl low centrum | 670 → 625 | 125.0 → 123.5 | 796.0 → 749.5 | 5.374 → 5.365 | 6.81 → 5.97 |
| webgl low rynek | 627 → 573 | 167.5 → 169.0 | 795.5 → 743.0 | 5.555 → 5.554 | 6.28 → 5.97 |
| webgl low teatralny | 947 → 863 | 121.5 → 132.5 | 1069.5 → 996.5 | 6.376 → 6.367 | 7.98 → 7.43 |
| webgl low rocha | 539 → 473 | 108.5 → 102.5 | 648.5 → 576.5 | 4.448 → 4.452 | 6.04 → 5.47 |
| webgl low outskirts | 72 → 70 | 28.5 → 28.5 | 101.5 → 99.5 | 2.079 → 2.076 | 3.26 → 3.05 |

## Retained costs

| Config | Programs | Geometries | GPU MiB | Retained heap MiB |
|---|---:|---:|---:|---:|
| webgpu high | 238 → 238 | 3307 → 3192 | 363.9 → 365.4 | 946.0 → 948.4 |
| webgpu low | 220 → 220 | 2514 → 2399 | 250.6 → 252.2 | 894.6 → 897.5 |
| webgl high | 238 → 238 | 3307 → 3192 | 363.2 → 364.7 | 953.9 → 956.3 |
| webgl low | 220 → 220 | 2514 → 2399 | 262.8 → 264.3 | 902.1 → 905.0 |

At wp5 the scene pass saves **104 draws** on both backends: **−10.2% High / −12.7% Low**. Bridges are 138 → 90 and
Outskirts 97 → 41 in every configuration (borough buildings 68 → 12, panel blocks 26 and ground 3 unchanged).
The total triangle increase at wp5 is about **0.06–0.08%**. All measured street-level scene/total draw counts fall;
total triangles elsewhere remain within roughly 1.1% of the baseline, with moving actors and alternating shadow
passes contributing noise. The 0.03 ms WebGPU Low outskirts CPU increase is below the run-to-run spread; no GPU-time
claim is made.

The new borough copies have **18 blocks / 45,464 instances / 4,364,544 bytes (4.16 MiB)** of duplicated matrix and
instance attributes. That is the buffer upper bound if every copy is uploaded, before offsets from removed geometry
and per-object resources. Across the visited views GPU memory grows **1.5–1.6 MiB**, retained heap after GC
**2.4–2.9 MiB**, and reported geometries fall by **115**. Programs are unchanged. Heap is collected after clearing
scratch captures; memory figures describe these six visited views, not every possible upload across the city.

All 24 completed cost boots have clean captured warning/error/exception logs. Chrome is **157.0.8103.79**.
Raw results, including all 30 frames and every attributed draw, are
`/tmp/cx-vista-bridges/verified/{base,cand}-{high,low}-{webgpu,webgl}-{1,2,3}/result.json`;
root/material/name attribution is also collected in `/tmp/cx-vista-bridges/attribution-wp5.json`.

## Pixel checks

**wp5, Rynek, both bridge views and the outskirts view are bit-identical on WebGPU High and Low.** The bridge
batching is also identical at Centrum: turning off only the new borough far copies makes the candidate match the
baseline exactly. The existing distance/waste swap does not remove or simplify any instance.

The reproducible exception is **Centrum's borough horizon on WebGPU**: **7 pixels High / 22 Low**, each differing
by exactly **1/255 in a colour channel**. The same pixels differ in base/candidate and same-page merge on/off;
disabling only `OutskirtsBuildings` coarse copies removes every difference, as does hiding borough geometry on both
sides. Preserving fine traversal reduced the first attempt's 20 pixels / max 2 to 7 / max 1 on High. These are
regrouping-sensitive subpixel shading differences, consistent with depth/interpolation rounding; the positions,
matrices and both instance attributes are preserved. Every coordinate and before/after RGB value is recorded in
`/tmp/cx-vista-bridges/final-pixels.json`; there is no unaccounted larger change in these WebGPU comparisons.
High's coordinates are `(311,158), (641,162), (716,169), (1043,170), (710,173), (766,173), (809,174)`.

**WebGL2 merge on/off is bit-identical in every view and every completed boot, on both tiers.** Exact base/candidate
pairs also exist for all six views on both tiers. The following table identifies the equivalence-check corpus;
entries are differing pixels, base/candidate followed by same-page auto/off.

| Config | wp5 | Centrum | Rynek | Teatralny | Rocha | Outskirts |
|---|---:|---:|---:|---:|---:|---:|
| WebGPU High (`verified`, boot 1) | 0 / 0 | 7 / 7 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| WebGPU Low (`verified`, boot 1) | 0 / 0 | 22 / 22 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| WebGL2 High (`pixels`, startup time frozen) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| WebGL2 Low (`verified`, boot 1; also boot 2) | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

### Startup shading variation, kept separate from the merge result

Freezing time after boot does not normalize all captured startup state. Other WebGL2 boot pairs show small shading
changes around foliage, despite identical tree matrix/instance-attribute hashes and exact same-page merge on/off.
For example High boot 1 has 19 / 63 / 21 / 36 differing pixels at Centrum / Rynek / Teatralny / Rocha (max 3/255),
while boot 2 matches exactly in all six views. Freezing the clock before boot makes the supplemental High pair match
exactly too. The baseline itself then produces a different frozen RGBA image, which is also produced by the candidate:
this variation exists without changing code. Freezing the startup clock alone does not eliminate every Low boot
variant; its supplemental pair differs at 28 / 297 / 42 / 66 pixels (max 9/255), while its candidate image is exactly
identical to the earlier unmodified-baseline boots 1 and 2 in every required view. This is startup-dependent shading
state, not missing/changed geometry; its precise renderer mechanism was not isolated further.

All three cost-boot comparisons, including these variants and every differing pixel's RGB values, remain in
`/tmp/cx-vista-bridges/pixel-checks.json`. Supplemental startup-frozen comparisons are in
`/tmp/cx-vista-bridges/final-pixels.json`. The exact pairs above are identified explicitly rather than treating all
boot pairs as bit-identical. No material, LOD or renderer setting was changed to obtain them. The third-boot tree
buffer hashes and tree-hidden screenshots are retained in the raw results as diagnostic controls.

### Screenshot paths

- WebGPU High and Low: `/tmp/cx-vista-bridges/verified/{base,cand}-{high,low}-webgpu-1/`.
- WebGL2 High exact startup-frozen pair: `/tmp/cx-vista-bridges/pixels/{base,cand}-high-webgl/`.
- WebGL2 Low exact pairs: `/tmp/cx-vista-bridges/verified/{base,cand}-low-webgl-{1,2}/`.
- Each directory contains `wp5-auto.png`, `centrum-auto.png`, `rynek-auto.png`, `teatralny-auto.png`, `rocha-auto.png`,
  `outskirts-auto.png`, and their matching `-off.png` images. Centrum's `-borough-off.png` and `-borough-hidden.png`
  isolate the new family.
- WebGPU difference masks: `/tmp/cx-vista-bridges/high-webgpu-centrum-controlled-diff.png` and
  `/tmp/cx-vista-bridges/low-webgpu-centrum-controlled-diff.png` (red = differs).
- Remaining screenshots and all intermediate diagnostics stay under `/tmp/cx-vista-bridges/`; discarded black-canvas
  captures under `runs/` are not evidence. Scratch server, driver and summarizer: `/tmp/cx-vista-bridges/h/`.

## Validation

- `node --test tests/`: **673 passed, 0 failed** (final run 102.2 s), including the strengthened batching assertions.
- `git diff --check`: clean.
- No new JS module, preload, CSS, quality profile, LOD threshold or application global; browser hooks exist only in
  the scratch server's served copies. No commit was made.
