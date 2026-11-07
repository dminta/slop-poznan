# Jeżyce crosswalk state after the pedestrian change, 2026-11-07

Checked whether the recorded tram → car → pedestrian → tram gridlock still appears after `abc352f` ("Stop pedestrians
piling up at crosswalk U-turns, dead ends and queues"), and whether a small fix was verifiable. The original pass
changed no production code; the follow-up at the end fixes the `tramRoom` boundary trap and adds the retained room
audit.

Method: `node tools/bench-traffic.mjs --only jezyce --minutes 5 --fps 15 --seed <n>`, seeds 1, 4242, 7, 99, 2, 3, 5, 11,
tram seed 1922 (the benchmark default), first 20 s excluded. These runs used the earlier headless world without building,
landmark or bridge colliders. The benchmark now includes city-block colliders, so its current results are not directly
comparable. No browser check was performed. See [testing](../testing.md#traffic-benchmark).

## Baselines and the metric

This comparison is pre-change `d77c4bd` (the parent of `abc352f`) versus HEAD `d7c4802`. The historical record used
`7566c2a` and the later `a302005` baseline; `d77c4bd` already contains later traffic work over `7566c2a` (the Kaponiera
car–tram fix, the stopped-car tram sweep and the short-link follower merge), so the counts are not from the same
baseline. The historical per-seed outliers (129 s and 103 s) and the regression test's 120 s condition use
`longestHeld`, the longest continuous hold at sampling. The table below reports the benchmark's `waitMax` (longest
finished wait) and the benchmark's held-over counts. `waitMax` is a different statistic: its values must not be
compared with historical `longestHeld`, and the `>120 s` column is a count of cars held over 120 s at sampling, not the
test's `longestHeld < 120` bound. `longestHeld` was not captured here, so this table does not verify that bound.

## Measurement (waitMax and held counts)

| Seed | Pre `waitMax` | Pre > 60 s | Pre > 120 s | HEAD `waitMax` | HEAD > 60 s | HEAD > 120 s |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 57 | 0 | 0 | 62 | 1 | 0 |
| 4242 | 84 | 13 | 0 | 82 | 2 | 0 |
| 7 | 75 | 9 | 0 | 59 | 10 | 0 |
| 99 | 130 | 12 | 1 | 52 | 0 | 0 |
| 2 | 69 | 2 | 0 | 58 | 0 | 0 |
| 3 | 78 | 4 | 0 | 83 | 13 | 0 |
| 5 | 104 | 9 | 0 | 57 | 0 | 0 |
| 11 | 66 | 1 | 0 | 65 | 2 | 0 |
| **Sum / max** | **663 / 130** | **50** | **1** | **518 / 83** | **28** | **0** |

All sixteen runs had 0 deadlocks. Seeds 99 and 5 lose the paired long holds: 12/9 cars over 60 s and one over 120 s
become 0/0, and the junction max waits at `(-2100, -475)` / `(-2069, -470)` fall from 129/109 s to 46/40 s. The
result is not uniform: seed 1 rises 57 → 62 s and 0 → 1 car over 60 s, seed 3 rises 78 → 83 s and 4 → 13 over 60 s,
and seed 7 has 9 → 10 over 60 s. The 8-seed held-over-60 sum is 50 → 28 and no HEAD run has a car held over 120 s at
sampling.

The historical 129/103 s figures cannot be reproduced or refuted from this table. `abc352f` changed pedestrian queues,
U-turn/landing routing and recovery together, so the improvement of seeds 99/5 cannot be assigned to the landing links
alone; no ablation of those parts was run.

## Freeze mechanism

`tramRoom` caps forward room with `before = (c.t - p.t) * p.dir - c.clear` when the code condition `before >= -0.3`
holds. That includes `before = 0`: a walker can stop exactly at the clearance edge (`movement` is capped by `room`) and
then receive zero room while `tramNear` is true. If a tram then stops nearby, the state can persist.

The recovery clock is not reset by `p.node` alone. In `walk()`, `waitingForCrossing = !!p.node` is one term, but a curb
wait (`p.waiting`), a split-crossing hold, a pause or a conversation also suppress the 20 s clock, and removal is
postponed while `nearView` sees the spot. The crosswalk case therefore does not accrue the recovery, but "on a
crosswalk" is not the only reset condition.

The presence of a tram is not by itself proof that `tramRoom` caused a stop. An ad-hoc instrumented run was used to
compare `tramRoom` with the other `room` terms, but its script was not kept in the repo; the exact coordinates and
per-walker durations from it are **not reproducible** and are not evidence here. The reproducible evidence is the
benchmark table above. What that instrumentation suggested, and what still needs a retained tool, is that some freezes
at these crosswalks were limited by other `room` sources (queues, next-leg entrances, split holds) rather than by
`tramNear`.

## Rejected variant (ad-hoc, not retained)

A candidate extended the `tramNear` pedestrian exemption from `waitReason === 'pedestrian'` to stationary trams held by
traffic (`car`, `room`, `tram`, `block`, `player`), keeping signals, stops and curves unchanged. It was tried only on
the pre-change copy with an ad-hoc script that was not retained. The indicative result was that it removed some
`tramNear`-caused boundary stops but did not remove the remaining non-tram `room` freezes, so the recorded pre-change
scenario was not cleared as a whole. The numbers from that trial are **not reproducible** and are not used as a
regression result. The variant is not in the code.

## Remaining problem at the original pass

- A walker could still stop at `before = 0` while `tramNear` predicted a tram. A moving tram cleared this within the
  6 s lookahead; a tram that stopped at that moment could leave the walker there. The follow-up below fixes it.
- Not all long freezes at the old reproducer were tram-caused: the other `room` terms in `walk()` needed a retained
  instrumented check before changing the code. The follow-up below adds it.
- Curb waits with `n.crossing` blocking recur at the same junctions; they belong to the pedestrian-overlap item, not
  this cycle. No numbers from the unretained instrumentation are used here.
- The follow-up keeps the body-over-crossing block and the 6 s moving-tram lookahead; its `--json` output carries
  `longestHeld` as well as `waitMax`, so it is comparable with the historical record.

## Measurement status

The original pass (HEAD `d7c4802`) needed no traffic-code change for the recorded gridlock, but the `before = 0` trap
and the non-tram room limits remained. The follow-up below fixes the trap and retains the audit.

## Follow-up: tramRoom boundary fix and room audit (2026-11-07)

Method: `node tools/bench-traffic.mjs --only jezyce --minutes 5 --fps 15 --seed 1`, first the pre-fix working tree
(`6a1a234`, 62 s `waitMax`) and then the fixed tree with the new `--ped-rooms` audit. Both runs use the same benchmark
inputs (city-block colliders; no landmark or bridge colliders). The console prints `waitMax` only; the `--json` output
also carries `longestHeld`, so the 120 s regression bound needs a `--json` run.

| Run | mean km/h | stopped | waitMax | longestHeld | held > 60 s | deadlocks |
|---|---:|---:|---:|---:|---:|---:|
| before (seed 1) | 15.2 | 30.4% | 62 | 61 | 1 | 0 |
| after (seed 1) | 15.8 | 29.1% | 56 | 56 | 0 | 0 |

Full 8-seed runs (the same seeds as the original table: 1, 4242, 7, 99, 2, 3, 5, 11; otherwise the same command)
after the fix:

| Run (8 seeds) | sum waitMax | held > 60 s | mean km/h | stopped | max `longestHeld` | deadlocks |
|---|---:|---:|---:|---:|---:|---:|
| before (`d7c4802`) | 518 s | 28 | 13.99 | 35.4% | not captured | 0 |
| after | 500 s | 10 | 14.19 | 34.0% | 95 s | 0 |

The aggregate improves, but the result is not uniform: seed 99 rises 52 → 75 s and seed 5 rises 57 → 95 s. The 95 s
maximum stays below the test's 120 s bound, and all 16 runs (8 before, 8 after) had 0 deadlocks.

The fix is in `tramRoom` (`js/traffic.js`): a walker at or just inside the clearance edge (`before <= 0`, including the
old `-0.3` dead band) now finishes crossing when the near tram is standing short of the crossing and is neither over it
nor moving. A body over the crossing still holds the walker, and a moving tram keeps the `PED_TRAM_TIME` 6 s lookahead.
`PED_TRAM_HOLD` reuses one object, so the hot path allocates nothing. `tests/traffic.test.cjs` covers the edge, the
dead band, the approach and both retained blocks.

Room audit: walkers with `stuck > 0` are sampled once a second, so legitimate curb waits, split holds, pauses,
conversations and crosswalk waits are excluded. Jeżyce seed 1 has **1,745 ped-s stuck out of 94,103 sampled** (1.9%),
longest **17.7 s**; by `roomCause` the holds are **queue 1,668 (96%)**, **merge 73 (4%)**, **entrance 4 (0.2%)** and
**tram 0**. The remaining Jeżyce freezes are therefore queue/merge room, not `tramNear`; they belong to the
pedestrian-overlap item. The single seed and the benchmark's omissions limit the comparison, and no browser check was
performed.
