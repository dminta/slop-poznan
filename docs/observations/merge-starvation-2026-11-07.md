# Centrum seed 99 long hold, 2026-11-07

Reproduced a long Centrum hold. The original investigation kept no production code; a follow-up on the same day
retained the fix in the section at the end. Only the aggregate benchmark results and the single `--dump` snapshot were
documented at the time; the original ad-hoc per-second trace and the original variant patch were not retained. The
follow-up adds the benchmark's `--trace` option so the chain is reproducible (see below).

## Reproducible method

```
node tools/bench-traffic.mjs --only centrum --minutes 10 --fps 15 --seed 99 \
  --json /tmp/centrum-99-10min.json
```

Defaults: tram seed 1922, first 20 s excluded, cars sampled within 300 m once per simulated second. `--watch -1117,132`
prints a snapshot of that junction every 30 s; `--dump` stores one snapshot only, the longest wait as it stood. Neither
of those options produces a per-second time series; the follow-up adds `--trace` for that. The working tree at the time
included the uncommitted pedestrian-route/building-collider changes (`js/main.js`, `js/pedestrian-routes.js`,
`tools/bench-world.mjs`), so these numbers are not comparable with the historical `d7c4802` tables. No browser check
was run.

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

## Mechanism (partly reproducible; superseded by the retained trace below)

The reproducible part is the one t = 477 snapshot and the 30 s `--watch` snapshots around t = 450–480. They show the
queue behind #44 at the upstream line and the 9.4 m link `(-1117, 132) -> (-1136, 127)` occupied ahead.

The per-second times, car identities and the claim that the exit reservation still counted a lead held by `box`/`tram`
came from ad-hoc instrumentation that was removed and is **not retained**. That trace was therefore not reproducible
at the time; the retained `--trace` run below confirms the chain. The 184 s value is documented by the benchmark
aggregate and the worst snapshot; the chain is:

- the short link's lane 0 was occupied first by a left-turner, then by a car waiting at the downstream signal;
- the upstream car #44 reported `room` although the link was physically clear, because the exit reservation still
  included a priority lead from another approach that was itself held by `box`/`tram`;
- #44 missed that green and waited another cycle, with the queue behind it.

An ad-hoc script also read the two local signal plans (65 s cycle; offsets 17.9 s and 19.7 s). That script was not
retained. The conclusion — a compound of short-link storage, an exit reservation and a missed green, not a failure of
`mergeFirst` alone — is confirmed by the retained trace below. It belongs with the short-link left-turn/merge work
rather than with the rejected early-arrival and lane-lead variants.

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

## Status

- Resolved by the retained fix below: the 184 s chain is now reproducible with the benchmark's `--trace` option, and
  the patch is in the tree.
- The 8-seed × 7-district comparison was run for the retained fix (below). Centrum, including the target node and
  the two neighbours flagged in review, has no box-stuck seed. Kaponiera also improves (held > 120 s 12 → 3, no cycle).
- The baseline above is the committed `6a1a234` tree; the fixed numbers are the working tree with this change.
- Two tests were added: one for the blocked-lead reservation and one for the short-link straight fallback.

## Retained fix (2026-11-07)

The per-second chain is reproducible this time:

```
node tools/bench-traffic.mjs --only centrum --minutes 10 --fps 15 --seed 99 \
  --trace -1117,132 --trace-min 20
```

At t = 410 s the east-west green starts. The trace shows `#18` (a police car) on the south approach
`(-1121, 169) -> (-1117, 132)` stopped at its line at a red, `held tram`; `#44` on the east approach
`(-1074, 129) -> (-1117, 132)` stands less than a metre before its line with `held room`. Through t = 411–425 no car is
*waiting* on the link's lane 0 (the cars on it are clearing), yet `#44` remains refused: `#18` is the only priority
lead, and `room()` counts its exit reservation because police are exempt from the red-approach filter; from t = 421 s
the `downstreamStops` exception would have kept it eligible anyway. The east green is therefore wasted. The same trace
at t = 416–435 shows `#44` itself choosing the link's left turn and waiting there for a tram and then the downstream
signal, which holds the link's only usable lane for 26 s even after the reservation is gone.

Three changes in `js/traffic.js`:

