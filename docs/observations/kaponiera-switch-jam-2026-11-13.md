# Kaponiera switch investigation, 2026-11-13

No runtime change. At `4c08e9d`, the assigned seed-7 139 s hold is already gone. The 2026-11-11 signal-plan
record's result table correctly shows seed 7 at 95 s and zero holds over 120 s; its remaining-cases prose and the
backlog had carried forward the older seed-7 diagnosis. The one remaining hold over 120 s is seed 1's separate
175 s boundary queue. This investigation corrects those references, without changing signals or taking on that queue.

## Current baseline

Five simulated minutes, 15 fps, the ordinary benchmark world and update order. Seeds run in independent processes,
up to four at a time. Values below are freshly measured on the assigned tree, before any edits.

| Seed | km/h | stopped % | held >60 s | held >120 s | longest hold s | deadlocks | off-stop trams >60 s | max switch wait s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 15.2 | 42.1 | 8 | 1 | 175 | 0 | 6 | 13.9 |
| 4242 | 13.6 | 45.8 | 6 | 0 | 111 | 0 | 6 | 32.7 |
| 7 | 12.9 | 49.6 | 12 | 0 | 95 | 0 | 2 | 7.9 |
| 99 | 12.3 | 51.6 | 15 | 0 | 112 | 0 | 3 | 36.7 |
| 2 | 13.1 | 50.5 | 13 | 0 | 116 | 0 | 1 | 41.3 |
| 3 | 13.2 | 47.0 | 1 | 0 | 70 | 0 | 2 | 41.9 |
| 5 | 12.0 | 51.5 | 17 | 0 | 112 | 0 | 8 | 6.7 |
| 11 | 12.2 | 52.6 | 18 | 0 | 113 | 0 | 4 | 25.9 |
| mean / sum / maximum | 13.0625 | 48.8375 | 90 | 1 | 175 | 0 | 32 | 41.9 |

The totals match the task's 90 / 1 / 13.1 / zero-deadlock expectation, but the seed attribution does not. No seed
has a switch hold over 60 s. Repeating seed 7 with the requested trace/watch/dump gives an identical JSON result:
zero repeat noise at the benchmark's reported precision. `--trace-min 100` emits no trace line there. Seed 1's dump
instead identifies bus 207 at `(-1185,138)`, waiting 175 s behind car 49 on the approach to `(-1136,127)`.

## Isolated historical replay

To investigate the old claim without changing shipping files, a scratch entry point sets the exported exceptional
signal plan's `walkSpeed` to 1 **in memory**, before `buildWorld`. This reconstructs its earlier 40/10 split instead
of the current 34/16 split. It is a diagnostic historical comparison, not a proposed signal variant. Copies of the
benchmark/world loader under `.agent-task/` retain the normal seeded sequence and update order, and instrument the
loaded tram source to log node holders, track-crossing holders, body occupancy and per-second vehicle state.

The replay reproduces the old seed-7 result: **13.6 km/h, 47.7% stopped, 9 held >60 s, 1 held >120 s, longest hold
139 s, zero deadlocks, 3 off-stop trams >60 s, maximum switch wait 81.4 s**. Repeating with the additional state
probe produces an identical benchmark JSON row. The old table is reproducible; it describes an earlier signal phase.

The trace distinguishes pooled tram IDs from displayed line numbers:

1. At t=159–227, line **20**, pooled tram **18**, approaches from the west and stops around `(-1518,80)`.
   Its blocker is line **18**, pooled tram **16**, physically straddling switch node `(-1463,89.3)`. At t=159 its
   body occupies edges 72–75; the rear is still on edge 72, before that node. `holds()` is true, rather than a
   future-approach claim. The holder waits for car 4, then car 41, then car 25; the first two are refused for exit
   room on the northern road links and subsequently move into signal queues. The holder creeps forward as cars
   clear. At t=226 it is moving again; the switch releases when its rear clears. The benchmark's longest-stop
   text reports line 20 at this location for 61 s, not 81 s.
