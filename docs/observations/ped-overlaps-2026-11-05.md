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

## Follow-up 2026-11-07: coincident lines and blocked exits

The backlog still listed short conversation and blocked-crossing queues, up to 16 s and 6 pedestrians, mostly around
Dworzec and Droga Dębińska. Re-running the audit with the landing connectors in place showed that some were longer
again (longest 26 s, biggest 7). Command:

`node tools/audit-ped-overlaps.mjs --minutes 3 --fps 15 --seeds 4242,77 --only dworzec,wilda`

### Mechanisms

1. **One physical line, two route objects.** A two-way street is two directed edges on one centreline, and a divided
   pair drawn closer than `PAIR_SEP` (4 m) is moved onto one too (`road-network.js`). `along(e)` gave each edge four
   walking tracks, so each physical line existed twice, once per direction, with opposite route parametrisations. The
   per-frame queue in `traffic.js` was keyed by the route object, so walkers on the two copies could not queue behind
   each other. In 60 s at Wilda, 167 distinct route objects held 96 ordered pairs of coincident lines.
2. **One corner corridor, two corner links.** A junction builds one corner link per pair of tracks, so the same short
   corridor is an A→B link for one route and a B→A link for another. When trams or a red light stopped both directions,
   their queues interleaved on the same metres; the 5.3 m Most Dworcowy link held five bodies on one point for 24 s.
3. **Blocked exits were exempt from the 20 s clock.** `walk()` suppressed the stuck counter for anyone on a crosswalk
   (`p.node`) and for anyone whose `nextRoute` contained a crossing. A body that had crossed but could not leave the
   far curb, or waited in a give-way queue, therefore never aged. Waiting at the curb for the WALK is the legitimate
   case; standing on the zebra is not.

### Fix

- `js/pedestrian-routes.js`: every walking track carries a `walkKey` naming its physical line. Both directed edges of
  one centreline share it; the twin edge's normal is flipped so its `sign`/inset map onto the same four keys. Tracks
  and their ends are unchanged, so `next()` (including the underpass connectivity test) keeps working.
- `js/traffic.js`: `routePeds` is keyed by `walkKey`, or by the undirected segment for corner links and crosswalks.
  Following, entrance clearance and strip-hold queues use world positions and headings, because `t` and `dir` are not
  comparable between opposite parametrisations. Entrance clearance tests the entry point in world space, so a
  stationary body on a shared point holds it whichever route brought it there. A walker that is already stopping keeps
  a body length from a stationary oncoming body; free walkers still pass, so the guard did not cost crossing
  throughput. Crossing walkers are exempt from the stuck clock only while `waiting` at the curb, and split-crossing
  strip holds stay exempt; blocked exits now age and are re-placed after 20 s. The removal is still postponed while
  `nearView` sees the spot.
- `tools/audit-ped-overlaps.mjs`: worst pairs now snapshot position and state at their peak; previously they stored the
  ped objects and described them at the end of the run, so the reported place/state did not belong to the duration.

### Before / after

Seeds 4242 and 77, 3 simulated minutes at each of the two focus points, sampled once per second after 20 s.

| District | seed | clusters | longest s | biggest | pairs/s | entries/min |
|---|---|---|---|---|---|---|
| Wilda | 4242 | 5 → 4 | 14 → 10 | 6 → 7 | 21.8 → 13.8 | 115.5 → 118.1 |
| Wilda | 77 | 1 → 4 | 11 → 15 | 6 → 8 | 20.5 → 13.9 | 122.6 → 120.0 |
| Poznań Główny | 4242 | 5 → 1 | 20 → 24 | 7 → 5 | 15.9 → 14.6 | 97.1 → 101.3 |
| Poznań Główny | 77 | 6 → 3 | 26 → 12 | 7 → 6 | 17.0 → 14.2 | 96.8 → 97.5 |
| **all** | | **17 → 12** | **26 → 24** | **7 → 8** | **18.8 → 14.1** | **108.0 → 109.2** |

The two seeds are not uniform (Wilda 77 gains three short clusters and the biggest grows by one), but the citywide
overlapping-pair rate falls about 25% and crossing throughput is unchanged. What remains is no longer a multi-minute
stack: the largest is the 8-body two-way queue at Droga Dębińska, and the longest is the tram-blocked Most Dworcowy
corner corridor above.

### Remaining

- The 5.3 m Most Dworcowy corner link still holds five bodies for 24 s when trams block both directions on one line.
  A direction-specific inset lane (the two sidewalk tracks at 1.7 / 2.8 m from the curb) is the untried fix; this
  change only makes the two flows see each other.
