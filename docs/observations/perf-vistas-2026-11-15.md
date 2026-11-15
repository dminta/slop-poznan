# High-altitude vista draw calls (2026-11-15)

The Winogrady vista (wp5, `(-240, 40, -3200)` → `(-47, 25, -2560)`) was the highest scene-draw view of the 2026-11-14
transition sweep ([record](perf-transitions-2026-11-14.md) §5.3). This pass broke its draws down by object and
material, then regrouped the distant static geometry. Scene draws at wp5 fall **−34 % on High and −44 % on Low**, on
WebGPU and WebGL2. Merge on vs off renders **bit-identical pixels** in the checked views, and programs are unchanged.

## Method

- Chrome 157 headless, `--use-angle=metal`, WebGPU and `?backend=webgl`, 1280 × 720, DPR 1, HTTP cache disabled,
  `?quality=high|low`, default Złota godzina preset, Apple M5 Pro. Baseline = `git archive` of `82181df` on one port,
  candidate = this tree on another; three boots per backend × tier, 60 settle frames and 30 measured frames per view,
  medians of the three boots. A scratch harness (generated copy of `main.js`, not in the repo) pins the camera, wraps
  `renderer.render` / `renderPipeline.render` to split each frame into shadow passes, the scene pass and post quads
  (scene = the scene call minus the nested shadow draws), and times `renderPipeline.render()` for renderer CPU.
- Views: Rynek street level `(22,7,58) → (0,10,0)`, Centrum drone `(-1150,320,900) → (-1100,0,0)` 55°, wp5.
- Traffic and pedestrians keep running, so counts move by a few draws between boots. Renderer CPU shares the machine
  with the other boots and is only indicative. Shadow draws are means over the 30 frames (far cascade every 2nd frame).
- Absolute wp5 numbers are lower than the 2026-11-14 table (2,039 vs 2,314 scene draws on WebGPU High): that sweep ran on an
  older tree; this pass measured both sides on `82181df`.

## Where the wp5 scene draws go (baseline, WebGPU)

A `renderer.renderObject` hook attributes every draw of the scene pass to its root group and material:

| Root | High draws | Notes |
|---|---:|---|
| StreetDetails instanced | 747 | 565 tree cells (542 whole-crown LOD 2 meshes, 200 m cells), the rest 1 km static chunks |
| Landmarks | 455 | 395 are steel/gold meshes of ≈ 13 triangles each (5 k triangles in all), 3–4 km away |
| CityBlocks instanced | 448 | facade boxes and roof pieces, 1 km chunks; 249 of them 4–8 km away |
| Bridges | 138 | |
| Outskirts | 98 | |
| TramInfrastructure | 79 | |
| everything else | ~90 | |

Low has no tree draws to speak of (100: shared far geometry) but the same Landmarks / CityBlocks / StreetDetails far
chunks: 455 + 448 + 282 + 138 + 98 + 79 of 1,603.

The common cause is **chunk accumulation in the far field**: the large static families (`largeMeshes` in
`scene-culling.js`) are cut into 1 km cells, frustum-culled only. Over a 3–8 km panorama ~35 of those cells per family
are in the frustum for ~25 families (CityBlocks facade/roof pieces, StreetDetails, TramInfrastructure rails and arms),
roughly 600 draws that cover a few pixels each. Landmarks add ~400 more because the steel and gold meshes were excluded
from the landmark batch.

## Change

1. **Far-block merge** (`js/scene-culling.js`). Each large static family also gets coarse 4 km copies of its instances
   (same material, geometry and per-instance attributes). For every 4 km block, the 1 km chunks stand down for the coarse
   copy while (a) the camera is ≥ 1,500 m from the block's world bounds, (b) at least two of its 1 km chunks are in the
   view frustum and (c) the coarse copy submits at most 2× the triangles of the in-view fine chunks. The rule is checked
   every frame from `updateSceneCulling(position, camera)`; it is a pure regrouping, so it cannot pop. The first
   attempt without (b) and (c) cut draws as much but raised submitted triangles 8–10 % at Rynek and Centrum
   (coarse blocks seen edge-on at the horizon); with them Rynek / Centrum triangles stay within ±0.6 %. 155 blocks are
   built per tier.
2. **Per-landmark steel/gold batching** (`js/landmarks.js`, `batchStaticGroupMeshes(..., splitShadowFlags)`). The
   excluded materials are merged per landmark group instead of staying ~400 individual meshes, culled with their landmark.
   Shadow flags are kept apart so no mesh changes whether it casts or receives. Shadow draws drop too.

Not done on the way: tree-cell merging (counting the baseline's draw list, LOD 2 cells of 400–600 m would leave 213–109 of
542 high-tier tree draws, but the low tier has no tree draws to save and each level change would repack a 4–9× larger
cell; not needed once the above reached the target, so unmeasured), and merging the steel/gold meshes across the whole
city (an always-visible mesh would add draws in every pass at street level).

## Results (medians of 3 boots, 30 frames each)

