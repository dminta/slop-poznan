# Centrum short-link merge and exit-room tails, 2026-11-10

Baseline: `8c41595` with `f20646d`'s box wait (`SHORT_SIGNAL_LINK` 12 m, `BOX_WAIT_EXIT` 17.5 m), measured before
`e526603`'s Kaponiera tram-pad release; on top of it Centrum seeds 1, 5, 11, 99 reproduce exactly and Kaponiera seeds 5
and 11 stay identical. The retained
configuration and the baseline are eight independent five-minute, 15 fps runs each (`node tools/bench-traffic.mjs
--seed <seed> --json <file>`, seeds 1, 4242, 7, 99, 2, 3, 5, 11), plus one-second traces:

```
node tools/bench-traffic.mjs --only centrum --seed 5 --trace -1117,132 --trace-min 20 --dump
node tools/bench-traffic.mjs --only centrum --seed 11 --trace -1117,132 --trace-min 20
node tools/bench-traffic.mjs --only centrum --seed 1 --trace -1136,127 --trace-min 20 --dump
```

Each district is rebuilt with the seed reset; the sample is cars within 300 m, once a second after 20 s. The box wait
gives seed 1 its 86 s bound but seeds 5 and 11 pay with longer tails at `(-1117, 132)`.

## Mechanism

At `(-1117, 132)` the east approach `(-1074, 129)` has three lanes. Approach lanes 0 and 1 both feed **lane 0** of the
9.4 m westbound link `(-1117, 132) -> (-1136, 127)` (`moves[0].out = [0, 0, 1]`); only approach lane 2 feeds the
link's lane 1. The link's far signal at `(-1136, 127)` is red for most of the approach's green, so lane 0 holds one or
two cars and the two approach lanes take turns through `mergeFirst`.

Seed 5's longest hold is #11 on approach lane 1: it stops at t=144, misses the 150-171 green because the oncoming
18 m bus #202b turns left across the junction, then waits through the 215-239 green behind the merge. Lane 0's #20 and
lane 2's #56 take the link at 218, #41 enters at 225, and #11 reaches the line at 234, just before the red at 240. The
green spent 20 s to pass three link cars. Seed 11's longest hold is #17 on the south approach, turning left into the
same link: through its whole 174-213 green the link's lane 0 is full of westbound cars waiting at the far signal, so
`room` refuses it, and it waits another 65 s cycle. Seed 1's remaining 86 s hold is the same left turn at this node.

The box wait itself is at the *other* end of the short link: a car on `(-1136, 127) -> (-1117, 132)` waits in the box
before the 18 m exit's zebra and frees that 9.4 m link for the next green. It is what removes seed 1's old 112 s hold
at `(-1136, 127)`; disabling it restores 113 s and drops seed 5 to 58 s / seed 11 to 65 s, exactly the old tails.

## Retained fix

`shortLinkLane` keeps its stopped-storage rule (a car already on the link for its downstream signal) and adds two
cases:

1. **Same lane index while draining.** When the planned lane's front is still moving, the car may take the sibling
   whose index matches its own approach lane. At the east approach this stores the second lane on the link's lane 1
   instead of queueing for the merge into lane 0. Cross-lane switches behind a moving front stay off: that is what
   moved Kaponiera seed 4242 from 112 to 147 s and added a car held over 120 s.
