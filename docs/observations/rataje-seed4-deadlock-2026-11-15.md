# Rataje seed-4 car–tram deadlock, 2026-11-15

## Reproduction and source versions

Investigation starts at `6bc437f`, using five simulated minutes, 15 fps, seed 4 and the ordinary benchmark world
(20 s warmup, 300 m car sampling radius; street furniture and building colliders, without rendered city-grid
sidewalks, landmark/bridge colliders or rendering). No commit is made.

```
node tools/bench-traffic.mjs --seed 4 --dump --json .agent-task/rataje/baseline-4.json
node tools/bench-traffic.mjs --only rataje --seed 4 --trace 1026,1671 --dump
```

Both current-source commands report **zero Rataje deadlocks**, 16.3 km/h, 36.9% stopped, finished waits
7 / 27 / 47 s (p50 / p90 / max), longest sampled hold 46 s and zero holds >60 / >120 s. The full run and isolated
run agree. Prebuilding one extra world also gives that same row, so first-world setup is not the explanation.

The original [capacity finding](kaponiera-signal-capacity-2026-11-15.md) predates `9798737`, which fixed two
pedestrian curb comparisons. Restoring only `9798737^:js/traffic.js` in a scratch source-loading wrapper recreates
**the exact reported cycle**, including car 49, line 13, positions, T300 and 58 s minimum member wait. The restored
source differs from current traffic.js only in those two curb expressions; the current signal offsets, other
modules, tram seed and simulation order stay unchanged. This demonstrates a changed seeded trajectory, not a new
car–tram cycle-breaking rule in `9798737`.

Scratch evidence and runners are under `.agent-task/rataje/`: `baseline-trace.txt`, `baseline-4.json/log`,
`replay-baseline-4.json/log`, `old-curb-4.json/log`, `diagnose.mjs`, `variant.mjs` and `candidate.mjs`.
The historical replay wrapper prebuilds one world; that warmup was separately shown not to change the current row.
The diagnostic probe runs after simulation updates and only reads the selected vehicle plus the tram's sweep.
An initial probe needed its fixed-capacity path array sliced to `path.n`; the corrected replay completes normally.

## Exact historical wait cycle

At T300.067:

| Member | State | Waits for |
|---|---|---|
| Car 49, `(1027.721, 1669.797)` | `car`, speed 0, wait 61.4 s; edge 2817 lane 0, connector 5.821 / 10.224 m | Line 13's proxy in exit edge 8753 lane 0 |
| Tram pooled ID 2, line 13, `(1021.072, 1690.405)` | `car`, speed 0, stuck 58.4 s; front `(1026.627, 1675.507)`; obstacle car 49 | Car 49's committed connector (road-car gate) |

The give-way node is `(1026.4, 1670.733)`. Its 10 m exit stores the car behind the downstream signal at
`(1030, 1697)`. The car's exit coordinate is **−4.403 m**; its half-length is 2.12 m. The proxy centre is
**0.969655 m**, half-length **2.437376 m**, so its near edge is **−1.467721 m**. The car's projected nose is
−2.283248 m: it stands 0.815527 m before the pad. Its real curved-path body nevertheless reaches the tram's future sweep.
The mapped exit run has **dir −1**: it opposes the tram, rather than crossing its path. Car/tram heading dot is
**−0.944932**. This distinction matters: storing the car's rear past the pad does not prove it can reach that
position without driving into the stopped tram's front.

The car slows behind the pad at T234–237. At T238 the tram starts binding on car 49. By T242 the car has stopped
for 3.4 s and the tram for 0.4 s; the final positions stabilise. At T262 the car has waited 23.4 s and the tram
20.4 s. At T300 both still occupy the same positions. Car 15 also stands in the other connector/exit lane,
but is not an extra member of this two-body wait cycle. Tram 7 waits for car 69 farther upstream.

### Why the existing breakers do not fire

