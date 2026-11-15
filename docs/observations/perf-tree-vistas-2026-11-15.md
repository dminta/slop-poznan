# High-tier tree LOD 2 draws at vistas (2026-11-15)

Step 7 of the older-device perf list left the whole-crown LOD 2 tree meshes (542 draws in 200 m cells at the Winogrady
vista wp5) as the biggest remaining scene-draw family after the [far-block merge](perf-vistas-2026-11-15.md). LOD 2 now
lives in 400 m far cells with per-instance moves instead of cell repacks. Tree scene draws at wp5 fall 616 → 264, scene
draws −23 % (High) and −7 % (Low); WebGPU High renders are bit-identical to the base in all 14 frozen views.

## Method

Same as the previous record: Chrome 157 headless, `--use-angle=metal`, 1280 × 720, DPR 1, cache disabled, Złota godzina,
Apple M5 Pro, baseline = `git archive` of `9c781f4` on one port, candidate = this tree on another, three boots per
backend × tier, medians of the boots. The harness is a scratch patched static server plus a CDP driver (not in the repo):
it patches `main.js` (loop wrapper, fixed camera pin, optional fixed elapsed), wraps `renderer.render` /
`renderer.renderObject` to attribute draws and instances by pass (scene = perspective camera, shadow = orthographic)
and by tree LOD (mesh name suffix), times `renderPipeline.render()`, and wraps `update()` / `rebuild()` in `trees.js` to
time level changes per frame. Views: wp5, Centrum drone `(-1150,320,900)→(-1100,0,0)`, Rynek `(22,7,58)→(0,10,0)`
(fov 55, 60 settle + 30 measured frames), plus a 660-frame flight wp5 → Rynek through 11 interpolated poses (~5 m per frame,
a level update on 659 of 660 frames: worst case, the helicopter at 52 m/s updates every ~5th frame). The first
baseline/candidate batches ran at different machine loads (renderer CPU differed by 30–40 %); the numbers below are from
a second baseline batch run right after the candidate batch, which is why only these are quoted.

## Baseline (before the change)

At wp5 on WebGPU High the scene pass draws 1,491 meshes (`CityBlocks` 269, `StreetDetails` 745, of which 616 tree
meshes: 23 LOD 1 and 593 LOD 2). The Centrum drone is worse: 612 of 620 tree draws are LOD 2, so the same family is its
biggest too. A LOD 2 crown is only 102–138 triangles; the 593 draws submit 14.2 k instances, 1.58 M triangles. The
tree field has 118,067 trees in 1,944 cells, 6,545 LOD 2 meshes. Level changes repack the whole 200 m cell of every changed
tree: per flight frame mean 0.45 ms / p95 0.7 ms / max 0.9 ms in `rebuild()` (whole `update()`: 0.8 / 1.1 / 1.3 ms on WebGPU High).

## Change (`js/trees.js`)

- Level 2 moved out of the 200 m cells into **400 m far cells** (`TREE_FAR_CELL_SIZE`): one mesh per species and cell, so
  the instance capacity just moves from the fine to the far meshes (no memory growth; the same 118 k instance slots).
- A tree that enters or leaves level 2 is added to or swap-removed from its far mesh (`createSlotLists`, O(1)); the 200 m
  cell is repacked only for trees that enter or leave levels 0/1. The far mesh keeps a **static bounding sphere** around
  every tree that can sit in it (computed once at boot with `InstancedMesh.computeBoundingSphere`), so nothing is
  recomputed per level change.
- Every flush re-sends the far mesh's whole list. The first version sent only the touched slots; three.js uploads an
  attribute only when its mesh draws, so a culled far mesh lost its earlier ranges and trees went missing in the first
  frozen-pixel check (a patch of park trees at Centrum). With whole-list uploads (≤ ~250 instances per mesh) the check is clean.
- Shadows: the far meshes still cast, exactly like the fine ones; tree shadow draws fall (212 → 202 Rynek, 483 → 307
  Centrum, 84 → 65 wp5), but a far mesh's larger sphere lets more of its instances into the shadow passes (see costs).
- No change to the LOD distances, hysteresis, materials, tier profiles or the low tier's shared LOD 2 geometry.

### Cell size (single WebGPU High boot, wp5 / Centrum)

