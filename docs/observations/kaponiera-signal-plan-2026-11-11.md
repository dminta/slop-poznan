# Kaponiera signal plan: the 38 m crossing and the 10 m give-way link, 2026-11-11

Seed 2's 10 holds over 120 s were the last car queue in Kaponiera after `e526603`: the three-lane approach from
`(-1490, 170)` fed a 10 m, two-lane exit into the signal at `(-1503, 224)`, whose 60 s plan gave the exit only 10 s of
green. The plan spent 40 s of the cycle on the 37.8 m pedestrian crossing over Roosevelta's tram corridor at the 1 m/s
accessibility speed. The crossing needs 32 s at a 1.2 m/s design walking speed (the 1.2–1.4 m/s range used for
crossings), so the plan now clears it at 1.2 m/s at this one site (`SIGNAL_WALK_SPEEDS`): green0 40 → 34 s,
green1 10 → 16 s, start1 45 → 39 s, cycle and offset unchanged. Seed 2 goes 10 → 0 holds over 120 s and the
longest hold 169 → 116 s; the eight Kaponiera seeds go 11 → 1 hold, 130 → 90 over 60 s and 12.6 → 13.1 km/h with no
deadlock. The costs are seed 1's new 175 s queue at Centrum's boundary and seed 5's one box stop; Centrum is
0.2 km/h lower and Jeżyce 0.1 higher, and the other four districts are bit-identical. The eight-seed car–tram audit
is 37 before and 37 after on this tree (Kaponiera 9 → 8, Jeżyce 21 → 23, Centrum 2 → 1); the 36 in the task note was
measured at `8c41595`, before the tree's later changes.

## Method

```
node tools/bench-traffic.mjs --only kaponiera --seed <1|4242|7|99|2|3|5|11> --json <file>
node tools/bench-traffic.mjs --seed <same eight> --json <file>
node tools/bench-traffic.mjs --only kaponiera --seed 2 --trace -1497,198 --trace-min 100
node tools/bench-traffic.mjs --only kaponiera --seed 2 --trace -1503,224 --trace-min 40
node tools/bench-traffic.mjs --only kaponiera --seed 2 --watch -1503,224
node tools/audit-tram-overlaps.mjs --seed <same eight>
node tools/audit-signal-heads.mjs
node --test tests/
```

Five simulated minutes at 15 fps per district, first 20 s excluded, cars within 300 m sampled once per second. Seed 2's
give-way trace and pace (`--trace -1497,198 --trace-min 100`) show the two link cars at the stop line for a whole
red, the six-car three-lane approach behind them, and the give-way passing 12 cars in 5 min (2.4/min). A scratch
probe (`.agent-task/probe-*.mjs`, not committed) read the graph, the crosswalk widths and the plan values; a 300 s
tram probe counted tram-seconds within 40 m of the signal.

## Root cause

The signal at `(-1503, 224)` (plan 49, Franklina Roosevelta corridor, cycle 60 s, offset 27.6998 s) has one crossing,
on arm side 1: 40.97 m of track, of which 37.77 m is the curb-to-curb walk. It crosses the wide Roosevelta/tram mouth
diagonally; the rail clearance falls to 0.1 m mid-span, so there is no median refuge to split it at.

`configureSignals` measured that 37.77 m walk and `configureSignalClearance` reserved 40 s for the group-0 stage at
1 m/s (`ceil(37.77 + 2)`). The cycle stayed 60 s, so group 1 got `60 - 40 - 10 = 10 s`. The give-way from
`(-1497, 198)` feeds group 1 over edge 2367 (`10.0 m`, 2 lanes) from a `20.7 m`, 3-lane approach fed by a further
61 m of 3-lane links from the signal at `(-1494, 109)` (plan 237, green0 20 s). The link stores about one car per lane,
so it drains 2–2.4 cars per cycle; the upstream green releases far more. The queue is demand against the fixed 10 s
green, not a lost slot or a car rule: the two cars at the line wait the whole red, the six in the approach wait two or
three cycles, and seed 2 reports 10 cars over 120 s and a 169 s sampled hold. A zero-demand crossing would still
deserve the same walk; the lever is the walking speed, not a shorter walk for people.

The simulation's pedestrians themselves walk at 1.22–1.78 m/s (`preferred walking speed` in `traffic.js`), so a 1 m/s
clearance is a conservative accessibility value, not a measured speed.

## Change

`SIGNAL_WALK_SPEEDS` in `js/city-config.js` lists the one site whose clearance runs at 1.2 m/s, keyed by the signal
site `(-1496.1, 232.3)`:

- plan 49 only: `walkSpeed: 1.2` on the timing object, read by `configureSignalClearance`;
- `min0 = ceil(37.77 / 1.2 + 2) = 34`, `start1 = 39`, `green1 = 16`, `cycle` stays 60 and the corridor `offset`
  stays 27.6998 (the group-0 green still starts where the 40 km/h wave puts it);