- Conversation pairs can still meet within a body width of another pair (`meet` checks only the two partners'
  distance), giving up to 8 bodies for 8 s.
- The `nearView` postponement is unchanged: a player standing at a blocked knot keeps it until they look away.

Per-frame cost with the same headless world at Centrum over 1 800 `traffic.update` frames at 60 fps after a 20 s
warm-up, alternating old/current three times: **0.745 → 0.766 ms/frame** (about +3%, within the ±10% run-to-run noise);
no per-frame allocation, reused route lists, and the line key is built once per route.

`node --test tests/*.cjs`: 412 pass. `tests/underpass-sidewalks.test.cjs` and the route-sink and route-building tests
pass unchanged; the physical track geometry (and so the signal-audit hash) does not move, because `walkKey` is only an
extra field on each track.

## Follow-up 2026-11-07: crosswalk landings stage 2

The backlog still listed 212 empty crosswalk ends (197 tracks with an empty end) on the furnished headless world. The
stage-2 change keeps every safety rule: no sibling-line U-turn, no road-lane crossing, `RAIL_KEEP` 2 m, no building
wall, no closed courtyard and no water. Reproduce with:

`node tools/audit-crosswalk-landings.mjs [--json out.json] [--list] [--near x,z,r]...`

The tool builds the same world as `tools/bench-world.mjs` (street furniture and city-block colliders, no city-grid
curbs, landmarks or bridges), counts both directions of every crosswalk track, and independently re-checks every
fallback connector leg with the exact segment-to-segment lane margin (`edge.half + 0.8 m`), the 2 m rail keep and the
building colliders. `diagnoseFallback` mirrors the direct and long loops separately (the long loop has no 16 m
cross-block rule) and names the first rejection: `walk`, `block`, `lane`, `rail`, `building`, `lot`, `corridor`,
`length` or `noBlock`. `--json` carries the reason for every remaining end and a per-end `reasonCounts` summary.

### Mechanisms

1. **Sidewalk track ends were invisible to the long fallback.** `fallbackPaths`' second loop skipped every target with
   `!next.node`. Sidewalk tracks carry `from`/`to`, not `node`, so only crosswalk tracks could be reached beyond
   `DIRECT_MAX` 8 m; a landing next to a sidewalk track end 8-32 m away stayed isolated. Removing the gate connects
   16 ends (212 → 196).
2. **The 8 m corridor was narrower than the junction corners it had to round.** At a wide corner the straight chord
   between a landing and a nearby sidewalk leaves the 8 m band and was rejected. Widening to 12 m connects 20 ends
   alone and 44 with the node fix (168 remaining); 16 m connects 30 alone and 56 together (156 remaining). Deep
   points now have to see their nearest block edge without a building between them, so a connector cannot enter a
   closed courtyard or back yard through a gap. On this world no gained connector at 12/16 m is building-enclosed; a
   synthetic wall behind the 8 m band trips the new guard (`tests/pedestrian-route-buildings.test.cjs`).
