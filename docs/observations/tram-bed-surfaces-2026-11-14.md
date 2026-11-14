# Tram corridor surface clearance — 2026-11-14

The initial sections record the first, visual-only implementation. The coordinator follow-up below supersedes its
height-query, unchanged non-surface hash and test-pin conclusions; the final rebase section records validation
against current `poznan` (`15f9359`).

## Diagnosis and rule

At Pułaskiego / Grudzieniec, the four light-grey wedges are `UNDERPASS_SIDEWALKS`: four independently generated
2.8 m viaduct-side strips, each with a granite curb and inset sidewalk. They are not median/refuge slabs or plaza
paving. Their original builder emitted whole polygons without applying the block's `tramCut`. The southern
triangle is park block **402**, with park curb, paving, granite coping and lawn; the non-park block `tramCut`
selection explicitly skips `park >= 0.5`, and this park has no matching tram cut on its raised layers.

`railClearance` / `railCells` support prop and furniture clearance; `railRectClear` checks rectangular footprints;
`ZEBRA_RAIL_KEEP` cuts road paint. None previously clipped these two surface paths. The existing block selection also
misses corridors grazing an edge without a centreline boundary crossing. The fix adds one final clipping step to
`createExtrudedPolygonMesh`, shared by all city-grid ground-surface extrusion paths. It reuses `railCells`, selecting
only tram segments with positive filled-surface intersection, then uses the existing `cutSlab` subtraction.

**There is no physical tram bed width in `tram-infra.js`.** `layoutTrackRails` explicitly lays tram rails flush on
asphalt or raised paving, without a bed mesh. This report therefore uses the established **2.2875 m** half-width
(`0.7175 + 0.07 + 1.5`) of the existing tram slab cuts, rather than inventing a ballast width. As in those cuts,
each segment quad is extended by that half-width at both ends to close bends. Mainline railway beds are excluded.

The final cut starts with `ShapeUtils.triangulateShape`, in the renderer's x/−z frame and with the same contour/hole
winding. This matters for historical folded park outlines: ordinary ear clipping or repairing the outline could
change their fill away from a track. Only those existing filled triangles are subtracted; no new polygon area is
introduced. Unaffected extrusion calls take the original mesh path. Geometry pieces are merged and their temporary
buffers disposed. At this first stage, road-network rectangles, height-query rules, props and generated geodata
were not edited; the missing height rule is corrected in the coordinator follow-up below.

## Audit method and results

`tools/audit-tram-bed-surfaces.mjs` builds the actual blocks, supplies their footprint map and colliders to the actual
city grid, and records every requested extrusion plus the polygons/holes actually emitted after clipping. Rendering
is inert, but `ShapeUtils` uses the existing real Earcut fixture. Landmark colliders are omitted (they affect prop
placement, not these surface polygons); this audits city-grid surfaces, not tram stop platforms or bridge decks.
There are no rectangular block slabs in this geodata, so the extrusion records cover its block surfaces.

The overlap check independently implements convex polygon intersection against every candidate tram corridor and
checks the renderer's filled triangles, including holes. A positive intersection over **1e-6 m² per triangle** is an
overlap; shared edges are allowed. Counts are **surface pieces**, not track/surface pairs, so crossing both tracks
counts a piece once. The local check clips intersections to x **−1120…−960**, z **−875…−715** around the junction.
The `--before` replay bypasses only the new final cut and retains the earlier block/plaza cuts.

| Surface kind | Conflicting records before | Overlapping pieces after |
| --- | ---: | ---: |
| Curb | 694 | 0 |
| Sidewalk | 534 | 0 |
| Park/plaza curb | 71 | 0 |
| Park/plaza paving | 66 | 0 |
| Park coping | 33 | 0 |
| Park lawn | 34 | 0 |
| Partial-block lawn | 8 | 0 |
| Median hedge | 0 | 0 |
| **City-wide** | **1,440** | **0** |
| **Junction box** | **14** | **0** |

There are **28,474** logical surface requests before and after, and **28,474 → 53,404** emitted polygon pieces.
Exactly **1,440** output hashes change, all on inputs independently classified as touching a tram corridor;
**0** input hashes change and **0** non-touching output hashes change. The **27,034** unchanged records have the
aggregate SHA-256 `68ffbd91e0c47834c5cbb84feebde5b792fef28230420db448b071cc290bd533`
(over ordered `[inputHash, outputHash]` pairs). Per-record SHA-256 hashes, source kind, owner, actual intersection
coordinate and areas are in `.agent-task/before-audit.json` and `.agent-task/after-audit.json`; the latter contains
`diff`, and `.agent-task/audit-diff.log` has a readable comparison. Areas below use renderer triangles, not the signed
area of potentially folded outlines.

