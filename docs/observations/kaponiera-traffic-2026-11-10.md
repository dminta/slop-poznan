# Kaponiera traffic investigation, 2026-11-10

> Measured at `42329c3`, before `564975e` (length-weighted pedestrian street spawns, which reshuffles seeded draws in
> districts with pedestrian streets) and `5e6a68e`. [Re-measured at `5e6a68e`](#re-measured-at-5e6a68e) below.

The current checkout differs from the 2026-11-08 benchmark baseline. On the five-minute seed-1 Kaponiera run
(`node tools/bench-traffic.mjs --only kaponiera --seed 1 --dump`), no sampled car exceeds 120 s; mean speed is
13.2 km/h, stopped 50.0%, finished wait p90/max 44/118 s, and 25 cars exceed 60 s. There is one wait-for cycle,
and two junctions have a car stopped inside over 20 s. The all-district seed-1 run gives the same Kaponiera row;
Centrum has two cars over 120 s, with a 145 s maximum finished wait. These results do not match the older
five-car/zero-deadlock seed-1 result, so they are not a controlled before/after comparison with that record.

## Seed-1 trace

`--trace -1468,118 --trace-min 20` shows car 43 at the give-way on the 10 m link from `(-1494, 109)`,
lane 2, held by tram conflicts. At t=154–156 it has waited 116–118 s, with successive trams in or near the
crossing; it clears and is on the downstream signal approach by t=181. Cars 20 and 58 also wait at the same
crossing, respectively for a tram reservation and a tram proxy. The seed has no car over 120 s at this focus.

`--trace -1503,224 --trace-min 20` shows car 62 waiting for its signal on the approach from `(-1497, 198)`;
it enters on green at t=195. A tram proxy appears on its outgoing lane and the car stops inside the connector;
tram 6 later waits for car 62 while car 62 follows the proxy. At t=292 this is an 89 s two-vehicle cycle.
Bus 208 queues behind car 62. The box at `(-1503, 224)` is blocked for 92 s; the separate box at
`(-1468, 118)` for 43 s. These traces do not establish that bypassing a proxy would be collision-free.

## Rejected experiments

Both experiments were run only in a temporary copy, on the same five-minute seed-1 Kaponiera command. Neither
was kept in production, and neither was advanced to a multi-seed or overlap audit.

- Let a stopped connector vehicle ignore the proxy of a tram waiting for that vehicle. Mean speed 13.2 → 13.4 km/h,
  stopped 50.0 → 49.5%, p90/max 44/118 → 44/118 s, held >60 25 → 25, held >120 0 → 0, deadlocks 1 → 1.
  The two-vehicle cycle changed to a three-vehicle cycle involving bus 208, and the `(-1503, 224)` box remained
  blocked for 84 s. Rejected because the deadlock remains.
- In the exit-room calculation, use the space behind a tram proxy when it lies close to the entrance. All reported
  seed-1 metrics and the 89 s cycle were identical to baseline. Rejected as ineffective.

No production behavior changed. In particular, neither experiment establishes an overlap-safe solution or meets
the requested zero-deadlock goal.

## Current Centrum regression

`node tools/bench-traffic.mjs --only centrum --seed 1 --dump` reproduces the current full-suite traffic-flow
failure: mean 14.4 km/h, stopped 34.1%, wait p90/max 28/145 s, 5 cars over 60 s, 2 over 120 s, no deadlock,
and one box-stuck junction. At t=300 car 21 is stopped for `room` on the approach to `(-1048, 131)`; the
benchmark attributes 142 s maximum wait to `(-1117, 132)` and reports the box at `(-1136, 127)` for 34 s.
The trace threshold of 100 s at `(-1117, 132)` emitted no per-second snapshots, so this does not establish the
full blocker chain or a safe fix.

## Current eight-seed Kaponiera baseline

Five minutes, 15 fps, `node tools/bench-traffic.mjs --only kaponiera --seed <seed>` (each independent process),
first 20 s excluded. The box column is the number of reported junction boxes with a car stopped inside over 20 s.

| Seed | mean km/h | stopped % | wait p90 / max s | held >60 s | held >120 s | deadlocks | box-stuck |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13.2 | 50.0 | 44 / 118 | 25 | 0 | 1 | 2 |
| 4242 | 13.7 | 47.1 | 44 / 112 | 8 | 0 | 0 | 0 |
| 7 | 11.8 | 53.0 | 49 / 155 | 28 | 6 | 1 | 1 |
| 99 | 12.1 | 53.2 | 42 / 89 | 21 | 0 | 1 | 0 |
| 2 | 11.3 | 55.9 | 50 / 145 | 27 | 10 | 0 | 0 |
| 3 | 11.1 | 55.7 | 51 / 97 | 18 | 0 | 0 | 0 |
| 5 | 11.7 | 54.7 | 45 / 83 | 32 | 5 | 2 | 0 |
| 11 | 13.5 | 47.9 | 46 / 86 | 8 | 0 | 0 | 0 |
| Total | 12.3 mean | 52.2 mean | 46.4 mean / 155 worst | 167 | 21 | 5 | 2 seeds |

These are current-tree measurements, not the 2026-11-08 baseline. No production variant was retained, so there
is no valid after table.

## Current all-district baseline

`node tools/bench-traffic.mjs --seed <seed>`, same eight seeds and five-minute settings. Means are the
unweighted mean of the eight reported district rows; box counts are seed-districts with at least one box.

| District | mean km/h | stopped % | worst waitMax s | held >60 s | held >120 s | deadlocks | box-stuck seeds |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.4 | 33.1 | 137 | 29 | 3 | 2 | 3 |
| Łazarz | 13.9 | 25.9 | 40 | 0 | 0 | 0 | 0 |
| Centrum | 14.3 | 34.0 | 145 | 7 | 2 | 0 | 2 |
| Kaponiera | 12.3 | 52.2 | 155 | 167 | 21 | 5 | 2 |
| Stare Miasto | 18.2 | 6.6 | 85 | 2 | 0 | 0 | 0 |
| Rataje | 17.0 | 35.1 | 95 | 6 | 0 | 0 | 2 |
| Wilda | 15.9 | 35.0 | 63 | 1 | 0 | 0 | 0 |
| Total | 15.1 mean | 31.7 mean | 155 | 212 | 26 | 7 | 9 |

## Current car–tram overlap baseline

`node tools/audit-tram-overlaps.mjs --seed <seed>` for the same eight seeds, five minutes each, reports
74 pairs: seed 1 9, 4242 8, 7 9, 99 6, 2 12, 3 6, 5 14, 11 10. By district: Jeżyce 50, Centrum 13,
Kaponiera 8, Stare Miasto 3, and Łazarz, Rataje and Wilda 0 each. The task's historical figure was 54;
no production change was made and neither rejected trial has a comparable audit.

## Full test suite

`node --test tests/`: 493 passed, 2 failed (495 total). The traffic-flow test reports Centrum seed 1 held 145 s;
the tree-clearance audit fails with `Missing import stub: ./landmarks-stadium.js` in
`tools/audit-tree-clearance.mjs`. The test suite was run on unchanged production code.

## Re-measured at 5e6a68e

Same commands, five minutes, 15 fps, the eight seeds above, each seed one all-district
`node tools/bench-traffic.mjs --seed <seed> --json` run. Kaponiera has no pedestrian street, so `564975e` leaves its
rows identical to the table above (seed 1 still 13.2 km/h, 50.0 %, 44 / 118 s, 25 held > 60 s, none > 120 s, the
same 89 s car 62 / tram 6 cycle at `(-1503, 224)`, boxes at `(-1503, 224)` 92 s and `(-1468, 118)` 43 s). The longest
sampled hold over the eight seeds is 169 s (seed 2). The other districts moved:

| District | mean km/h | stopped % | worst waitMax s | held >60 s | held >120 s | deadlocks | box-stuck seeds |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.5 | 33.4 | 85 | 21 | 0 | 0 | 4 |
| Łazarz | 14.6 | 25.4 | 39 | 0 | 0 | 0 | 0 |
| Centrum | 14.2 | 34.5 | 113 | 13 | 0 | 0 | 0 |
| Kaponiera | 12.3 | 52.2 | 155 | 167 | 21 | 5 | 2 |
| Stare Miasto | 17.9 | 7.8 | 53 | 0 | 0 | 0 | 0 |
| Rataje | 17.0 | 35.1 | 95 | 6 | 0 | 0 | 2 |
| Wilda | 15.9 | 35.0 | 63 | 1 | 0 | 0 | 0 |
| Total | 15.2 mean | 31.9 mean | 155 | 208 | 21 | 5 | 8 |

Every remaining > 120 s hold and deadlock is in Kaponiera. Default seed 4242, all districts: 14.7 km/h, 34.8 %
stopped, worst wait 112 s, none held > 120 s, no deadlock (Kaponiera 13.7 km/h, 47.1 %, 112 s, 8 held > 60 s).

Centrum seed 1 (`--only centrum --seed 1 --dump`): 14.3 km/h, 34.3 % stopped, wait p90/max 26 / 113 s, 3 held > 60 s,
none > 120 s, no deadlock or box. The 145 s car 21 hold for room at `(-1048, 131)` is gone; the longest is now car 58,
112 s stopped for `room` on the west approach `(-1174, 136) → (-1136, 127)` (lane 2, at `(-1160, 142)`), with car 10
109 s behind it. The traffic-flow test's `longestHeld < 120` bound passes by 8 s.
