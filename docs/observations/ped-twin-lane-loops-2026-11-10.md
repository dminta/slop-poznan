# Twin-lane corner loops and the Pasaż Różowy pocket, 2026-11-10

Investigated on this tree (`poznan` at 8c41595) against the task baseline. The named Dworcowy stand-off is the
head-on entrance cycle described in [ped-corner-links-2026-11-10.md](ped-corner-links-2026-11-10.md); this pass
root-caused the loop topology and tried route-build and movement fixes. **No candidate met the acceptance**: the
overlap rate and crosswalk throughput improved, but every variant that broke the named pair either moved a cluster
elsewhere or raised `--ped-rooms` freeze seconds. Production code is unchanged.

## Method

```
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77 --only dworzec   # screen
node tools/bench-traffic.mjs --ped-rooms
node tools/bench-traffic.mjs --ped-rooms --only centrum
```

The baseline on this tree reproduces 0 clusters, 5.43 overlapping pairs/s and 105.3 crosswalk entries/min; `--only
dworzec` gives 6.2 / 8.0 pairs/s, 81.4 / 76.9 entries/min and the 19 / 16 s pair at `(-1558, 575)`. `--ped-rooms`
gives 40,271 ped-s of 646,231 (Jeżyce 2,428, Łazarz 2,789, Centrum 22,550, Kaponiera 3,008, Stare Miasto 769, Rataje
2,270, Wilda 6,458), longest 20.1 s.

## Root causes found

1. **The 1.1 m links at Most Dworcowy are not a corner between two streets.** They link the two painted lane lines
   (inset 1.7 / 2.8 m) of one `edge`, whose 4.78 m split sidewalk runs are isolated: at both ends the only accepted
   link is the 1.1 m U-turn to the twin line. The two lines therefore form a closed 4.8 × 1.1 m racetrack. The
   named 19 s pair sits on the two direction objects of one of its 1.1 m U-turn links, head-on. Four walkers (two
   on the links, two on the sidewalks) each wait at an `entrance` held by the next, and only the 20 s recovery ends
   it. A scan of the benchmark world finds **332 such closed twin-lane tracks** (249 split runs, 83 full tracks; 67
   under 6 m). The same topology appears at Św. Marcin, Taczaka, Wilda and Rataje.
2. **Pasaż Różowy is a 1.87 m way, not a street.** `PEDESTRIAN_WAYS[88]` is a 1.87 m, 8 m-wide piece whose four
   walking lines (two offsets on each side) are joined by every pair of ends within 32 m: twelve 1.1-5.6 m links, a
   clique with no through exit at its north end. Walkers entering from the south wander and queue; 1.87 m is too short
   for the 1.5 m direction-inset ramp, so head-on walkers meet on the centre line. Of 274 pedestrian ways, 19 are
   under 6 m; only this one is the pocket.

## Variants tried and rejected

All numbers are `--only dworzec` (seeds 4242 / 77) unless a full run is named. Each variant was built in the working
tree and reverted; no test or production behaviour was retained.

| Variant | pairs/s | entries/min | named pair | full audit / rooms | rejection |
|---|---|---|---|---|---|
| Baseline | 6.2 / 8.0 | 81.4 / 76.9 | 19 / 16 s | 0 clusters, 5.43 / 105.3; rooms 40,271, Centrum 22,550 | — |
| Drop every twin-lane U-turn link | 8.8 / 9.4 | 75.8 / 88.1 | gone | not run | pairs/s worse; isolated fragments become shuttles |
| Same, but only at dead ends (keep the twin where another link exists) | 5.4 / 8.4 | 76.1 / 84.4 | gone | not run | 20 s pairs moved to Roosevelta |
| Twin-loop routing guard + one-step sink guard + spawn skip + one-direction-at-a-time on tracks < 3 m | 5.0 / 4.8 | 79.9 / 89.3 | gone | **1 cluster / 5 s**, 5.24 / 110.0; rooms **43,399**, Centrum **22,949**; Kaponiera held > 120 s 2 | fails 0 clusters and both room bounds |
| Remove the 1.1 m twin U-turn in ways + one-direction rule | 6.8 / 7.6 | 90.8 / 87.0 | persists | Centrum 20.5 / 15.7, 1-2 clusters; Centrum rooms 21,785 | more Pasaż overlaps |
| Twin-loop traps + way twin removal + way-link one-direction rule | 5.0 / 4.8 | 79.9 / 89.3 | gone | Centrum 13.0 / 8.4, 1 cluster 15 s; Centrum rooms 21,388 | Pasaż cluster kept |
| Above + skip ways shorter than 2 m (Pasaż) | 5.0 / 4.8 | 79.9 / 89.3 | gone | Centrum 17.0 / 13.6, 1 cluster 6 s; rooms not measured | new Aleja Niepodległości cluster |
| One-direction-at-a-time on tracks < 3 m alone | 6.8 / 7.6 | 90.8 / 87.0 | persists | 2 clusters; rooms +1,914 Centrum, +1,116 Łazarz, +1,092 Kaponiera, +435 Rataje | queue time counted as stuck |
| Track-length-scaled lane ramp (len / 4) | 8.8 / 9.3 | 87.0 / 82.9 | persists | Centrum rooms 25,063 | pairs and rooms worse |
| Swap exemption: ignore a blocker that is leaving through the same entrance (immediate) | 7.8 / 8.2 | 83.6 / 84.8 | gone | — | transient pairs rise |
| Same swap exemption after 3 s standing | 6.4 / 8.0 | 80.6 / 75.8 | 20 s | — | no improvement |
| Skip ways shorter than 2 m alone | — | — | — | Centrum rooms 22,674 | +124 ped-s |
| Remove all links between the lines of one way | — | — | — | Centrum 16.2 mean, 1 cluster 12 s; Centrum rooms 22,482 | clusters; not enough room gain |

The route/spawn variants all shift the seeded random sequence (each route choice consumes one draw per link), so a
cluster that leaves Pasaż appears at another short-link knot. The movement variants that reduce overlaps (one
direction at a time) do it by queueing, which the room audit counts as frozen ped-seconds. No variant satisfied both
constraints at once, so the working tree keeps the baseline.

## Remaining

- The Dworcowy/Św. Marcin/Taczaka/Wilda/Rataje 16-20 s entrance cycles are real and reproduced; the root cause is the
  closed twin-lane topology (332 tracks) and the 1.87 m Pasaż clique.
- A fix needs to change the route graph so a twin-lane link is a genuine two-way lane with room at both ends (not a
  U-turn at a dead end), or a settlement rule that lets the four-body ring swap without adding more pairs than it
  removes. Both need a fresh design, not another capacity threshold.
- The room audit is dominated by ordinary same-direction queues (80% `queue`), not by the named pair; the Dworzowy
  stand-off is a small share of Centrum's 22,550 ped-s. A fix aimed only at the pair cannot move the total below the
  baseline, which is why every overlap-improving variant failed the room bound.