| Example | Intersection x, z (m) | Area before → after (m²) |
| --- | --- | ---: |
| Underpass curb | −1021.85, −811.02 | 39.26 → 16.59 |
| Its inset sidewalk | −1021.70, −811.15 | 31.10 → 12.61 |
| Underpass curb | −1037.08, −803.41 | 39.20 → 7.71 |
| Park 402 curb | −1036.93, −798.19 | 4,996.62 → 4,487.51 |
| Park 402 paving | −1036.91, −798.11 | 4,925.26 → 4,441.19 |
| Park 402 coping | −1052.00, −778.06 | 1,613.18 → 1,592.76 |
| Park 402 lawn | −1049.71, −779.86 | 1,420.34 → 1,408.49 |

One of the four underpass sidewalk tops lies wholly inside the union of the corridors and disappears; the other
three retain **12.61**, **5.76** and **3.88 m²**, respectively. The park retains **99.17%** of its lawn. These are
cuts at the track edge, not whole-block removals.

Rerun from the repository root:

```sh
node tools/audit-tram-bed-surfaces.mjs --before --json /tmp/tram-surfaces-before.json
node tools/audit-tram-bed-surfaces.mjs --compare /tmp/tram-surfaces-before.json --json /tmp/tram-surfaces-after.json
node --test tests/tram-bed-surfaces.test.cjs
node --test tests/
```

`--root /path/to/checkout` audits another checkout with the same harness. The original main checkout at `c363ade`
was also measured, rather than relying solely on a source replay: **every input/output record hash matches the
`--before` replay exactly**, including its 1,440/14 conflicts. See `.agent-task/main-audit.json`.

## Regression and test pins

The new regression requires the measured **1,440** baseline conflicts and **14** local conflicts, zero after both
locally and city-wide, identical input hashes, changes only on touched surfaces, and remaining junction lawn and
sidewalk area. No existing count pin changed. The shared Three.js stub gains only `BufferGeometry.dispose()` to
support disposal of temporary merged pieces. Existing inert-only rendering fixtures do not triangulate the new
surfaces; this new audit explicitly supplies real `ShapeUtils` for that coverage.

`node --test tests/` passes **616/616** in **175.43 s**, including the new regression.
The focused regression also passes independently after the final local-box audit metadata check (**13.27 s**). `git diff --check` is clean.

## Headless build timings

The same `.agent-task/perf/node-boot.mjs` harness loads each checkout in a fresh Node process with inert rendering
and real `ShapeUtils`. It builds blocks, the grid with footprint holes, street details, traffic/pedestrian routes,
tram/rail layouts, signal heads, road paint, tram infrastructure and trams. It omits renderer/GPU work and separate
landmark/airport/outskirts/bridge scene builders, so these are **headless builder** timings, not browser boot times.
The main checkout and worktree start from `c363ade`. Commands alternate main/worktree; no parallel build is launched.

```sh
node .agent-task/perf/node-boot.mjs --root /Users/dminta/Projects/slop-poznan --json /tmp/tram-main.json
node .agent-task/perf/node-boot.mjs --root . --json /tmp/tram-work.json
# Repeat the pair three times; --hashes optionally records the non-surface outputs after timing stops.
```

| Interleaved pair | Main build (ms) | Worktree build (ms) | Main grid (ms) | Worktree grid (ms) |
| --- | ---: | ---: | ---: | ---: |
| 1 (saved as 2) | 18,702.48 | 17,920.84 | 1,373.18 | 1,886.47 |
| 2 (saved as 3) | 16,590.22 | 17,013.45 | 1,225.12 | 1,892.30 |
| 3 (saved as 4) | 16,303.26 | 16,272.46 | 1,210.96 | 1,746.27 |
| **Median** | **16,590.22** | **17,013.45** | **1,225.12** | **1,886.47** |

The measured median increases are **423.23 ms / 2.55%** for the harness and **661.36 ms / 53.98%** for city-grid.
The new clipping work is visible in the grid phase; noisy total timings do not establish a precise causal boot
regression. These were run on a shared Apple M5 Pro Mac, without CPU throttling. Saved files are
`.agent-task/perf/isolated-{main,work}-{2,3,4}.json` (the filename is a run label, not a machine-isolation claim).
An earlier warm-up pair overlapped the preceding test/browser work and measured 44.36/29.63 s; it and the preliminary
more heavily contended series are retained but excluded from the three-pair medians above.

The last pair also records **24/24 identical non-surface hashes**: block records, footprints and colliders; grid
sidewalk/network inputs, prop colliders, trees, lamps and plaza rectangles; street furniture, trees and audio
signals; final road network, crossings and pedestrian links; tram/rail layouts, paint, infrastructure colliders,
stops/rail corridor and tram graph. Hashing happens after `totalMs` is captured. These complement the per-surface
record hashes: the geometry changes do not alter the shared placement or simulation data.

## Browser evidence and approval

