# Pedestrian overlap clusters, 2026-11-05

User report: "in some places a large group of pedestrians appears, overlapping each other". The fix is in
`js/pedestrian-routes.js` and `js/traffic.js` (walking and queues; no pedestrian field read by audio was renamed), with
the method below reproducible from the new headless audit.

## Method

`node tools/audit-ped-overlaps.mjs [--minutes 3] [--fps 15] [--seeds 4242,77] [--only centrum,...] [--json out.json]`
runs the real pedestrian simulation on the furnished network (the same setup as `bench-traffic.mjs`: `buildWorld`, no
three.js, trams active) with the camera parked at Centrum (Św. Marcin), Stare Miasto, Jeżyce (Rynek Jeżycki), Łazarz
(Głogowska), Wilda, Rataje (Rondo Rataje), Rondo Kaponiera and Poznań Główny (Dworzec). The default run is 3 simulated
minutes per focus point and seed at 15 fps.

After 20 s it samples once per simulated second. Two placed pedestrians are an overlapping pair when their centres are
less than 0.5 m apart. A cluster is a connected group of at least four such pedestrians; it is reported once it lasts
over 5 s, with its centroid, street name (`getLocationLabel`), member states (`waiting`, `crossing`, `talking`,
`resting`, on a corner link, on a held split crossing), route coordinate, spawn origin and age. The summary also counts
citywide overlapping pairs per second and crosswalk entries per minute (a placed ped whose `node` becomes non-null), so
a fix cannot pass by stopping or deleting pedestrians.

The recorded runs used seeds 4242 and 77, 3 minutes per focus point (2 880 simulated seconds per seed). The bare
network counts below come from the same routes built with `buildRoadNetwork([], [])`, which is enough to expose the
crosswalk-line links without the grid furniture.

## Mechanisms found

1. **A crosswalk linked back to its own other painted line.** Two lines are laid over all but the widest roads. At a
   crosswalk end, `links` offered the sibling line at the same curb, reached over a 1.5 m corner segment. That is a
   U-turn straight back over the zebra just crossed. On the bare network the old code produced **5 294** sibling links
   over 3 391 crosswalks; in a sample of 20 goals per end, **2 458** route choices selected the sibling line. Where the
   curb had no sidewalk exit, every walker used that one short shared segment. Six peds stood within 0.5 m for 25 s at
   the Park Mickiewicza corner (-1140.1, 107.2; Aleja Niepodległości / Święty Marcin) and four at the same point for
   25 s in Centrum.
2. **Queues with no room behind the entrance.** Queue spacing existed only for people already at a curb and only along
   the same lateral line. A queue that filled a crosswalk back to its first metre left new arrivals nowhere to stand but
   the entrance point itself; the corner queue also counted a pedestrian at exactly the same point as "ahead" and gave
   both zero room, locking the pair for good. Split crossings' `hold` had no queue at all: everyone reached the strip end
   and stood on it. This produced the Wilda Droga Dębińska stack (53 s, 12 peds at -135, 1933; 74 s in the first
   baseline run), Rataje's Jana Pawła II / Łacina hold (up to 140 s in the baseline) and the Głogowska / Most Dworcowy
   corner link (108-115 s, up to 20 peds; up to 31 in an intermediate variant).
3. **Dead-end crosswalk sinks.** With the sibling link removed, **276** crosswalk ends on the bare network have no
   onward link at their landing; the old code hid some behind the sibling step, and its route choice sent **802**
   sampled paths into a landing with no onward link. Peds crossed, found no exit, turned round and crossed
   back, then often chose the same crossing again. Wilda's short Droga Dębińska tracks held 27 pedestrians all standing
   on 7.8 m, feeding themselves from that loop.
4. **Spawning is not the main source.** Spawn clearance already rejected crosswalk ends with another body within
   `QUEUE_GAP`. In the 3-minute runs 384 of 5 440 old spawns were within 0.5 m of another body (7.1%); the figure after
   the fix is 332 of 5 440 (6.1%), and those overlaps are transient: same-line following separates them. The persistent
   clusters all formed after ordinary walking, at the mechanisms above.

## Fix

`js/pedestrian-routes.js`
- Crosswalk tracks carry their `arm`; `links` never connects the two lines of that arm to each other.
- `next` skips a crossing whose far end lands on a known block with no links at that landing. Unknown landings (sparse
  or synthetic graphs) keep the old behaviour.
- Removing that U-turn exposed empty landings. An empty landing now gets a fallback only when the connector stays
  within the source block's edge corridor (5 m; direct curb links also cap at 5 m), is at most 32 m long, keeps every
  road lane at least its half width + 0.8 m away, stays 1.5 m from a rail/tram centreline, avoids building lots (2 m pad), and never crosses water. It can join the nearest point on a sidewalk track or another zebra; a
  cross-block seam must also pass `clearGap`. The street index is built with the routes; sidewalk tracks are materialised only for a landing’s nearby edges, and
  `links()` does no whole-network loop in a frame. Crosswalk tracks never entered by routing go from **321 to 218** and ends with no
  links from **365 to 230** (old U-turn figures: 20 and 208). The remaining 230 ends are isolated landings; they are
  listed with reasons in `docs/backlog.md` rather than connected through a block, road, rail line or water.