1. **Blocked leads do not reserve a signal-start short link.** In both loops of `room()`, a lead that is stopped
   (< 0.5 m/s) and held by a physical obstruction (`box`, `tram`, `oncoming`, `crossing`, `pedestrian`, `turner`,
   `bus`, `lane`) is skipped when ranking and counting exit reservations, for an exit under 12 m whose start node is a
   signal. A lead waiting only for its own signal (`held 'signal'`), a moving lead, and a short exit from an
   unsignalised give-way keep the old rule. Tram-body reservations (`tramBlocks`) are untouched.
2. **A left turn does not wait on a short link between signals.** If `mayEnter` refuses a left turn from an edge under
   12 m whose ends are both signals, `accelerate` retries once with the first straight or other non-left move the same
   lane can make (`straightFallback`). It still turns left when the way is clear; this is not a protected signal phase
   and it does not remove a movement.
3. **A committed entrant does not stop in the upstream box.** In `room()`, when a car that cannot stop enters a long
   feeder (20 m or more) of a short signal-to-signal link, the space behind the rearmost car, not the sum of all gaps,
   is the available room. This keeps the Św. Marcin approach queue from backing into `(-1074, 129)` (seed 5: 53 s).
   Stoppable cars keep the old estimate; buses keep the short-link bus guard; the rule does not apply at give-way short
   exits.

The first change alone left the link blocked by the left-turner (and a narrower red-only variant still reached
198 s at the same car); the second is what keeps the link's single usable lane moving. The third removes the two new
box-stuck seeds found in review. The rejected early-arrival and lane-lead braking relaxations were not restored.

The benchmark's box-stuck definition now requires the vehicle's **body centre** past the stop line (`v.cs > 0`). A car
still standing on its approach with only a bumper over the line, or an 18 m bus whose centre stays on a 7.8 m link, is
not counted as a junction-box blockage; without this, seed 1's 36 s red wait and the same seed's 22 s bus wait looked
like boxes. The baseline tables below were re-measured with this definition.

| Centrum, seed 99, 10 min | Baseline | Retained fix |
|---|---:|---:|
| mean speed | 12.5 km/h | 12.5 km/h |
| stopped | 41.2% | 40.4% |
| `waitMax` / `longestHeld` | 184 / 184 s | 52 / 51 s |
| cars held > 60 s | 12 | 0 |
| cars held > 120 s | 1 | 0 |
| deadlocks | 0 | 0 |
| target `(-1117, 132)` stopped car-s | 2,488 | 1,191 |
| target `(-1117, 132)` through | 81 | 97 |
| target `(-1117, 132)` max wait | 184 s | 51 s |
| junction box at the target > 20 s | none | none |

The longest queue moved to `(-809, 251)` (12 cars, outside this junction) in that second half; the 5-minute window
does not reach it. On the eight seeds × seven districts, five-minute runs (seeds 1, 4242, 7, 99, 2, 3, 5, 11, compared
with a detached worktree at `6a1a234`):

| Centrum, 8 seeds, 5 min | Baseline | Retained fix |
|---|---:|---:|
| mean | 13.7 km/h | 13.9 km/h |
| stopped | 36.1% | 35.2% |
| longest queue | 8 | 8 |
| `waitP90` / `waitMax` | 31 / 106 s | 30 / 103 s |
| held > 60 s | 17 | 6 |
| held > 120 s | 0 | 0 |
| deadlocks | 0 | 0 |
| seeds with a box-stuck car | 2 | 0 |

The two baseline box seeds are `(-1074, 129)` 21 s on seed 11 and `(-1074, 129)` 59 s plus `(-1117, 132)` 20 s on
seed 7; with the fix Centrum has none. Across the eight 5-minute seeds the target junction took 372 → 393 cars through
(+6%) with 9,081 → 8,332 stopped car-seconds (-8%); its maximum wait fell 106 → 79 s. Over all seven districts
held > 60 s falls 164 → 117, held > 120 s 12 → 3, deadlocks 1 → 0 (the Kaponiera seed 11 cycle is gone) and box-stuck
seed-districts 13 → 11. Kaponiera improves (held > 60 s 114 → 80, > 120 s 12 → 3); Jeżyce, Łazarz, Stare Miasto and
Rataje are unchanged. Wilda's mean falls 15.9 → 15.5 km/h and stopped rises 35.4 → 36.5%, while its held > 60 s goes
2 → 0; that district is not part of this change and the difference is within the run-to-run spread.

The five-minute `tests/traffic-flow.test.mjs` window passes (Centrum seed 4242: `waitMax` 56 s, stopped 36.4%,
mean 13.5 km/h); the full `node --test tests/*.cjs` suite passes. No browser check was run.
