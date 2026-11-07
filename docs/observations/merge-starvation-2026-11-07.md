# Centrum seed 99 long hold, 2026-11-07

Reproduced a long Centrum hold and tried one candidate fix. No production code was kept. Only the aggregate benchmark
result and the single `--dump` snapshot are documented; the per-second trace and the variant patch are not.

## Reproducible method

```
node tools/bench-traffic.mjs --only centrum --minutes 10 --fps 15 --seed 99 \
  --json /tmp/centrum-99-10min.json
```

Defaults: tram seed 1922, first 20 s excluded, cars sampled within 300 m once per simulated second. `--watch -1117,132`
prints a snapshot of that junction every 30 s; `--dump` stores one snapshot only, the longest wait as it stood. Neither
option produces a per-second time series. The working tree at the time included the uncommitted
pedestrian-route/building-collider changes (`js/main.js`, `js/pedestrian-routes.js`, `tools/bench-world.mjs`), so these
numbers are not comparable with the historical `d7c4802` tables. No browser check was run.

## Reproduction (documented)

Two identical 10-minute runs gave the same aggregate. `waitMax` is the longest finished wait among sampled cars;
`longestHeld` is the longest continuous wait seen at a sampling point. They are different statistics and are not
interchangeable.

| Metric | Centrum, seed 99, 10 min |
|---|---:|
| mean speed | 12.5 km/h |
| stopped | 41.2% |
| `waitMax` | 184 s |
| `longestHeld` | 184 s |
| cars held > 60 s | 12 |
| cars held > 120 s | 1 |
| deadlocks / switch holds > 60 s | 0 / 0 |

The worst junction is the Św. Marcin signal at `(-1117, 132)`: 2,488 stopped car-seconds, 52% of them with a merge root
cause and 37% signal. A 5-minute run ends at 300 s and gives `waitMax` 54 s and `longestHeld` 53 s, with no car over
60 s; its window ends before the t = 477 s peak, so it neither reproduces nor contradicts the 10-minute result. The event
is a second-half-of-run queue, not the 110 s hold in the older 5-minute record.

The `--dump` snapshot at t = 477 shows car #27 with a 184 s wait on the 25.1 m approach
`(-1074, 129) -> (-1117, 132)`, lane 1, behind #36. #36 is 6.6 m behind the line with `waitReason 'merge'` and no leader
left in its own lane; both wait for #44 in lane 0.

## Mechanism (partly reproducible)

The reproducible part is the one t = 477 snapshot and the 30 s `--watch` snapshots around t = 450–480. They show the
queue behind #44 at the upstream line and the 9.4 m link `(-1117, 132) -> (-1136, 127)` occupied ahead.

The per-second times, car identities and the claim that the exit reservation still counted a lead held by `box`/`tram`
came from ad-hoc instrumentation that was removed and is **not retained**. That trace is therefore **not reproducible**.
The 184 s value is documented by the benchmark aggregate and the worst snapshot, but the exact blocking chain below is
an interpretation, not a retained trace:

- the short link's lane 0 was occupied first by a left-turner, then by a car waiting at the downstream signal;
- the upstream car #44 reported `room` although the link was physically clear, because the exit reservation still
  included a priority lead from another approach that was itself held by `box`/`tram`;
- #44 missed that green and waited another cycle, with the queue behind it.

An ad-hoc script also read the two local signal plans (65 s cycle; offsets 17.9 s and 19.7 s). That script was not
retained. The conclusion — a compound of short-link storage, an exit reservation and a missed green, not a failure of
`mergeFirst` alone — is therefore a hypothesis. It belongs with the open short-link left-turn/merge items rather than
with the rejected early-arrival and lane-lead variants.

## Candidate variant (rejected, not reproducible)

One unretained variant was measured at the time: in `room()`, on an exit shorter than 12 m, do not count an exit
reservation from a priority lead whose current `held` was `tram` or `box`. The patch was reverted and is not in the
repository, so the table cannot be reproduced from the current tree.

| Centrum seed 99, 10 min | Baseline | Variant |
|---|---:|---:|
| `longestHeld` / `waitMax` | 184 / 184 s | 133 / 133 s |
| held > 60 s | 12 | 11 |
| held > 120 s | 1 | 1 |
| mean speed | 12.5 km/h | 12.2 km/h |
| stopped | 41.2% | 41.9% |
| junction box with a car stopped inside > 20 s (target node) | none | `(-1074, 129)`, 52 s |

The 10-minute run is outside the 5-minute `tests/traffic-flow.test.mjs` window, so this does not establish a regression
test failure. It also does not demonstrate a no-regression change: the same seed was slower and more stopped, one car
still exceeded 120 s, and a car stood in the junction box at the target node `(-1074, 129)` for 52 s. The variant was
therefore not kept. `git diff` for `js/traffic.js` contains only the unrelated pedestrian-route wiring that was already
in the tree.

## Open

- The documented aggregate supports the 184 s hold but not the exact short-link/reservation chain. A future investigation
  must retain its per-second instrumentation and patch before publishing a causal result.
- The 8-seed × 7-district comparison was not run for this variant. Any future change to the reservation or the adjacent
  signals needs it, without trading the hold for a box-stuck car or a slower district.
- Re-run the aggregate after the uncommitted pedestrian-route changes land, so the baseline is a committed tree.
- No automated test was added because no production behaviour changed. The only reproducible command is above.