- the last WALK entrant (second 7) has `green0 - 2 = 32 s` for 37.77 m = 1.18 m/s, just under the slowest walker; the
  2 s red clearance still separates it from group 1's green.

The displayed heads, pedestrian WALK/flashing states and audio read the same `signalTiming` object, so nothing else
changed. `tests/signal-clearance.test.cjs` now checks every crossing at its plan's design speed, pins plan 49's
`cycle/green0/green1/start1` and offset, and asserts that it is the only plan above 1 m/s.

## Result

Kaponiera, eight seeds, `--only kaponiera`, 5 min (base `0fa5f4a` → this change). `held` is the sampled count and
`longest` the longest sampled hold.

| Seed | km/h | stopped % | wait p90 / max s | held > 60 s | held > 120 s | longest hold | deadlocks | trams > 60 s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13.6 → 15.2 | 48.3 → 42.1 | 44 / 118 → 38 / 175 | 16 → 8 | 0 → 1 | 118 → 175 | 0 → 0 | 1 → 6 |
| 4242 | 13.7 → 13.6 | 47.1 → 45.8 | 44 / 112 → 40 / 111 | 8 → 6 | 0 → 0 | 111 → 111 | 0 → 0 | 1 → 6 |
| 7 | 13.6 → 12.9 | 47.7 → 49.6 | 47 / 140 → 43 / 95 | 9 → 12 | 1 → 0 | 139 → 95 | 0 → 0 | 3 → 2 |
| 99 | 12.1 → 12.3 | 52.8 → 51.6 | 43 / 89 → 44 / 113 | 16 → 15 | 0 → 0 | 119 → 112 | 0 → 0 | 7 → 3 |
| 2 | 11.3 → **13.1** | 56.0 → **50.5** | 50 / 145 → 50 / **116** | 27 → **13** | **10 → 0** | **169 → 116** | 0 → 0 | 2 → 1 |
| 3 | 11.1 → **13.2** | 55.7 → **47.0** | 51 / 97 → 47 / 71 | 18 → **1** | 0 → 0 | 115 → 70 | 0 → 0 | 2 → 2 |
| 5 | 11.8 → 12.0 | 53.8 → 51.5 | 52 / 121 → 44 / 112 | 28 → 17 | 0 → 0 | 120 → 112 | 0 → 0 | 8 → 8 |
| 11 | 13.5 → 12.2 | 47.9 → 52.6 | 46 / 86 → 48 / 114 | 8 → 18 | 0 → 0 | 85 → 113 | 0 → 0 | 7 → 4 |
| **total / mean** | **12.59 → 13.06** | **51.2 → 48.8** | 46 / 145 → 44 / 175 | **130 → 90** | **11 → 1** | 169 → 175 | **0 → 0** | **31 → 32** |

Seed 2's own measure of the change: the give-way through count goes 12 → 19 cars in 5 min (2.4 → 3.8/min), its
stopped car-seconds 1560 → 542, the signal's 1497 → 925, and the signal's through count 20 → 27. The 175 s seed-1 hold
is a bus in a `room` queue into Centrum's `(-1136, 127)`, on the sampled boundary; seed 1's mean rises 13.6 → 15.2 and
its held > 60 s falls 16 → 8. Seed 11 is the one clear car regression (13.5 → 12.2 km/h, held > 60 s 8 → 18); its
longest hold stays 113 s and the eight-seed totals are the acceptance measure.