`js/traffic.js`
- Same-track, same-direction following for the whole track, not only at a curb, using a reused `routePeds` index.
- A new leg's entrance stays clear of a slow same-direction walker (and of the opposite direction on a crosswalk), and
  a track longer than its queue capacity is not entered from behind a full queue.
- The corner queue ignores people at the same point (`forward > 0.01`), so an existing overlap cannot deadlock.
- A held split crossing queues back along the approach in `QUEUE_GAP` steps.
- `PED_STUCK_TIME` 20 s: a pedestrian standing with no legitimate wait (not a curb, strip hold, conversation or rest)
  is re-placed 60-280 m away with the normal view protection. Removal is postponed while `nearView` says the camera can
  see the old spot; the counter keeps running and the ped leaves as soon as it is out of view. Short tracks still count
  a crossing wait, because a blocked exit there is the bottleneck itself.

`stuck` is the only new pedestrian field; it is not read by `audio-sources.js` and no existing field changed name.

## Before / after

Two seeds (4242, 77), 3 simulated minutes at each of the eight focus points, sampled once per second after 20 s. Per
district: clusters / longest cluster (s) / biggest cluster / overlapping pairs per second / crosswalk entries per minute.

| District | clusters | longest s | biggest | pairs/s | entries/min |
|---|---|---|---|---|---|
| Centrum | 2 → 1 | 145 → 7 | 8 → 4 | 21.9 → 9.2 | 147.9 → 122.7 |
| Stare Miasto | 1 → 0 | 9 → 0 | 4 → 0 | 12.1 → 6.2 | 210.0 → 196.8 |
| Jeżyce | 0 → 0 | 0 → 0 | 0 → 0 | 11.2 → 6.7 | 192.6 → 188.9 |
| Łazarz | 0 → 0 | 0 → 0 | 0 → 0 | 18.2 → 10.2 | 135.2 → 135.8 |
| Wilda | 11 → 6 | 74 → 14 | 10 → 6 | 47.9 → 21.1 | 130.2 → 119.0 |
| Rataje | 4 → 0 | 140 → 0 | 6 → 0 | 21.1 → 7.0 | 107.7 → 106.9 |
| Rondo Kaponiera | 3 → 1 | 111 → 5 | 9 → 5 | 22.9 → 9.4 | 109.9 → 91.5 |
| Poznań Główny | 6 → 12 | 115 → 16 | 20 → 6 | 102.9 → 14.2 | 107.0 → 91.7 |
| **all** | **27 → 20** | **145 → 16** | **20 → 6** | **32.3 → 10.5** | **142.6 → 131.7** |

The remaining clusters are short (<= 16 s) and small (<= 6): two conversation pairs meeting within a body width, a
resting pedestrian with followers, or a queue at a blocked give-way crossing. They are not the multi-minute stacks of
people standing on one point that the user reported. A separate flow classifier (seeds 4242/77, 3 min, entries onto a
crosswalk track) puts the entry rate at **133.1 → 122.8 per minute (-7.7%)**. Before the landing connections it was
-9.5%: about 58% of that earlier drop was the removed U-turn and dead-end crossing pairs, the rest walkers queueing
briefly behind sidewalk conversations (6-12 s) and rests (1.5-4.5 s). The walking population moves rather than freezing (spawn and crossing counts stay in the thousands).

Per-frame cost, measured with the same headless world at Centrum over 1 800 `traffic.update` frames at 60 fps after a
20 s warm-up: **0.632 → 0.66 ms/frame** (about +8%); max early/late frame 2.6 / 1.6 ms. `createPedestrianRoutes` is
182 ms (base 180 ms) and `links()` over all crosswalk ends is 5.33 s total with a 33.4 ms worst call (base 5.1 s / 34 ms).
The per-frame cost is dominated by traffic; route lists are scanned instead of all 340 peds, no scratch object is
allocated per frame, and no whole-network loop runs in a frame.
`tools/benchmark-pedestrians.mjs` was not run because this checkout has no local three.js build (the change does not
touch `PersonRig`); the measurement above covers the changed simulation loop.

## Regression test

`tests/pedestrian-route-sinks.test.cjs` builds the bare routes from the real geodata and asserts, over every crosswalk
end, that no link steps onto the sibling line of the same crossing, and over sampled route choices that none U-turns
over its crossing or crosses into a dead end on a known block. On the old code it fails at the first sibling link
(5 294 links / 2 458 sampled choices before the fix; 0 / 0 after). `tests/traffic-population.test.cjs` gained the
`indexRoutePeds` stub required by its source-sliced `update`. The signal-head audit hash moved because removing the
U-turn links and adding the new landing connectors change the materialised walking segments the placement fixture sees;
counts are unchanged (17/74/66/10 → 91/0/66/10), and `tests/signal-audit.test.cjs` carries the new hash `85648549...`.