- `queuedBehindTram(car49, tram13)` becomes true after the car's 20 s wait. Its release correctly also requires
  `obstacleGap(..., oncoming=true, stopped=true) === Infinity`; the probe returns **2.5 m**, so the tram cannot
  safely go first. The restart gate remains active: conflict entry is **0.419153 m** ahead of the front,
  ending at **11.901541 m**. The ordinary obstacle sweep uses `oncoming=false` and returns **Infinity** for
  this heading, so the tram's binding car gate is its **road-car gate**, not the ordinary stopped-body sweep.
  Releasing it would still be unsafe: the separate oncoming-inclusive release check sees the future intrusion.
- `proxyYieldsTo`'s existing wait and storage predicate qualifies after both 20 s waits. The empty 10 m exit can
  hold the rear clear: `10 − 4.24 = 5.76 m`, beyond the pad end plus margin **3.907031 m**. With the normal
  one-metre storage allowance, `room` still has `9 − 4.24 = 4.76 m` rear clearance. However, this helper is called
  only by `room` and `alongside`, before entry. Car 49 has already entered; `accelerate` calls `follow` on its exit
  occupancy, and `follow` does not use the release.
- `occupyTrams`' obstacle exemption runs only after the lane-interval overlap check. Car 49's projected nose is
  still 0.816 m before that interval, so the obstacle is skipped before the exemption is reached. Its actual body
  reaches the future swept corridor despite that disjoint lane interval; the connector body and its exit-lane
  projection answer different geometric questions.
- `heldByTram` / `tramStandsAt` exempt the car that is the tram's obstacle, but these entry/curve checks cannot
  override the proxy leader selected inside `follow`. The stale `held: room` field is not the binding gate: the
  recorded `waitReason` and leader establish the active pad-following gate.

## Candidate and acceptance

A scratch candidate applies the existing car-first pad release in `follow`, only for the already-entered car's
actual outgoing lane and only while `room` verifies rear storage after the real queue and reservations. It preserves
other leaders. Both 20 s waits and exact `tram.obstacle === car` identity remain required. A per-car tram reference
latches the selected release until leaving that connector, with resets on `leave` and pooled `place`: otherwise
initial acceleration resets `wait` before the car covers the remaining 0.816 m and reaches `occupyTrams`' exemption.
A moving tram never qualifies.

This is a new bounded variant of the previously rejected connector proxy bypass: that trial did not establish
this exact two-way waited release with verified rear storage. The road-car gate remains active while the car
moves. No coordinates, signal plans, forecasts, body envelopes or gate distances are changed.

Historical seed-4 screening: mean **17.0 → 17.2 km/h**, stopped **35.8 → 35.3%**, deadlocks **1 → 0**, holds >120 s
**0 → 0**, longest sampled hold **67 → 55 s**. One box stop remains under the benchmark's >20 s definition.
The historical overlap audit rejects it: **0 → 1 pair**, **0 → 17 pair-frames**. The new contact is exactly
car 49 / tram pooled ID 2 at **T263.7**, `(1028, 1674)`, with the car moving **3.8 m/s** into a **stationary** tram
(`carWait: signal`, `tramWait: car`). Exit storage is not a sufficient path-clearance condition for this opposing
run. This variant must not be retried merely with different waits or a different latch. No game code is retained.
The complete current-source same-seed nine-by-seven comparison appears below. It cannot establish safety for
the reported encounter because that encounter is already absent after the curb fix.

A scratch regression drives the real `follow`, `proxyYieldsTo`, `room` and `ahead` functions through this call-site
pattern. It fails on baseline, passes on the candidate, checks continued acceleration, real leaders, changed exit
storage, both wait thresholds, moving/other-obstacle trams, and approach/source-lane exclusions.

## Current-source baseline refresh

All nine requested seeds `1 2 3 4 5 7 11 99 4242` complete on unmodified `6bc437f`, with **0 deadlocks**
and **18 holds >120 s**, all in Kaponiera. This is a fresh baseline: the earlier 4-hold/28-pair signal-offset
acceptance record predates the pedestrian curb fix and also excludes seed 4. Those historical counts must not
be substituted for these same-source, same-seed measurements.

