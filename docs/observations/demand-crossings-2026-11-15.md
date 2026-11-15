# Headless demand-crossing audit — 2026-11-15

## Scope and method

Audited all 23 active two-arm pedestrian-demand signals in `buildWorld()` (`tools/bench-world.mjs`, benchmark world: real `road-network.js`, `pedestrian-routes.js`, `city-grid.js`, `street-details.js`, `tram-infra.js`, `trams.js`, `traffic.js` and `buildings.js` block colliders; omits landmark/bridge colliders and browser rendering) using `tools/audit-demand-crossings.mjs`.

Nodes were grouped into 19 spatial batches (200 m radius, offsetting single-node or close batches by 100 m in `x` so `spawnPed` can place crossers within its 60–280 m ring), simulated for 5 minutes per batch at 15 fps across seeds `4242` and `77`. Node `2634` at `(415.5, 523)` corresponds to historical node `2422` in [signals-2026-10-30.md](signals-2026-10-30.md).

## Bug found and fixed

Before the fix, 4 of the 23 nodes (`139`, `1662`, `2634`, `3158`) recorded `50` road-green crossing entries (`84` roadway-during-green events):

- In `js/traffic.js` `walk()`, `curbProgress(p)` returns `p.len - p.t` when `p.dir === -1`.
- When a waiting pedestrian is clamped to `p.t = p.len - KERB` (`KERB = 1.6`), IEEE 754 float64 arithmetic yields `p.len - (p.len - 1.6) = 1.6000000000000014 > 1.6` for track lengths such as `17.8` m (`2634`), `19.3` m (`139`), `23.68` m (`1662`), and `27.75` m (`3158`).
- On the next frame, `curbProgress(p) <= KERB` evaluated to `false`, skipping `mayCross(p)` and `p.waiting`, so the pedestrian stepped off the curb onto the live roadway while the road signal was green.
- Fix in `js/traffic.js`: add `1e-6` tolerance to both `curbProgress(p) <= KERB + 1e-6` checks in `walk()` (matching the existing `KERB - 1e-6` tolerance on the arrival check) and clamp `Math.max(0, KERB - s)` so `room` never goes negative into `Math.sqrt`.

## Post-fix results (seeds 4242, 77; 5 min/batch; 15 fps)

- **Demand nodes**: 23 (`0` unvisited)
- **NPC requests / phases served**: 345 requests, 322 phases served (the remaining 23 were pending at batch end)
- **Clearance failures** (`redClearance < width / 1 m/s`): 0
- **Road-green minimum failures** (`< 20 s`): 0
- **Request delay failures** (`< 2 s`): 0
- **Starvation** (`curb wait > 60 s` without request): 0
- **Road-green violations** (`enterGreen` / `roadGreen`): 0 / 0

Note on `maxWait`: nodes `3150` (`69.8 s`) and `3158` (`71.3 s`) had `starved: 0` because demand phases were requested and served normally, while `mayCross` held walkers for an extra cycle when queued vehicles occupied `n.crossing[side]`.