| Config | Scene draws | Shadow draws | Total draws | Triangles M | Renderer CPU ms |
|---|---|---|---|---|---|
| WebGPU high Rynek | 784 → 756 (-3.6%) | 394 → 352 | 1198 → 1128 (-5.8%) | 6.25 → 6.26 (+0.2%) | 8.1 → 7.6 |
| WebGPU high Centrum drone | 1225 → 1215 (-0.8%) | 683 → 501 | 1927 → 1735 (-10.0%) | 7.34 → 7.31 (-0.4%) | 13.3 → 11.9 |
| WebGPU high **wp5 Winogrady** | 2039 → 1339 (-34.3%) | 100 → 100 | 2158 → 1458 (-32.4%) | 8.12 → 8.30 (+2.2%) | 12.4 → 10.0 |
| WebGPU low Rynek | 678 → 649 (-4.3%) | 212 → 170 | 890 → 818 (-8.0%) | 5.26 → 5.27 (+0.3%) | 6.4 → 6.0 |
| WebGPU low Centrum drone | 743 → 738 (-0.7%) | 238 → 126 | 981 → 864 (-11.9%) | 5.05 → 5.05 (+0.0%) | 7.2 → 6.8 |
| WebGPU low **wp5 Winogrady** | 1584 → 884 (-44.2%) | 32 → 32 | 1617 → 917 (-43.3%) | 7.18 → 7.37 (+2.6%) | 8.3 → 6.6 |
| WebGL2 high Rynek | 783 → 753 (-3.8%) | 393 → 348 | 1195 → 1120 (-6.3%) | 6.23 → 6.26 (+0.6%) | 9.2 → 9.1 |
| WebGL2 high Centrum drone | 1220 → 1215 (-0.4%) | 677 → 502 | 1916 → 1736 (-9.4%) | 7.31 → 7.30 (-0.2%) | 15.1 → 14.2 |
| WebGL2 high **wp5 Winogrady** | 2043 → 1343 (-34.3%) | 106 → 106 | 2168 → 1468 (-32.3%) | 8.12 → 8.31 (+2.3%) | 21.4 → 12.1 |
| WebGL2 low Rynek | 675 → 648 (-4.0%) | 211 → 173 | 888 → 822 (-7.4%) | 5.26 → 5.27 (+0.2%) | 7.0 → 6.8 |
| WebGL2 low Centrum drone | 745 → 733 (-1.6%) | 240 → 124 | 986 → 858 (-13.0%) | 5.05 → 5.04 (-0.2%) | 8.3 → 7.3 |
| WebGL2 low **wp5 Winogrady** | 1584 → 884 (-44.2%) | 32 → 32 | 1617 → 917 (-43.3%) | 7.18 → 7.36 (+2.6%) | 9.9 → 7.4 |

Programs are unchanged (230 high / 212 low). No new console warnings or errors in any measured boot; one of the twelve candidate boots (WebGPU low, second run) logged a
single `net::ERR_CONNECTION_RESET` for `perf-stats.js` from the single-threaded `python3 -m http.server` under 30 module
requests, not from the page. Triangles at wp5 rise ~2.2–2.6 % (coarse blocks partly outside the view), fewer draws and
the same pipelines; the Rynek and Centrum triangle deltas are within traffic noise. The renderer CPU improves at wp5
(High WebGPU 12.4 → 10.0 ms, WebGL2 21.4 → 12.1 ms, Low 8.3 → 6.6 and 9.9 → 7.4 ms) and slightly elsewhere; GPU time was
not measured and is not claimed.

Street-level views gain a little (Rynek −3.6…−4.3 % scene, −6…−8 % total; Centrum drone −10…−13 % total). The shadow
passes lose draws (Rynek 394 → 352, Centrum 683 → 502 on WebGPU High), which only the landmark merge can explain: the far
merge touches the scene pass alone.

## Pixel checks

- **Same page, merge on vs forced off, time frozen** (the scratch page pauses the loop, hides the actors, stubs
  `performance.now` to a constant and renders each pose twice): Rynek, Centrum and wp5 on WebGPU High and WebGL2 Low
  are **bit-identical** (0 differing pixels). At wp5, 44 of 155 blocks are merged; at Rynek 3; at Centrum none.
- **Flight, wp5 → Rynek** (11 poses, 60 m arc, WebGPU High): 44 → 44 → 44 → 44 → 44 → 33 → 10 → 8 → 0 → 0 → 3 merged
  blocks; merge on vs off is bit-identical at ten poses and differs by one pixel (±1 of 255) at the fifth. There is no visual
  switch to pop; the transitions are only a draw-count change.
- **Before vs after builds** (rynek / wp5, WebGPU High): the static city, landmarks (Ratusz) and roofs are pixel-identical;
  the only differences are the animated cloud layer, wind-swayed trees and the minimap canvas, which depend on elapsed time
  and the moving actors of each separate page (`shots/diff-rynek.png`, `shots/diff-wp5.png`; red = differs).
- Screenshots: `.agent-task/shots/before/` and `after/` (three views), `flight/` (the eleven poses, off and auto).

## Costs

- Retained JS heap after GC (single boot each): 551.4 → 547.0 MiB high, 527.9 → 523.5 MiB low; the second copy of the far
  instance buffers did not show up as growth (one sample each, within the run-to-run spread; the merged landmark meshes
free their per-mesh geometries, which is a possible but unseparated offset). Culling phase (single boot): 608 → 640 ms
  high, 341 → 457 ms low.
- Independent verification (2 alternating boots each, WebGPU high, loaded machine): the duplicated instance data is
  16.0 MB (232,702 instances), the upper bound on GPU growth once every block has drawn; retained heap after GC
  923.9 → 934.9 MB at boot and 940 → 949 MB after visiting Rynek, wp5 and Centrum (+9–11 MB); GPU memory 333.4 → 338.1 MB
  at boot and 356.4 → 363.5 MB after the views; `[init]` culling phase 695/685 → 851/831 ms high and 486 → 575 ms low,
  wall-clock boot unchanged. The single-sample heap figures above understate the cost.
- A coarse block uploads its instance buffer the first time it draws: expect one small upload per block when a flight first
  reaches 1.5 km range, not a recurring cost.

## Not done

- Tree LOD 2 cell merging (542 draws at wp5 High, 100 Low): not needed to meet the target; repack cost while flying should be
  measured before trying it.
- Bridges (138 draws, 3–4 km away) and Outskirts (98 chunks): small pieces, same far-chunk pattern.
