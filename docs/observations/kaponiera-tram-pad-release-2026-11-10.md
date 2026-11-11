# Kaponiera tram-pad release, 2026-11-10

The last Kaponiera deadlock at `8c41595` was not the tram → car → own-proxy cycle that `6d70c71`'s queued
release broke. It was a car that could not enter a short exit because the tram's *crossing pad* held the exit lane's
mouth, while the tram itself was stopped because the car's front corner was inside the tram's body band. One rule in
`js/traffic.js` (`proxyYieldsTo`, used by `room` and `alongside`) breaks the circle: a tram stopped for that car yields
its own pad, so the car goes first. Seed 5's 70 s deadlock and its two holds over 120 s are gone; the other seven
seeds are bit-identical. The remaining holds are a capacity queue behind a 10 s green (seed 2) and a tram switch jam
(seed 7).

## Method

```
node tools/bench-traffic.mjs --only kaponiera --seed <1|4242|7|99|2|3|5|11> --json <file>
node tools/bench-traffic.mjs --only kaponiera --seed 5 --trace -1468,118 --trace-min 20
node tools/bench-traffic.mjs --seed <same eight> --json <file>
node tools/audit-tram-overlaps.mjs --seed <same eight>
```

Five simulated minutes at 15 fps, first 20 s excluded, cars within 300 m sampled once per second. A scratch probe
(`.agent-task/probe.mjs`) read the occupancy lists, the tram path runs and the `room` terms behind the trace.

## Root cause

At `(-1468, 118)` the 10 m approach from `(-1494, 109)` (3 lanes) merges into the 10 m exit to `(-1438, 115)`
(far end signalised). Tram 13's track crosses the exit lane 0 at its mouth: the mapped run is a 1 m crossing at
track `s 3.5..4.5`, padded by 2.4 m either side, so the proxy occupies lane `s -2.1..2.7`. The lane is 10 m long; a
car at the downstream line sits at `s 7.3` (body `5.2..9.4`).

Seed 5, `--trace -1468,118 --trace-min 20`:

- from t≈228 car 66 stands in approach lane 0 at `s 7.3` (`waitReason room`, `held room`). Exit lane 0 holds the
  tram proxy at `s 0.3` and car 78 stopped for the signal at `s 7.3`; lane 1 holds car 49 at `s 7.3`. `room` charges
  the proxy `2 × 2.4 + 3.0 = 7.8 m` of the 10 m lane, so no slot exists even after the signal releases the two cars.
- tram 13 comes down the crossing and stops at `(-1456, 98)`, front `(-1466, 110.2)`, `obstacle #66`. The nearest
  swept point `(-1468.7, 115.5)` is 0.53 m from car 66's front-left corner, inside the tram's 1.2 m half width:
  the tram body would clip the corner if it moved. The tram cannot pass, and its `stuck` reaches 70 s at t=300; the
  benchmark reports the two-vehicle cycle and a 126 s sampled hold.
- the geometry is a genuine circular wait: the car cannot advance into the exit (the tram body is about to cross its
  mouth, and its own pad says so), and the tram cannot advance (the car's front corner is in its body band). A
  stopped car cannot back out, so nothing in the car-following model could resolve it.

The same shape as the accepted queued release: the tram is *already* waiting for the car, and the tram's own sweep
keeps it stationary until the car clears. The car, not the tram, should go first.

## Rule

`proxyYieldsTo(o, v, f)` in `js/traffic.js` returns true only when all of these hold:

- `o` is a tram lane proxy (`o.tram`);
- that tram's `obstacle` is this car `v` (it is stopped for the car's body, not for anything else);
- the tram stands (`speed < 0.1`) and has been stuck at least `PROXY_RELEASE_WAIT` 20 s;
- the car has itself stood at least 20 s (`v.wait`), so a car that just arrived at the line keeps the old rule;
- the lane is long enough for the car's rear to clear the pad even when empty
  (`f.len - 2 v.half >= o.s + o.half + 0.5`);
- and, at `room`'s return, the free length left behind the lane's real occupants and their reservations, minus the
  car's length, is still past the pad end (`free - 2 v.half >= padEnd`). The empty-link test alone is not enough: a
  12 m exit with one stopped 4.2 m car gives `free = 11 - 6.2 = 4.8`, which passes the usual 4.7 m test, but the
  queue-from-the-line rear would be 0.6 m, inside a pad ending at 2.7 m. The review round added this second test.

So the car cannot stop on the track it crossed, including behind a real queue in the same lane.

