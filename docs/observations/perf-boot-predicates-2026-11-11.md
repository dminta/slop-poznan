# Faster boot: indexed load-time spatial predicates (2026-11-11)

## Question

Ranked opportunity 8 in [the older-device audit](perf-older-devices-2026-11-11.md) was to index and cache the load-time
spatial predicates: `pointInPoly` alone was 18.8 % of the boot CPU profile and 32 % inclusive, `pointInPark` / `inPlaza`
added ~9 %, `insideCurbIsland` 2.4 %, `pointInPolygonXZ` 1.8 %, `layoutBusMarkings` 3.3 %, `crossingRuns` 2.3 % and
`buildTrackGraph` 2.8 %. This records the implementation and its measured effect. No `js/geodata.js`, `js/main.js` or
world data changed.

## What changed

- `js/city-config.js` gained a per-polygon edge index (`createPolygonIndex` / `pointInPolyIndexed`): the ray test flips
  only for edges whose z span covers the point, so edges are bucketed in 4 m z slots and a query visits just those
  (with the exact `pointInPoly` endpoint pairing and formula, so vertex/edge ties are unchanged). The buckets are CSR
  typed arrays (`Int32Array` offsets + edges), not one small JS array per slot. Filing and querying share one clamped
  `polygonSlot`, so a value one ulp below z1 (a 4,096 m span rounds `z - z0` to the slot count) cannot fall past the
  last slot.
- `blockAt` (curb island lookup) and `buildings.js` `insideCurbIsland` share one lazily built index per `BLOCKS` entry
  (`pointInBlockPoly`). This was the hot path: `blockAt` was 1.1 s of the Node profile, called mostly by
  `nearestCurbFrame`.
- `pointInPark` now buckets the 579 park rings in a 64 m grid (lazily) and indexes each ring's edges; it no longer
  scans every park ring per point. This was 14 % of the headless city-grid build. `buildCityGrid` calls
  `releaseParkIndexes()` at the end: the park indexes and ring grid are boot-only (buildings and blockLots), so their
  ~0.9 MB is given back; a late call rebuilds lazily.
- The land raster's even-odd scanline fill reuses the same z-slot edge buckets instead of testing every ring edge on
  each 2 m row.
- `city-grid.js` uses a weak per-polygon index (`polygonIn`) in the park tree/lamp and plaza loops that sample the same
  outline every 11-22 m (`pointInPolygonXZ` was 1.8 % of boot); block outlines there call `pointInBlockPoly` instead, so
  they share the block's index rather than building a duplicate.
- `street-details.js` `inPlaza` buckets the paved-square/park-block rects in 64 m cells (bounds grown by the largest
  call margin, 1.5 m) before the unchanged exact test.
- `road-paint.js` `layoutBusMarkings` buckets the ~2,400 crosswalk segments in 16 m cells (4 m keep) before the
  unchanged distance test. This removed `layoutBusMarkings` and most of `roadPaint` from the profile (663 ms → 36 ms
  at 1×).
- No point-level memoisation was added: once the edge work was indexed, the repeated exact-coordinate queries were
  rare and a cache would have added invalidation risk without measurable gain.

Remaining top load functions after this change are outside the predicate scope: `outlineRay` (14-17 % self),
`tram-infra.nearest` / `poleAt`, `distPointToSeg` and `crossingRuns` (~2 %), the land raster's bridge capsules and
`railClearance`.

## Measurement

Browser numbers use the audit's harness (`.agent-task/perf-harness`, headless Chrome 157, Apple-silicon Mac, 1280 × 720,
WebGPU, full page load, `[init]` phases and a 200 µs whole-boot CPU profile). The machine was also running other
worktree builds during these runs (load average ~8-17), so absolute wall times are higher than the audit's 16.5 s
baseline; each row is an interleaved A/B pair on the same machine state.

| Run | Baseline (`poznan` 0fa5f4a) | Indexed | Change |
|---|---:|---:|---:|
| Boot 1×, sample 1 | 21.49 s | 13.42 s | −38 % |
| Boot 1×, sample 2 | 18.17 s | 11.85 s | −35 % |
| Boot 1×, review round 1 | 18.41 s | 11.85 s | −36 % |
| Boot 6× CPU, sample 1 | 109.52 s | 70.80 s | −35 % |
| Node `buildWorld` (3 interleaved runs) | 13.0-14.5 s wall / 15.2-17.0 s CPU | 10.9-11.6 s wall / 13.1-13.9 s CPU | ~−15 % |
| Node `buildCityGrid` (3 runs) | 3.06-3.34 s | 1.50-1.72 s | ~−48 % |

`[init]` phases of the review-round-1 pair:

| Phase | Baseline | Indexed |
|---|---:|---:|
| blocks | 2.48 s | 1.89 s |
| cityGrid | 2.87 s | 1.51 s |
| streetDetails | 4.14 s | 2.00 s |
| traffic | 3.46 s | 1.85 s |
| roadPaint | 0.67 s | 0.03 s |
| compile | 1.49 s | 1.10 s |
| total to first frame | 18.41 s | 11.85 s |

