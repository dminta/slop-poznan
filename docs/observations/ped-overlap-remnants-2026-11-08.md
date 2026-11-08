# Pedestrian overlap remnants, 2026-11-08

The backlog still listed three remnants after the direction-specific inset lanes: a 9 s / 4-body same-direction queue
on an 11.8 m Droga Dębińska corner link feeding a crosswalk, conversation pairs meeting within a body width of another
pair, and the 20 s recovery postponed indefinitely while a pedestrian was in `nearView`. The fixes are in
`js/pedestrian-routes.js` (connector lines) and `js/traffic.js` (queues, conversations, recovery).

## Method

Baseline and fix were measured on the same tree with the same commands:

```
node tools/audit-ped-overlaps.mjs --minutes 3 --seeds 4242,77
node tools/bench-traffic.mjs --ped-rooms
```

The audit runs the real pedestrian simulation on the furnished headless world (`tools/bench-world.mjs`) with the camera
parked in turn at the eight districts (3 simulated minutes per seed and district, 15 fps). After 20 s it samples once
per simulated second; a cluster is a connected group of four or more placed pedestrians whose centres are under 0.5 m
apart that lasts over 5 s. It also reports citywide overlapping pairs per second and crosswalk entries per minute, so a
fix cannot pass by stopping pedestrians.

## Mechanisms found

