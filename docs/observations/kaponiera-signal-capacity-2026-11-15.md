# Kaponiera signal capacity, 2026-11-15

The +12/+12 s signal offsets are implemented in production. The user accepts the one extra car–tram pair
(**27 → 28**) as a known cost for reducing Kaponiera holds >120 s **11 → 4**, with **0 new deadlocks** and a
worst district mean-speed change of **−0.0625 km/h**. The current baseline is **4 holds / 28 pairs** over
historical seeds `1 2 3 5 7 11 99 4242`. No commit or push was made.

## Corrected scope and method

The coordinator corrected the task in round 2: use historical seeds **1 2 3 5 7 11 99 4242** and require
**no new deadlocks against the same-seed baseline**. The original list substituted seed 4 for 11. Round 1's
rejection of +15/+15 solely because of an unchanged Rataje seed-4 deadlock was wrong under these corrected
instructions. Round 2 runs the missing full matrix and audit; it rejects on the newly measured gates instead.

Baseline, +15/+15 and +12/+12 each have all eight seeds × seven districts and the matching eight-seed car–tram
audit. Kaponiera-only screening also covers +15/+12 on all eight seeds. All runs use five simulated minutes,
15 fps, a 20 s warmup and the benchmark's 300 m car sampling radius. District mean speeds average the eight
per-seed means reported by the tool to 0.1 km/h, as in the earlier observation records.

```
node tools/bench-traffic.mjs --only kaponiera --seed S --json FILE
node tools/bench-traffic.mjs --seed S --json FILE
node tools/audit-tram-overlaps.mjs --seed S
node tools/bench-traffic.mjs --only kaponiera --seed 1 --trace -1136,127 --trace-min 60
node tools/bench-traffic.mjs --only kaponiera --seed 5 --trace -1503,224 --trace-min 40
node tools/bench-traffic.mjs --only kaponiera --seed 5 --trace -1497,198 --trace-min 100
```

Raw results, scratch runners and traces are under `.agent-task/capacity/`. Baseline files are `baseline-S.json`
and `baseline-audit-S.log`; round-2 files are `round2-15-S.json`, `round2-audit15-S.log`,
`round2-full12-S.json`, `round2-audit12-S.log` and `round2-15-12-S.json`. The scratch wrapper is
`variant.mjs`, orchestrated by `variants.py`. `.agent-task/REPORT.md` records progress and final verification.

The standard seed-1 trace suppresses the junction at 330.3 m from the Kaponiera focus, even though its approach
queue is sampled. `trace-boundary.mjs` changes only that print gate and the relative import path: simulation,
focus and sampling stay unchanged.

## Reproduced causes and legal timing limits

- At `(-1135.54, 127.34)`, site `(-1134.8, 118.4)`, plan 248 gives group 0 18 s, group 1 37 s,
  start1 23 s, cycle 65 s, offset 17.92475177 s. The seed-1 trace repeats the first green's `room` hold
  behind a tram proxy (T160–165), the second green's `box` hold behind cross traffic (T213–230), and car 11's
  153 s wait at T278. The district's longest sampled hold is 142 s; the boundary trace also includes cars
  outside the 300 m sampling radius.
- At `(-1503.29, 224.03)`, site `(-1496.1, 232.3)`, plan 49 gives group 0 34 s, group 1 16 s,
  start1 39 s, cycle 60 s, offset 27.69980691 s. Seed 5 repeats car 8 held by tram 6 at T187–197 and
  pedestrians at T198–202, losing the green while its occupied 10 m exit blocks the 3→2 merge upstream.

The measured crossing widths are 14.05 / 34.217 m for plan 248's parallel green stages at 1 m/s and 37.774 m
for plan 49's group-0 stage at its existing 1.2 m/s. The implemented rule is
`green >= ceil(width / walkSpeed + 2)`: the last WALK entrant at second 7 finishes by the opposing green at
`green + 5`, since `7 + width / walkSpeed <= green + 5`.
Thus plan 248's group 1 is already at its 37 s minimum and plan 49's group 0 at its 34 s minimum. Extra green for
the congested approach cannot be taken from the other stage at the current cycle and design walking speed.

