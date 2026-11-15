# Traffic acceptance noise floor and the curb-fix reproduction — 2026-11-15

`tools/accept-traffic.mjs` ([docs/testing.md](../testing.md#accepting-traffic-changes)) at `a69af9a`: 20 fresh seeds
(`61 67 71 73 79 83 89 97 101 103 107 109 113 127 131 137 139 149 151 157`, disjoint from the eight historical seeds and
from the curb record's twelve), 5 min, 15 fps, 7 districts, `--jobs 6`. About 30 min wall per 20-seed comparison, all
runs cold. Paired mean difference per seed (working − baseline) with a 95 % paired-bootstrap CI.

## Noise floor: same code, independent seeds

`--base worktree --baseline-seed-shift 1000` (baseline side runs the identical tree on seeds + 1000, so the two sides are
independent samples of one distribution):

| metric | baseline | working | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 95 | 74 | -1.05 | [-1.95, -0.15] | better |
| holds > 120 s | 15 | 28 | +0.65 | [-0.55, +1.85] | within noise |
| deadlocks | 8 | 3 | -0.25 | [-0.5, 0] | within noise |
| max wait s | 2320 | 2195 | -6.25 | [-20.8, +8.65] | within noise |
| km/h all (sum of 20 seeds) | 304.4 | 304.0 | -0.02 | [-0.28, +0.25] | within noise |
| km/h Kaponiera (info) | 259.5 | 262.7 | +0.16 | [-0.36, +0.69] | within noise |
| km/h Wilda (info) | 341.1 | 324.8 | -0.81 | [-1.84, +0.25] | within noise |

(Other district speeds: every diff within ±0.2 km/h per seed, all within noise.) No gate read `worse` and no deadlock
pattern repeated, so the exit status was 0. One of the twelve metrics (car–tram pairs, 74 vs 95) still read `better`
on identical code: that is the expected ~5 % per-metric false alarm, and it points the harmless way. Practical
floor for 20 seeds, from these intervals: **car–tram pairs about ±1 pair/seed (≈ ±20 total)**, **holds > 120 s about
±1.2 per seed (≈ ±25 total)**, deadlocks ±0.4/seed, max wait ±15 s, overall mean speed ±0.25 km/h/seed, a district
±0.5 km/h/seed (Wilda ±1). Per-seed differences of the same code reach ±4–5 pairs and ±7 holds, so single-seed or
eight-seed readings of a few pairs say nothing. Identical trees on identical seeds are bit-identical (a 3-seed smoke run
without a shift agreed to the last digit), so a difference between two trees on the same seeds is a real code or
random-stream change; the CI says whether it is more than resampling.

## Curb fix `9798737` vs its parent `d7aae30`

`--base d7aae30 --work 9798737`, same 20 seeds:

| metric | d7aae30 | 9798737 | mean diff / seed | 95 % CI | verdict |
|---|---|---|---|---|---|
| car–tram pairs | 93 | 74 | -0.95 | [-1.95, +0.10] | within noise |
| holds > 120 s | 49 | 28 | -1.05 | [-2.75, +0.40] | within noise |
| deadlocks | 1 | 3 | +0.10 | [-0.10, +0.30] | within noise |
| max wait s | 2382 | 2195 | -9.35 | [-24.35, +6.60] | within noise |
| km/h all (sum) | 302.1 | 304.0 | +0.10 | [-0.09, +0.28] | within noise |
| km/h Kaponiera (info) | 251.2 | 262.7 | +0.57 | [+0.13, +0.99] | better |
| other districts (info) | | | -0.12 … +0.20 | all straddle 0 | within noise |

The curb fix is **not a regression**: every gate is within noise and the point estimates point the better way (fewer
pairs, fewer holds), reproducing the earlier finding that the eight-seed rise (28 → 44 pairs, 4 → 15 holds) was
resampling noise. Per seed the sign flips freely (pairs −5 … +3, holds −11 … +4). Kaponiera speed is the only interval
clear of zero (+0.57 km/h/seed), in the better direction. No new deadlock pattern (three deadlocks over 20 seeds, none
repeated). The sign matches the curb record's fresh-seed result (improvement), while its eight historical seeds read the
other way.

Cross-check: the working side here (`9798737`) and the noise run's working side (`a69af9a`) give identical per-seed
numbers (74 pairs, 28 holds, 3 deadlocks, max wait 2195 s). The 400 lines of `js/` and tools changed between the two
commits (culling, street-details, landmarks) leave the headless traffic stream untouched.

## Reading guidance

- Use the 20-seed run; a clear `worse` needs a shift larger than the floor above. Extend with `--seeds` (cached seeds are
  reused) when an interval just touches zero.
- Expect about one false alarm in twenty comparisons per gated metric; rerun a flagged gate on 20 other seeds before
  acting.
- The `km/h` rows in the table sum the per-seed means, so divide by 20 for km/h.
