# Jeżyce car–tram follow-up (2026-11-15b)

HEAD `78c2bb4` includes the user-accepted Kaponiera offset commit `e3ba722`. No game code is retained from this
investigation, and no commit is made. Both geometry-based harness variants below fail the required per-seed flow
bound. The task's fallback therefore applies: keep the simulation unchanged and document the rejected variants.

## Method and fresh baseline

Re-ran both commands for every seed `1, 2, 3, 5, 7, 11, 99, 4242`, each across all seven districts:

```sh
node tools/audit-tram-overlaps.mjs --seed S
node tools/bench-traffic.mjs --seed S --json .agent-task/jezyce-15b/baseline-bench-S.json
```

Defaults: five simulated minutes, 15 fps, 20 s warmup. Each process builds districts in the normal order; the
building-collider RNG consumption and update order are preserved. Raw outputs, instrumented replay scripts,
variant source copies and a merged `baseline-summary.json` are in `.agent-task/jezyce-15b/`.
The benchmark omissions, pooled pair IDs, discrete section rectangles and rigid articulated-bus audit rectangle
retain the limitations in [testing](../testing.md#cartram-body-overlap-audit). This is not a browser collision proof.

The complete sweep **reproduces 28 pairs**: Jeżyce 16, Kaponiera 7, Centrum 2, Rataje 2, Stare Miasto 1,
Łazarz/Wilda 0. First-contact speeds classify 11 as moving above 1 m/s, 17 as stopped below 0.5 m/s.
There are **0 baseline deadlocks** and **4 existing holds over 120 s**, all at Kaponiera: seed 7 has 2
(longest 123 s), seed 99 has 1 (129 s), seed 4242 has 1 (137 s). These are existing same-seed baseline holds.
Early differences from the older observation's per-seed rows do not change the task's aggregate baseline, which
matches after all eight seeds finish. The independent instrumented seed-2 replay reproduces 3 pairs / 488 frames.

## Trace: 4660 unsafe storage

The geometry is still the documented 10 m stop-line span on `4660`; the section-sweep audit requires 24.75 m
retreat to clear its turning envelope. Ordinary braking room cannot establish that a stored body is safe.
No coordinate-specific setback or lane offset is tested.

Seed 2, car 19 / tram 21:

- At 95 s the car is on `2595 -> 4660`, connector coordinate 17.33 m, speed 11.19 m/s, already committed.
  Tram 21 is stopped for car 2 at front position (−2042.37, −430.22); its forecast is released while held for a car.
- At 96 s the car reaches `4660`, s=2.98 m, speed 10.44 m/s, planned straight exit `7652`.
  It is refused for `room` at that exit. At 97 s it is stationary at s=7.77 m, nose at the far stop line.
- It waits for `room` through 105 s, `box` through 112 s, `crossing` at 113 s, then `tram` from 114 s.
  Upstream `room(f, ...)` tested the stub's storage, not its downstream exit. `shortLinkTramBlocked` is a
  dynamic braking/held-next-curve check, not a permanent keep-clear test of the standing section envelope.
- Tram 21 restarts when car 2 clears. At 120 s its front is (−2043.93, −452.31), speed 2.63 m/s;
  its obstacle is car 31, not stationary car 19. At 121.60 s tram section 0 overlaps car 19.
- `obstacleGap` exempts oncoming cars (heading dot below −0.5). Opposing mappings of `4660` exist on
  tram edges 748/764; the turning tram's corridor crosses the stored body. Curve refusal and subsequently a lane
  proxy hold the car in place, rather than moving its unsafe waiting position. At 125 s the car follows proxy 21;
  at 130 s it is again refused for `tram`, at the same s=7.77 m.

This is a car stored before the tram moves into it, not just a fast car missing an entry gate. The tram may be
stopped for another car for many seconds before it resumes, so testing only a currently held next curve cannot
prove storage safe. Preserve `tramStandsAt`'s exemption for the tram waiting for this very car.

## Trace: bus 8947 -> 4659

Seed 5, bus 205 / tram 13 first contacts at 161.067 s, cs=−7.64 m, speed 6.02 m/s, `commit` set,
`dl=0`, half-length 9 m and half-width 1.30 m. A negative connector coordinate is expected: `enter` begins when
the front bumper reaches the line. The bus was admitted before its centre entered the connector.

The nearest opposing track (`te 55`) is about 2.45 m from the connector centre. `mapTramsToRoads` maps junction
curves with `gap - 0.1 = 2.2 m`, sufficient for car half-width 0.92 m plus tram 1.2 m, but not bus 1.3 m plus
tram 1.2 m. Thus `tramBlocks` has no matching opposing-track reservation for this graze; the existing connector
conflict seen in the trace does not hold this tram at entry. The ordinary tram obstacle sweep also exempts
oncoming traffic. Reintroducing the rejected broad `busOnly` reservations would change a different admission
problem and has already produced Jeżyce deadlocks.

A section-aware replay checks the actual articulated front rectangle (half-length 5.2 m) and production trailer
pose (half-length 3.4 m), both half-width 1.3 m, against every tram section. During the 47 rigid-overlap frames
from 161.067–164.333 s, the front really overlaps for 29 frames, first at **161.733 s**; the trailer overlaps for
13 frames, first at **163.200 s** (these counts can overlap in time). The initial rigid-body false positive does
not explain away the encounter. This probe counts real section contacts within the rigid-contact episode;
it is not a replacement city-wide section-aware bus audit.

## Rejected variants

All experiments use copied `bench-world.mjs` fixtures and copied traffic/tram sources under `.agent-task/jezyce-15b/`.
Production sources stay unchanged throughout, including while the baseline processes run. Screening uses Jeżyce
alone, the first district in the full command, preserving its RNG history. Once a row fails a mandatory bound,
further full-district acceptance runs are unnecessary; none of these partial screens is claimed as acceptance.

### A: let a short opposing-run car clear

Geometric distinction from sustained contraflow: allow the tram obstacle sweep to see a stopped oncoming vehicle
only on an edge under 12 m, outside a connector, when its planned outgoing lane has no opposing mapping on the
tram's remaining path. The ordinary obstacle exemption and proxy release could then let the car leave the short
opposing run. This does not change `tramStandsAt`, add a feeder cap, or retry broad next-curve stand tests.

Seed 2 pairs fall 3 → 2, but contacts become moving connector entries: 19:21 at 123.5 s (3.7 m/s) and 41:17 at
293.1 s (3.4 m/s). Releasing the car while the tram has already approached does not ensure their whole bodies
clear each other. Mean speed falls **15.1 → 14.0 km/h**, beyond 0.1 km/h. Rejected.

### B: steer outward within connector curb allowance

Precompute minimum left-side distance from straight, single-lane connectors to opposing tram segments, sampling
at 0.5 m. If a vehicle needs an outward displacement to preserve its half-width plus the 1.3 m tram margin,
and the minimum approach/exit right-hand curb allowance accommodates it, use that as its lateral steering
target before and through the connector. No bus-only conflict, signal timing or road coordinate changes are made.
This tests available lateral room rather than the rejected static Rynek lane offset or a whole-edge setback.

The whole body and turning sweep still matter: static centreline/curb distances do not guarantee sufficient
clearance during the transient steering motion. In seed 1 bus 210 still touches tram 21 on `4660` at 89.6 s,
and bus 205 gains a stopped connector contact at 212.9 s. Flow also fails on seeds 1 and 2.

| Variant | Seed | Pairs before → trial | Mean km/h | Stopped % | Longest hold s | Held >120 s | Deadlocks |
|---|---:|---:|---:|---:|---:|---:|---:|
| oncoming | 2 | 3 → 2 | 15.1 → 14 | 30.7 → 34.7 | 56 → 70 | 0 → 0 | 0 → 0 |
| clearance | 1 | 4 → 2 | 16.5 → 15 | 29 → 31 | 54 → 54 | 0 → 0 | 0 → 0 |
| clearance | 2 | 3 → 2 | 15.1 → 14.3 | 30.7 → 34.6 | 56 → 80 | 0 → 0 | 0 → 0 |
| clearance | 5 | 2 → 1 | 13.5 → 14.9 | 37.3 → 31.6 | 64 → 102 | 0 → 0 | 0 → 0 |

## Final before/after: unchanged game

No variant meets the task's acceptance criteria. There is no production fix and therefore no kept-change regression
test to add. The final game sources are byte-identical to the measured baseline; the final columns below are that
same unchanged simulation, not a claim of a second independent 56-row run. Pairs stay **28 → 28**, deadlocks
**0 → 0**, holds >120 s **4 → 4**, and every district/seed mean speed is unchanged. The requested overlaps remain
open work. A future rule must establish safe storage or reserve an actually clear body path before admission,
without stranding traffic at the upstream junction; another centreline-only clearance or blanket guard is insufficient.

District means average the eight printed benchmark mean-speed rows. Pair counts and long holds sum those rows.

| District | Pairs before → final | Mean km/h before → final | Held >120 s before → final | Deadlocks before → final |
|---|---:|---:|---:|---:|
| jezyce | 16 → 16 | 14.5625 → 14.5625 | 0 → 0 | 0 → 0 |
| lazarz | 0 → 0 | 13.8625 → 13.8625 | 0 → 0 | 0 → 0 |
| centrum | 2 → 2 | 14.3375 → 14.3375 | 0 → 0 | 0 → 0 |
| kaponiera | 7 → 7 | 12.6250 → 12.6250 | 4 → 4 | 0 → 0 |
| stare | 1 → 1 | 17.7000 → 17.7000 | 0 → 0 | 0 → 0 |
| rataje | 2 → 2 | 17.3250 → 17.3250 | 0 → 0 | 0 → 0 |
| wilda | 0 → 0 | 15.9375 → 15.9375 | 0 → 0 | 0 → 0 |

### Every seed and district

Each `before → final` value is unchanged. `Wait / hold` gives the longest finished wait and longest sampled
continuous hold, respectively, in seconds. The raw JSON retains stopped shares, queues, other wait percentiles,
box-stuck counts and tram/switch waits as well.

| Seed | District | Pairs | Mean km/h | Wait / hold s | Held >120 s | Deadlocks |
|---:|---|---:|---:|---:|---:|---:|
| 1 | jezyce | 4 → 4 | 16.5 → 16.5 | 55 / 54 → 55 / 54 | 0 → 0 | 0 → 0 |
| 1 | lazarz | 0 → 0 | 14.2 → 14.2 | 36 / 36 → 36 / 36 | 0 → 0 | 0 → 0 |
| 1 | centrum | 1 → 1 | 13.3 → 13.3 | 90 / 90 → 90 / 90 | 0 → 0 | 0 → 0 |
| 1 | kaponiera | 0 → 0 | 13.0 → 13.0 | 80 / 80 → 80 / 80 | 0 → 0 | 0 → 0 |
| 1 | stare | 0 → 0 | 18.1 → 18.1 | 30 / 29 → 30 / 29 | 0 → 0 | 0 → 0 |
| 1 | rataje | 1 → 1 | 16.3 → 16.3 | 58 / 57 → 58 / 57 | 0 → 0 | 0 → 0 |
| 1 | wilda | 0 → 0 | 15.5 → 15.5 | 39 / 38 → 39 / 38 | 0 → 0 | 0 → 0 |
| 2 | jezyce | 3 → 3 | 15.1 → 15.1 | 56 / 56 → 56 / 56 | 0 → 0 | 0 → 0 |
| 2 | lazarz | 0 → 0 | 13.3 → 13.3 | 33 / 33 → 33 / 33 | 0 → 0 | 0 → 0 |
| 2 | centrum | 0 → 0 | 14.9 → 14.9 | 55 / 55 → 55 / 55 | 0 → 0 | 0 → 0 |
| 2 | kaponiera | 1 → 1 | 12.4 → 12.4 | 114 / 113 → 114 / 113 | 0 → 0 | 0 → 0 |
| 2 | stare | 0 → 0 | 15.8 → 15.8 | 42 / 42 → 42 / 42 | 0 → 0 | 0 → 0 |
| 2 | rataje | 0 → 0 | 17.7 → 17.7 | 70 / 70 → 70 / 70 | 0 → 0 | 0 → 0 |
| 2 | wilda | 0 → 0 | 15.6 → 15.6 | 35 / 35 → 35 / 35 | 0 → 0 | 0 → 0 |
| 3 | jezyce | 3 → 3 | 14.4 → 14.4 | 85 / 85 → 85 / 85 | 0 → 0 | 0 → 0 |
| 3 | lazarz | 0 → 0 | 14.3 → 14.3 | 33 / 32 → 33 / 32 | 0 → 0 | 0 → 0 |
| 3 | centrum | 0 → 0 | 13.8 → 13.8 | 52 / 52 → 52 / 52 | 0 → 0 | 0 → 0 |
| 3 | kaponiera | 2 → 2 | 12.4 → 12.4 | 105 / 104 → 105 / 104 | 0 → 0 | 0 → 0 |
| 3 | stare | 1 → 1 | 18.3 → 18.3 | 29 / 25 → 29 / 25 | 0 → 0 | 0 → 0 |
| 3 | rataje | 0 → 0 | 16.2 → 16.2 | 50 / 49 → 50 / 49 | 0 → 0 | 0 → 0 |
| 3 | wilda | 0 → 0 | 16.6 → 16.6 | 39 / 39 → 39 / 39 | 0 → 0 | 0 → 0 |
| 5 | jezyce | 2 → 2 | 13.5 → 13.5 | 52 / 64 → 52 / 64 | 0 → 0 | 0 → 0 |
| 5 | lazarz | 0 → 0 | 13.9 → 13.9 | 73 / 73 → 73 / 73 | 0 → 0 | 0 → 0 |
| 5 | centrum | 1 → 1 | 15.0 → 15.0 | 58 / 58 → 58 / 58 | 0 → 0 | 0 → 0 |
| 5 | kaponiera | 1 → 1 | 12.1 → 12.1 | 91 / 90 → 91 / 90 | 0 → 0 | 0 → 0 |
| 5 | stare | 0 → 0 | 18.2 → 18.2 | 31 / 31 → 31 / 31 | 0 → 0 | 0 → 0 |
| 5 | rataje | 0 → 0 | 17.4 → 17.4 | 50 / 49 → 50 / 49 | 0 → 0 | 0 → 0 |
| 5 | wilda | 0 → 0 | 15.7 → 15.7 | 47 / 47 → 47 / 47 | 0 → 0 | 0 → 0 |
| 7 | jezyce | 1 → 1 | 14.8 → 14.8 | 84 / 83 → 84 / 83 | 0 → 0 | 0 → 0 |
| 7 | lazarz | 0 → 0 | 13.3 → 13.3 | 39 / 39 → 39 / 39 | 0 → 0 | 0 → 0 |
| 7 | centrum | 0 → 0 | 14.6 → 14.6 | 49 / 49 → 49 / 49 | 0 → 0 | 0 → 0 |
| 7 | kaponiera | 0 → 0 | 12.8 → 12.8 | 123 / 123 → 123 / 123 | 2 → 2 | 0 → 0 |
| 7 | stare | 0 → 0 | 17.8 → 17.8 | 29 / 28 → 29 / 28 | 0 → 0 | 0 → 0 |
| 7 | rataje | 0 → 0 | 17.7 → 17.7 | 46 / 45 → 46 / 45 | 0 → 0 | 0 → 0 |
| 7 | wilda | 0 → 0 | 18.4 → 18.4 | 26 / 26 → 26 / 26 | 0 → 0 | 0 → 0 |
| 11 | jezyce | 2 → 2 | 14.2 → 14.2 | 81 / 80 → 81 / 80 | 0 → 0 | 0 → 0 |
| 11 | lazarz | 0 → 0 | 14.2 → 14.2 | 22 / 22 → 22 / 22 | 0 → 0 | 0 → 0 |
| 11 | centrum | 0 → 0 | 13.1 → 13.1 | 56 / 56 → 56 / 56 | 0 → 0 | 0 → 0 |
| 11 | kaponiera | 0 → 0 | 12.9 → 12.9 | 114 / 114 → 114 / 114 | 0 → 0 | 0 → 0 |
| 11 | stare | 0 → 0 | 18.2 → 18.2 | 25 / 24 → 25 / 24 | 0 → 0 | 0 → 0 |
| 11 | rataje | 0 → 0 | 18.5 → 18.5 | 44 / 44 → 44 / 44 | 0 → 0 | 0 → 0 |
| 11 | wilda | 0 → 0 | 16.8 → 16.8 | 37 / 37 → 37 / 37 | 0 → 0 | 0 → 0 |
| 99 | jezyce | 1 → 1 | 15.9 → 15.9 | 55 / 55 → 55 / 55 | 0 → 0 | 0 → 0 |
| 99 | lazarz | 0 → 0 | 13.7 → 13.7 | 29 / 29 → 29 / 29 | 0 → 0 | 0 → 0 |
| 99 | centrum | 0 → 0 | 14.3 → 14.3 | 58 / 57 → 58 / 57 | 0 → 0 | 0 → 0 |
| 99 | kaponiera | 1 → 1 | 13.3 → 13.3 | 130 / 129 → 130 / 129 | 1 → 1 | 0 → 0 |
| 99 | stare | 0 → 0 | 17.2 → 17.2 | 21 / 20 → 21 / 20 | 0 → 0 | 0 → 0 |
| 99 | rataje | 0 → 0 | 17.3 → 17.3 | 56 / 56 → 56 / 56 | 0 → 0 | 0 → 0 |
| 99 | wilda | 0 → 0 | 13.4 → 13.4 | 63 / 63 → 63 / 63 | 0 → 0 | 0 → 0 |
| 4242 | jezyce | 0 → 0 | 12.1 → 12.1 | 97 / 97 → 97 / 97 | 0 → 0 | 0 → 0 |
| 4242 | lazarz | 0 → 0 | 14.0 → 14.0 | 31 / 30 → 31 / 30 | 0 → 0 | 0 → 0 |
| 4242 | centrum | 0 → 0 | 15.7 → 15.7 | 43 / 44 → 43 / 44 | 0 → 0 | 0 → 0 |
| 4242 | kaponiera | 2 → 2 | 12.1 → 12.1 | 138 / 137 → 138 / 137 | 1 → 1 | 0 → 0 |
| 4242 | stare | 0 → 0 | 18.0 → 18.0 | 25 / 25 → 25 / 25 | 0 → 0 | 0 → 0 |
| 4242 | rataje | 1 → 1 | 17.5 → 17.5 | 66 / 65 → 66 / 65 | 0 → 0 | 0 → 0 |
| 4242 | wilda | 0 → 0 | 15.5 → 15.5 | 42 / 41 → 42 / 41 | 0 → 0 | 0 → 0 |

## Verification

- `node --test tests/`: **627/627 pass**, no failures/skips, about 131 s while audits run concurrently.
- No production source or test markers changed; no preload/CSS/cache changes are required.
- No browser check is claimed: there is no retained behavior or rendering change to inspect.
- No commit created. Documentation changes are this record, the backlog bullet and `docs/actors.md`.
