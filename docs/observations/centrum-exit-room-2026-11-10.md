# Centrum exit-room hold, 2026-11-10

Baseline: `aecdb54`, `node tools/bench-traffic.mjs --only centrum --seed 1 --trace -1136,127 --trace-min 20 --dump` and the corresponding trace at `-1117,132`. Traces are sampled each simulated second, 15 fps; the occupancy positions are lane coordinates, with negative positions representing vehicles still on a connector. The default five-minute run excludes the first 20 seconds.

## Mechanism before attempting a fix

On the 16.2 m west approach to (-1136, 127), #58 in lane 2 waits behind #57, then at the line, with #10 behind. At t=165, #57 enters the 9.4 m eastbound link in lane 2; #7 and #42 enter lanes 0 and 1. The three cars are stopped at the downstream signal at t=190–210; #58 and #10 remain stopped on the approach. At t=216, both signals turn green, but #7, #42 and #57 are held for pedestrians at the downstream junction. #7 moves at t=220, #42 at t=229; #57 remains until t=231, first for pedestrians and then merge. #27 and #38 fill lanes 0 and 1 behind them. #58 is refused room throughout the green because its destination lane remains occupied; the upstream signal turns red at t=234. At t=240–270 #38 waits on the short link for the downstream red, while #58 and #10 wait another signal cycle. At t=280 #38 is held by tram 5 and the lane corresponding to #58 is occupied by a moving tram proxy; #58 enters at t=282, ending a 112 s stop, #10 having waited 110 s. This is a compound storage and missed-green event, not a permanent deadlock. The two signal phases, pedestrians and tram all contribute at different times; the link's three lanes do not guarantee independent downstream discharge because of merge and conflicting movements.

## Rejected trial

A temporary routing trial retried a right turn for a straight-going vehicle stopped for pedestrians for over 10 s on a signal-to-signal link shorter than 12 m, only if the same lane had a right turn. It left the seed-1 result unchanged: mean 14.3 km/h, moving mean 21.7 km/h, stopped 34.3%, queue 4, wait p50/p90/max 9/26/113 s, longest sampled hold 112 s, 3 cars held over 60 s, none over 120 s, no deadlock or box-stuck junction; switch maximum 7.4 s, total 18.1 tram-s. It did not achieve the goal and was removed. This is not evidence of safety or of results on other seeds.

## Baseline and result

Eight independent default five-minute, 15 fps all-district runs (`node tools/bench-traffic.mjs --seed <seed> --json <file>`); same seeds and district aggregation as the earlier record. Each district is built with the seed reset. Since the sole trial was rejected and production code was restored, the retained result is the baseline; these are not independent after measurements.

| District | Mean km/h | Stopped % | Worst completed wait s | Worst sampled hold s | Held >60 s | Held >120 s | Deadlocks | Seeds with box-stuck |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.55 | 33.39 | 85 | 85 | 21 | 0 | 0 | 4 |
| Łazarz | 14.60 | 25.44 | 39 | 39 | 0 | 0 | 0 | 0 |
| Centrum | 14.15 | 34.54 | 113 | 112 | 13 | 0 | 0 | 0 |
| Kaponiera | 12.30 | 52.19 | 155 | 169 | 167 | 21 | 5 | 2 |
| Stare Miasto | 17.85 | 7.75 | 53 | 52 | 0 | 0 | 0 | 0 |
| Rataje | 16.99 | 35.10 | 95 | 95 | 6 | 0 | 0 | 2 |
| Wilda | 15.94 | 35.02 | 63 | 63 | 1 | 0 | 0 | 0 |

| Centrum seed | Mean / moving km/h | Stopped % | Queue | Wait p50 / p90 / max s | Longest hold s | Held >60 / >120 s | Deadlocks / box-stuck |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 14.3 / 21.7 | 34.3 | 4 | 9 / 26 / 113 | 112 | 3 / 0 | 0 / 0 |
| 4242 | 13.4 / 21.2 | 36.8 | 7 | 13 / 26 / 61 | 61 | 1 / 0 | 0 / 0 |
| 7 | 13.2 / 21.3 | 38.1 | 7 | 13 / 27 / 58 | 57 | 0 / 0 | 0 / 0 |
| 99 | 15.9 / 22.5 | 29.4 | 7 | 9 / 25 / 71 | 70 | 2 / 0 | 0 / 0 |
| 2 | 14.6 / 21.7 | 32.7 | 4 | 10 / 25 / 42 | 42 | 0 / 0 | 0 / 0 |
| 3 | 14.6 / 21.4 | 32.0 | 8 | 8 / 23 / 72 | 72 | 1 / 0 | 0 / 0 |
| 5 | 13.0 / 20.5 | 36.7 | 10 | 13 / 21 / 58 | 58 | 0 / 0 | 0 / 0 |
| 11 | 14.2 / 22.2 | 36.3 | 8 | 13 / 30 / 65 | 65 | 6 / 0 | 0 / 0 |