1. **One corridor, many route objects.** A corner link and a wide-corner connector are created once per route choice,
   and a fallback connector's projection sub-track repeats the parent sidewalk's metres. Each carried its own route
   key (the segment's own endpoints), so two spans that reach the same landing line queued as separate lines: the
   crosswalk queue backed onto the 11.8 m link and the link's variants stacked on one point.
2. **Recovery was exempt while the route still contained a crossing.** `walk()` scanned the whole remaining route and
   cleared the stuck clock if any later leg was a crosswalk. A body 20 m back on a corner link therefore never aged,
   however long the knot held it (the 62 s stack found during this work). The leader's walking lines in the merge rule
   were also applied at any distance from the crossing, which could pin that body at the link start with zero room.
3. **Conversations checked only the partners.** `meet()` accepted a partner 0.75-2 m away without looking at anyone
   else, so a second pair could form inside the first (four bodies in one spot).
4. **The view postponement had no limit.** A player standing still at a knot kept the body in the camera frustum, so
   the re-placement waited forever.

## Fix

`js/pedestrian-routes.js`
- `physicalLine(track)` names the physical line a connector lands on (its target's `walkKey`, else its own undirected
  segment). Direct and rounded corner legs and the fallback connectors carry it as `walkKey`, so variants that reach
  the same landing line share one queue. Projection sub-tracks inherit the parent track's line, so a walker cut onto
  a sidewalk queues with the ordinary walkers of that sidewalk.
- Geometry, track ends, `links()` and `next()` are unchanged.

`js/traffic.js`
- `pedCells`, a reused 2 m world grid of placed pedestrians, built with `indexRoutePeds`. `pedNear()` answers the
  conversation-clearance query; the per-frame index allocates no string (integer keys).
- `MEET_CLEAR` 0.65 m (one body width plus the queue gap): a pair can start talking only where both partners are clear
  of every other placed body. Existing pairs and walkers count.
- `PED_STUCK_VIEW_TIME` 30 s: the 20 s recovery is still postponed while `nearView` sees the spot, but only for 10 s;
  after that `spawnPed` re-places the body (its new spot is still chosen out of view).
- The stuck exemption now applies only when the **next** leg is the crossing and the walker is within 2 × `QUEUE_GAP`
  of its curb (or is `waiting` at a crosswalk). A body far back on a long approach ages as any other jam.
- The leader merge yield (`yieldToLine`) runs only within 2 × `QUEUE_GAP` of the crossing entrance. Beyond that the
  walker keeps to its own line.
- Route-key same-line following, entry clearance, capacity and the split-hold queue are otherwise unchanged; connector
  legs now share their landing line, so the existing queue sees the variants.

## Before / after

Seeds 4242 and 77, 3 simulated minutes at each of the eight focus points, sampled once per second after 20 s. Per
district: clusters / longest cluster (s) / biggest cluster / overlapping pairs per second / crosswalk entries per
minute. The two seeds are listed separately where they differ.

| District | seed | clusters | longest s | biggest | pairs/s | entries/min |
|---|---|---|---|---|---|---|
| Centrum | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 4.5 → 3.9 | 118.5 → 116.6 |
| Centrum | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 4.2 → 4.6 | 118.1 → 135.0 |
| Stare Miasto | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 2.8 → 3.3 | 176.3 → 169.5 |
| Stare Miasto | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 2.5 → 2.8 | 177.8 → 182.6 |
| Jeżyce | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 2.1 → 2.2 | 159.0 → 153.4 |
| Jeżyce | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 3.2 → 3.1 | 152.6 → 152.3 |
| Łazarz | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 3.3 → 3.2 | 102.8 → 105.0 |
| Łazarz | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 5.9 → 5.7 | 111.0 → 109.5 |
| Wilda | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 5.4 → 5.3 | 111.8 → 114.4 |
| Wilda | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 4.7 → 5.4 | 108.4 → 109.1 |
| Rataje | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 3.6 → 3.3 | 91.1 → 91.9 |
| Rataje | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 3.7 → 3.5 | 77.3 → 84.8 |
| Rondo Kaponiera | 4242 | 1 → 0 | 11 → 0 | 4 → 0 | 6.3 → 6.0 | 95.3 → 107.3 |
| Rondo Kaponiera | 77 | 0 → 0 | 0 → 0 | 0 → 0 | 5.1 → 7.5 | 87.8 → 95.3 |
| Poznań Główny | 4242 | 0 → 0 | 0 → 0 | 0 → 0 | 6.0 → 8.5 | 89.6 → 87.0 |
| Poznań Główny | 77 | 1 → 1 | 18 → 7 | 5 → 5 | 7.3 → 9.1 | 89.6 → 79.1 |
| **all** | | **2 → 1** | **18 → 7** | **5 → 5** | **4.41 → 4.84** | **116.7 → 118.3** |

Clusters fall 2 → 1 and the longest falls 18 → 7 s; the Kaponiera 11 s / 4-body cluster is gone. The remaining
cluster is 7 s / 5 at Most Dworcowy, a red-light knot of short corner links and a sidewalk end, not a multi-minute
stack. The mean overlapping-pair rate rises 4.41 → 4.84/s (+10%) and crosswalk entries hold at 116.7 → 118.3/min
(+1.4%); the same 5,440 spawns occur and 325 still land within 0.5 m of a body in both runs.

Wilda has no cluster in either seed. Its remaining longest overlapping pair is 18 s with **two** stationary bodies at
a 1.4 m Henryka Jordana corner link during a red light (`-76.29, 1759.62`); the 11.8 m Droga Dębińska link no longer
turns its queue into a 4-body cluster. The Droga Dębińska pairs that remain are two-body signal waits
(5-19 s, mostly on 1.1-3.2 m links).

## Room audit

`node tools/bench-traffic.mjs --ped-rooms` (default 5 simulated minutes, seed 4242, seven districts) samples
pedestrians once a second and reports `ped-s` with `stuck > 0` by the `walk()` term that capped their room. Per
district, frozen ped-seconds of sampled: Jeżyce 2,295 → 1,528, Łazarz 1,750 → 2,078, Centrum 2,818 → 3,303,
Kaponiera 5,193 → 3,735, Stare Miasto 1,318 → 1,620, Rataje 2,528 → 3,107, Wilda 7,758 → 6,458. Total **23,660 →
21,829 ped-s** (-7.7%) of about 642,800 sampled. The longest single hold stays at the audit's 20 s recovery bound
(20.1 s) in both runs; it moves between `entrance`, `curbQueue`, `merge`, `queue` and `tram` sites as the seeded
order shifts. The `tramRoom` boundary trap stays fixed.

## Regression tests

`tests/ped-overlaps.test.cjs` covers the three changes directly:

- `stuckExpired`: a body in view is re-placed after `PED_STUCK_VIEW_TIME` (and the ordinary 20 s rule still works
  when the camera looks away).
- `pedNear` and `meet`: a third body within `MEET_CLEAR` of either partner keeps the pair walking; a clear pair may
  start talking.
- `physicalLine` through the real route builder: two corner-link spans onto one landing line carry the same
  `corner:<line>` key and have different lengths; a track with its own `walkKey` is named by it.

`node --test tests/ped-overlaps.test.cjs`: 4 pass. `node --test tests/*.cjs`: **446 pass**. The route geometry and the
signal-audit fixture do not move (only extra fields on connector tracks), and `traffic-population`/`traffic` still
slice their existing functions.

## Remaining

- The 7 s / 5-body cluster at Most Dworcowy is the same red-light short-link knot described in the 2026-11-07 records;
  its link starts and the crosswalk curb share one physical point, so the bodies can only be spaced along the few
  metres between them. It is no longer a multi-minute stack.
- Overlapping pairs per second are slightly above the baseline. Conversations are now less frequent (a pair needs
  0.65 m of clear space), so more walkers reach the same signalised curbs and wait there; entries rose 1.4%.
- `nearView` still postpones the first 10 s of a recovery so the pop happens out of view where possible.