The headless CDP capture script is `.agent-task/capture.mjs`. The Python static server uses **8160**. It intercepts
only the camera/time settings in the served main module and, for before captures, serves `city-grid.js` from the
unchanged main checkout. Repository camera and boot code are not modified. Chrome uses an isolated headless profile,
1440 × 1000 at DPR 1, high quality, midday, FOV 56. The player stays at spawn; the rendered camera is fixed before
culling each frame, so HUD location labels still show spawn. Actors and traffic lights are not time-frozen.

| View | Eye | Look | Paired WebGPU captures under `.agent-task/` |
| --- | --- | --- | --- |
| Reported overhead | −1040, 60, −760 | −1040, 0, −800 | `before-top-gpu.png`, `after-top-gpu.png` |
| Junction street level | −1055, 1.7, −790 | −1025, 0.2, −812 | `before-street-gpu.png`, `after-street-gpu.png` |
| Park block 239 | 485, 60, −1878 | 485, 0, −1928 | `before-winogrady-gpu.png`, `after-winogrady-gpu.png` |
| Block 1342 | 2552, 60, 2695 | 2552, 0, 2645 | `before-chartowo-gpu.png`, `after-chartowo-gpu.png` |

The two city-wide candidates came from the audit: park 239's curb originally overlapped near **483.43, −1927.80**,
and block 1342's curb near **2551.87, 2645.09**. Additional Jeżyce and Sybiraków paired views are retained.
The overhead eye/look matches the supplied `before-top.png`. Before/after images show the wedges and lawn ending
at the cleared track corridor while adjacent surfaces remain. WebGL2 fallback captures (`after-*-webgl.png`) also
show the junction and the additional Jeżyce/Sybiraków views. Both backend console logs contain **0 errors and
0 warnings**. Audio was not assessed. No frame-time claim is made.

The server and isolated Chrome are stopped after capture. No commit or merge is made. **User screenshot approval
is still required before the coordinator merges**, as requested by the task.


## Coordinator follow-up: logical ground and support placement

The coordinator correctly found that the first fix removed only meshes. The five reported coordinates still
resolved to park 402, underpass strips 200034/200036, park 239 and block 1342. A new regression was run before the
fix and failed at `−1036.93, −798.19` (park 402); it now requires `blockAt === null` at all five points (the before/after IDs are saved in `.agent-task/height-five-points.json`) and calls
the actual controller prototype's `getGroundHeight` for person, car and cyclist, requiring 0 m.

`city-config.js` now indexes every tram corridor in 32 m cells and rejects its exact extended quad at the start of
`blockAt`, before both ordinary-block and underpass lookup. This is equivalent to assigning those quads to every
intersected block, without duplicating a large segment list per park; a second overlapping block cannot restore
the removed surface. Rejection changes a point only inside the same 2.2875 m corridor used by the renderer.
It does not widen the logical cut for placement. The new `tramSurfaceClearance` measures distance to that cut's
edge; city-grid lamp bases retain 0.7 m (0.2 m radius + the existing 0.5 m clearance), and street lamp placement
includes that distance in its normal curb checks and relocation search.

The actual controller already leaves cars and cyclists at y = 0 and excludes park blocks from pedestrian sidewalk
height. Those cases did not all float before. Ordinary and underpass sidewalks did return 0.22 m for walking;
other `blockAt` consumers also saw the removed islands as valid supports. No controller behavior is changed:
correcting the shared query fixes those callers. The earlier `RAISED_GROUND` precedence is retained and does not
cover any of the five regression points.

### City-wide agreement audit

```sh
node tools/audit-tram-bed-surfaces.mjs --height --json /tmp/tram-surface-height.json
node --test tests/tram-surface-height.test.cjs
node --test tests/
```

The `--height` option independently generates samples from every `GEO.rail kind=tram` segment: longitudinal
spacing at most 1 m from 1 cm inside one extended end cap to 1 cm inside the other, at lateral offsets
`−half+0.01`, `−half/2`, `0`, `half/2`, `half−0.01`. At each point it calls the real `blockAt` and independently
checks every candidate emitted polygon/holes in a spatial index. **783,010 samples** produced **36,935 logical /
rendered mismatches before**, all invisible raised ground, and **0 after**, with **0 logical raised samples and
0 rendered raised samples**. Shared track runs can repeat a world point; these are query counts, not unique cells.
The analytic polygon/corridor audit also remains **0 overlaps city-wide**, and all **28,474** ground-surface
output hashes match the visual-only patch exactly. Together with `blockAt`'s unconditional
quad rejection, this covers the continuous cut rule as well as the numerical samples; it is not a claim that a
finite sample grid alone proves every world point.

