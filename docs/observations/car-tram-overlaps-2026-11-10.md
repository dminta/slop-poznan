# Car–tram overlap diagnosis (2026-11-10)

> Measured at `42329c3`, before `564975e` (length-weighted pedestrian street spawns, which reshuffles seeded draws in
> districts with pedestrian streets) and `5e6a68e`. [Re-measured at `5e6a68e`](#re-measured-at-5e6a68e) below.

The checkout at `42329c3` is a different world from the 2026-11-09 record: the seed-4242 Jeżyce benchmark already has a 131 s maximum wait, one vehicle held over 120 s and one deadlock. Its overlap audit finds three pairs, not five. The deadlock is the car in the box and tram 2 at (−2023, −448), not caused by the experiment below. Do not compare its trajectories to the earlier world as if the network were unchanged.

Method: `tools/audit-tram-overlaps.mjs` and `tools/bench-traffic.mjs`, five minutes at 15 fps, 20 s warmup, the benchmark world and pooled pair IDs as described in [testing](../testing.md#cartram-body-overlap-audit). Instrumented copies of the audit added lane and section positions at first contact; they did not change update order. Body rectangles include an articulated bus as one 18 m rectangle, rather than its rendered articulated shape.

## Traces

Seed 2 has eight Jeżyce pairs. Four stopped articulated buses (203:21, 208:23, 211:17, 205:1) are on the 25.97 m connector out of 10 m edge 2595, lane 0, with connector positions 17.42–23.18 m; their half-length is 9 m. They are following the very tram they touch (the recorded proxy gap ranges from −3.93 to 1.82 m). Tram front speeds are 3.6–4.3 m/s and the overlapping sections are on the turn. A fifth stopped car (6:17) is on edge 4660, lane 0, 7.06 m along its 10 m edge, with a 0.3 m tram-proxy gap, as the turning tram's section reaches it. This is a queue occupying the turning body's envelope; the sampled positions do not establish that simply moving the stop line will clear the whole connector. The other three seed-2 pairs are moving cars, including two following almost stopped trams on straight shared lanes.

Seed 4242's three pairs are all on the 132.2 m edge 4692, lane 0, at 29.73, 53.25 and 87.93 m. The cars move 1.9–9.4 m/s behind nearly stopped trams waiting for cars; the first two report a 36 m gap to another leader and no tram proxy as leader. These are rear approaches on a shared straight lane, not stopped vehicles at a junction line. The tram's proxy can be discarded for the entire mapped stretch when its obstacle intersects that stretch.

## Rejected experiment

For a same-direction mapped stretch only, retain the tram proxy behind the obstacle by clipping its end just behind that vehicle, instead of dropping the whole proxy; preserve the old exemption for crossing and opposing stretches. The default Jeżyce audit falls from three pairs / 1,037 pair-frames to zero / zero, but the benchmark mean falls 13.5 → 12.9 km/h and stopped share rises 35.1 → 38.1%. The maximum wait remains 131 s, held >120 s remains one and the same deadlock remains. This fails the no-flow-regression requirement and was reverted. No eight-seed variant or full variant benchmark was run after this disqualifying result; it should not be represented as a successful fix.

The clean seed-4242 benchmark's all-district mean is 14.9 km/h, stopped 33.5%, maximum wait 131 s, one held over 120 s and one deadlock. Kaponiera is 13.7 km/h, 47.1% stopped, maximum wait 112 s, eight held over 60 s and none over 120 s. These are the unchanged before/after values because the only experiment was reverted.

The full `node --test tests/` run on the unchanged production code reports 493 passed and two failed: the seed-1 Centrum flow test sees a 145 s hold, and the tree-clearance audit cannot load `./landmarks-stadium.js` because its harness lacks an import stub. These are separate existing checkout failures, not failures introduced by the reverted experiment.

## Current audit baseline

Seeds 1, 4242, 7, 99, 2, 3, 5 and 11, all seven districts. Moving means first-contact car speed ≥ 1 m/s; the remaining pairs are stopped or slow. The Jeżyce rows were collected before the experiment, the other districts after its reversion, with unchanged production code in both cases.

| District | Default seed pairs | Eight-seed pairs | Moving | Stopped/slow |
|---|---:|---:|---:|---:|
| Jeżyce | 3 | 50 | 28 | 22 |
| Łazarz | 0 | 0 | 0 | 0 |
| Centrum | 4 | 13 | 12 | 1 |
| Kaponiera | 1 | 8 | 6 | 2 |
| Stare Miasto | 0 | 3 | 3 | 0 |
| Rataje | 0 | 0 | 0 | 0 |
| Wilda | 0 | 0 | 0 | 0 |
| **Total** | **8** | **74** | **49** | **25** |

These are also the final values: the candidate was reverted and no production behavior was retained.

## Re-measured at 5e6a68e

`node tools/audit-tram-overlaps.mjs --seed <seed>`, same eight seeds and settings: **73 pairs**, 53 moving and
20 stopped/slow. Per seed: 1 6, 4242 10, 7 12, 99 4, 2 8, 3 15, 5 11, 11 7. The traces above were taken at `42329c3`;
`564975e` reshuffles the Jeżyce, Centrum and Stare Miasto draws, so the same contacts are not guaranteed to recur.

| District | Default seed pairs | Eight-seed pairs | Moving | Stopped/slow |
|---|---:|---:|---:|---:|
| Jeżyce | 5 | 47 | 30 | 17 |
| Łazarz | 0 | 0 | 0 | 0 |
| Centrum | 2 | 11 | 10 | 1 |
| Kaponiera | 1 | 8 | 6 | 2 |
| Stare Miasto | 2 | 7 | 7 | 0 |
| Rataje | 0 | 0 | 0 | 0 |
| Wilda | 0 | 0 | 0 | 0 |
| **Total** | **10** | **73** | **53** | **20** |

`node tools/audit-tram-opposing-lanes.mjs` is unchanged by the layout restore: 40 runs / 38 lanes / 293 m
(`--all` 55 / 51 / 498).