Only offsets were varied. Positive shifts delay both stages, aiming to serve the queue after the traced tram
body clears. Negative timing tests earlier service. This differs from the rejected historical offset experiment,
which retained the old 1 m/s, 40/10 split. No global 1.2 m/s retiming, 12–15 s green1, phase-preserving +6 s
variant, longer corridor cycle, crossing split or merger-rule variant was repeated.

The scratch wrapper imports the real config, adds `shift * (40 / 3.6)` to the two plans' distance inputs, then
imports the unmodified benchmark/audit. `configureSignalClearance` converts that into the desired local offset;
no source file or other plan is changed. This is an experimental injection, not a proposed change to corridor
geometry. Round 3 replaces this injection with the production per-site offset table described below. Both pedestrian stages retain
their durations, WALK entry window, clearance margins and design speeds in every variant.

## Round-2 acceptance results (before the round-3 tradeoff approval)

| Variant | Kaponiera holds >120 s | New deadlocks | Car–tram pairs (limit 27) | Worst district mean delta km/h (limit −0.1) | Result |
|---|---:|---:|---:|---:|---|
| +15/+15 | 11 → 2 | 3 | 27 → 26 | -0.7625 | Rejected |
| +12/+12 | 11 → 4 | 0 | 27 → 28 | -0.0625 | Accepted in round 3 with the +1 pair cost |

Baseline has zero deadlocks on the corrected 56 district-seeds. Both variants retain the same split, cycle,
walking speed and WALK duration, so pedestrian clearance is unchanged. Round 3 explicitly accepts +12/+12
despite exceeding the earlier overlap gate by one pair. Rataje seed 4 is not part of this gate.

Kaponiera per-seed cells: mean km/h / holds >120 s / longest hold s / deadlocks.

| Seed | Baseline | +15/+15 | +12/+12 | +15/+12 screening |
|---:|---:|---:|---:|---:|
| 1 | 12.5 / 3 / 142 / 0 | 12.8 / 0 / 97 / 0 | 13.0 / 0 / 80 / 0 | 12.9 / 0 / 112 / 0 |
| 2 | 14.1 / 0 / 117 / 0 | 12.2 / 2 / 138 / 0 | 12.4 / 0 / 113 / 0 | 11.9 / 4 / 136 / 0 |
| 3 | 12.5 / 1 / 126 / 0 | 12.6 / 0 / 114 / 0 | 12.4 / 0 / 104 / 0 | 12.0 / 11 / 182 / 0 |
| 5 | 10.3 / 6 / 145 / 0 | 12.9 / 0 / 81 / 0 | 12.1 / 0 / 90 / 0 | 14.1 / 3 / 148 / 0 |
| 7 | 13.7 / 0 / 95 / 0 | 12.7 / 0 / 93 / 0 | 12.8 / 2 / 123 / 0 | 12.0 / 0 / 78 / 0 |
| 11 | 12.8 / 0 / 98 / 0 | 12.5 / 0 / 97 / 0 | 12.9 / 0 / 114 / 0 | 12.7 / 0 / 82 / 0 |
| 99 | 13.2 / 0 / 110 / 0 | 13.2 / 0 / 92 / 0 | 13.3 / 1 / 129 / 0 | 14.3 / 0 / 84 / 0 |
| 4242 | 12.4 / 1 / 123 / 0 | 12.9 / 0 / 119 / 0 | 12.1 / 1 / 137 / 0 | 11.9 / 0 / 102 / 0 |

### Full district comparison: +15/+15