The before fixture is the visual-only patch saved at `/private/tmp/tram-visual-only`; its unchanged config was
also saved in `.agent-task/visual-only-city-config.js`. Before and after audit artifacts are
`.agent-task/height-before-audit.json` and `.agent-task/height-final-audit.json`. A retained neighbour at
`−1070, −760` still returns park 402, with **1.3731 m** clearance from the cut edge.

### Non-surface hashes and measured placements

The same seeded headless builder records 24 categories. **13 change** compared with the visual-only patch:

- `grid.propColliders`, `grid.parkLampSites`: unsupported lamp bases are removed.
- `street.footprints`, `street.colliders`, `street.trees`, `street.audioSignals`: corrected island/support checks,
  lamp relocation and nearby pole/tree exclusions change placement.
- `network.final`, `crosswalks`, `pedestrian.links`, `paint`: corrected landings and footpath supports alter routes
  and their zebra paint; unchanged road lanes do not imply unchanged walking links.
- `tramLayout`, `tramInfra.colliders`, `tram.graph`: track-ground heights, pole placement, support-dependent shelter
  furniture and attached road-junction metadata change. The rail centreline geometry remains unchanged.

The **11 unchanged** categories are `blocks.colliders`, `blocks.footprintsByBlock`, `blocks.allBlocks`,
`grid.sidewalks`, `grid.footprints`, `grid.parkTreeSites`, `grid.pavedPlazaRects`, `grid.sidewalkBlocks`,
`railLayout`, `tramInfra.stops` (public passenger-stop records) and `tramInfra.railCorridor`.
The detailed hashes are `.agent-task/height-before-hashes.json` / `height-after-final-hashes.json`.

The optional `--records` capture added to the saved builder harness writes semantic placements. The comparison
script `.agent-task/compare-height-records.py` removes incidental tree collider references and compares exact
multisets, including attributes; its full output is `.agent-task/height-record-diff.json`:

| Headless builder records | Before → after | Removed / added exact records |
| --- | ---: | ---: |
| Grid tree sites | 61,519 → 61,519 | 0 / 0 |
| Grid lamps | 3,438 → 3,390 | 48 / 0 |
| Grid prop colliders | 63,107 → 63,059 | 48 / 0 |
| Street tree field | 119,264 → 119,264 | 68 / 68 |
| Street footprints | 35,547 → 35,342 | 260 / 55 |
| Street colliders | 95,583 → 95,378 | 326 / 121 |
| Road lane geometry | 12,992 → 12,992 | 0 / 0 |
| Crosswalk geometry | 3,935 → 3,936 | 9 / 10 |
| Materialised pedestrian segments | 497,376 → 497,064 | 836 / 524 |
| Tram rail pieces | 30,691 → 30,691 | 4 / 4 (ground height only) |
| Tram poles | 4,491 → 4,487 | 486 / 482 |
| Detailed tram-stop/furniture layout | 232 → 232 | 8 / 8 |
| Mainline rail pieces / masts | 13,612 / 1,650 unchanged | 0 / 0 |

Street tree changes comprise **66 removed and 66 added positions**, plus two same-position attribute changes.
For example the mapped tree at `−1361.5, −1152.2` stays at its surveyed point but changes tier 2 → 1 when the
opposite raised block disappears; a procedural site at `798.2886, −2525.8366` moves to `798.4084, −2527.8330`.
The mapped park tree at `−1523.3, −1230` is dropped: its centre remains on park 317, but its trunk corner
`−1523.04585, −1230.25415` is inside the cut and correctly returns null. The old corner-support check now rejects it.

Removed grid-lamp examples include `−932.6176, 1748.9466` (only **0.5795 m** from the new edge),
`−3522.2410, −915.5904` and `834.2900, −2708.6733`. Street footprints include a removed street footprint centred
at `−1275.6393, −577.3853`; a box at `887.6183, −2148.9075` relocates to `887.4963, −2148.6335`.
A crossing endpoint near `1050.2707, −190.2651` moves to `1050.3572, −189.7726` to reach valid ground.
Tram-pole examples include `4481.0757, −161.5330` → `4481.1046, −161.0339`. Four rail pieces near
`−1266…−1274, −544…−579` lower from 0.22 m to 0 m because the old underpass support was removed; their x/z,
lengths, IDs and all other rail-piece records are unchanged.

The shelter-only audit (a different reduced fixture) retains **224** shelters instead of 225, moves **41** instead
of 38, and drops **4** instead of 3. The added drop is **Rondo Śródka, 1506.0, −86.2**, where no supported roof
footprint remains; AWF, Gwarna and Sołacz remain the existing drops. Passenger stops remain available. Both
raised-ground and pole-overlap counts stay **0**. Full builder layout has eight detailed shelter/machine changes,
including Bonin `−1590.0903, −2402.2300` → `−1590.1382, −2402.2445`, Most Teatralny
`−1447.2539, −238.5529` → `−1450.5597, −240.4275` and Rondo Rataje
`1007.3462, 1379.1836` → `1007.5906, 1379.1307`.