2. At t=230–233, line 20 advances towards its stop. From t=234 it brakes for a **different** conflict: a track
   crossing with edge **607**, at coordinate **1126.834 m** on that edge. The holder is line **14**, pooled tram
   **15**, boarding at Rondo Kaponiera around `(-1420,91)`. Its occupied interval at t=240 is
   **[1116.080, 1147.980] m**, which contains the crossing. This is `crossHeld()`, not `crossApproach()`.
   Line 20 stands around `(-1487,85)` from about t=239 to t=268. Line 14 departs at t=264, moves at 4.36 m/s
   by t=267, and clears the crossing with its rear; line 20 starts immediately afterwards. No missed release is
   observed. Pulling the gate back over the short switch complex explains why the waiting nose is about 50.5 m
   before this later crossing: `complexStopGate()` reserves the whole tram's exit space.
3. The **81.4 s** maximum belongs to line **2**, pooled tram **3**, around `(-1395,96)` (t≈189–270).
   It is not line 20's later wait at `(-1487,85)`. The old prose conflated a district maximum with one nearby tram.

Car 16 stands at `(-1498.485,76.716)` from about t=131 through t=270. Its binding reason changes between `room`
and `tram`; this is not 139 s continuously attributed to one tram reason. Nor do all three mouths carry proxies
throughout that interval. At t=180–226 only lane 2 of outgoing road edge **3277** (10 m) carries line 20's pad,
at s=0.146, half-length 2.625 m. During its advance and later stop (t=230–268), all three lanes carry that tram's
pads, at s=2.000 / 1.039 / 0.319 m. At t=240 its nose is `(-1471.268,87.870)` and its body extends west across the
road mouths. Those later reservations cover a tram body, not just a distant approach forecast. At t=271 lane 2's
pad disappears as the rear passes and car 16 starts at 0.66 m/s; line 20 moves away at 3.58 m/s. The remaining pads
clear lane by lane. This is the ordinary historical release, not a newly released car or a fix-safety claim.

## Classification and decision

There is **no current seed-7 case to fix**. For the historical tram-side reservation mechanism, the evidence supports
**(c), occupied-track queueing**, rather than (a): line 20 waits for actual switch/crossing occupancy, first behind
car-held line 18 and then a boarding line 14. Neither a far-tram priority inversion nor an unreleased reservation
was observed. This does not prove that every historical proxy placement is geometrically minimal. In particular,
the earlier single-lane pad would need a swept-car clearance and restart-safety proof before claiming (b); a stopped
tram alone does not provide that proof. There is no current reproduction on which to validate such a change.

No shipping variant was tried or retained, and no rejected proxy/release rule from the backlog was revived. The
historical signal replay is not eligible for acceptance: it recreates the very hold being investigated and uses an
obsolete signal split. Changing the current tram/proxy rules to remove a hold already absent would not demonstrate
an improvement. The separate seed-1 queue and seed-5 box stop remain open.

## Validation and commands

```
node tools/bench-traffic.mjs --only kaponiera --seed <1|4242|7|99|2|3|5|11> --json <file>
node tools/bench-traffic.mjs --only kaponiera --seed 7 --trace -1496,82 --trace-min 100 --watch -1496,82 --dump --json <file>
node tools/bench-traffic.mjs --only kaponiera --seed 1 --trace -1136,127 --trace-min 120 --dump --json <file>
node .agent-task/replay-historical.mjs --only kaponiera --seed 7 --trace -1496,82 --trace-min 100 --json <file>
node --test tests/
```

**601 tests passed, zero failed** (112.965 s). No runtime source, source-sliced marker or test was changed. The
full eight-seed all-district benchmark and overlap audit were not rerun: the task conditions those on an improving
runtime candidate, and none exists here. The previously recorded current audit total remains **37 pairs**; that
is a cited baseline, not a fresh audit result. There is consequently no new per-district before/after table or
new-car-release safety check to report. No browser/audio check was needed for these documentation corrections.

Raw JSON/logs and diagnostic copies are in this worktree's `.agent-task/`: `results/base-k-*`, `trace7*`, `trace1*`,
`historical7*`, and `tests.log`. They are task-local artifacts, not shipping tools. The production docs contain the
measurements and mechanism so the finding survives removal of those artifacts.