| District | Mean km/h, baseline → variant | Holds >120 s | Deadlocks |
|---|---:|---:|---:|
| Jeżyce (Rynek Jeżycki) | 14.5250 → 14.5250 | 0 → 0 | 0 → 1 |
| Łazarz (Głogowska) | 13.8625 → 13.8625 | 0 → 0 | 0 → 0 |
| Centrum (Św. Marcin) | 14.3375 → 13.5750 | 0 → 1 | 0 → 2 |
| Rondo Kaponiera | 12.6875 → 12.7250 | 11 → 2 | 0 → 0 |
| Stare Miasto | 17.7000 → 17.7000 | 0 → 0 | 0 → 0 |
| Rataje (Rondo Rataje) | 17.3250 → 17.3250 | 0 → 0 | 0 → 0 |
| Wilda | 15.9375 → 15.9375 | 0 → 0 | 0 → 0 |

Car–tram body overlap pairs, baseline → variant:

| Jeżyce | Łazarz | Centrum | Kaponiera | Stare Miasto | Rataje | Wilda | Total |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 15 → 14 | 0 → 0 | 3 → 1 | 6 → 8 | 1 → 1 | 2 → 2 | 0 → 0 | **27 → 26** |

New deadlock: **Centrum (Św. Marcin), seed 11**, at T224 with minimum member wait 90 s:

#21 room at (-992, 136) (-981, 117) S → #24 car in box at (-992, 136) (-985, 142) S → tram 13 car (-977, 150) → #35 oncoming at (-992, 136) (-998, 145) L.

New deadlock: **Centrum (Św. Marcin), seed 11**, at T298 with minimum member wait 60 s:

#21 car in box at (-992, 136) (-985, 142) S → tram 20 car (-977, 150) → #35 oncoming at (-992, 136) (-998, 145) L → #8 room at (-992, 136) (-984, 116) S.

New deadlock: **Jeżyce (Rynek Jeżycki), seed 99**, at T298 with minimum member wait 31 s:

#19 car in box at (-2023, -448) (-2040, -442) L → tram 2 car (-2046, -422).

### Full district comparison: +12/+12

| District | Mean km/h, baseline → variant | Holds >120 s | Deadlocks |
|---|---:|---:|---:|
| Jeżyce (Rynek Jeżycki) | 14.5250 → 14.5625 | 0 → 0 | 0 → 0 |
| Łazarz (Głogowska) | 13.8625 → 13.8625 | 0 → 0 | 0 → 0 |
| Centrum (Św. Marcin) | 14.3375 → 14.3375 | 0 → 0 | 0 → 0 |
| Rondo Kaponiera | 12.6875 → 12.6250 | 11 → 4 | 0 → 0 |
| Stare Miasto | 17.7000 → 17.7000 | 0 → 0 | 0 → 0 |
| Rataje (Rondo Rataje) | 17.3250 → 17.3250 | 0 → 0 | 0 → 0 |
| Wilda | 15.9375 → 15.9375 | 0 → 0 | 0 → 0 |

Car–tram body overlap pairs, baseline → variant:

| Jeżyce | Łazarz | Centrum | Kaponiera | Stare Miasto | Rataje | Wilda | Total |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 15 → 16 | 0 → 0 | 3 → 2 | 6 → 7 | 1 → 1 | 2 → 2 | 0 → 0 | **27 → 28** |

## Other variants

- +15/+12: 18 Kaponiera holds >120 s, all eight seeds, no Kaponiera deadlock. It fails the long-hold gate
  (baseline 11); no full district or overlap result is claimed.
- +10/+10 (round 1): historical full matrix reduces holds 11 → 8 and overlap pairs stay 27, but introduces a
  Kaponiera seed-4242 deadlock. Its Kaponiera mean is 12.6875 → 13.05 km/h; no district mean falls. Rejected under
  the corrected gate too.
