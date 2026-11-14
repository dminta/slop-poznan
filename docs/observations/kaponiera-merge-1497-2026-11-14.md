# Kaponiera (-1497, 198) 3→2 Merge Investigation (2026-11-14)

## Summary

No game code was changed. On `eed1a16`, Kaponiera seed 5's worst hold (`145 s`, reported as `91%` `merge` at the 2-arm give-way `(-1497, 198)`) is a combination of **plain downstream capacity** on the `10.0 m` 2-lane exit `2367` into signal `(-1503, 224)` (`16 s / 60 s` green, with `tram 6` and pedestrians taking the first green so `#8` holds `2367 l1` for `114 s`) and `accelerate()`'s `mergingAhead` braking holding cars `6–10 m` short of the stop line behind stopped cars in the adjacent lane (which labels the queue `merge` instead of `room`). Three geometric fixes to `accelerate()`'s `mergingAhead` braking were tested and reverted because they regressed Kaponiera seed 2 (`14.1 → 12.3–13.2 km/h`) and introduced `boxStuck` at `(-1503, 224)` (`30 s`, seed 5) and `(-1494, 109)` (`73 s`, seed 3).

## Topology and Lane Mapping

- Upstream feeder `6171`: `(-1487, 151) -> (-1490, 170)`, `17.21 m`, 3 lanes (`out: [0, 1, 2]`).
- Approach `6172`: `(-1490, 170) -> (-1497, 198)`, `20.70 m`, 3 lanes (`l0, l1, l2`).
- Give-way node `2041` at `(-1497, 198)`: 2 arms (`in: [6172]`, `out: [2367]`), `move -> 2367` `turn: 'S'`, `out: [0, 1, 1]` (`l0 -> l0` straight-only; `l1` and `l2 -> l1` straight + right).
- Exit `2367`: `(-1497, 198) -> (-1503, 224)`, `10.00 m`, 2 lanes (1-car storage per lane).
- Downstream signal `313` at `(-1503, 224)`: `cycle 60 s`, `green0 34 s`, `start1 39 s`, `green1 16 s` (`26.7%` green for `2367`), `walkSpeed 1.2 m/s`.

## Per-second Trace: Seed 5 and Seed 3

Reproduced with `node tools/bench-traffic.mjs --only kaponiera --seed 5 --dump --trace -1497,198 --trace-min 5`:

1. **`T120..T257` (`137 s`) — `2367 l1` physically full:** `#8` (from `6172 l2`) enters `2367 l1` at `T140` and sits at `(-1503, 224)` for `114 s` (`T143..T257`): red (`T143..T186`), then `tram 6` (`T187..T197`, `11 s`) and `pedestrian` (`T198..T202`, `5 s`) consume the entire `16 s` `g1` green, then a second red (`T203..T254`), clearing at `T255..T257`. Meanwhile `#58` (lead of `6172 l1`, arrived `T120`) waits `137 s` for `room` on `2367 l1`, enters at `T257`, and sits at `signal` until `T300` (`43 s`).
2. **`T155..T300` (`145 s`) — `#18` in `6172 l1`:** `#18` arrives at `T155` behind `#53` behind `#58` in `6172 l1`. `2367 l1` is physically occupied for the entire `145 s` (`#8` then `#58`); `2367 l0` is also occupied (`#36`, `#77`, `#32`, `#16`) with `6172 l0` feeding it.
3. **Why `mergeFirst` is fair, and why `merge 91%` appears:** `l2` (`#8` at `T140`) and `l1` (`#58` at `T257`) alternate cleanly by `mergeArrival`. However, `accelerate()` calls `mergingAhead(v, f, j)` even when `mayEnter` already refused `v` for `'room'` and even when `v` has a leader in its own lane:
   - `#14` (lead of `6172 l2` after `#8` enters at `T140`) freezes at `s = 11.8` (`6.1 m` short of the stop line) for `118 s` (`T140..T258`) braking for stopped `#58` (`s = 18` in `l1`), never reaching `d <= 2` to set `mergeArrival` until `#58` leaves.
   - `#53` (behind `#58` in `l1` during `T142..T256`) oscillates every second between `car` and `merge` because `mergingAhead`'s `v.wait > 15 && v.waitReason === 'merge'` follower exemption clears `waitReason` to `car` on the next frame; after `#58` enters `2367 l1` at `T257`, `#53` freezes at `s = 12.2` (`6 m` short of the stop line) for `40 s` (`T260..T300`) braking for stopped `#14` (`s = 17.9` in `l2`), and `#54` (follower in `l2`) freezes at `s = 6.8` braking for `#53`.
   - Because `bench-traffic.mjs`'s `waitingOn()` stops at `waitReason === 'merge'`, `#18 -> #53`, `#14`, and `#54` are attributed to `merge` (`91%`) instead of `'room'` behind `#58`/`#8` at `(-1503, 224)`.