| id | x | z | width (m) | clear (s) | clrOk | req | served | lat min/p50/max (s) | minGreen (s) | minDelay (s) | starved | maxWait (s) | enterGreen | roadGreen | visitors |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 139 | 1060.7 | 1452.8 | 16.1 | 16.1 | ok | 14 | 12 | 25/25/25 | 20 | 19.93 | 0 | 38.3 | 0 | 0 | 43 |
| 565 | 2848.1 | -1512.5 | 7.8 | 7.8 | ok | 16 | 16 | 7.07/25/25 | 20 | 2 | 0 | 33.6 | 0 | 0 | 144 |
| 1010 | -3525.1 | 2208.1 | 14.05 | 14.05 | ok | 14 | 14 | 7/25/25 | 20 | 2 | 0 | 39.9 | 0 | 0 | 36 |
| 1561 | 3224.2 | 2319.8 | 8.05 | 8.05 | ok | 16 | 16 | 7/25/25 | 20 | 2 | 0 | 33.5 | 0 | 0 | 174 |
| 1612 | 2441.5 | 2655.2 | 10.85 | 10.85 | ok | 16 | 14 | 7.07/25/25 | 20 | 2 | 0 | 36.3 | 0 | 0 | 39 |
| 1662 | -944.8 | -2366.2 | 20.48 | 20.48 | ok | 13 | 12 | 7.07/25/25 | 20 | 2 | 0 | 45.5 | 0 | 0 | 67 |
| 1826 | 1029 | -2524.7 | 10.85 | 10.85 | ok | 16 | 14 | 7.07/22.4/25 | 20 | 2 | 0 | 35.9 | 0 | 0 | 60 |
| 2342 | 1979.9 | 2611.7 | 7.3 | 7.3 | ok | 17 | 16 | 7.07/25/25 | 20 | 2 | 0 | 32.3 | 0 | 0 | 40 |
| 2402 | 1169.4 | -2431.9 | 10.85 | 10.85 | ok | 16 | 14 | 7.07/25/25 | 20 | 2 | 0 | 35.9 | 0 | 0 | 63 |
| 2634 | 415.5 | 523 | 14.6 | 14.6 | ok | 14 | 14 | 7.07/23.87/25 | 20 | 2 | 0 | 39.6 | 0 | 0 | 22 |
| 2719 | 1054.7 | -2541.6 | 14.35 | 14.35 | ok | 14 | 13 | 7.07/25/25 | 20 | 2 | 0 | 39.1 | 0 | 0 | 56 |
| 3150 | -138.4 | 1996.2 | 10.85 | 10.85 | ok | 16 | 14 | 7.07/25/25 | 20 | 2 | 0 | 69.8 | 0 | 0 | 107 |
| 3158 | -791.8 | -1199.4 | 24.55 | 24.55 | ok | 12 | 12 | 7.07/25/25 | 20 | 2 | 0 | 71.3 | 0 | 0 | 69 |
| 3271 | -1244.5 | 652.5 | 11.35 | 11.35 | ok | 15 | 14 | 7.07/25/25 | 20 | 2 | 0 | 35.3 | 0 | 0 | 28 |
| 3282 | 1583.8 | -639.5 | 7.55 | 7.55 | ok | 18 | 16 | 7.07/25/25 | 20 | 2 | 0 | 32.6 | 0 | 0 | 32 |
| 3436 | -155.5 | 1992 | 8.55 | 8.55 | ok | 15 | 15 | 7.07/23.47/25 | 20 | 2 | 0 | 33.5 | 0 | 0 | 50 |
| 5102 | 2024.6 | 1666.8 | 14.37 | 14.37 | ok | 11 | 11 | 7.07/21.8/25 | 20 | 2 | 0 | 38.3 | 0 | 0 | 27 |
| 5287 | 3067.2 | -2357.8 | 11.1 | 11.1 | ok | 15 | 14 | 7.07/25/25 | 20 | 2 | 0 | 37.5 | 0 | 0 | 59 |
| 5326 | 3455.2 | -1978.9 | 10.85 | 10.85 | ok | 16 | 14 | 7.07/25/25 | 20 | 2 | 0 | 35.9 | 0 | 0 | 69 |
| 5454 | 1876.6 | -2466.6 | 14.3 | 14.3 | ok | 13 | 13 | 7.07/25/25 | 20 | 2 | 0 | 39.3 | 0 | 0 | 54 |
| 7021 | -8552.9 | -2582.3 | 5.1 | 7 | ok | 18 | 16 | 7.07/24.47/25 | 20 | 2 | 0 | 34.5 | 0 | 0 | 100 |
| 7235 | -8541.2 | -2643.1 | 10.6 | 10.6 | ok | 16 | 14 | 7.07/25/25 | 20 | 2 | 0 | 34.6 | 0 | 0 | 69 |
| 7548 | -7965.8 | -537.5 | 9.05 | 9.05 | ok | 14 | 14 | 7.07/23.27/25 | 20 | 2 | 0 | 33.1 | 0 | 0 | 54 |

## Regression test

`tests/demand-crossings.test.mjs` runs `tools/audit-demand-crossings.mjs` for 1.5 minutes (seed `4242`) on nodes `2634` (`(415.5, 523)`), `139`, and `1662`, asserting requests are served within the 26 s bound and 0 walkers cross on road green or starve.