### Changed pins and checks

Only measured data pins move; clearance assertions are retained. Fixtures differ deliberately (some omit building
or landmark walls), so their counts must not be combined with the full builder table above.

- Lamp fixture: main **2571 → 2559**, side **20622 → 20578**, gas **1074 → 1055**, park **2826 → 2782**,
  plaza **615 → 612**, total **27708 → 27586**. Every class still has **0** roadway/curb overlaps,
  **0** footprint overlaps and **0** poles below 0.5 m clearance. The audit's raw underpass/plaza fallback now also
  respects the cut, so it cannot certify an invisible raw polygon as support.
- Tree fixture: original species counts `[45749,49608,22017,1981]` → `[45762,49589,22023,1981]`;
  final assignment `[43874,47547,21103,6831]` → `[43887,47528,21109,6831]`. Site digest
  `e4e73919…` → `474fb97b…`, grid-prop digest `448f0391…` → `6e27b564…`, street-collider digest
  `8add17e4…` → `911857fc…`. Tree mesh combinations **25473/30363 → 25479/30369**;
  accepted OSM trees **32876 → 32875**, OSM park trees **25624 → 25623**, street trees **34468 → 34469**.
  One mapped root loses support; removal/relocation of lamps and traction poles changes nearby procedural rows,
  and one procedural gap filler is admitted.
- Signal placement fixture: non-signal footprint restoration **6867 → 6844**. Signal clearance and phase checks
  remain intact. The audit's historical B/C classification **76/93 → 75/94** reflects a previously usable support
  becoming invalid. Runtime heads restore all **190 A** approaches, with **0 B / 0 C** as before. Pedestrian heads
  **1937 → 1935**, new/reused runtime poles **111/60 → 112/59**, overhead heads/poles/reuse **94/40/54 → 95/42/53**,
  strict/band/exception **85/86/7 → 87/88/6**, span heads/poles/reuse **31/29/32 → 33/32/33**, new span heads
  **21 → 23**, strict/band spans **29/30 → 31/32**. Placement digest `2cea0c14…` → `2afb0e86…`;
  exception lists and all unchanged reach/rail/pole-clearance limits are still asserted.
- The source-sliced outline-index test supplies an infinite tram-cut distance to isolate its original edge-grid
  arithmetic; the new cut predicate is covered separately by the real city-wide height and clearance checks.

`node --test tests/` passes **618/618** in **133.88 s**. The focused height test, lamp clearance and outline-index
checks also pass independently. `git diff --check` is clean. No production traffic or tram driving rule is changed.

The changed walking network shifts the shared seeded simulation sequence. In the five-minute seed-1 Centrum run,
a **newly observed car–tram wait cycle** lasts **33 s** near Gwarna: `#49 car in box at (−842, 13)` and tram 8 near
`−866, −4`, observed at t = 209 s. It clears during the run; maximum car wait is **92 s**, mean speed **14.2 km/h**,
and **33.8%** of cars are stopped. The original strict zero-cycle assertion therefore fails on this corrected
world. This is recorded explicitly rather than claimed unchanged or silently hidden by switching seeds.

The flow regression now asserts this **one exact two-member case**, capped at **35 s**, with the original
**<120 s** maximum car wait, **<40%** stopped, **>12 km/h** mean and **0** minute-long switch waits still enforced.
Jeżyce seed 1 still requires **0 cycles**; seed 4242's pre-existing bounded case is retained. `bench-traffic.mjs`
adds `deadlockDetails` to its JSON so the test can bind the precise location/members/duration instead of allowing
an arbitrary extra cycle. The trace and summary are `.agent-task/height-centrum-flow.log` / `.json`.
This is an acknowledged seeded traffic limitation of the revised world, **not a claim that the cycle was fixed**.

### Repeated interleaved timings

The live main checkout advanced to `89ec754` during this follow-up. To keep the comparison fixed, the **task-base
main sources at `c363ade`** were copied to `/private/tmp/tram-original-main`; the worktree retains that same base plus
this patch. Six fresh processes ran in order **main1, work1, main2, work2, main3, work3**, using the same real-ShapeUtils
headless builder as above, with no rendering, hashing or JSON record capture inside the measured build. Temporary
browser/server processes were stopped. The machine is shared, so timings still have ordinary host-load variation.

| Pair | Frozen main build ms | Revised worktree ms | Main grid ms | Revised grid ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 16,784.47 | 17,089.50 | 1,276.95 | 1,809.66 |
| 2 | 16,408.97 | 18,553.08 | 1,195.78 | 1,981.33 |
| 3 | 16,310.12 | 17,368.91 | 1,170.45 | 1,874.80 |
| **Median** | **16,408.97** | **17,368.91** | **1,195.78** | **1,874.80** |