Seed 3 (`--trace -1497,198 --trace-min 5`) shows the same pattern: `#51` (`l2`, `T140`) and `#7` (`l1`, `T189`, `126 s` wait) alternate while `2367 l1` is occupied by `#56` then `#51`, and bus `#203` (`l2` lead) freezes at `s = 8.4` (`9.5 m` short of the stop line) for `45 s` with `merge/room`.

Across all 8 Kaponiera seeds on the baseline (`eed1a16`):

| Seed | `(-1497, 198)` stopped car-s | through | max wait | `merge` share | District `held > 120 s` |
|---:|---:|---:|---:|---:|---:|
| 1 | 636 | 14 | 116 s | 86% | 3 |
| 2 | 290 | 21 | 43 s | 54% | 0 |
| 3 | 1006 | 12 | 126 s | 87% | 1 |
| 5 | 1076 | 10 | 145 s | 91% | 6 |
| 7 | < 300 | – | – | – | 0 |
| 11 | 695 | 14 | 79 s | 84% | 0 |
| 99 | < 548 | – | – | – | 0 |
| 4242 | 1283 | 16 | 115 s | 87% | 1 |

## Candidate Variants Tested and Reverted

Three geometric guards on `accelerate()`'s `mergingAhead` braking (`js/traffic.js`) were tested on Kaponiera and reverted:

1. **`go && c && !v.claimed && mergingAhead(v, f, j)`** (skip `mergingAhead` braking when `mayEnter` refused `v`):
   - Seed 5 `(-1497, 198)` improved `1076 → 309 car-s`, `10 → 16` through, `145 → 101 s`, `merge 91% → 0%`; district `10.3 → 11.5 km/h`, `>120 s 6 → 5`.
   - **Regressions:** Seed 5 new `boxStuck` at `(-1503, 224) 30 s`; Seed 2 `14.1 → 12.3 km/h` (`stopped 45.6% → 51.1%`); Seed 7 `>120 s 0 → 1` and new `boxStuck` at `(-1494, 109) 37 s`; Seed 4242 `>60 s 18 → 22` and `(-1503, 224) 30 s` `boxStuck`.
2. **`o && o.v.speed >= 0.5`** (only brake for a moving adjacent-lane merger):
   - Seed 2 `14.1 → 13.2 km/h` (`>60 s 9 → 13`); Seed 3 `12.5 → 12.3 km/h`, `>60 s 11 → 22`, `>120 s 1`; Seed 5 `(-1503, 224) 30 s` `boxStuck`, `>120 s 5`.
3. **`!go && v.held === 'merge'`** (only apply `mergingAhead` braking when refused for `'merge'`):
   - Seed 2 `14.1 → 12.3 km/h` (`stopped 45.6% → 51.1%`); Seed 3 `(-1494, 109) 73 s` `boxStuck`, `>60 s 11 → 15`; Seed 5 `(-1503, 224) 30 s` `boxStuck`, `>120 s 5`.

Changing when cars pull up to merge stop lines shifts arrival timing at Kaponiera's short-link signals (`(-1503, 224)` and `(-1494, 109)`), pushing cars into boxes behind trams and pedestrians, while `#18`'s `145 s` hold in seed 5 remains bounded by `2367`'s `10 m` capacity into `(-1503, 224)`'s `16 s / 60 s` green.
