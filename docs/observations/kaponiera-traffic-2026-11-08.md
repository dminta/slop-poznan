# Rondo Kaponiera short-link queues, 2026-11-08

Kaponiera's remaining long holds after the 2026-11-07 short-link work were a lane-storage problem in the 10 m
give-way exit at `(-1497, 198)` and a queue that backed from that exit through the 20.7 m approach into the junction
box at `(-1490, 170)`. Two changes in `js/traffic.js` remove both without touching signal plans or adding a protected
movement. The 8-seed Kaponiera benchmark moves cars held over 120 s from 25 to 7, removes the two deadlocks and clears
the `(-1490, 170)` box; the 7-district run moves the held-over-120 total 28 → 12 and deadlocks 2 → 0, with Rataje the
one district that adds two holds.

## Method

```
node tools/bench-traffic.mjs --only kaponiera --minutes 5 --seed <1|4242|7|99|2|3|5|11> --json /tmp/kaponiera-<seed>.json
node tools/bench-traffic.mjs --minutes 5 --seed <same eight> --json /tmp/all-<seed>.json
node tools/audit-tram-overlaps.mjs
```

Five simulated minutes at 15 fps, first 20 s excluded, cars within 300 m sampled once per simulated second, tram
seed 1922. The per-district runs are the reproducible Kaponiera tables; the all-district runs are one world build per
process, so their district rows can differ from a `--only` run of the same seed (the shared building-collider build
consumes the random stream before the first district's reset). Both sides of every comparison use the same command.
`tools/bench-traffic.mjs` defines `waitMax` as the longest finished wait among sampled cars, `held > 120 s` as sampled
cars that stood over 120 s at once, and box-stuck as a car whose body centre is past the stop line and still stopped
after 20 s.

## Baseline

Per-district Kaponiera, 8 seeds, 5 min (the `--only` command):

| Seed | mean km/h | stopped | wait p90 | waitMax | held > 120 s | deadlocks |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 12.6 | 50.9% | 43 | 126 | 1 | 0 |
| 4242 | 12.1 | 53.6% | 55 | 195 | 1 | 1 |
| 7 | 12.3 | 51.5% | 47 | 67 | 0 | 0 |
| 99 | 12.5 | 51.9% | 50 | 125 | 1 | 0 |
| 2 | 11.1 | 56.7% | 50 | 192 | 15 | 0 |
| 3 | 11.8 | 52.9% | 49 | 139 | 4 | 0 |
| 5 | 10.8 | 57.0% | 52 | 120 | 0 | 1 |
| 11 | 12.1 | 53.3% | 51 | 126 | 3 | 0 |
| **sum / mean** | **11.9** | **53.5%** | **49.6** | **195** | **25** | **2** |

All eight seeds had a junction box with a car stopped inside for over 20 s, almost always `(-1490, 170)` (51 s on seed
4242, 57 s on seed 7). The give-way at `(-1497, 198)` was the worst junction on most seeds: 87–95% of its stopped
car-seconds had `waitReason 'merge'` and its maximum wait was 80–192 s.

## Mechanism

The road graph maps the three lanes of the 20.7 m approach `e5709` into the 10 m exit `e2089` as `[0, 1, 1]`. Two
approach lanes therefore feed lane 1, which is also the right-turn lane into `e6666`; lane 0, straight-only into
`e7790`, is fed only from approach lane 0 and stayed empty in every trace. The 10 m link itself stores one car per
lane. At the far signal `(-1503, 224)` group 1 (the north and west approaches) gets 10 s of a 60 s cycle because the
wide group-0 crossing sets `min0` to 40 s, so the exit releases roughly one car per lane per minute. A whole approach
lane queued behind that one storage slot.

The 20.7 m approach and the 17.2 m link above it then filled behind the merge. A car that entered the approach while
the exit was momentarily clear could not leave when the queue ahead stopped, and stood in the `(-1490, 170)` connector
(`v.conn`, `v.cs > 0`) for 51–57 s. The signal at `(-1494, 109)` showed the same shape one junction north: the 10 m
links `e2985`/`e5706` filled from the 10 s/20 s downstream greens at `(-1438, 115)` and `(-1486, 53)` and blocked the
junction's own green.

## Fix

Both rules are general; no coordinate test was added.

1. **A short link uses a free sibling lane.** `shortLinkLane()` runs in `mayEnter` for an uncommitted car entering an
   edge under 12 m whose far end is a signal, and only when the planned lane's front car is already stopped for that
   signal (`speed < 0.5`, `held 'signal'`). If the lane is physically full, it takes another lane of the same edge,
   provided the lane can make the car's current turn and every movement it offers is also offered from the planned
   lane. The second test is what keeps a car out of a left-turn-only sibling: at Kaponiera 230 that lane crosses the
   tram tracks, and the unrestricted variant produced 89 s tram switch waits. The chosen lane is stored in
   `v.outEdge`, and `room`/`mergingAhead` read it instead of `move.out`, so the exit reservation and merge braking see
   the slot the car really takes. `accelerate` and `enter` use `v.out` for the same reason.
2. **A give-way feeder does not stop in the junction behind its short exit.** For an edge of 20 m or more whose next
   edge is a short link into a signal, `room` measures only the space behind the rearmost car, not the sum of all gaps.
   The old rule did this only for a car that could no longer stop and only between two signals. It now also covers a
   stoppable car at an unsignalised feeder, but only while the rearmost car is stopped (< 1 m/s): a moving queue can
   still be followed into the feeder. Buses keep the old estimate.

## Results

Kaponiera, same 8 seeds and command:

| Seed | mean km/h | stopped | wait p90 | waitMax | held > 120 s | deadlocks |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 12.4 | 53.1% | 52 | 139 | 5 | 0 |
| 4242 | 12.1 | 52.5% | 49 | 120 | 0 | 0 |
| 7 | 12.8 | 50.2% | 44 | 72 | 0 | 0 |
| 99 | 13.0 | 50.4% | 43 | 119 | 0 | 0 |
| 2 | 12.2 | 52.4% | 50 | 125 | 1 | 0 |
| 3 | 11.1 | 55.9% | 53 | 129 | 1 | 0 |
| 5 | 13.2 | 48.2% | 45 | 113 | 0 | 0 |
| 11 | 11.8 | 52.9% | 50 | 114 | 0 | 0 |
| **sum / mean** | **12.3** | **52.0%** | **48.3** | **139** | **7** | **0** |

Mean speed rises 11.9 → 12.3 km/h, stopped time falls 53.5% → 52.0%, the worst wait falls 195 → 139 s, held over 120 s
falls 25 → 7 and both deadlocks are gone. The `(-1490, 170)` box stop is gone on every seed; the one remaining box
report is the known `(-1468, 118)` tram link (seed 3, 47 s), which is not part of this change. Seed 1 is the one hold
regression (1 → 5 cars, longest 139 s against 126 s); seeds 2 and 3 keep one each and the other five seeds none. The
slower seeds still have a lower ceiling than the old 195 s.

## All districts

Seven districts, 8 seeds, 5 min, one world per process (base is this branch at `9fe6cf3`). Values are the 8-seed sum for
the counts and the 8-seed mean for speed and stopped; `waitMax` is the worst single seed. Box-stuck counts junction
seed-pairs, not seconds.

| District | mean km/h | stopped | waitMax | held > 60 s | held > 120 s | deadlocks | box-stuck seeds |
|---|---|---|---|---|---|---|---|
| Jeżyce | 14.4 → 14.4 | 33.5 → 33.5% | 143 → 143 | 24 → 24 | 3 → 3 | 0 → 0 | 0 → 0 |
| Łazarz | 13.7 → 13.7 | 28.4 → 28.4% | 38 → 38 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Centrum | 14.2 → 14.4 | 33.7 → 33.4% | 89 → 95 | 6 → 12 | 0 → 0 | 0 → 0 | 0 → 0 |
| Kaponiera | 11.9 → 12.3 | 53.5 → 51.9% | 195 → 139 | 156 → 122 | 25 → 7 | 2 → 0 | 8 → 1 |
| Stare Miasto | 17.8 → 17.6 | 8.4 → 8.5% | 52 → 38 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Rataje | 16.8 → 17.5 | 35.4 → 34.1% | 95 → 103 | 6 → 14 | 0 → 2 | 0 → 0 | 5 → 4 |
| Wilda | 17.0 → 17.0 | 32.1 → 32.1% | 42 → 42 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| **total** | **15.1 → 15.3** | **32.1 → 31.7%** | **195 → 143** | **192 → 172** | **28 → 12** | **2 → 0** | **13 → 5** |

Jeżyce, Wilda and Łazarz are bit-identical on this run; Stare Miasto's worst wait falls 52 → 38 s. Centrum is slightly
slower at the tail (max 89 → 95 s, held > 60 s 6 → 12, no car over 120 s). Rataje is the one district that adds long
holds (0 → 2 at seed 99, max 95 → 103 s) while its mean rises 16.8 → 17.5 km/h; it is outside the Kaponiera work and
the change only reads the general short-link/lane tests, but it is reported rather than hidden. The whole hold and
deadlock reduction comes from Kaponiera.


## Tests and audits

The three regression tests are in `tests/traffic-regressions.test.cjs`: the sibling-lane movement test, the stopped
rear car at a give-way feeder, and the `v.outEdge` reservation. `tests/traffic.test.cjs` updates the feeder test for
the give-way extension. The full `node --test tests/*.cjs` suite passes.

`node tools/audit-tram-overlaps.mjs` (5 min, seed 4242) moves from 6 to 9 pairs: Jeżyce 3 → 3, Centrum 1 → 0,
Stare Miasto 2 → 2, Rataje 0 → 0 and Kaponiera 0 → 4. Two of the Kaponiera pairs are moving cars (6.8 and 10.3 m/s)
against a tram curve — the known commitment race, now reached more often because the short links discharge more cars;
one is a stopped car (1.2 m/s) outside a connector and one is a car already turning. No pair is a stopped car left
inside a tram body and no car–tram cycle appears. The audit is a single-seed proxy and its pair count moves with the
traffic trajectories; it is reported here rather than hidden.

## Rejected variants

- **Sibling lane without the movement-subset test.** It filled the left-turn lane at `(-1438, 115)`; two trams then
  waited 89 s at their switches and Kaponiera seed 4242 had 9 cars over 120 s.
- **Sibling lane for every short link, or without the stopped-front test.** Allowing it on links that are not storing
  for a signal brought back the Jeżyce seed 7 car–tram cycle at `(-2023, -448)` and raised the audit to 13 pairs;
  switching behind a moving front also added pairs without a storage benefit.
- **Rear-gap rule for every feeder and every car.** It cut the merge's throughput: seed 3 gained a deadlock and
  Kaponiera held over 120 s rose to 11 across the 8 seeds.
- **Excluding buses from the sibling lane.** The bus-only difference flipped seed 4242 from no long hold to three
  (80 → 166 s) without changing the physical argument: `room`/`alongside` already check the chosen lane for a bus.
