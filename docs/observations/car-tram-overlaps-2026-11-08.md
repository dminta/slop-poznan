# Short-link car–tram overlaps (2026-11-08)

The moving Kaponiera/Centrum pairs in the 2026-11-04 investigation are a commitment race on the short links around
Kaponiera and Św. Marcin: a car enters a 10 m link at 10–14 m/s before the tram's exit curve is reserved, cannot stop
on the link, and the >4 m/s `enter` fallback then drives it into the tram body. A second variant is a tram that stands
just before a curve while it waits for room: the curve is not reserved (a stopped tram keeps only its body), but the
tram can pull away while a car that is already on the link is crossing. Two changes remove both without the hold and
deadlock regressions of the earlier all-vehicle forecasts.

## Method

```
node tools/audit-tram-overlaps.mjs
node tools/bench-traffic.mjs
node --test tests/*.cjs
node --test tests/traffic-flow.test.mjs
```

Both tools use the default seed 4242, five simulated minutes at 15 fps and the first 20 s excluded. The audit pools
object IDs; a pair is the first contact in the run. The benchmark world omits several rendered details (see
[testing](../testing.md#cartram-body-overlap-audit)). `waitMax`, `held > 120 s` and `deadlocks` are the benchmark's
definitions from [the Kaponiera record](kaponiera-traffic-2026-11-08.md#method). These are trajectory-sensitive
single-seed proxies, and later trajectories in the run can move when one decision changes; the eight-seed totals in the
older records used the same tools with `--seed`.

## Baseline

| District | Pairs | First contacts |
|---|---:|---|
| Jeżyce | 3 | 19:21, 47:23, 47:13 (shared lanes, stopped) |
| Łazarz | 0 | — |
| Centrum | 0 | — |
| Kaponiera | 4 | 207:21 at (−1132, 121), car 6.8 m/s; 42:7 at (−1384, −212), car 10.3; 8:15 at (−1412, 73), car 1.2; 18:2 at (−1123, 143), car 3.2 |
| Stare Miasto | 2 | 43:23 at (285, −245), car 0.9; 3:21 at (−128, −278), car 5.5 |
| Rataje | 0 | — |
| Wilda | 0 | — |
| **Total** | **9** | |

Benchmark: 14.9 km/h mean, 34.5 % stopped, worst wait 120 s, no car held over 120 s and no deadlock. Kaponiera alone:
12.1 km/h, 52.5 % stopped, worst wait 120 s, 13 cars held over 60 s and none over 120 s.

## Traced mechanisms

- **Car 207 / tram 21, −1132, 121.** Car 207 waited on the 10 m signal link `e3116` for 21 s and then entered the
  45.9 m connector into `e6020`. Tram 21 stood 5.9 m before the conflict, waiting for `room`; because it was stopped,
  `occupyTrams` reserved only its body and the curve stayed free. The car crossed while the tram pulled away. The
  benchmark's restart gate covered only conflicts within 5 m, so the 5.9 m stand was outside it.
- **Car 42 / tram 7, −1384, −212.** Car 42 (a fire truck, 7.4 m body) entered the 10 m link `e7343` from the 42.4 m
  connector at 13.9 m/s. The exit curve `e7343 → e8174` was already held by tram 7. The car needed 32 m to stop, the
  link offered about 5 m, and `enter`'s speed ≥ 4 m/s fallback accepted the refused curve.
- **Car 18 / tram 2, −1123, 143.** Car 18 crossed into the 9.4 m link `e6034` at 10.2 m/s while the line 5 tram stood
  6.7 m before the `e6034 → e5684` curve, held by `car`. The car needed 17 m to stop and had about 6 m, so it was
  physically committed before its `v.commit` was set. The restart gate only counted cars that had committed.

## Fix

Both rules are general; no coordinate test was added.

1. **Short-link entry guard** (`js/traffic.js`, `shortLinkTramBlocked`). Before entering a link shorter than 12 m,
   `mayEnter` checks the link's exit moves. If the car's comfortable stopping distance
   `v² / 2b` exceeds the link's remaining room (`len − half − 0.5 m`) and the exit curve is held by a tram, or a tram is
   standing within `TRAM_SHORT_REACH` 20 m of it, the car is refused with `held: 'tram'`. A car that can stand on the
   link is unchanged (ordinary short-link storage), and buses keep their longer-body guard. The stand test
   (`tramStandsAt`) ignores a tram that is dwelling at a stop, held by a red or at a route end, skips the tram that is
   waiting for this car, and only counts the metres before the nose.
2. **Restart gate reach and physical commitment** (`js/trams.js`, `drive`). `ROAD_GATE_REACH` is 8 m instead of 5 m, so
   a tram stopped 5.9 m before a curve waits for a car already entering it. The gate also counts a car still on a short
   link that cannot stop before the curve (`unable`): `speed > 1` and `speed² > 2b(len − s − half)`, before `v.commit`
   is set. The gate keeps its existing exemptions: a car already waiting for a tram is not followed, and the tram sets
   `t.obstacle` so `heldByTram` lets that car go.

## Results

Same default commands:

| District | Pairs base → final | Remaining first contacts |
|---|---:|---|
| Jeżyce | 3 → 3 | 19:21 (same shared-lane touch), 24:5 at (−2155, −493), 44:13 at (−1874, −394) |
| Łazarz | 0 → 0 | — |
| Centrum | 0 → 1 | 58:11 at (−1128, 143), car stopped (0 m/s) |
| Kaponiera | 4 → 1 | 38:1 at (−1387, −216), car 7.6 m/s, held curve |
| Stare Miasto | 2 → 0 | — |
| Rataje | 0 → 0 | — |
| Wilda | 0 → 0 | — |
| **Total** | **9 → 5** | |

Benchmark, same run:

| Scope | Metric | Baseline | Final |
|---|---|---:|---:|
| All districts | mean km/h | 14.9 | 15.1 |
| All districts | stopped | 34.5 % | 33.5 % |
| All districts | worst wait | 120 s | 112 s |
| All districts | held > 120 s | 0 | 0 |
| All districts | deadlocks | 0 | 0 |
| Kaponiera | mean km/h | 12.1 | 12.8 |
| Kaponiera | stopped | 52.5 % | 49.2 % |
| Kaponiera | worst wait | 120 s | 112 s |
| Kaponiera | held > 60 s | 13 | 11 |
| Kaponiera | held > 120 s | 0 | 0 |
| Centrum | mean km/h | 13.6 | 14.5 |
| Centrum | worst wait | 77 s | 99 s |
| Centrum | held > 120 s | 0 | 0 |

Kaponiera improves on every hold count. Centrum's worst wait rises 77 → 99 s but stays below 120 s; its new pair is a
stopped car at the `e6034/e5684` crossing that was parked there by the shifted trajectories, not a new moving entry.
Stare Miasto loses both of its moving pairs (one of them a car at 5.5 m/s against a held curve).

## Rejected variants

Measured on the same default audit/benchmark:

- **Stand gate in every short-link `tramBlocks` call, or with a long connector stop.** Both remove the moving entries but
  Kaponiera's worst wait rose 120 → 191 s and cars held over 120 s 0 → 12, with 30 over 60 s; the long connector stop
  also added five Centrum pairs at (−985, −79). The gate is kept only at the short-link entry, and the tram side waits
  for a physically committed car instead of blocking approach traffic.
- **Short-link entry guard with a feeder two-step** (checking the next link from a 20 m feeder): the audit moved pairs
  around (Kaponiera 4 → 7 when used alone) without a hold benefit. Only the one-step link guard is in the code.
- **`enter` hard stop for every car on a short link.** The earlier measurements already rejected it; it is not revived
  here. The entry guard stops the car while there is still braking distance.

## What remains

- The 27 stopped first contacts from the eight-seed audit are shared-lane touches and close opposing lanes; this pass
  does not change lane geometry.
- The Kaponiera pair 38:1 at (−1387, −216) is the same race at the next link, where the car was already on the 10 m
  link when the curve was claimed; the entry guard cannot see it from the upstream approach. It is one moving pair
  against four before.
- The Centrum stopped pair at (−1128, 143) is trajectory noise from the shorter Kaponiera queue; no stopped car is left
  in a tram body by a new moving entry.
- `tools/audit-tram-opposing-lanes.mjs` is unchanged: 47 runs / 45 lanes / 417 m.

No browser check was run. The visible change is limited to cars waiting a few seconds longer before two Kaponiera short
links while a tram crosses; it still needs a look at the rendered tram/car spacing on WebGPU and WebGL2.