3. **The remaining key nodes have no same-block sidewalk to reach.** Okrąglak's landing at `-841.5, 30.6` sits on a
   351 m² block cut by tram tracks; it has no sidewalk track of its own, and its only ports are two tracks 15.6/16.7 m
   away across the roadway, where they cross a lane (the 15.6 m candidate also comes within 0.13 m of a rail). Miła /
   Dąbrowskiego (`-3269.1, -884.3`) has a same-block candidate 19.2 m away through a building lot and a cross-block
   one 26 m away across a lane (0.10 m from a rail). Promienista / Grochowska (`-3541.4, 1448.4`, `-3540.3, 1449.4`)
   and Wierzbięcice / Górna Wilda (`-851.4, 1662.7/1664.2`) are similar: their only non-sibling candidates are
   17-26 m across a lane (Wierzbięcice's 17.7 m candidate also comes within 0.10 m of a rail), with the rest at 36-46 m.
   Okrąglak / Święty Marcin at `-1120.1, 112` has candidates 12.5-21.3 m across the roadway and 39.8-45 m around it.
   A corridor beyond 16 m gains no other key node, and 40/48 m `FALLBACK_MAX` adds only 6/7 ends, so both stay.
   The audit's per-end `reasonCounts` (overlapping categories) put lane at 138 of the 156 remaining ends, length at
   70, lot 51, walkable 32, rail 14, corridor 14, building 8 and block 4; 2 ends have no candidate beyond their own
   or sibling lines. Length is therefore not the main limiter, and building lots/walls are behind the lane rule. The
   2 m lot pad and 0.4 m body pad are unchanged and neither is relaxed by the wider corridor. Święty Marcin / Wysoka
   has no empty end in this world. A production full-scene count is still open because the benchmark omits
   landmark/bridge colliders and city-grid curbs.

### Before / after

`buildWorld` from `tools/bench-world.mjs`, 3,270 crosswalks and 4,527 tracks in both runs.

| metric | before | after |
|---|---|---|
| empty crosswalk ends | 212 | **156** |
| tracks with an empty end | 197 | **143** |
| fallback ends / connector legs | 153 / 376 | 209 / 1,004 |
| sibling U-turn links | 0 | **0** |
| laneHits / railHits / buildingHits | 0 / 0 / 0 | **0 / 0 / 0** |

On the bare `buildRoadNetwork([], [])` network (`tests/pedestrian-route-sinks.test.cjs`) ends with no links fall
**230 → 109** and tracks with an empty end **218 → 98**; the test now keeps ceilings of 120/110. Route build rises
182 → 242 ms and `links()` over all 9,054 ends 5.33 → 6.3 s (worst single call 33.4 → 37 ms); the longer corridor
scans a wider 32 m box only when an end has no base link, and the result is cached per end.

`node --test tests/*.cjs` passes (415 tests: the original 413 plus the two new landing tests).

### Remaining follow-up

The production full-scene count is still open because the benchmark omits landmark and bridge colliders and city-grid
curbs; the 156 empty crosswalk ends themselves are listed above and in `docs/backlog.md`.

## Follow-up 2026-11-07: dead-end sidewalk guard

The long fallback lands on sidewalk tracks, whose ends are `from`/`to` rather than a crosswalk `node`. `next()` only
guarded `target.node`, so on the headless world **346** path ends landed on a sidewalk track with no onward link (333
before the long fallback accepted sidewalk tracks). A walker that took one could reverse on the same short track and
loop, or stand until the 20 s recovery moved it.

### Mechanisms

1. **A projection sub-track's node sat on the wrong end.** `fallbackPaths` cuts a sidewalk track `q` at the projection
   point `c` and offers two sub-tracks from `c` to `q`'s ends. The backward sub (`c` → `point(q, 0)`) carried
   `from: q.from`, but `from` names the node at end 0, which is `c` (mid-track, no node), while end 1 is `q.from`.
   `baseLinks(track, dir)` reads `track.to` for a dir 1 exit and `track.from` for dir -1, so the link lookup ran at the
   wrong end. The leg also travelled `dir -1`, which starts the walker at `point(q, 0)` and sends them back to `c`
   instead of continuing along `q`.
2. **`next()` had no sidewalk branch.** For `target.edge` the guard built no landing and skipped the dead-end test, so
   a fallback path could end on a track whose `links` list was empty.

### Fix

- `js/pedestrian-routes.js`: both projection sub-tracks now travel `dir 1` from `c`, and their `to` names the node at
  end 1 (`q.from` for the backward sub, `q.to` for the forward one); `from` is null because `c` is mid-track. `links`
  therefore looks for onward connections at the node the walker actually reaches.
- `next()` checks `target.edge` as well as a crosswalk `target.node`: when the landing lies on a known block and
  `links(target, last.dir)` is empty, the path is skipped. Unknown landings keep the old behaviour.
- `tests/pedestrian-route-sinks.test.cjs`: the sampled route-choice check also rejects a chosen sidewalk landing with
  no links, and a targeted loop puts the goal exactly on every dead-end sidewalk landing and asserts `next()` never
  returns that path. On the old code 151 of 230 bare-network links were chosen this way; now 0.

### Before / after

Furnished headless world (`buildWorld`, 3,270 crosswalks / 4,527 tracks) and the bare `buildRoadNetwork([], [])`
network (3,391 / 4,729). "Sampled" is the route-sink test's three goals per crosswalk end; "targeted" puts the goal
exactly on the dead landing.

| metric | furnished before | furnished after | bare before | bare after |
|---|---|---|---|---|
| sidewalk path ends with no onward link | 346 | **335** | 230 | **219** |
| of those, landing on a known block | 346 | 335 | 230 | 219 |
| sampled route choices into a dead end | 517 | **0** | 8 | **0** |
| targeted goals routed into the dead end | 270 / 346 | **0 / 335** | 151 / 230 | **0 / 219** |

Of the 346 furnished dead ends, 11 are projection sub-tracks that now reach `q.from`/`q.to` and gain a non-empty
onward link; the remaining 335 (ordinary sidewalk track ends with no other port) are all rejected by the guard. The
sampled choice count falls 26,664 → 26,433 because some ends now return no path at all. No new dead ends appear.

`node --test tests/*.cjs`: 419 pass. The signal-audit fixture is unchanged because the guard only filters `next()`;
it adds or moves no track.