| Far cell | wp5 scene draws | wp5 tree draws | Centrum scene draws | Scene tris wp5 | Shadow tris Centrum |
|---|---|---|---|---|---|
| 200 m (base) | 1491 | 616 | 1390 | 7.90 M | 3.40 M |
| 300 m | 1247 | 372 | 1141 | 7.94 | 3.53 |
| **400 m** | 1139 | 264 | 1018 | 7.94 | 3.60 |
| 600 m | 1025 | 150 | 915 | 8.01 | 4.07 |
| 800 m | 981 | 106 | 876 | 8.11 | 4.47 |
| 1200 m | 946 | 71 | 825 | 8.20 | 5.30 |

Larger cells keep cutting draws, but submitted shadow triangles grow fast (a 1.2 km sphere lets most of the cell into the
shadow frustum). 400 m keeps scene triangles within +1.4 % and shadow triangles within +7.5 % at every measured view;
600 m would be the next step if draws matter more than shadow vertex work.

## Results (medians of 3 boots, 30 frames per view)

| Config | Scene draws | Tree scene draws | Shadow draws | Tree shadow draws | Scene tris M | Shadow tris M | Renderer CPU ms |
|---|---|---|---|---|---|---|---|
| WebGPU high rynek | 787 → 729 (-7.4%) | 154 → 96 | 575 → 565 | 212 → 202 | 5.48 → 5.50 (0.3%) | 2.73 → 2.84 (4.0%) | 8.2 → 7.5 |
| WebGPU high centrum | 1387 → 1019 (-26.5%) | 620 → 253 | 1101 → 923 | 483 → 307 | 6.69 → 6.77 (1.1%) | 3.37 → 3.59 (6.5%) | 13.9 → 10.2 |
| WebGPU high wp5 | 1491 → 1143 (-23.3%) | 616 → 264 | 219 → 208 | 84 → 65 | 7.90 → 7.94 (0.6%) | 1.14 → 1.21 (6.3%) | 10.8 → 8.5 |
| WebGPU low rynek | 669 → 657 (-1.8%) | 35 → 25 | 242 → 244 | 0 → 0 | 5.31 → 5.33 (0.4%) | 0.86 → 0.86 (-0.1%) | 6.2 → 6.1 |
| WebGPU low centrum | 875 → 805 (-8.0%) | 110 → 39 | 243 → 249 | 0 → 0 | 5.52 → 5.59 (1.2%) | 0.58 → 0.60 (2.3%) | 7.2 → 6.7 |
| WebGPU low wp5 | 985 → 919 (-6.7%) | 110 → 40 | 72 → 72 | 0 → 0 | 7.44 → 7.48 (0.5%) | 0.23 → 0.23 (0.0%) | 7.5 → 6.5 |
| WebGL2 high rynek | 786 → 730 (-7.1%) | 154 → 96 | 573 → 567 | 212 → 202 | 5.48 → 5.50 (0.3%) | 2.72 → 2.84 (4.2%) | 9.8 → 8.7 |
| WebGL2 high centrum | 1385 → 1023 (-26.1%) | 620 → 253 | 1099 → 931 | 483 → 307 | 6.68 → 6.77 (1.4%) | 3.35 → 3.60 (7.5%) | 16.7 → 11.4 |
| WebGL2 high wp5 | 1491 → 1139 (-23.6%) | 616 → 264 | 219 → 200 | 84 → 65 | 7.90 → 7.94 (0.6%) | 1.14 → 1.21 (6.6%) | 13.1 → 9.8 |
| WebGL2 low rynek | 670 → 655 (-2.2%) | 35 → 25 | 244 → 242 | 0 → 0 | 5.31 → 5.33 (0.3%) | 0.86 → 0.86 (-0.2%) | 6.9 → 7.0 |
| WebGL2 low centrum | 875 → 808 (-7.7%) | 110 → 39 | 241 → 245 | 0 → 0 | 5.52 → 5.59 (1.2%) | 0.58 → 0.59 (1.7%) | 8.0 → 7.6 |
| WebGL2 low wp5 | 985 → 919 (-6.7%) | 110 → 40 | 72 → 72 | 0 → 0 | 7.45 → 7.48 (0.5%) | 0.23 → 0.23 (0.0%) | 7.9 → 7.6 |