Boot CPU profile, self time:

| Function | Baseline 1× | Indexed 1× | Baseline 6× | Indexed 6× |
|---|---:|---:|---:|---:|
| `pointInPoly` / `pointInPolyIndexed` | 19.0 % | 3.3 % | 22.1 % | 4.6 % |
| `pointInPark` | 5.0 % | < 1 % | 5.5 % | < 1 % |
| `insideCurbIsland` | 2.2 % | < 1 % | 2.6 % | < 1 % |
| `pointInPolygonXZ` | 1.9 % | < 1 % | 2.2 % | < 1 % |
| `layoutBusMarkings` | 3.1 % | < 1 % | 3.2 % | < 1 % |
| `city-config.js` inclusive | 32.8 % | 15.7 % | 36.3 % | 18.8 % |
| `street-details.js` inclusive | 35.9 % | 27.3 % | 37.3 % | 30.0 % |

The 6× profile keeps `pointInPolyIndexed` at 4.6 % and `street-details.js` at 30 %: the remaining cost is the unindexed
park/rail clearance and outline-distance work, not the block point test. A phone-level throttle therefore still spends
~70 s before the first frame under the same synthetic slowdown.

## Memory

`node --expose-gc .agent-task/bench-heap.mjs old|new` measures the retained index structures over all 2,030 blocks and
579 park rings, after forced GC (heap + typed-array backing stores):

| Index set | Old small-array buckets | CSR (`Int32Array` offsets + edges) |
|---|---:|---:|
| Blocks + parks | 23.63 MB (16.97 + 6.66) | 3.29 MB (2.42 + 0.87) |
| After `releaseParkIndexes()` | — | **2.42 MB retained** (blocks only) |

The block indexes stay because `controllers.js` `isPointOnSidewalk` calls `blockAt` during play. The park indexes and the
64 m ring grid are only used by the buildings and city-grid builds, so `buildCityGrid` releases them; a later
`pointInPark` call rebuilds them lazily.

## Equivalence evidence

- **Land raster:** every 2 m cell centre (19,315,428 cells) gives the same `isLand`, `isWater` and `distToWater` as
  the baseline (57,946,284 comparisons, 0 mismatches), so the edge-bucketed scanline fill and the bridge capsules are
  cell-for-cell identical.
- **Predicates:** 25,583,140 comparisons between the baseline and indexed modules, all identical. That covers a 1.2 M
  point 8 m lattice over the detail box (`blockAt`, `pointInPark`, `isLand`, `isWater`, `distToWater`, `districtAt`,
  `waterAt`), 6.29 M samples on every block vertex/edge/quarter point with ±0.01 m and ±1 µm offsets, and 2.27 M samples
  on every park ring vertex/edge with the same offsets. The indexed block and park results were also checked against a
  plain copy of the original ray cast.
- **City grid:** the headless build hash is identical (`1bbd5957acfbc104`): 807 paved plaza rects, 61,550 park and
  plaza trees, 3,516 lamps, 65,523 prop colliders, footprints, sidewalks and cut slabs.
- **Buildings:** the headless `buildCityBlocks` collider hash is identical (`e3c30f15565873d4`) for 51,893 colliders.
- **Street furniture:** the full city-grid + street-details build on the real plaza/park data has the same hash
  (`765de96526680865`): 35,425 footprints and 13,190 road-network edges.
- **Traffic:** `node tools/bench-traffic.mjs --only centrum --seed 4242 --json` produced byte-identical JSON before and
  after (52 cars, same waits, queues and tram stops).
- **Road paint:** the P-22 marking layout on the real headless network is identical (115 marks,
  hash `70c581dbdcda3f37`), and `tests/zebra-visibility.test.cjs` keeps the documented `P-22 ways: 87 designated,
  50 painted, ...` report.
- **Regression test:** `tests/predicate-index.test.cjs` compares the indexed block and park predicates with the plain
  ray cast on every vertex, edge midpoint and ±1 µm neighbour, plus a synthetic polygon with edges on slot boundaries
  and a 4,096 m span whose one-ulp-below-`z1` query previously rounded past the last slot.

## Limits

- The 6× pair was measured before the CSR layout change; the indexing algorithm is the same, and the final 1× pair after
  it is the review-round-1 row.
- Headless Chrome on one Apple-silicon Mac, with other builds running; the 1× absolute times are 10-30 % above the
  audit's quiet-machine baseline. The A/B pairs and phase ratios are the result, not the absolute seconds.
- The 6× CPU throttle is a JS slowdown, not a phone. The shader compile/warm-up rows are still cache-dependent.
- The predicate check is exhaustive on vertices/edges/slot boundaries and dense on a lattice, not proof over every real
  number. It uses the same IEEE arithmetic and the same endpoint pairing, which is what the index preserves.
- `outlineRay`, `tram-infra.nearest`, `crossingRuns` and the land raster's bridge capsules are untouched and now the
  largest boot entries; they need separate work.