| District | Nine-seed mean km/h | Holds >120 s | Deadlocks | Longest sampled hold s |
|---|---:|---:|---:|---:|
| Jeżyce (Rynek Jeżycki) | 14.5444 | 0 | 0 | 95 |
| Łazarz (Głogowska) | 13.9778 | 0 | 0 | 42 |
| Centrum (Św. Marcin) | 14.2000 | 0 | 0 | 65 |
| Rondo Kaponiera | 12.7444 | 18 | 0 | 191 |
| Stare Miasto | 17.7889 | 0 | 0 | 43 |
| Rataje (Rondo Rataje) | 17.0333 | 0 | 0 | 111 |
| Wilda | 16.3333 | 0 | 0 | 63 |

Kaponiera holds >120 s by seed: 1: 0; 2: 6; 3: 4; 4: 3; 5: 0; 7: 0; 11: 0; 99: 0; 4242: 5.
District means average the nine per-seed means printed to 0.1 km/h by the benchmark.

The matching current-source nine-seed overlap audit completes with **48 pairs / 4,394 pair-frames**:
Jeżyce 19, Łazarz 0, Centrum 3, Kaponiera 19, Stare Miasto 4, Rataje 3, Wilda 0. Per-seed totals in the
requested order are **7 / 5 / 8 / 4 / 3 / 5 / 5 / 4 / 7**. Raw results are `baseline-audit-S.log`.

## Complete current-source candidate comparison and decision

Both baseline and scratch candidate complete all **9 seeds × 7 districts**, with matching five-minute overlap
audits. Both have **0 deadlocks**, **18 holds >120 s** and **48 pairs / 4,394 pair-frames**. Every one of the
**63 overlap-audit rows is exactly identical**, including all contact events. There is no district mean-speed
drop, and no individual seed/district mean drops either.

| District | Mean km/h, baseline → candidate | Holds >120 s | Deadlocks |
|---|---:|---:|---:|
| Jeżyce (Rynek Jeżycki) | 14.5444 → 14.5444 | 0 → 0 | 0 → 0 |
| Łazarz (Głogowska) | 13.9778 → 13.9778 | 0 → 0 | 0 → 0 |
| Centrum (Św. Marcin) | 14.2000 → 14.2000 | 0 → 0 | 0 → 0 |
| Rondo Kaponiera | 12.7444 → 12.7444 | 18 → 18 | 0 → 0 |
| Stare Miasto | 17.7889 → 17.8222 | 0 → 0 | 0 → 0 |
| Rataje (Rondo Rataje) | 17.0333 → 17.0333 | 0 → 0 | 0 → 0 |
| Wilda | 16.3333 → 16.3333 | 0 → 0 | 0 → 0 |

Only Stare Miasto seed 3 changes any benchmark field: mean 18.0 → 18.3 km/h, moving mean 19.4 → 19.5 km/h,
stopped 7.0 → 6.3%, longest queue 5 → 3, finished wait p90 10 → 9 s, max/longest sampled hold 26 → 17 s,
and trams held >60 s 2 → 1. All other 62 benchmark rows match in every field. Raw candidate results are
`candidate-S.json/log` and `candidate-audit-S.log`; `comparison.json` records the complete comparison.

**Reject the candidate and retain no game code.** The current-source matrix passes the numerical regression
gates, but its seed-4 baseline already has no target cycle. The restored historical target is the meaningful
fix control: its new car 49 / line 13 body contact fails the no-increase overlap requirement. No threshold,
coordinate-specific exception, entry hard stop, signal change or unsafe tram-first release is retained.
The exact historical mechanism remains documented for a future collision-safe routing/storage solution.

Validation: `node --test tests/` passes **631 tests, 0 failures**, in 139.7 s. The scratch call-site regression
fails on unmodified `follow` and passes on the candidate; since the candidate is rejected, no production
regression test or source-slice marker changes are retained. Both `js/traffic.js` and `js/trams.js` compare
byte-for-byte with the initial snapshots; the tracked changes are this observation, the Rataje backlog bullet
and the actor guidance. `git diff --check` passes. No commit or push is made.