Tree draws in the table are scene-pass tree meshes (all levels). Console: no warnings or errors in any of the 24 boots.

### Flight wp5 → Rynek (660 frames, per frame, medians of 3 boots)

| Config | `update()` mean / p95 / max ms | `rebuild()` mean / p95 / max ms | Renderer CPU p95 / max ms | Tree draws median |
|---|---|---|---|---|
| WebGPU High | 0.80 → 0.56 / 1.10 → 0.80 / 1.30 → 1.60 | 0.45 → 0.18 / 0.70 → 0.40 / 0.90 → 0.50 | 12.5 → 11.0 / 15.7 → 13.3 | 161 → 103 |
| WebGPU Low | 0.66 → 0.49 / 1.00 → 0.70 / 1.10 → 1.00 | 0.32 → 0.13 / 0.60 → 0.30 / 0.70 → 0.40 | 9.4 → 8.1 / 12.6 → 11.4 | 46 → 34 |
| WebGL2 High | 0.74 → 0.53 / 1.00 → 0.70 / 1.20 → 1.60 | 0.45 → 0.18 / 0.70 → 0.40 / 0.90 → 0.50 | 14.2 → 12.8 / 19.1 → 15.7 | 161 → 103 |
| WebGL2 Low | 0.58 → 0.46 / 0.80 → 0.60 / 1.10 → 1.00 | 0.31 → 0.13 / 0.50 → 0.30 / 0.80 → 0.40 | 9.8 → 9.2 / 12.5 → 10.9 | 46 → 34 |

There is no hitch: the per-frame repack cost falls (the far level no longer repacks a 200 m cell), and the worst frame of the
whole flight is not worse in renderer CPU. The `update()` max rises 1.3 → 1.6 ms on High (one frame, the swap-remove burst
where many trees cross a ring at once; `update()` is dominated by its per-tree distance loop, 118 k trees, ~0.5 ms).

## Costs

- Submitted triangles: scene +0.3–0.6 % at Rynek and wp5, +1.1–1.4 % at Centrum; shadow-pass tree work +4–7 % on High
  (more far instances reach the shadow frustum; shadow draws −1 % to −16 %). Low's shadow passes carry no trees.
- Retained JS heap after GC (median of 3 boots): 951.4 → 940.9 MiB High, 887.6 → 887.5 MiB Low (WebGPU); GPU memory
  365.4 → 365.6 MiB High, 258.4 → 258.5 MiB Low. Geometries 5,219 → 4,400 High, 3,552 → 3,387 Low (fewer LOD 2 meshes).
- `[init]` boot phases are within noise (streetDetails 1,524 → 1,476 ms, culling 484 → 481 ms on WebGPU High); the static
  far spheres add one pass over 118 k instances at boot.
- GPU time was not measured and is not claimed.

## Pixel checks

Frozen page: loop paused, actors hidden, `performance.now` / `Date.now` stubbed, the TSL node frame time set to a constant,
simulation elapsed fixed, HUD hidden; each pose rendered by stepping the loop 8 (views) or 3 (flight) times, screenshot via CDP.
Two renders of the same build are bit-identical (0 differing pixels), so any difference is the change.

- WebGPU High: wp5, Centrum, Rynek and all 11 flight poses (wp5 → Rynek) are **bit-identical** to the base (0 differing pixels).
- WebGL2 Low: wp5 and eight of the other frames are identical; Centrum 16, flight-02 224, flight-03 19, flight-06 20,
  Rynek / flight-10 350 differing pixels, max 11/255 per channel: crowns that overlap at equal depth now draw in another
  instance order (swap-remove reorders a mesh). Not visible at 1:1.
- Screenshots: `.agent-task/shots/` (see its `INDEX.md`), not committed.

## Not done / left

- Tree level `update()` still loops all 118 k trees every 4 m of camera movement (~0.5 ms); a distance-banded or
  incremental sweep would be the next step if that matters on slow CPUs.
- Levels 0/1 still repack their 200 m cell per change; the same slot lists would work for them.
- Bridges (138 draws at wp5) and Outskirts chunks (98) remain, see [perf-vistas](perf-vistas-2026-11-15.md).