The repeated comparison measures **+959.94 ms / +5.85%** in the complete headless harness and **+679.02 ms** in the
grid phase versus the original task-base main. It includes both the visual clipping and the logical/support fix;
it does not isolate the height predicate's cost. Saved files are
`.agent-task/perf/height-frozen-{main,work}-{1,2,3}.json`. Rerun by substituting those roots into the earlier paired
commands. No claim is made about frame time or live main at later commits.

### Follow-up street-level screenshots

The pair `.agent-task/height-before-street-gpu.png` / `height-after-street-gpu.png` uses the same eye
`(−1055, 1.7, −790)`, look `(−1025, 0.2, −812)`, FOV 56, midday, high quality and 1440 × 1000 viewport.
Before serves the saved visual-only config/grid/street-details; after serves the final sources. Geometry cuts remain
visible while supports follow the corrected ground. Captures use `.agent-task/capture-height.mjs` and headless
Chrome CDP, with no visible browser tabs. Both runs have **0 console errors/warnings**. The isolated browser and
port 8160 server have been stopped. No commit or merge is made.


## Final integration: rebase onto poznan 15f9359

At the coordinator's request, the work was first committed as **Clip surfaces and height queries to the tram track
corridors**, then rebased from `c363ade` onto **15f9359545af768f3ad0739dc5665398f3fda7f8**. Conflicts in
`city-config.js`, `city-grid.js` and `street-details.js` retained boot6's `lotsWithin`, `isBlockAt` and optimized
call sites along with the tram cuts and cut-edge support clearance. The branch contains one task commit above that
parent; subsequent measurements and this record are amended into that commit. Earlier "no commit" statements
above describe the prior review stages.

`blockCutAt` now rejects `inTramSurfaceCut` as well as its existing road/per-block tram cuts. `blockAt` keeps its
fast corridor rejection before any ordinary or underpass fallback. `isBlockAt` rejects the same corridor before its
known-block shortcut, returning true only for the null candidate there. No source from the shelter collider fix
in `ad9233b` is reverted: `js/tram-infra.js` and `tests/tram-infra.test.cjs` are unchanged from `poznan`. The
`15f9359` signal-envelope audit and its documentation/tool changes are also retained.

### Rebased surface, ground and predicate audits

Both trees were rebuilt through the rerunnable audit, with real ShapeUtils, current building footprint holes and
the same sample grid. The comparison is against a frozen `git archive 15f9359` at `/private/tmp/tram-rebase-base`,
not the older `c363ade` timings or cached results:

| Check | poznan 15f9359 | Rebased patch |
| --- | ---: | ---: |
| Requested ground-surface records | 28,474 | 28,474 |
| Tram-corridor overlap pieces, city-wide | 1,440 | **0** |
| Tram-corridor overlap pieces, junction box | 14 | **0** |
| Rendered/`blockAt` disagreement queries | 603 | **0** |
| Queries reporting logical raised ground inside corridors | 36,935 | **0** |
| Queries covered by rendered raised surface inside corridors | 37,538 | **0** |
| Height/render samples | 783,010 | 783,010 |
| `isBlockAt` comparison checks | 2,836,698 | 2,836,698 |
| `isBlockAt(x,z,b) !== (blockAt(x,z) === b)` | 0 | **0** |

The current baseline already renders many conflicting surfaces, so its 603 height/render disagreements are a
different quantity from the visual-only stage's 36,935 invisible-support disagreements. These figures must not be
conflated. The predicate audit checks the null candidate and every block/underpass candidate in each sample's
32 m cell. The focused five-point regression additionally checks **every** configured block and underpass as a
candidate at each reported point, plus the actual controller's three ground-mode results.

All **28,474 input hashes** match the new parent; **1,440 surface output hashes** change, all independently
classified as touching the corridor (**0 untouched inputs or non-touching outputs change**). Saved outputs:
`.agent-task/rebase-{base,work}-surfaces.json`, `rebase-surface-diff.json` and
`rebase-height-regression-initial.log`. The committed height regression now asserts the predicate agreement too.

```sh
node tools/audit-tram-bed-surfaces.mjs --height --json /tmp/tram-rebased-audit.json
node --test tests/tram-bed-surfaces.test.cjs tests/tram-surface-height.test.cjs
```

### 24 build hashes against current poznan

The committed `tools/bench-boot-headless.mjs` rebuilt both the frozen parent and rebased tree with `--hashes`.
All **24** categories were regenerated, rather than comparing with the previous-base files. **13 differ / 11 match**;
reasons remain the support/route changes listed in the follow-up section. Full SHA-256 values are retained in
`.agent-task/rebase-base-hashes.json` and `rebase-work-hashes.json`.

