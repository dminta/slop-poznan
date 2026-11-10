# Short corner-link investigation, 2026-11-10

Measured at `aecdb54` (baseline), headless furnished world, 15 fps, seed 4242, focus Poznań Główny. A once-per-second trace of all bodies within 3 m of the audit's longest pair shows a different immediate mechanism from the assumed red-light wait. At each second from 119 through 138 s pedestrian 7 stands at (-1553.89, 575.99), pedestrian 204 at (-1553.73, 576.19), both at t=0.48 m on distinct 1.10 m corner links, lane offset 0.11 m, speed 0, `roomCause=entrance`. Both intend to enter a 4.78 m sidewalk in direction -1. Pedestrians 36 and 295 stand at t=4.25 and 4.20 m on the two sidewalk lines in direction +1, `entrance`-blocked by the corner links; pedestrians 64, 117, 132, 105 and 23, 21, 199, 193 queue behind them. The two sidewalk lines and the corner links form a turnaround loop, and their entry checks hold each other. Neither 7 nor 204 has a crosswalk in its remaining route at those samples. At 110–113 s they were queued separately upstream; at 114–118 s they advanced onto the two links. From 119 through 138 s all four named bodies remain at those same positions each second. At 139 s pedestrian 7 is no longer in the local sample and 204 moves at 0.52 m/s; the trace does not by itself identify the release trigger. The pair remains 0.26 m apart for the stationary interval; the audit records 19 s. Nearby activity alone does not establish signal state as the immediate blocker.

The entry guard counts all pedestrians filed under a target physical-line key, including different connector geometries. Its minimum capacity is two even for a 1.1 m link, and its world entrance test searches only that target key. Parallel short connector links can therefore admit one body each before the shared downstream line blocks both. Narrowing capacity by itself may shift the queue into the sidewalk loop, so any candidate must be measured for both overlap and frozen pedestrian-seconds.

## Rejected experiment

In an isolated source copy, change the minimum capacity from two to one for non-crosswalk target tracks (the floor still permits more on longer tracks). `node tools/.audit-ped-temp.mjs --minutes 3 --seeds 4242 --only dworzec` gives 0 clusters (base 0), 7.6 pairs/s (base 6.2), 88.9 entries/min (base 81.4), and two 19 s pairs at (-1553.98, 576.57) and (-1553.68, 576.04), each a short-link body overlapping the sidewalk body. The hold moved rather than disappearing and pairs/s rose 23%; rejected without wider rollout. No production behaviour changed.

A second isolated experiment also checks the world-grid `pedNear` at entrances to non-crosswalk links shorter than 1.24 m. On the same seed and district it yields 0 clusters, 6.1 pairs/s and 82.1 entries/min, but creates three 19 s overlapping sidewalk pairs at Głogowska / Zachodnia (-1653, 764) and another 19 s sidewalk/corner pair at (-1581, 557). It shifts the long stand-off to other locations, so it too is rejected; other seeds and the full seven-district benchmark were not run for either failed candidate.

## Baseline and retained result

The requested original commands reproduce 0 clusters, longest cluster 0 s, largest cluster 0, 5.43 pairs/s and 105.3 entries/min (eight districts, seeds 4242 and 77, three minutes). `--ped-rooms` gives 40,271 of 646,231 sampled ped-s, Centrum 22,550 of 93,701, and longest hold 20.1 s. The retained result is the unchanged baseline: no candidate passed the goal, so there is no after simulation or regression test claiming a fix.

## Cycle-breaking follow-up

At 125 s the two 1.10 m links are exactly the same segment traversed in opposite directions, but have different `walkKey`s because each names its destination sidewalk. Pedestrian 7 is on the link from (-1553.635, 575.570) to (-1553.989, 576.612), aiming for pedestrian 36's 4.78 m line in the opposite direction. Pedestrian 36's next leg is the reversed short link, currently occupied by 204, then the other 4.78 m line. Pedestrian 295 is the corresponding blocker of 204. All four have `roomCause=entrance`. Both short tracks have both inset lanes; the two sidewalks have inset masks 3 and 1. `laneOffset` fades to zero at track ends, so recognizing the cycle alone does not guarantee separated bodies during the swap.

Three isolated production-code experiments were run with `node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77 --only dworzec`, and then reverted:

| Variant | pairs/s 4242 / 77 | entries/min 4242 / 77 | longest target pair 4242 / 77 | result |
|---|---|---|---|---|
| Baseline | 6.2 / 8.0 | 81.4 / 76.9 | 19 / 16 s | 0 clusters |
| Ignore an oncoming entrance blocker whose next leg has the current route's key | 6.2 / 8.0 | 81.4 / 76.9 | 19 / 16 s | No effect: reversed link has a different key |
| Identify the reversed 1.1 m segment by both endpoints and ignore the oncoming blocker | 7.4 / 9.5 | 85.1 / 76.5 | named pair no longer in top five / 9 s | 0 clusters, but overlap rate rises in both seeds, 19% on average |
| Same endpoint rule only after both walkers have been stuck for 5 s | 6.4 / 8.0 | 80.6 / 76.9 | 20 / 16 s | 0 clusters; named hold persists and throughput falls in seed 4242 |

The direct geometric cycle rule opens the loop but does not satisfy the overlap constraint. The delayed version does not eliminate the stand-off. Neither was taken to the full eight-district audit or room benchmark, since both fail the prescribed initial screen. No production behaviour or tests were retained.