No fix was established. In particular, reducing pedestrian protection or bypassing room checks was not tested as a safe solution; the long hold and narrow test margin remain.

The standalone `node tools/bench-traffic.mjs --only centrum` default seed 4242 agrees with the table. Full `node --test tests/`: 496/496 passed on rerun. The first run, concurrent with all eight benchmark processes, had 495/496 pass: the offline geodata child exceeded its 180 s timeout. The rerun passed the geodata test in 173 s and the whole suite in 308 s.

## Follow-up: anticipatory room, merge and pedestrian checks

The baseline exit trace at `(-1117,132)` shows #42 (lane 1) and #57 (lane 2) are on the *same* incoming signal link, both going to the single lane toward `(-1079,150)`. At t=227 #42 is already represented on that outgoing connector and #57 is refused `merge`; at t=230 #57 follows #42, whose rear is still in the connector. This is not a car from a give-way approach taking precedence over a link car. Both cars share the signal and #42 is ahead; exempting #57 would remove protection for an actual merge, so the proposed give-way priority condition has no matching occurrence in this chain.

A temporary baseline per-second pedestrian probe at `(-1117,132)` shows actual walkers on side 3, not shared-walk peers or curb queues. At t=215, three are crossing at `(-1104,129)`, `(-1104,129)` and `(-1105,138)` on a 34.7 m crossing. At t=226 two remain at `(-1106,143)` and `(-1106,145)` and another has entered at `(-1103,122)`. The link cars need a real crossing clearance, rather than ignoring a false pedestrian reservation.

### A: projected exit room (rejected)

For occupants actually moving over 0.5 m/s on a link under 12 m between signals with a green downstream signal, add up to two seconds of their current speed to the room estimate, capped at occupied length and the link. No stopped or tram proxy was projected. Seed 1 Centrum: base → trial mean 14.3 → 14.7 km/h, moving 21.7 → 21.9, stopped 34.3 → 32.8%, queue 4 → 9, wait p50/p90/max 9/26/113 → 9/22/82 s, hold 112 → 82 s, held >60/>120 3/0 → 2/0, deadlocks 0 → 0, box 0 → 0, trams held >60 0 → 1. Despite this initial improvement the variant is rejected: Kaponiera seed 4242 goes from 111 to 156 s longest hold and 13.7 to 12.0 km/h, and seed 99 adds a deadlock (1 → 2). Centrum seed 2 rises from 42 to 116 s longest hold. It also creates a Centrum box-stuck seed and tram holds.

Eight seeds, base → A; mean speed and stopped are unweighted seed means, hold is worst sampled hold, counts summed, box is seeds with a stuck box, tram is trams held over 60 s (summed district-seed counts).

| District | Mean km/h | Stopped % | Worst hold s | Held >60 / >120 | Deadlocks | Box seeds | Tram holds |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jeżyce | 14.55 → 14.55 | 33.39 → 33.39 | 85 → 85 | 21/0 → 21/0 | 0 → 0 | 4 → 4 | 11 → 11 |
| Łazarz | 14.60 → 14.60 | 25.44 → 25.44 | 39 → 39 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 0 → 0 |
| Centrum | 14.15 → 14.31 | 34.54 → 33.86 | 112 → 116 | 13/0 → 8/0 | 0 → 0 | 0 → 1 | 0 → 2 |
| Kaponiera | 12.30 → 12.84 | 52.19 → 50.33 | 169 → 156 | 167/21 → 131/19 | 5 → 4 | 2 → 1 | 31 → 40 |
| Stare Miasto | 17.85 → 17.85 | 7.75 → 7.75 | 52 → 52 | 0/0 → 0/0 | 0 → 0 | 0 → 0 | 20 → 20 |
| Rataje | 16.99 → 16.99 | 35.10 → 35.10 | 95 → 95 | 6/0 → 6/0 | 0 → 0 | 2 → 2 | 22 → 22 |
| Wilda | 15.94 → 16.84 | 35.02 → 32.92 | 63 → 77 | 1/0 → 2/0 | 0 → 0 | 0 → 0 | 56 → 56 |

### C: straight car waits before exit zebra (rejected; fails no-regression check)

Temporary one-line change at `mayEnter`'s `first` in `js/traffic.js`: permit a straight car whose incoming edge is shorter than 12 m and begins at a signal to use the existing yielding point before the exit zebra, provided the normal `wait >= 0` geometry allows it. The input crosswalk, box, tram and room checks remain. It was later reverted in favour of D below.