| Category | Status | poznan SHA-256 prefix → rebased prefix |
| --- | --- | --- |
| `blocks.colliders` | same | `58a78e08fac41897` → `58a78e08fac41897` |
| `blocks.footprintsByBlock` | same | `f6d665eb00328dc4` → `f6d665eb00328dc4` |
| `blocks.allBlocks` | same | `59f39d2442895f7d` → `59f39d2442895f7d` |
| `grid.sidewalks` | same | `bb0b0f785f5dc0bf` → `bb0b0f785f5dc0bf` |
| `grid.footprints` | same | `77f10ad2c3035bb1` → `77f10ad2c3035bb1` |
| `grid.propColliders` | changed | `59049dd441ec5eca` → `9bfeb6d788da0d69` |
| `grid.parkTreeSites` | same | `c6d4d5f2e5ba8d29` → `c6d4d5f2e5ba8d29` |
| `grid.parkLampSites` | changed | `ccbd879a7a1834d8` → `a0ec159910663223` |
| `grid.pavedPlazaRects` | same | `13ed8a8303933952` → `13ed8a8303933952` |
| `grid.sidewalkBlocks` | same | `a6a348ac05d7ef99` → `a6a348ac05d7ef99` |
| `street.footprints` | changed | `012d33f86958c33e` → `8969bfa3b5fc45d2` |
| `street.colliders` | changed | `d41accc2a9343069` → `2f3f4203a39a4724` |
| `street.trees` | changed | `7c2b98b8db555416` → `96af51c61c58b395` |
| `street.audioSignals` | changed | `b96a84e363da5209` → `ba6891af334c6f19` |
| `network.final` | changed | `2385faa9a8b5687e` → `48fac2e0cd3d84e8` |
| `crosswalks` | changed | `f35f34b8e2bb6f14` → `6da2006e00186563` |
| `pedestrian.links` | changed | `32fc0ef21470ac0a` → `49247076fdec0a6c` |
| `tramLayout` | changed | `8985d1c55c686a84` → `6881d4ac8265d616` |
| `railLayout` | same | `809197682800cfcc` → `809197682800cfcc` |
| `paint` | changed | `0fac8d6b991c148d` → `c78ac8c7a237b43d` |
| `tramInfra.colliders` | changed | `557712112c9432de` → `ed1ad1e98d4ab414` |
| `tramInfra.stops` | same | `7f00dfe5918d7c8a` → `7f00dfe5918d7c8a` |
| `tramInfra.railCorridor` | same | `383f2db8707da24a` → `383f2db8707da24a` |
| `tram.graph` | changed | `0ff5914d16b76586` → `57f25a4628366f15` |

The optional `--triangulate-surfaces` flag now supplies real ShapeUtils while leaving rendering objects inert.
Without it, an inert triangulator yields no faces and omits the final surface-clipping arithmetic from a timing.
Its default remains off for compatibility with the established boot6 measurements. A second rebased hash run with
this flag produced **24/24 identical values** to the default run (`rebase-work-real-hashes.json`), proving the flag
changes the measured geometry work without changing the placement/network outputs.

### Test pins re-derived after the rebase

All six existing placement/count/hash test files were restored from `git show poznan:tests/<file>` before measuring
again. A temporary measurement wrapper recorded assertion actual/expected values; the assertions were then updated
from those new logs and verified normally by the full suite. **39 changed placement assertions** were re-derived:
**4 shelter**, **18 signal audit**, **1 signal placement**, **2 street-tree collider**, **6 lamp** and **8 tree field**.
Raw logs are `.agent-task/rebase-pin-*.log`; `rebase-pin-manifest.json` retains every old/new value. Their newly
measured replacement values match the earlier follow-up table; they were not copied from the old commit.

One difference in fixture baselines illustrates why the rerun mattered: the non-signal restored-footprint assertion
now measures **33,306 → 33,283**, reflecting the new parent's fixture outputs, while its restored
increment remains **6,867 → 6,844**. All rail/curb/footprint, phase, reach and open-front shelter safety assertions
remain in force. The inherited shelter OBB/back-panel/open-front tests pass on the rebased geometry.

The rebased full `node --test tests/` run passes **618/618** in **127.50 s**
(`.agent-task/rebase-full-tests.log`), including the new surface/predicate checks and inherited shelter-collider tests.
The standalone rebased Centrum seed-1 run was also rerun and matched the explicitly bounded case described below.
`git diff --check` is clean. The optional benchmark flag is separately exercised by its hash run and all six timing
builds; its 24 outputs match the default benchmark mode.

### Centrum cycle: causal control and retained test case

The strict original zero-cycle assertion was restored while investigating. The rebased seed-1 run still reproduces
exactly the earlier **33 s** cycle at t = **209 s**, between car **#49** turning right in the box at **−842, 13**
(position **−849, 7**) and **tram 8** near **−866, −4**. It clears during the run: longest-held car **92 s**,
mean **14.2 km/h**, **33.8%** stopped, **0** cars held over 120 s and **0** switch waits over 60 s.