`room` then does not count that proxy as an occupant and `alongside` does not treat it as a body the car would come
alongside. Every other check still applies: the real queue in the lane, `mergingAhead`, `tramBlocks`, the signal and
the crossing. The tram is not released in return: its ordinary swept-obstacle test keeps it stopped until the car's
rectangle is 1.35 m clear of its path, and the pad disappears as the car occupies the lane.

Rejected variants:

- **No wait terms** (any tram stopped for the car): fired once in seed 99 for a car that had just reached the line
  (`v.wait 0`), and the changed trajectory left an unrelated bus held 124 s at `(-1503, 224)` plus a 25 s box stop.
  Adding `t.stuck >= 20 && v.wait >= 20` keeps the release to the real cycle.
- **Room only, not `alongside`**: the car stayed refused by `alongside` for the same pad (`vs -3.3`, pad rear
  `-2.1`), so `room` alone changed nothing.
- **Counting the room behind the pad instead of ignoring it**: the mouth is the pad; a car standing "behind" it is
  still in the tram's path, and the handover needs the car past the pad (rejected in the earlier round as well).

## Results

Kaponiera, 8 seeds, `--only kaponiera`, 5 min (base `8c41595` → this change). `held` is the sampled count; `longest`
is the longest sampled hold.

| Seed | km/h | stopped % | wait p90 | wait max | held > 60 s | held > 120 s | longest hold | deadlocks | box-stuck |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13.6 → 13.6 | 48.3 → 48.3 | 44 → 44 | 118 → 118 | 16 → 16 | 0 → 0 | 118 → 118 | 0 → 0 | 2 → 2 |
| 4242 | 13.7 → 13.7 | 47.1 → 47.1 | 44 → 44 | 112 → 112 | 8 → 8 | 0 → 0 | 111 → 111 | 0 → 0 | 0 → 0 |
| 7 | 13.6 → 13.6 | 47.7 → 47.7 | 47 → 47 | 140 → 140 | 9 → 9 | 1 → 1 | 139 → 139 | 0 → 0 | 0 → 0 |
| 99 | 12.1 → 12.1 | 52.8 → 52.8 | 43 → 43 | 89 → 89 | 16 → 16 | 0 → 0 | 119 → 119 | 0 → 0 | 0 → 0 |
| 2 | 11.3 → 11.3 | 56.0 → 56.0 | 50 → 50 | 145 → 145 | 27 → 27 | 10 → 10 | 169 → 169 | 0 → 0 | 0 → 0 |
| 3 | 11.1 → 11.1 | 55.7 → 55.7 | 51 → 51 | 97 → 97 | 18 → 18 | 0 → 0 | 115 → 115 | 0 → 0 | 0 → 0 |
| 5 | 11.7 → **11.8** | 54.6 → **53.8** | 51 → 52 | 121 → 121 | 31 → **28** | 2 → **0** | 126 → **120** | 1 → **0** | 0 → 0 |
| 11 | 13.5 → 13.5 | 47.9 → 47.9 | 46 → 46 | 86 → 86 | 8 → 8 | 0 → 0 | 85 → 85 | 0 → 0 | 0 → 0 |
| **total / mean** | **12.6 → 12.6** | **51.3 → 51.2** | 47.0 → 47.1 | 145 → 145 | **133 → 130** | **13 → 11** | 169 → 169 | **1 → 0** | 2 boxes (seed 1) → 2 boxes (seed 1) |

The seven other seeds are bit-identical (the whole `--json` rows are equal, not just the rounded fields); only seed 5
diverges. That is the strongest regression check available for this change. Re-measured after the review's return
test (real queue behind the pad): seed 5 keeps the same row (11.8 km/h, 53.8 %, held > 120 s 0, deadlocks 0), and
seeds 99, 2 and 7 are byte-identical again.

## Remaining cases

- **Seed 2, 10 holds > 120 s** stays. Trace `--trace -1497,198 --trace-min 100`: the give-way `(-1497, 198)` has 6
  approach cars (3 lanes, 20.7 m) in a permanent queue behind a 10 m, 2-lane exit; the exit's far signal
  `(-1503, 224)` has `cycle 60, green0 40, green1 10`. `green0` is `min0 = ceil(width0 + 2) = 40`, the 38 m group-0
  pedestrian crossing at 1 m/s; `green1 = cycle - green0 - 10 = 10`. The link stores one car per lane per cycle, the
  give-way passes 12 cars in 5 min (2.4 / min) while the 3-lane approach refills. The queue is demand against a
  fixed 10 s green, not a wait-for cycle or a lost slot; shortening `green0` would strand walkers mid-crossing.
  The lead car's delay is structural, and the rear car waits two or three cycles (169 s). No car-following rule
  should fix it; widening the link or re-timing the signal is outside this task.