Seed 1 Centrum: base → C mean 14.3 → 14.3 km/h, moving 21.7 → 21.4 km/h, stopped 34.3 → 33.2%, queue 4 → 5, wait p50/p90/max 9/26/113 → 10/24/87 s, longest held 112 → 86 s, held >60/>120 3/0 → 1/0, deadlocks 0 → 0, box-stuck 0 → 0, trams held >60 0 → 0, max switch 7.4 → 7.4 s and total switch time 18.1 → 20.3 s. Seed 4242's seven district rows were identical to base. Seed 7 Kaponiera: mean 11.8 → 11.9 km/h, stopped 53.0 → 54.4%, longest held 155 → 155 s, held >60/>120 28/6 → 35/12, deadlocks 1 → 2, box-stuck junctions 1 → 2, trams held >60 1 → 4, max switch 14.8 → 45.2 s, total switch 34.9 → 123.6 s. New cycle at t=300: car #40 stopped inside at `(-1503,224)` / `(-1502,236)` and tram 6 at `(-1501,259)`, 39 s. Existing baseline cycle tram 10 and #83 at `(-1468,118)` is unchanged. Therefore C as written is rejected by the no-new-deadlocks rule even before the eight-seed batch is complete.

The user stopped the batch. Only seeds 1, 4242 and 7 completed all seven districts; seeds 99, 2 and 3 stopped after two district rows, and seeds 5 and 11 were not started. No eight-seed C aggregate is claimed. Raw files under `/tmp/centrum-c-*.json` and `/tmp/centrum-c-*.log` are temporary and may not persist.

## Retained fix: C restricted to exits over 17.5 m (D)

C was reverted and re-tried with narrower scopes (Centrum seed 1 + Kaponiera seed 7 screened first):

| Variant | Centrum seed 1 hold | Kaponiera seed 7 |
|---|---|---|
| C: all straight cars on a <12 m signal-to-signal link | 112 -> 86 s | rejected: deadlocks 1 -> 2, held >120 s 6 -> 12, new 39 s cycle (-1503,224) |
| C + `!n.tramConflicts` (no tram conflict anywhere at the node) | 112 s (no gain) | identical to base |
| C + `!tramOverLink` (no tram conflict on this exact lane curve) | 112 s (no gain) | identical to base |
| D: C + exit link `f.len > 17.5` | 112 -> 86 s | identical to base (11.8 km/h, 53%, 155 s, 28/6, deadlocks 1) |

Every Centrum straight curve at (-1117,132) is a tram conflict like Kaponiera's, so no tram-based scope separates them. The geometry does: Centrum exits are 18 m (toward (-1079,150)) and 26 m, Kaponiera's (-1503,224) exits 10-17 m, where a car standing before the zebra occupies most of the exit link and the box.

D (retained): `mayEnter`'s `first` also holds for `m.turn === 'S' && e.len < 12 && e.from.signal && f.len > 17.5`. Test: "a straight car on a short signal-to-signal link waits before a long exit link's zebra".

Eight seeds x seven districts, 5 min, 15 fps, base -> D (mean and stopped are seed means; wait/hold are worst; counts summed; box = seeds with a stuck box):

| District | Mean km/h | Stopped % | Worst wait / hold s | Held >60 | Held >120 | Deadlocks | Box seeds |
|---|---|---|---|---|---|---|---|
| Jeżyce | 14.55 = | 33.39 = | 85 / 85 = | 21 = | 0 | 0 | 4 = |
| Łazarz | 14.60 = | 25.44 = | 39 / 39 = | 0 | 0 | 0 | 0 |
| Centrum | 14.15 -> 14.52 | 34.54 -> 33.42 | 113 / 112 -> 87 / 86 | 13 -> 10 | 0 -> 0 | 0 -> 0 | 0 -> 0 |
| Kaponiera | 12.30 = | 52.19 = | 155 / 169 = | 167 = | 21 = | 5 = | 2 = |
| Stare Miasto | 17.85 = | 7.75 = | 53 / 52 = | 0 | 0 | 0 | 0 |
| Rataje | 16.99 = | 35.10 = | 95 / 95 = | 6 = | 0 | 0 | 2 = |
| Wilda | 15.94 = | 35.02 = | 63 / 63 = | 1 = | 0 | 0 | 0 |

Only Centrum changes (every other district/seed row is identical). Centrum per seed: seed 1 hold 112 -> 86 s, stopped 34.3 -> 33.2%; seed 5 mean 13.0 -> 14.6 km/h, stopped 36.7 -> 33.7% but worst hold 58 -> 76 s and held >60 s 0 -> 3 (tail got worse, still under 120); seed 11 mean 14.2 -> 15.6, stopped 36.3 -> 31.5%, worst hold 65 -> 86 s, held >60 s 6 -> 2. Other Centrum seeds unchanged. Caveat: seeds 5 and 11 trade a longer tail for higher throughput; the test bound (seed 1) gains 34 s of margin.