The controlled experiment follows the coordinator's second suggested test: a fresh archive of **15f9359** keeps
its original surfaces, street furniture, ordinary `blockAt`/`isBlockAt`, tram code and vehicle-driving bodies.
Only the `createPedestrianRoutes` arguments are wrapped with the corridor predicate: pedestrian-route queries
inside the corridor return null/false; every other query is the unchanged baseline query. This reproduces the
**same two-member cycle, location, 33 s duration, 209 s time and every reported district statistic** as the full patch.

| Five-minute Centrum run | Cycles | Max held s | Mean km/h | Stopped |
| --- | ---: | ---: | ---: | ---: |
| Current poznan, seed 1 | 0 | 64 | 14.8 | 32.0% |
| Current poznan, seed 2 | 0 | 45 | 14.3 | 34.3% |
| Current poznan, seed 3 | 0 | 72 | 14.8 | 32.2% |
| Current poznan + pedestrian-query wrapper only, seed 1 | **1 (33 s)** | 92 | 14.2 | 33.8% |
| Full rebased patch, seed 1 | **1 (33 s)** | 92 | 14.2 | 33.8% |

The control changes only `js/city-config.js` (adds the helper and two wrappers; leaves its original query functions
untouched) and `js/traffic.js` (imports and route-factory arguments). Stripping those two import/argument changes
makes traffic.js byte-identical to the baseline. All other `js/*.js` files are byte-identical; source SHA-256 values
for city-grid, street-details, tram-infra, trams and pedestrian-routes are retained in
`.agent-task/rebase-control-source-hashes.json`. The exact control patch is `.agent-task/rebase-ped-only.patch`.

This demonstrates a latent cycle in the existing vehicle/tram rules under the shifted pedestrian network/shared
seeded sequence, **without any surface, support-placement or driving-rule change**. It does not claim the
unmodified baseline's seed 1 has a cycle (it does not), nor that a different baseline seed was found to reproduce it
(seeds 2 and 3 did not). On this evidence the explicit two-member **35 s bound** is retained, with the other original
wait/speed/stopped/switch limits intact. No game traffic/tram driving code is altered by this task beyond the inherited
boot6 changes. The regression comment now points to this control.

Reproduce the control from the saved patch:

```sh
mkdir -p /tmp/tram-ped-control
# Extract the measured baseline, then apply the two-file control patch (not the production patch).
git archive 15f9359 | tar -x -C /tmp/tram-ped-control
patch -d /tmp/tram-ped-control -p1 < .agent-task/rebase-ped-only.patch
node /tmp/tram-ped-control/tools/bench-traffic.mjs --minutes 5 --seed 1 --only centrum --json /tmp/tram-control.json
node tools/bench-traffic.mjs --minutes 5 --seed 1 --only centrum --json /tmp/tram-rebased-flow.json
```

Saved summaries/traces are `.agent-task/rebase-base-centrum-seed{1,2,3}.{json,log}`,
`rebase-ped-only-seed1.{json,log}` and `rebase-centrum-seed1.{json,log}`. No temporary control source is shipped in `js/`.

### Rebased interleaved timings

After the test/hash/control runs completed, six fresh Node processes were run in order **main1, work1, main2,
work2, main3, work3** against frozen `15f9359` and the rebased tree. The same committed harness runs both roots;
`--triangulate-surfaces` is enabled, and hashing/record capture is disabled. Rendering/GPU, landmarks, bridges,
outskirts, airport and canopy builders remain outside this headless fixture's scope.

| Pair | poznan 15f9359 build ms | Rebased build ms | poznan grid ms | Rebased grid ms |
| --- | ---: | ---: | ---: | ---: |
| 1 | 14,373.27 | 15,700.66 | 1,100.11 | 1,863.65 |
| 2 | 14,748.13 | 15,963.87 | 1,072.41 | 1,780.66 |
| 3 | 17,653.59 | 18,948.04 | 1,406.22 | 2,109.36 |
| **Median** | **14,748.13** | **15,963.87** | **1,100.11** | **1,863.65** |

The measured median total delta is **+1,215.74 ms / +8.24%**; the grid phase adds
**763.54 ms**. The third pair is slower on both trees under shared-host load, while the individual paired total
deltas are **1,327.39**, **1,215.74**
and **1,294.45 ms**. These are measured headless builder costs, not GPU/frame-time
or browser boot claims. Saved runs are `.agent-task/rebase-time-{main,work}-{1,2,3}.json`.

```sh
node tools/bench-boot-headless.mjs --triangulate-surfaces --root /path/to/poznan-15f9359 --json /tmp/tram-main.json
node tools/bench-boot-headless.mjs --triangulate-surfaces --root . --json /tmp/tram-work.json
# Repeat the pair three times. Add --hashes for the 24-category comparison (hashing occurs after timing stops).
```
