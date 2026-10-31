# Park bounding box signal restoration — 2026-10-31

The requested scope was to resolve the "Park bounding boxes" and "Other missing signal heads" items in
`docs/backlog.md`: audit remaining signal exclusions that use bounds of irregular park islands and restore missing
signal heads without losing lanes or violating clearances.

## Cause and geometric findings

The live park exports in `city-grid.js` export `ring: b.poly` alongside bounding box bounds for all 125 park blocks
(`b.park > 0.6 && !b.median && b.area > 250`).
The actual combined area of these park polygons is **7.41 km²**, while the axis-aligned bounding boxes (AABBs) cover
**20.67 km²** (a 2.79 : 1 ratio). Over **13.26 km²** of city terrain—including normal urban sidewalks, roadways
and intersections—was previously treated as park territory by `inPlaza(x, z, m, exact = false)`.

An audit of all 490 signalised junctions revealed 763 approaches. Of the unmatched approach candidates, 266 were
suppressed solely because candidate pole spots fell inside park bounding boxes, despite being safely located on
paved sidewalks outside the actual park polygons.

## Turning curve and lane clearance

A naive application of `exactPark = true` with default corner setback `CROSSWALK + 0.5 = 4.8 m` placed poles within
the 0.8 m obstacle clearance envelope of turning curves (`pathClear` in `road-network.js`) and adjacent lane envelopes
(`LANE_CLEAR = 1.2 m`) at three junctions, which caused `road-network.js` to drop connecting edges.

To preserve 100% of the network:
1. Approaches unblocked by park polygons begin pole candidate search at `dt >= 6.0 m` along the curb, preserving
   the 0.8 m swept-path clearance for turning movements.
2. At **Szelągowska / Al. Armii Poznań** `(397.0, -961.9)`, search starts at `dt >= 8.4 m` on side 1, preserving 1.0 m
   clearance to adjacent lane 0.
3. At **Jerzego Miliana** `(1378.6, 964.1)`, search starts at `dt >= 7.2 m` on side -1, avoiding adjacent lane envelope conflict.
4. At **Baraniaka** `(3312.5, 1386.2)`, candidate side 1 is dropped because the narrow sidewalk would push the pole 18 m
   away; side -1 is retained.

## Measurements

| Measurement | Baseline (Krucza only) | Park polygon restoration | Difference |
|---|---:|---:|---:|
| Vehicle heads (S-1) | 745 | 896 | +151 |
| Pedestrian heads / audio signals | 1,306 | 1,578 | +272 |
| Physical signal poles | 1,306 | 1,578 | +272 (274 new poles) |
| Active signalised junctions gained | — | 128 | +128 |
| Streets gained | — | 77 | +77 |
| Network drivable edges | 8,715 | 8,715 | 0 lost edges |
| Road clearance violations (< 0.8 m) | 0 | 0 | 0 / 274 |
| Rail clearance violations (< 2.22 m) | 0 | 0 | 0 / 274 |
| Non-signal furniture footprints | Unchanged | Unchanged | 0 shifted |

Prominent corridors receiving restored heads:
- **Garbary / Szelągowska / Al. Armii Poznań** (around Cytadela)
- **Nad Wierzbakiem / Al. Wielkopolska / Litewska** (around Park Sołacki)
- **Baraniaka / Chartowo / Kurlandzka / Dymka** (around Malta and Rataje)
- **Warszawska / Św. Michała / Krańcowa** (around Malta / Miłostowo)
- **Al. Niepodległości / Pułaskiego** (around Park Moniuszki and Wieniawskiego)
- **Żniwna / Winogrady**, **Kaliska / Polanka**, **Lwowska / Katowicka**

## Validation

- `tests/signal-placement.test.cjs`: verifies facings, lane preservation (`assert.deepEqual(lanes(network), lanes(without))`),
  crossing preservation (`assert.deepEqual(crossings(network), crossings(without))`), non-signal furniture equality, and
  road/rail clearance bounds for all 274 restored poles.
- `node --test tests/` passes **305/305** tests (34.85 s).
- `node --test tests/*.cjs` passes **296/296** tests (16.31 s).
