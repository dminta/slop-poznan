# Observation: pedestrians on vehicle carriageways (2026-11-16)

Report: "after recent changes you can sometimes meet pedestrians walking along the vehicle carriageway (not a pedestrian
street)". Not a crossing at a zebra: a person walking on the road where cars drive.

## Cause

**`177bdc3` ("Restore carriageways pruned by park footprints…")** made park block footprints `walkable = true`
(`city-grid.js`), which is what let the road network keep roads that a park's bounding box used to prune, and also lets
walkers use the park ground (3,616 pedestrian ways instead of 1,511, 5,364 crosswalks instead of 3,950). The route
builder then accepted walks that cross those roads: `pedestrian-routes.js` `clear(a, b, block)` tests only walkable
ground and the block, so a sidewalk line (`along`, whole-line branch), a corner link (`cornerClear`) or a pedestrian-way line
(`wayClear`) running over a restored carriageway was accepted whole. Only the split branch (`splitAlong`) and the
`clearHazards` family of connector checks looked at lanes. Before `177bdc3` the park AABB made the same ground
non-walkable, so no walk existed there.

Why no earlier tool saw it: `tools/bench-world.mjs` builds the road network without the city grid's sidewalks and park
footprints, so its network never prunes at a park and the headless benchmarks (and every audit built on them) ran on the
"restored" layout all along. 177bdc3, 3e63862, d985b3f, `321c138`, `9798737` and `2d898ac` give **byte-identical** headless dynamic
results on the default world. `buildWorld({ furnished: true })` (new, opt-in) runs `buildCityBlocks` + `buildCityGrid` and
hands their sidewalks and footprints to street details and traffic as `main.js` does (landmark, bridge and outskirts colliders
stay omitted).

## Audit (`tools/audit-ped-roadway.mjs`)

