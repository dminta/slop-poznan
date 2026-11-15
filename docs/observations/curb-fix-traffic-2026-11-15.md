# Did the curb-epsilon pedestrian fix (9798737) worsen car–tram overlaps and Kaponiera holds? — 2026-11-15

## Result

**No.** The rise on the eight historical seeds is seed-sampling noise, not a traffic-rule regression. On twelve fresh
seeds the fix is neutral to better, and over all twenty seeds it is within noise. **No game code changed.**

The eight historical seeds `1 2 3 5 7 11 99 4242` were the ones the earlier tram/signal rounds were tuned and
accepted on (28 pairs, 4 holds > 120 s were the minimum found on them). The simulation is chaotic: `Math.random` is
shared by traffic, pedestrians and trams, so any change in a pedestrian's behaviour changes every later draw and
decorrelates every vehicle trajectory from the old run. A re-roll of a seed set that was selected for low values
regresses to the population mean.

## Setup

`pre` = `df2b727` with the two `9798737` lines in `walk()` reverted (identical to d7aae30 behaviour; reproduces the
raw `.agent-task/pre-curb-*` events). `post` = `df2b727`. 5 min, 15 fps, 7 districts, `audit-tram-overlaps.mjs` and
`bench-traffic.mjs`.

## Car–tram overlap pairs

| seeds | pre | post |
|---|---|---|
| historical 8 (`1 2 3 5 7 11 99 4242`) | 28 | 44 |
| fresh 12 (`13 17 19 23 29 31 37 41 43 47 53 59`) | 56 | 46 |
| all 20 | 84 (4.2 / seed) | 90 (4.5 / seed) |

Fresh-seed pairs by district (pre → post): Jeżyce 28 → 27, Kaponiera 14 → 14, Centrum 4 → 2, Stare Miasto 5 → 0,
Rataje 5 → 3. Moving contacts on the fresh seeds fall 29 → 19, stopped stay 27 → 27. Per-seed fresh counts move by up
to ±4 in both directions (e.g. seed 59: 9 → 4, seed 37: 3 → 5), the same spread as the historical difference.

## Kaponiera holds and deadlocks (`bench-traffic.mjs`)

| seeds | holds > 120 s pre → post | of which Kaponiera | deadlocks pre → post | box-stuck |
|---|---|---|---|---|
| historical 8 | 4 → 15 | 4 → 15 | 0 → 0 | 7 → 11 |
| fresh 12 | 19 → 12 | 18 → 8 | 2 → 1 | 19 → 18 |
| all 20 | 23 → 27 | 22 → 23 | 2 → 1 | 26 → 29 |

Mean speed over all 20 seeds, pre → post (km/h): Jeżyce 14.28 → 14.74, Łazarz 14.16 → 14.08, Centrum 14.07 → 14.29,
Kaponiera 12.58 → 13.01, Stare Miasto 17.95 → 18.00, Rataje 17.07 → 17.08, Wilda 16.48 → 16.76. No district loses
more than 0.1 km/h; Kaponiera on the fresh seeds gains 0.65.

## Mechanism

- The bug the fix removed only affected four crossings (`139`, `1662`, `2634`, `3158`; walkers walking onto the road on
  green). Only `139` lies in a sampled district (Rataje, 50 m from the camera), and Rataje's pairs are unchanged on the
  historical seeds (2 → 2) and fall 5 → 3 on fresh ones. Kaponiera and Jeżyce, where the "new" contacts are, contain
  none of the four, so the old jaywalkers cannot have delayed cars there. Hypothesis 1 (cars were delayed by walkers
  on the crossing and now arrive at tram conflict zones) is not supported.
- Hypothesis 2 (phase requests served differently) is not supported either: the demand-crossing audit shows 0
  road-green violations and request latencies of 7–25 s, unchanged by the fix at all nodes except the four.
- What does change everywhere is the random stream: the fix alters when a handful of pedestrians stand or walk, so
  every later `Math.random()` draw (spawn, destination, speed variation) differs and cars meet trams in different
  places. The post-run events on the historical seeds are the familiar types (Kaponiera `(-1383,-214)` and
  `(-1135,150)` connector conflicts, Jeżyce `(-2050,-456)` shared-lane contacts), just in other seeds and with
  different vehicle ids, which is what a resampled population looks like.

## Decision

No rule change: there is no gate the fix moves traffic through, and tuning against eight seeds that were already
selected would overfit them again. The earlier per-seed baselines (28 pairs, 4 holds) stay valid only as paired
comparisons of a *code change that does not touch the random stream*. Any change that alters pedestrian behaviour
needs the fresh-seed set above (baseline 84 pairs / 23 holds pre-fix, 90 / 27 now on 20 seeds), not just the eight.
The pedestrian-overlap audit and the demand-crossing audit are unaffected as there is no code change.