- **Seed 7, one 139 s hold** stays. Trace `--trace -1496,82 --trace-min 100`: car 16 waits `tram` at the give-way
  exit whose three lane mouths carry tram 18/20 proxies for 139 s. Tram 20 is `stop` → `switch` at `(-1488, 85)` for
  the seed's 81 s switch wait; the car waits for the tram queue, not for a car rule. It is the tram-switch backlog in
  [the tram edge record](tram-edge-jams-2026-11-04.md), not a Kaponiera car cycle.
- Seed 1's two box stops at `(-1468, 118)`/`(-1503, 224)` and the audit pairs are unchanged.

## All districts

Eight all-district runs (`node tools/bench-traffic.mjs --seed <seed> --json <file>`), 7 districts × 5 min each,
base `8c41595` → this change. Values are the 8-seed mean for speed and stopped, the worst single seed for `waitMax`,
and the 8-seed sum for the counts; box-stuck counts seeds with at least one junction box, not boxes.

| District | km/h | stopped % | worst wait | held > 60 s | held > 120 s | deadlocks | box-stuck seeds |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.7 → 14.7 | 32.8 → 32.8 | 85 → 85 | 15 → 15 | 0 → 0 | 0 → 0 | 4 → 4 |
| Łazarz | 14.6 → 14.6 | 25.4 → 25.4 | 39 → 39 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Centrum | 14.5 → 14.5 | 33.6 → 33.6 | 87 → 87 | 9 → 9 | 0 → 0 | 0 → 0 | 0 → 0 |
| Kaponiera | 12.6 → 12.6 | 51.3 → 51.2 | 145 → 145 | 133 → 130 | 13 → **11** | 1 → **0** | 1 → 1 |
| Stare Miasto | 18.0 → 18.0 | 7.2 → 7.2 | 37 → 37 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Rataje | 17.0 → 17.0 | 35.1 → 35.1 | 95 → 95 | 6 → 6 | 0 → 0 | 0 → 0 | 2 → 2 |
| Wilda | 15.9 → 15.9 | 35.0 → 35.0 | 63 → 63 | 1 → 1 | 0 → 0 | 0 → 0 | 0 → 0 |
| **total** | **15.3 → 15.3** | **31.5 → 31.5** | **145 → 145** | **164 → 161** | **13 → 11** | **1 → 0** | **7 → 7** |

The six other districts are bit-identical on all eight seeds, not merely within the accepted 0.2 km/h: their
8 all-district JSON rows are byte-equal. The instrumentation run showed a single release point in seed 5
(`t=250, car 66 / tram 13`) and none in seed 99 once the two 20 s gates were in place.

## Overlap audit

`node tools/audit-tram-overlaps.mjs --seed <seed>`, same eight seeds and five minutes: **36** pairs total
(Jeżyce 21, Kaponiera 9, Stare Miasto 5, Centrum 1; Łazarz, Rataje and Wilda 0), exactly the 36 of the base record
and not above it. Seed 5's audit is 8 pairs, unchanged by the release (its car 66 crosses in front of a *stationary*
tram 13, whose nose is still several metres back; the tram's own sweep keeps it stopped until the car is
1.35 m clear of the path); re-measured after the review's return test: the same 8 (Jeżyce 5, Centrum 1, Kaponiera 2).
Per seed: 1 → 5, 4242 → 5, 7 → 3, 99 → 3, 2 → 5, 3 → 3, 5 → 8, 11 → 4.

## Tests

`tests/traffic-regressions.test.cjs` adds "a tram stopped for a car yields its own crossing pad in the car's exit
lane": the release, the 20 s terms on both sides, the wrong-obstacle case, a moving tram, a real car queued so the pad
is not clearable, and a lane too short to hold the car clear of the pad. It slices `proxyYieldsTo` next to `room` and
`alongside`, so keep those two call sites and their free variables if the functions are reorganised.

`node --test tests/`: **501 passed, 0 failed** (501 tests, 150 s), including `tests/traffic-flow.test.mjs` ("traffic
flows at Jeżyce and Centrum: no deadlock, nobody held over 2 minutes" and the seed-4242 Jeżyce overlap bound).