* **Static:** every route track (`segments()`: sidewalk lines, corner/curb links, island ports, way lines; crosswalk tracks
  exempt) sampled every 0.5 m; a sample is an offence when it lies in the roadway oracle built from the network. The strict
  oracle (`--envelope span`, what the route builder now rejects) is, per edge from stop line to stop line, the span of the
  lane centres ± 1 m (a car's half width). `--envelope half` additionally uses `edge.half − 1 m`: **round 0 used it and it
  was over-strict**: `half` reaches over curb paving (Termalna: half 4.9, one lane at −0.58, the sidewalk block starts at
  lat +1.6; Dymka: block from lat 3.0, outer lane at 1.51), so about a quarter of its "offenders" were pavement. The default
  envelope (lane span ± 1.2 m plus junction connector curves) is noisier still (curb-hugging corner links graze the swept
  curves). Crosswalk rectangles are exempt; pedestrian streets are not in the network. Runs are deduplicated.
* **Dynamic:** the real simulation at the eight districts, 3 min each, seeds 61/67/71, 1 sample/s, placed walkers not on a
  crosswalk track nor in a crosswalk rectangle and inside the same oracle (1,305,600 placed ped-seconds per tree).

## Bisect (furnished world, `--envelope span --connectors off`)

| commit | routes inside a roadway | runs |
| --- | ---: | ---: |
| b5d5e00 (after 2d898ac, before 177bdc3) | 633.5 m (sidewalk 49, way 78.5, link 506) | 310 |
| **177bdc3** | **767.5 m** (86 / 116 / 565.5) | 394 |
| 3e63862, d985b3f | 767.5 m | 394 |

`177bdc3` adds +134 m (+84 runs), concentrated at roads through parks and outskirts (Arcybiskupa Walentego Dymka, Słowiańska,
Za Cytadelą, Kmicica, Baraniaka). The other suspects change nothing: `2d898ac`, `3e63862`, `9798737`, `d985b3f` and `321c138`
leave the totals unchanged (d985b3f's segment rail gates and curb frame cache are exact). The 633 m before 177bdc3 are the
generator's older gaps (it never tested carriageways outside the split branch); the fix removes both.

## Fix (`js/pedestrian-routes.js`)

* `onRoadway(x, z)` / `laneFree(a, b, skip)`: a straight walk is free when none of its 0.5 m samples is in a roadway
  (lane-centre span ± 1 m, cached on the edge as `_roadLo`/`_roadHi`; an edge without lanes falls back to `half − 1`).
* `along`: a whole-line sidewalk track needs `laneFree`, else it takes the existing `splitAlong` clipping.
* `cornerClear` (corner links and their rounded variants): needs `laneFree(a, b, 1)`; the first and last metre are exempt,
  because a crosswalk landing can stand inside a short or service edge's lane band and every link from it was rejected at
  sample 0 (about 4 of the dead ends the first version created).
* `layOutWays` / `wayRuns`: a way segment that touches a roadway is **clipped into its clear runs** (≥ 1 m each, chain broken
  at the cut), not dropped. The first version dropped whole segments by `laneClearPoint` (`half + 0.8 m`) and removed 79 tracks
  / 3.7 km, including 105 m of Półwiejska, whose end vertices sit in the narrow streets they join. Now every deptak keeps its
  lines: Półwiejska 2,964 → 2,958 m, Gołębia 869 → 865, Murna 220 → 216, Jaskółcza 309 → 304, Kwiatowa 361 → 358, Zaułek
  Zierhoffera 507 → 497 (−185 m of way length in all, 3,616 → 3,617 ways).
* Crosswalk tracks keep crossing the lanes. `clearOfStreets`/`clearHazards` connectors are unchanged.

## Before / after (furnished world)

| measure | pre-regression `b5d5e00` | before `d985b3f` / poznan | after |
| --- | ---: | ---: | ---: |
| static, strict span | 633.5 m (310 runs) | 767.5 m (394) | **31 m (31)** |
| dynamic strict ped-seconds, 24 runs × 3 min | — | 224 | **4** |
| in-browser audit (span) | — | 761.5 m (413 runs) | **40.5 m (45)** |
| pedestrian ways / length | 1,511 (older world) | 3,616 / 112,976 m | 3,617 / 112,791 m |
| crosswalk ends without a link (of 14,942) | 25 of 11,024 | 28 | 30 |
| bare network empty ends / tracks (sinks test) | — | 12 | 14 (ceiling 15 unchanged) |

The remaining 31 m are trimmed lane-end grazes (none above 2 m). The dynamic hotspots before were Szkolna (Stare Miasto,
169 ped-s: a sidewalk fragment inside the lane span) and Zwierzyniecka / Zeylanda (Kaponiera, 53), both gone but 4 ped-s at
Kaponiera. The Głogowska / Most Dworcowy cluster the reviewer worried about (a removed 14 m corner link at (−1584, 562)) does
not form: `audit-ped-overlaps` on Dworzec, seeds 61/67/157, default and furnished (`BENCH_FURNISHED=1`), gives 0 clusters and
identical pair rates (5.9 / 7.4 / 8.0 per s) on poznan and on this tree.

## Acceptance (`node tools/accept-traffic.mjs --base poznan --ped`, 20 fresh seeds)

Final tree rebased onto `poznan` 9f3d3c0, 5 min, 15 fps, seeds 61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149
151 157. Exit 0: **no statistically clear regression**, no new deadlock pattern.

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 76 | 95 | +0.95 | [-0.1, +2.05] | within noise |
| holds > 120 s | 27 | 17 | -0.5 | [-1.85, +0.85] | within noise |
| deadlocks | 3 | 2 | -0.05 | [-0.25, +0.15] | within noise |
| max wait s | 2166 | 2165 | -0.05 | [-13.7, +13.1] | within noise |
| km/h all | 305.1 | 304 | -0.06 | [-0.18, +0.07] | within noise |
| ped clusters | 8 | 7 | -0.05 | [-0.15, 0] | within noise |
| ped overlap pairs/s (info) | 114.45 | 114.29 | -0.01 | [-0.05, +0.03] | within noise |

(Every km/h district row is within noise too.) Car–tram pairs lean up on these seeds, so the reviewer's independent check
matters: on 20 other fresh seeds (163–269) against the correct base `poznan` 2670dc1, pairs went 107 → 101 (CI [-1.2, +0.6]).
An earlier run of mine on those seeds compared against 9f3d3c0, whose `trams.js` change confounds it, and is dropped. The
pedestrian routes next to the Jeżyce pattern that run flagged (-2023,-448) are identical on both trees.

## Browser check (headless Chrome, CDP 9420, http 8220, WebGL2, 1280 × 800, Spacer mode)

`/tmp/cc-ped-roadway/h/serve.mjs` serves a tree with two in-memory patches (a debug handle in `main.js`, a `forcePed` hook in
`traffic.js`); the page runs the strict audit in the browser world: `before` (poznan): **761.5 m in 413 runs** on 692,235
tracks; `after`: **40.5 m in 45 runs** on 692,430. Red cubes mark every offending sample within 60 m of the spot. Same mode,
same fixed camera (spot + 13, 11, 13) before and after; a forced walker stands on the nearest route of the spot's kind.
No console errors or warnings in either run (`/tmp/cc-ped-roadway/shots2/{before,after}.json`).

| spot | before | after |
| --- | --- | --- |
| Dezyderego Chłapowskiego (−709, 2308): a sidewalk line across the carriageway | `/tmp/cc-ped-roadway/shots2/before-chlapowskiego-1.png` | `/tmp/cc-ped-roadway/shots2/after-chlapowskiego-1.png` |
| Aleja Niepodległości (−1007, −312): a corner link along the carriageway | `/tmp/cc-ped-roadway/shots2/before-niepodleglosci-1.png` | `/tmp/cc-ped-roadway/shots2/after-niepodleglosci-1.png` |
| Inflancka (1863, 2767): a junction link | `/tmp/cc-ped-roadway/shots2/before-inflancka-1.png` | `/tmp/cc-ped-roadway/shots2/after-inflancka-1.png` |
| Półwiejska deptak (−278, 607; way length 129 m; the plate shows the nearest street, Rybaki): no offender, keeps its walkers | `/tmp/cc-ped-roadway/shots3/before-polwiejska-1.png` | `/tmp/cc-ped-roadway/shots3/after-polwiejska-1.png` |

(Frames `-0`/`-2` repeat each shot.) The earlier round's Termalna / Dymka / Za Cytadelą frames (`/tmp/cc-ped-roadway/shots/`)
are superseded: their red cubes mostly marked curb paving, not carriageway. In the Niepodległości before frame the red line
runs along the asphalt next to the pavement; after, it is gone and walkers keep to the sidewalks.

## Tests

`tests/ped-roadway.test.mjs` (new, ~70 s; asserts ≤ 60 m, no way offender, no run > 6 m; it fails on poznan with 767.5 m);
`tests/pedestrian-route-sinks.test.cjs` keeps its ceiling of 15 (comment updated); `tests/ped-overlaps.test.cjs` "a connector
is keyed by the physical line" now builds an L corner whose stop lines are 8 m out of the node (the old synthetic corner link
crossed the road's mouth, which is now rejected); `tests/boot-indexes-4.test.cjs` stubs `laneFree` in its `cornerClear` slice.