- Round-1 seed-1/5 screening, cells mean km/h / holds >120 s: +10/+15 gives 13.0/2 and 12.2/0;
  −5/+10 gives 13.8/0 and 12.3/5; +10/0 gives 13.0/1 and 11.0/0; 0/+10 gives 14.2/0 and 12.3/4
  (the latter's seed-5 longest hold is 154 s). These were preliminary screens, not complete acceptance runs.

## Separate finding: Rataje seed 4

The original task's seed-4 baseline has one Rataje deadlock at T300, minimum member wait 58 s: tram 13 at
`(1021, 1690)` and car 49 in the `(1026, 1671)` box. Its entire reported district row compares bit-identically
with the +15/+15 variant (`delay15-rataje4.json` versus Rataje in `baseline-4.json`). This pre-existing cycle is
recorded separately in `docs/backlog.md` and does not reject a Kaponiera variant under the corrected gate.
Seed 4 also has nine Kaponiera holds, making the original eight-seed set's baseline 20 rather than 11.

## Production implementation and verification (round 3)

`SIGNAL_OFFSET_OVERRIDES` in `js/city-config.js` explicitly lists site `(-1134.8, 118.4)` and site
`(-1496.1, 232.3)`, each with `seconds: 12`. Coordinate matches use a 2 m radius, as for `SIGNAL_WALK_SPEEDS`.
A private map resolves the plan objects at build time; `configureSignalClearance` adds the shift after rebuilding
the normal corridor offset. Resetting/rebuilding the graph does not accumulate the adjustment, and there is no
new per-frame lookup. No corridor distance metadata, cycle, split, WALK window or walking speed is changed.

The final production offsets are:

| Site | Junction | Plan | Offset before → after (s) | Cycle / green0 / green1 / start1 (s) |
|---|---|---:|---:|---:|
| (-1134.8, 118.4) | (-1135.54, 127.34) | 248 | 17.924751770454122 → 29.924751770454122 | 65 / 18 / 37 / 23 |
| (-1496.1, 232.3) | (-1503.29, 224.03) | 49 | 27.699806906382648 → 39.69980690638265 | 60 / 34 / 16 / 39 |

Production snapshots change only those two offsets; all other **491 plans compare identically** to the original
baseline. Unlike the scratch experiment, the production code leaves both plans' distance fields unchanged.
The regression in `tests/signal-clearance.test.cjs` pins both final offsets and splits, compares every plan
against a control with the override table empty, and checks that repeated graph builds preserve the schedules.
The existing furnished-crossing test still checks the last WALK entrant against every crossing's design speed.

Production verification uses the ordinary tools, without `variant.mjs`, `CAPACITY_SHIFTS` or a config injection:

```
node tools/bench-traffic.mjs --only kaponiera --seed S --json .agent-task/capacity/round3-production-S.json
node tools/audit-tram-overlaps.mjs --seed S
node --test tests/
```

All eight production Kaponiera JSON files match the experimental `round2-12-S.json` results in every field:
**4 holds >120 s, 0 Kaponiera deadlocks**. The full district mean-speed and no-new-deadlock comparison above
was measured in round 2; the production plan values match that experiment exactly.

The full production suite passes **627 tests, 0 failures**, in 112.9 s, including the new offset regression
and the furnished pedestrian crossing-clearance checks.

All **56 production overlap-audit rows match the experiment exactly**, including every recorded contact event.
The total is **28 pairs**: Jeżyce 16, Kaponiera 7, Centrum 2, Rataje 2, Stare Miasto 1; Łazarz and Wilda 0.
Raw production results are `round3-production-S.json` and `round3-audit-S.log`; snapshots are
`round3-production-plans.json`, and the full test output is `round3-tests.log`. Current production baseline:
**4 holds >120 s / 28 car–tram pairs**, with no new deadlocks in the accepted full historical-seed comparison.
`git diff --check` passes. No commit or push.
The Rataje seed-4 cycle remains its own backlog finding, outside the historical acceptance set. No geometry,
shader, audio or visual phase implementation changes; all consumers still read the shared local plan clock.