All districts, eight seeds (the same runs seed the whole network; only Kaponiera's plan changed):

| District | km/h | stopped % | worst wait s | held > 60 s | held > 120 s | deadlocks | trams > 60 s |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.7 → 14.8 | 32.8 → 32.3 | 85 → 85 | 15 → 15 | 0 → 0 | 0 → 0 | 11 → 10 |
| Łazarz | 14.6 → 14.6 | 25.4 → 25.4 | 39 → 39 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Centrum | 14.9 → 14.7 | 31.9 → 32.3 | 72 → 72 | 2 → 3 | 0 → 0 | 0 → 0 | 3 → 3 |
| Kaponiera | 12.6 → **13.1** | 51.2 → **48.8** | 145 → 175 | 130 → **90** | **11 → 1** | 0 → 0 | 31 → 32 |
| Stare Miasto | 18.0 → 18.0 | 7.2 → 7.2 | 37 → 37 | 0 → 0 | 0 → 0 | 0 → 0 | 17 → 17 |
| Rataje | 17.0 → 17.0 | 35.1 → 35.1 | 95 → 95 | 6 → 6 | 0 → 0 | 0 → 0 | 22 → 22 |
| Wilda | 15.9 → 15.9 | 35.0 → 35.0 | 63 → 63 | 1 → 1 | 0 → 0 | 0 → 0 | 56 → 56 |
| **all** | **15.38 → 15.44** | **31.2 → 30.9** | 145 → 175 | **154 → 115** | **11 → 1** | **0 → 0** | **140 → 140** |

Jeżyce's and Centrum's rows move through the tram schedule, not their car rules: trams obey the signal at
`(-1503, 224)` too (group 1), and the earlier, longer group-1 green changes their global timing. Łazarz, Stare Miasto,
Rataje and Wilda are bit-identical on every seed. At the Kaponiera span itself a 300 s seed-2 probe within 40 m of the
signal finds stopped tram-seconds 37 → 34 and the longest tram stop 33.3 → 27.3 s; the extra 1 in the `trams > 60 s`
column is the distant `(-1246, 637)`/`(-1032, 142)` backlog that moves with the changed tram schedule.

## Car–tram overlap audit

`node tools/audit-tram-overlaps.mjs --seed <seed>`, eight seeds, five minutes, same worlds and order as the benchmark.
On this tree (`0fa5f4a`) the baseline is already **37** pairs, not the 36 of the task note (that was `8c41595`);
this change leaves the total at **37**:

| | Jeżyce | Łazarz | Centrum | Kaponiera | Stare Miasto | Rataje | Wilda | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| before | 21 | 0 | 2 | 9 | 5 | 0 | 0 | **37** |
| after | 23 | 0 | 1 | **8** | 5 | 0 | 0 | **37** |

Kaponiera drops 9 → 8. Jeżyce gains two earlier-in-the-run contacts (the changed tram timing), Centrum loses one, so
the total is unchanged and not above the current baseline; it is one above the task's stale 36.

## Rejected variants

All are Kaponiera-only runs unless stated; "audit" is the eight-seed car–tram total (baseline 37).

- **1.2 m/s for every plan** (`min0 = ceil(width/1.2 + 2)` globally): 173 of 417 plans re-time. Seed 2 is excellent
  (14.1 km/h, 0 holds) but the eight seeds reach **2 deadlocks** (seeds 1 and 5), mean 13.5 km/h, held > 120 s 1,
  worst 175 s. Deadlocks rule it out.
- **green1 12 s** (walk speed 1.05, green0 38): seed 2 0 holds / 68 s, mean 12.588, held > 120 s 3, but audit 38
  (Kaponiera 10) and seed 4242 gains two holds.
- **green1 13 s** (1.1 m/s, green0 37): mean 12.325, lower than the baseline; audit 39 (Kaponiera 11).
- **green1 14 s** (1.13 m/s, green0 36): 1 deadlock (seed 5) and held > 120 s 10.
- **green1 15 s** (1.15 m/s, green0 35): 1 deadlock and 13 holds over 120 s.
- **Offset only** (keep the 1 m/s 40/10 split, shift plan 49 by +6 s): seed 2 still has 7 holds / 171 s and mean
  11.3 km/h. The link is demand-saturated, so moving its green does not add capacity.
- **Phase-preserving offsets** (add `min0(at 1 m/s) - min0` to the offset so the cross street's green starts where it
  did): +6 s with green1 16 keeps Centrum and Jeżyce bit-identical (Centrum stays 15.5/29.9 on seed 1) but gives
  8 holds over 120 s, 40 trams > 60 s and audit 38; +3 s with green1 13 gives 0 holds on seed 2 but audit 39.
  Preserving the tram phase moves the extra green to the end of group 1, where it conflicts with the tram path.
- **Splitting the crossing**: no refuge exists. `blockAt` along the 37.8 m path returns the same block and the rail
  clearance falls to 0.1 m mid-span, so a two-stage pedestrian phase would need new geometry, not a plan.
- **Changing the cycle** (60 → 70/76 s to lengthen group 1): the Roosevelta corridor shares a 60 s cycle and the
  offsets from distance at 40 km/h; `tests/signal-clearance.test.cjs` pins both. Re-timing one site would break the
  green wave for all its neighbours.

## Tests

`tests/signal-clearance.test.cjs` was updated and extended as described above. `node --test tests/`: **502 passed,
0 failed** (155.8 s), including the five-minute traffic-flow regression and the signal-head and pedestrian-route
audits. `node tools/audit-signal-heads.mjs` reports A 190 / B 0 / C 0 / D 11 (201), with the runtime heads and the
plans on the same clock.

## Remaining cases

- Seed 7's one 139 s hold is unchanged in kind: a line-20 switch jam holds the crossing proxies at `(-1496, 82)`, not a
  car queue.
- Seed 1's 175 s bus queue into Centrum's `(-1136, 127)` and seed 5's box stop are new side effects of the changed
  flow; both sit outside the Kaponiera junction and were the price of draining seed 2.
- Seed 11's mean falls 13.5 → 12.2 km/h while its longest hold stays 113 s; the eight-seed mean still rises.