2. **Left-turn detour on a 2-lane link.** A left turn into a full short link may take a sibling that is straight-only
   (no left or right movement) and leave the link straight instead of standing through its green for the link's only
   entry lane. A sibling with a turn of its own is still excluded (the tram-track case at Kaponiera `(-1438, 115)`).
   The detour is limited to links under 3 lanes: on the 3-lane link at `(-1136, 127)` (also inside
   the Kaponiera run's sampled area) it moved Kaponiera seed 11 from
   13.5 to 13.1 km/h and its worst wait from 86 to 110 s without changing Centrum.

The subset test that keeps a sibling from carrying movements the planned lane lacks remains for the same-lane case.
`room`, `alongside`, oncoming/crossing/pedestrian and tram checks are unchanged. The chosen lane still goes into
`v.outEdge`, so the reservation follows the real slot. Test: "a draining short link stores a merge in the same
lateral slot, and a left turn may leave it straight" in `tests/traffic-regressions.test.cjs`.

Eight seeds × seven districts, 5 min, 15 fps; base -> fix. Mean and stopped are seed means; waits are the worst
per-district sample; counts are summed; box is seeds with a car stopped in a junction box over 20 s; tram is trams
stopped over 60 s.

| District | Mean km/h | Stopped % | Worst wait / hold s | Held >60 s | Held >120 s | Deadlocks | Box seeds | Tram holds |
|---|---|---|---|---|---|---|---|---|
| Jeżyce | 14.73 = | 32.76 = | 85 / 85 = | 15 = | 0 | 0 | 4 = | 11 = |
| Łazarz | 14.60 = | 25.44 = | 39 / 39 = | 0 | 0 | 0 | 0 | 0 |
| Centrum | 14.51 -> 14.86 | 33.61 -> 31.88 | 87 / 86 -> 72 / 72 | 9 -> 2 | 0 | 0 | 0 -> 1 | 1 -> 3 |
| Kaponiera | 12.58 = | 51.26 = | 145 / 169 = | 133 = | 13 = | 1 = | 1 = | 32 = |
| Stare Miasto | 17.98 = | 7.23 = | 37 / 36 = | 0 | 0 | 0 | 0 | 17 = |
| Rataje | 16.99 = | 35.10 = | 95 / 95 = | 6 = | 0 | 0 | 2 = | 22 = |
| Wilda | 15.94 = | 35.03 = | 63 / 63 = | 1 = | 0 | 0 | 0 | 56 = |

Every row outside Centrum is bit-identical, Kaponiera included (no new deadlock, held > 120 s unchanged at 13).

Centrum per seed (`wait` is the worst completed wait, `hold` the longest sampled hold):

| Seed | Mean / moving km/h | Stopped % | Wait / hold s | Held >60 / >120 s | Box-stuck |
|---|---:|---:|---:|---:|---:|
| 1 | 14.3 / 21.4 -> 15.5 / 22.0 | 33.2 -> 29.9 | 87 / 86 -> 55 / 55 | 1 / 0 -> 0 / 0 | 0 |
| 4242 | 13.3 / 21.2 -> 14.1 / 21.3 | 37.4 -> 33.9 | 57 / 56 -> 51 / 50 | 0 / 0 -> 0 / 0 | 0 |
| 7 | 13.3 / 21.8 -> 15.6 / 22.2 | 38.9 -> 29.7 | 56 / 55 -> 55 / 55 | 0 / 0 -> 0 / 0 | 0 |
| 99 | 15.8 / 22.4 -> 14.2 / 21.8 | 29.5 -> 35.2 | 71 / 70 -> 58 / 70 | 2 / 0 -> 1 / 0 | 0 -> 1 |
| 2 | 14.6 / 21.7 -> 14.3 / 21.6 | 32.7 -> 33.9 | 42 / 42 -> 48 / 48 | 0 / 0 -> 0 / 0 | 0 |
| 3 | 14.6 / 21.4 -> 14.4 / 21.4 | 32.0 -> 33.0 | 72 / 72 -> 72 / 72 | 1 / 0 -> 1 / 0 | 0 |
| 5 | 14.6 / 22.0 -> 15.1 / 21.2 | 33.7 -> 28.8 | 76 / 76 -> 47 / 46 | 3 / 0 -> 0 / 0 | 0 |
| 11 | 15.6 / 22.7 -> 15.7 / 22.5 | 31.5 -> 30.6 | 87 / 86 -> 58 / 57 | 2 / 0 -> 0 / 0 | 0 |

Seeds 5 and 11 fall to a worst wait of 47 / 58 s (longest hold 46 / 57 s), seed 1 to 55 s; the aggregate is better. Seed 99 is the exception: its mean falls
15.8 -> 14.2 km/h and a car stands in the `(-986, 161)` box for 28 s, while its tail improves 71 -> 58 s. The new
Centrum tram holds are line 17 `curve` 66 s (`-1195, 561`, seed 1), line 19 `room` 60 s (`-900, -31`, seed 4242) and
line 20 `room` 90 s (`-797, 42`, seed 99); seed 7's old line 20 `signal` 65 s hold is gone. None is a switch wait or a
deadlock, and the 5-minute `tests/traffic-flow.test.mjs` window is unaffected.

## Rejected variants

All measurements are Centrum unless stated; the reference rows are base -> retained.

| Variant | Centrum seed 1 / 5 / 11 | Kaponiera |
|---|---|---|
| allow any sibling behind a moving front | 47 / 56 / 58 | seed 4242 112 -> 147 s, held > 120 s 0 -> 1, 13.7 -> 12.2 km/h; rejected |
| sibling only on a box-wait link (straight exit > 17.5 m) | 52 / 54 / 58, mean 14.3 / 14.1 / 14.3 | not measured; Centrum mean and stopped worse; rejected |
| moving sibling only after a 15 s wait | 148 / 73 / 96 | seed 4242 112 s, but seed 1 148 s and a car over 120 s; rejected |
| sibling only if the link's lanes are pure storage | 62 / 54 / 64 | mean 12.7 vs 13.3 km/h and 50.4 vs 47.1% stopped over 8 seeds; rejected |
| pure storage and 3 lanes | same as above | same; rejected |
| moving sibling only rightward (k >= own lane) | 47 / 55 / 58 | seed 4242 13.7 -> 11.7 km/h, 47.1 -> 54.5% stopped; rejected |
| left-turn detour only | 59 / 76 / 58 | seed 4242 identical to base; keeps seed 5's 76 s; rejected |
| same-index moving sibling only | 86 / 46 / 83 | seed 4242 identical to base; seed 11 not clearly lower; rejected |
| same-index + detour, detour blocked for moving fronts | 55 / 47 / 84 | seed 4242 identical to base; seed 11 not improved; rejected |
| same-index + detour on every link | 55 / 47 / 58 | seed 11 13.5 -> 13.1 km/h, worst 86 -> 110 s, held > 60 s 8 -> 16; rejected |
| **retained: same-index moving sibling + detour on 2-lane links** | **55 / 47 / 58** | bit-identical on all 8 seeds |

The rejected unrestricted left-turn sibling would also have re-opened the tram-track case: a sibling with a left turn
of its own crosses the tracks at Kaponiera `(-1438, 115)` and produced 89 s switch waits in the 2026-11-08 work. It is
excluded here. Projected exit room, the unscoped box wait and scoping the box wait by tram conflicts were not retried.

## Tests

`node --test tests/traffic-regressions.test.cjs` passes (4 tests). Full `node --test tests/`: **501/501 passed**.
`tests/traffic-flow.test.mjs` passes all three checks; seed 1 Centrum is 55 s longest hold, 29.9% stopped and
15.5 km/h against its 120 s / 40% / 12 km/h bounds. `node tools/audit-tram-overlaps.mjs --only centrum` reports 0
pairs for seeds 1 and 4242 (5 min). No browser check was run; this changes headless car paths only.
