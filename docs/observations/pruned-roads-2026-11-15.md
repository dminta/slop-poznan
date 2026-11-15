# Observation: Underpass sidewalk AABBs pruning carriageways (2026-11-15)

## Summary

`tools/audit-pruned-roads.mjs` compares the bare road graph (`buildRoadNetwork([], [])`) against the furnished road graph (`buildRoadNetwork(grid.sidewalks, [...grid.footprints, ...street.footprints])`).

Before the fix, `js/city-grid.js` pushed the axis-aligned bounding boxes of all 44 rotated `UNDERPASS_SIDEWALKS` strips into `roadSidewalks` (`grid.sidewalks`). Because those strips run diagonally along underpass corridors (and extend `2 m` past each end), their AABBs spanned across adjacent carriageways and junctions, pruning **197 road edges (5.630 km)** and disabling **4 additional signal plans** (including Most Teatralny plan `381`).

Removing the `UNDERPASS_SIDEWALKS` AABBs from `roadSidewalks` in `js/city-grid.js` restores all 197 edges and re-enables Most Teatralny plan `381`, leaving **0** edges pruned by sidewalks and **2** edges (`0.092 km`) pruned by `footprintObstacle` (Dąbrowskiego and Wiejska).

## Before vs. After (`node tools/audit-pruned-roads.mjs`)

| Metric | Bare | Furnished (before) | Furnished (after) |
| --- | ---: | ---: | ---: |
| Kept edges | 13,256 | 12,992 | 13,189 |
| Kept carriageway (km) | 569.907 | 560.860 | 566.476 |
| Dropped edges | — | 264 (9.071 km) | 67 (3.441 km) |
| — SCC disconnected | — | 212 (7.275 km) | 60 (3.150 km) |
| — Sidewalk / footprint lane pruning | — | 29 (0.986 km) | 2 (0.092 km) |
| — SCC no clear outgoing moves | — | 20 (0.658 km) | 2 (0.047 km) |
| — Other | — | 3 (0.152 km) | 3 (0.152 km) |
| Disabled signal plans | 6 | 25 (19 new) | 21 (15 new) |

Re-enabled signal plans: `69`, `118`, `201`, `381` (Most Teatralny), `384`.

## Secondary effect

Restoring the carriageway near `(-1434.31, -586.59)` exposed a 1-millimetre clearance discrepancy between `clearStreetTree` in `js/street-details.js` (`Math.max(1.2, 0.9 + pad)`) and `tools/audit-street-tree-clearance.mjs` (`Math.max(1.2, 0.9 + r * Math.SQRT2)`). Updating `clearStreetTree` to use `r * Math.SQRT2` keeps all street trees clear of the restored lane.

## Traffic & Tram-Overlap Gates (seeds `1, 2, 3, 5, 7, 11, 99, 4242`)

`tools/bench-world.mjs` passes `[]` for `sidewalks`, so traffic benchmarks already ran on the unpruned road graph and show zero regression:

- `node tools/bench-traffic.mjs --seed S`: **0** deadlocks across all 8 seeds; `held > 120 s` = `0` (seeds `1, 5, 7, 11, 99`), `6` (seed `2`, Kaponiera), `4` (seed `3`, Kaponiera), `5` (seed `4242`, Kaponiera). Centrum and Stare Miasto had `0` holds `> 120 s` and `0` deadlocks across all 8 seeds.
- `node tools/audit-tram-overlaps.mjs --seed S`: `overlapPairs` = `7, 5, 8, 3, 5, 5, 4, 7` (44 total across 8 seeds).

## Verification

- `node tools/audit-dark-heads.mjs`: `disabledPlans: 21`, `disabledPlansWithPolesOrHeads: 0`, `totalRenderedDisabledLensOrPanelInstances: 0`.
- `tests/sidewalk-prune.test.cjs`: verifies `grid.sidewalks` excludes `UNDERPASS_SIDEWALKS` AABBs, preserves Roosevelta near `(-1253.0, -546.1)` and Most Teatralny `(-1373.2, -213.7)` (`>= 3` arms), and keeps `SIGNAL_PLANS[381]` enabled.
- WebGPU and WebGL2 headless Chrome screenshots at Most Teatralny confirm working signal heads with 0 console/page errors.
