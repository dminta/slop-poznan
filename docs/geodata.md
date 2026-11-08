# Geodata pipeline (tools/ → js/geodata.js)

## Map
- `tools/build-poznan.mjs`: entry point. It assembles and writes the `GEO` object (the current contract in [Output shape and consumers](#output-shape-and-consumers)), and places the water labels itself.
- `tools/merge-extent.mjs`: one-off, not part of the build. Merges a wider western Overpass fetch into the committed snapshots (old elements stay, new ones with `max lon ≤ 16.883` and reaching the new padded box are appended) and writes the compact `tools/data/poz_*.json`. Used for the 2026-11-08 west expansion; commit its output as input data.
- `tools/poz-base.mjs`: the frame (`toWorld`, `llAffine`, `DETAIL_BOX`) and the snapshot loader. Side-effect free apart from reading `GEO_DATA`.
- `tools/geo-util.mjs`: the pure geometry and raster helpers (`ringArea`, `bbox`, `rdp`/`rdpRing`, `pointInRing`, `centroid`, the `Raster` class, `scanRings` (even-odd scanline over several rings), `elemRings` (outer rings, or inner ones with `role = 'inner'`) for Overpass elements, and `labelComponents`/`traceComponents` for the land components). It has no inputs, no frame and no import-time work: helpers that project lon/lat take a `project(lon, lat)` function (`toWorld`). Keep city constants and file reads out of it.
- `poz-roads.mjs`, `poz-water.mjs`, `poz-extra.mjs`, `poz-blocks.mjs`, `poz-buildings.mjs`, `poz-canopies.mjs` do their work at import time, as top-level side effects, in that dependency order; `poz-roadgraph.mjs` exports `buildRoadGraph`, which the entry point calls. What each decides is under [Pipeline](#pipeline-toolsbuild-poznanmjs).
- The only active city pipeline is `build-poznan.mjs` and its `poz-*.mjs` modules. The original city pipeline lives in git history (commit `fc38ef6` and earlier). Historical design decisions are in the [archived port plan](archive/poznan-plan.md); remaining data work is in the [backlog](backlog.md).

## Regenerate
```
node --max-old-space-size=8192 tools/build-poznan.mjs            # writes js/geodata.js
node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/x.js  # writes elsewhere (diff before replacing)
GEO_DATA=/some/dir node ... tools/build-poznan.mjs                # read inputs from another directory (default tools/data/)
```
- The run takes about 36–42 s with the west expansion (most of it the block outlines, lots and frames; the building and industry pass, snapshot load included, logs ≈ 0.6 s), with a peak RSS of ≈ 1.27–1.43 GB (`/usr/bin/time -l`, 2026-11-08; the old 8.2 × 5.7 km box took 29 s and 1.27 GB, the 6.1 × 3.7 km box 14 s and 0.81 GB). Keep the 8 GB heap flag that the header usage line and `tests/geodata.test.mjs` pass, because the 1 m rasters and the EDTs are large.
- The output is deterministic. A rebuild from the committed `tools/data` reproduces the committed `js/geodata.js` byte for byte (verified for the west-expansion output on 2026-11-08). After any change to tools/, build to a temporary path and `cmp` it against the committed file: an unexpected diff means a behaviour change.
- `tests/geodata.test.mjs` compares its fresh offline build byte for byte with the committed file, including the
  deterministic header. It also checks the exact 36 landmark names and validates their placement and footprints,
  so a missing site cannot pass through the map tests unnoticed.
- `js/geodata.js` is GENERATED: its header says "do not edit by hand", and its single JSON line is about 3.07 MB. To change any geodata value, change the tools or the inputs and rebuild. Commit the regenerated file together with the tool change.
- Read the build's `[geodata]` log lines (counts, the frame, the per-key KB at the end). They are the quickest sanity check after a change.
- Inspect the output with `head -c 1500 js/geodata.js`, or `import('./js/geodata.js')` in node. Never read the whole file.

## World frame (the whole sim uses it)
- 1 unit = 1 m. y is up. **x = east, z = south (north = −z)**. Heading 0 faces +z (south). The axes are not turned (`GEO.frame.bearingDeg` = 0): Poznań has no single street grid, so almost every block carries frontage frames.
- The origin is fixed at the Ratusz on Stary Rynek, **52.40856 N, 16.93401 E**, not derived from a data node.
- The projection is a local tangent plane at that point (`poz-base.mjs`): KX ≈ 67.97 km/°, KY ≈ 111.27 km/° at 52.4°.
- `GEO.frame.ll` is `toWorld` as affine coefficients `[a, b, c, d, e, f]`: **x = a·lon + b·lat + c, z = d·lon + e·lat + f** (emitted unrounded). `city-config.js` `LL(lon, lat)` reads it, so hand-placed lon/lat (outskirts zones, camera targets) follows the frame on every rebuild.
- `GEO.frame.detailBox` = `[x0, x1, z0, z1]` is the detailed core (west edge extended on 2026-11-08 to King Cross Marcelin and Business Garden: 52.383–52.434 N, 16.85686–17.000 E, x −5250…4491, z −2831…2844, ≈ 9.7 × 5.7 km = 55.3 km²; the earlier 2026-10-28 box was 52.383–52.434 N, 16.880–17.000 E, 8.2 × 5.7 km = 46 km²; it was 52.392–52.425 N, 16.895–16.985 E, 6.1 × 3.7 km). Blocks, roads, the road graph and `land` exist only inside it; `outskirts` covers the rest of the city out to the admin boundary. The runtime's `CITY_BOUNDS` is this box.
- Rings and polylines are flat `[x0, z0, x1, z1, ...]` arrays, rounded to 0.1 m. Outer rings have a negative shoelace area in (x, z); hole rings are positive.

## Output shape and consumers
- `GEO` has these keys: `version` (2), `frame{bearingDeg, origin, lat0, lon0, units, strip, sidewalk, detailBox, ll}`, `land`, `landHoles`, `water`, `outskirts`, `outskirtsHoles`, `districts`, `labels`, `roads`, `roadGraph`, `rail`, `levelCrossings`, `tramRoutes`, `tramStops`, `plazas`, `blocks`, `blockStats`, `blockFootprints`, `blockParkBuildings`, `blockAnchors`, `industry`, `canopies`, `parks`, `landmarks`. The positional tuple layouts of `roads`, `roadGraph.links`, `blocks`, `blockStats`, `blockFootprints`, `blockParkBuildings` and `blockAnchors` and the `industry` object layout are documented in comments next to the `GEO` literal in `build-poznan.mjs`. Keep those comments in sync when you change a layout. `GEO.canopies` is an array of objects `{ x0, x1, z0, z1, h, clearance, kind, cx, cz, w, d, ang, area, columns }`: the axis-aligned bounds, the oriented rectangle (long side `w`, `ang` in radians from +x towards +z), the roof top `h` and underside `clearance`, the OSM ring `area`, and the flat world `[x, z, ...]` column posts. `kind` is `platform`, `tram`, `fuel`, `market`, `shelter` or `roof`.
- `js/city-config.js` is the main consumer. It turns `GEO` into `{x, z}` rings and named exports: `LAND_RINGS`/`LAND_HOLES`, `WATER`, `OUTSKIRTS`/`OUTSKIRTS_HOLES`, `RAIL`, `PLAZAS`, `DISTRICTS` (`districtAt`), `BRIDGES` (the bridge-flagged graph links chained per name), `SIGNAL_SITES` (from `roadGraph.signals`, with each junction's arms), `roadClearance` (distance outside the road graph's runs, for street furniture), `ROADS`, `BLOCKS` (each with `built`, `levels`, `buildings` and `program` from `GEO.blockStats`, `parkFootprints` from `GEO.blockFootprints` and `GEO.blockParkBuildings`, and `anchors` from `GEO.blockAnchors`), `LANDMARK_SITES`, and the land raster behind `isLand`/`isWater`/`distToWater`/`clampToLand` (2 m cells; bridge decks count as land). Prefer those exports in runtime code. A few modules read `GEO` directly:
  - `road-network.js`: `roadGraph`
  - `city-grid.js`, `buildings.js`, `city-map.js`: `parks`, `plazas`, `frame`
  - `city-map.js`: `labels` (area names, placed by `kind`)
  - `canopies.js`: `canopies`
  - `tram-infra.js`: `rail` (for `oneway`, which `RAIL` drops) and `tramStops`
  - `trams.js`: `rail` (with each tram chain's `routes`), `tramStops` and `tramRoutes`
- When you add, rename or re-layout a `GEO` key, update every consumer of it, plus the `GEO` stubs in `tests/city-map.test.cjs` if `city-map.js` reads it.
- `GEO.landmarks` is keyed by a curated name (`Ratusz`, `Katedra`, `Bałtyk`, …; `poz-extra.mjs`), each `{x, z, w, d, h, area, ring, ang}`. `ang` (radians, the turn of a frontage frame's θ and three.js `rotation.y`) is the outline's principal axis: `w` and `d` are the extents along the turned axes, and `fitToSite` turns the model and its colliders by it (see [`world.md`](world.md)). `h` uses a curated height first, then OSM `height` only when it is at least max(6 m, `building:levels` × 3.4 m), then the storeys × 3.4 m, or the placeholder when none is usable. Tiny or implausible OSM heights are rejected. Runtime code looks entries up by name (`LANDMARK_SITES['Ratusz']`), so a dropped match silently drops the landmark: `fitToSite` returns early on a missing site.

## Data sources and licensing (tools/data/)
- Fetched inputs are OpenStreetMap via Overpass, © OpenStreetMap contributors, **ODbL**: each snapshot has a matching `q_poz_*.overpassql`. `poz_places.json` is the hand-written label supplement described below; it has no Overpass query. Extents, dates and schemas are in the next section.
- The output header and README.md carry the attribution. Keep it whenever you add a source, and add the new source's licence there too (GUGiK and ZTM terms if their data is used; see the [remaining data work](backlog.md)).

## Refreshing an OSM source
```
tools/overpass.sh tools/data/poz_landmarks.json tools/data/q_poz_landmarks.overpassql [tries=12]
```
- The script tries three Overpass endpoints per round and sleeps `i*4` s between attempts. It writes to an adjacent temp file and renames it over the output **only** when the response is HTTP 200, curl succeeded, the JSON parses, `elements` is an array and there is no `remark`. Overpass reports timeouts as a 200 response with a `remark`. Any failure leaves the old data untouched and exits 1.
- After a refresh, rebuild and review the diff of `js/geodata.js` and the build log counts (landmarks, blocks, graph links, signals).
- To add a landmark footprint, add its exact OSM name to `q_poz_landmarks.overpassql` (ways and relations) and its curated entry to `poz-extra.mjs`, then refetch and rebuild. For the runtime side, see [`world.md`](world.md).
- The 11 historic landmark elements added on 2026-11-05 were populated in `tools/data/poz_landmarks.json` from the 2026-10-28 `poz_buildings.json` snapshot (same geometry), not refetched with the new query.
- The build logs `WARNING landmark query name "…" matches nothing` for every name in the query's `["name"~…]` / `["name"=…]` filters that no snapshot element carries: an OSM rename otherwise drops the landmark silently. Unnamed footprints (Domki Budnicze, Bałtyk) are fetched by id or by another tag.

## Poznań snapshots (tools/data/poz_*.json)
Inputs for the Poznań pipeline, OSM via Overpass, **ODbL**. The core snapshots were refetched for the larger
detail box on 2026-10-28 18:40–18:51 CET (OSM base 2026-10-28T17:40–17:49Z), one query at a time, with
`bash tools/overpass.sh tools/data/poz_<name>.json tools/data/q_poz_<name>.overpassql`; the three overpass-api.de
endpoints answered (502s on some tries), no other instance was needed. For the 2026-11-08 west expansion, only the
western strip was fetched (OSM base 2026-11-08T17:54Z) and merged into the committed snapshots with
`tools/merge-extent.mjs`, so the core stayed frozen. Inside the old padded box OSM had not changed since the
2026-10-25/27 fetches (no tag change on any road, rail, tram route, building or signal there).
- **Detail box D3**: 52.383–52.434 N, 16.85686–17.000 E. **Padded box**: 52.380–52.437 N, 16.852–17.005 E (≈ 250–330 m
  on each side), selecting whole ways that intersect it, so features crossing the D3 edge are complete. (Before the
  2026-11-08 west expansion: D3 16.880–17.000 E, padded 16.875–17.005 E. Before Phase 13.2: D3 52.392–52.425 N,
  16.895–16.985 E, padded 52.389–52.428 N, 16.890–16.990 E.)
- **City**: the Poznań admin_level=8 boundary, relation **165941** (Overpass `area(id:3600165941)`). Area filters return
  elements that are at least partly inside, with full geometry.

| file | query | extent | elements | size |
|---|---|---|---|---|
| `poz_roads.json` | `q_poz_roads.overpassql` | padded box | 10,988 (10,958 ways, 30 relations) | 7.2 MB |
| `poz_signals.json` | `q_poz_signals.overpassql` | padded box | 7,165 nodes | 1.1 MB |
| `poz_rail.json` | `q_poz_rail.overpassql` | padded box | 1,591 (1,581 ways, 10 relations) | 1.8 MB |
| `poz_tram_routes.json` | `q_poz_tram_routes.overpassql` | padded box | 46 `route=tram` relations (members only; the same 46 as in the smaller box) | 0.2 MB |
| `poz_water.json` | `q_poz_water.overpassql` | city | 1,571 (1,543 ways, 28 relations) | 2.4 MB |
| `poz_parks.json` | `q_poz_parks.overpassql` | city + padded box | 7,954 (7,794 ways, 160 relations) | 10.6 MB |
| `poz_landmarks.json` | `q_poz_landmarks.overpassql` | D3 | 47 (38 ways, 8 relations, 1 node) | 0.2 MB |
| `poz_admin.json` | `q_poz_admin.overpassql` | city | 344 (148 relations, 26 ways, 170 nodes) | 2.1 MB |
| `poz_buildings.json` | `q_poz_buildings.overpassql` | padded box | 30,316 (30,135 ways, 181 relations) | 18.2 MB |
| `poz_industry.json` | `q_poz_industry.overpassql` | padded box | 440 (437 ways, 3 relations): substations, storage tanks, works, chimneys, silos and plants | 0.3 MB |

The 2026-11-08 west expansion fetched the new padded strip and merged it into these committed snapshots; the file sizes
are the compact `JSON.stringify` output of `tools/merge-extent.mjs`, not the raw Overpass pretty print. It carries
`man_made=cooling_tower|chimney|storage_tank|silo|works` and `power=plant|substation`. Only one chimney and no cooling
tower fall inside the detail box (Karolin's two cooling towers
and 204 m chimney are outside it and already in `js/satellite-sites.js`); EC Garbary's towers are a curated runtime fallback.
- Schema (`out body geom`): ways carry `bounds`, `nodes` (ids) **and** `geometry` (`[{lat, lon}]`, same length and
  order). Relations carry `bounds` and `members`: way members have `geometry`, node members have `lat`/`lon`, relation
  members (e.g. `subarea`) have neither. Multipolygon outers are split across member ways and must be chained.
  `poz_landmarks.json` ways use `out tags geom` (no `nodes`); its relations use `body` because `tags` drops `members`.
- Roads drop `footway|path|cycleway|steps|track|bridleway|proposed|construction|…` and `service=driveway|parking_aisle|
  drive-through`. Of `area:highway` only `=pedestrian` is kept: the other ~5,500 outlines (sidewalks, islands, lane
  surfaces) were two thirds of a 23.5 MB first fetch. Plazas come from `highway=pedestrian` areas/multipolygons,
  `area:highway=pedestrian` and `place=square` (Stary Rynek is way 8452544, Plac Wolności 634296533, Plac Kolegiacki
  relation 14445791).
- Rail and tram routes (refetched 2026-10-27, OSM base 20:06Z, and with the rest on 2026-10-28): besides `railway=tram|rail|light_rail`, the rail query
  takes every `railway=disused|razed|construction|abandoned` way that is a member of a `route=tram` relation, and
  `poz-roads.mjs` treats those as tram track. A line closed for rebuilding is retagged that way in OSM (plain
  `railway=disused` or `razed`, no `disused:railway=tram`) but stays in its route relations. In the 2026 data this is
  the whole Ostrów Tumski line (Pl. Wielkopolski – Małe Garbary – Most Chrobrego (razed) – Katedra – Most Mieszka I –
  Rondo Śródka), the Most Teatralny tracks (`construction`) and the Fredry curve: 59 ways (60 over the larger box), which `railway=tram` alone
  dropped. The old snapshot was not stale; its tram ways match the live data. Closed track that no route uses (depot
  yards at Stare Zoo, the Pl. Wielkopolski siding, the Ratajczaka line under construction) stays out.
  `poz_tram_routes.json` holds the relations (PTv2, one per direction; `ref`, `from`, `to`, `name`, ordered way and
  stop members).
- Tram line routes (`GEO.tramRoutes`, `poz-roads.mjs`): the PTv2 relations of the day lines (ref 1–99; not the heritage
  lines 0 and H, the night lines 2xx or the two unversioned line 17 diversion variants), one `{ ref, from, to }` per
  direction, sorted by number and terminus; routes with no track in the box are dropped. Each tram `rail` entry
  carries `routes`, the indices of the routes whose member ways make up at least half its length (`ROUTE_SHARE`: a
  chain is not cut where a dropped tunnel track leaves it). Measured after 15.10 (2026-10-29): 38 routes of 20 lines
  over the 9.7 × 5.7 km box after the west expansion (line 1 reaches it): 38 routes of 20 lines, 123.9 of 129.6 km of
  tram track on a route; the pre-expansion 8.2 × 5.7 km box had 121.7 of 127.4 km on 479 of 642 tram chains. Most of the rest is the Głogowska depot yard; Most Chrobrego carries 7, 8 and 17. (6.1 × 3.7 km box: 36
  routes of 19 lines, 76.5 of 76.9 km.)
- `TRAM_ROUTE_EXTENSIONS` in `poz-roads.mjs` completes five existing OSM ways missing from the relations. Rules
  anchor to an adjacent member way, before `ROUTE_SHARE` and chain assignment; raw snapshots stay unchanged.
  Ogrody's `495295031 → 100278290 → 495295027` serves the departure stop of lines 2/7/8/18. Zawady's
  `16403985 → 365385517 → 73491169 → 87781251` serves line 5's departure stop. The alternative loops skip those
  stops, so remain unassigned. Turning tracks retain the arrival route until the first member of the return
  relation, where runtime `turnRoute` changes direction while keeping the line number. At Starołęka,
  `1533059210` extends the routes using `977970537` south across the map boundary; `1533059211` extends the return
  routes using `151435174`. That closes the gap for lines 7/12/13 starting 126 m inside the box. Missing extension
  geometry fails the build explicitly. This adds 12 way memberships and routes six previously unassigned chains
  (998.1 m); every other generated value, including track geometry and route metadata, is unchanged.
- Track chains (`GEO.rail`) end at every node where more than two track pieces end, whatever their chaining key
  (`street`, `oneway`, `tracks`). Before 2026-10-28 a switch whose branch had another key (a street track leaving an
  off-street one, a two-way stub off a one-way line) was chained through, so the branch met the other chain mid-way
  and the runtime graph had no junction there: 249 tram chains then, 367 after (645 tram and 527 mainline chains in the
  current 9.7 × 5.7 km output).
- Underground ways (`tunnel=*` other than `building_passage`, or `layer` < 0) are dropped from the roads and the track,
  except railway underpasses (`railwayUnderpasses` in `poz-roads.mjs`): an underground way that crosses an at-grade
  `railway=rail|light_rail` way, plus the underground ways of the same name with an end within 10 m of one. OSM tags the
  road under a rail bridge that way, and the world is flat, so they stay at grade and tram-infra.js cuts the railway
  over them. Before 2026-10-28 they were dropped too: Hetmańska had an 80 m gap under the Górczyn line (both
  carriageways and both tram tracks), with the trackbed drawn across it. Kept on the 2026-10-28 snapshot: 7 road ways
  (Hetmańska 4, Nad Wierzbakiem, two service roads), 3 track ways (Hetmańska's 2 tram tracks, one outside the box);
  still dropped: 74 road ways (garage ramps, courtyard passages, Warmińska under Niestachowska) and 17 track ways (the
  Franowo tram tunnel, a 72 m PST tunnel).
- Level crossings (`GEO.levelCrossings`, flat `[x, z, ...]`, `poz-roads.mjs`): the nodes a drivable piece shares with a
  mainline track way, inside the detail box. OSM joins a road and a track only where they cross at grade (the node
  carries `railway=level_crossing`, which the snapshots do not fetch); bridges and underpasses share no node. 39 on the
  2026-10-28 snapshot: Św. Michała, Krańcowa, Bałtycka, Gdyńska and Wrzesińska, the rest on yard service roads.
  tram-infra.js lays flush rails there instead of the walled cut (`docs/world.md`).
- Signals live in their own file (`poz_signals.json`, nodes with tags); match them to road ways by node id.
- Water includes `natural=water` without a `water=*` subtag (most small ponds). The Warta in D3 is the unnamed closed way
  27942106 (`water=river`); the named `waterway=river` centreline (`Warta`) lies inside it. Jezioro Maltańskie is
  relation 7550595.
- Parks: `park`, `cemetery`, `forest`, `recreation_ground` and `natural=wood` city-wide; `playground`, `pitch`, `garden`
  and `landuse=grass` only in the padded box, and grass/garden ways only with a perimeter over 100 m. City-wide grass
  and gardens were 34 MB of a 40 MB first fetch.
- Landmarks are exact names. Exceptions: Bałtyk has no `name`, only `addr:housename=Bałtyk` (way 490881244); the Poznański
  Czerwiec 1956 crosses are a memorial node (9105702733); Iglica is way 239060359 `Pawilon 11` (`man_made=tower`,
  `tower:type=spire`); the Nowy Rynek towers are the unnamed building ways inside landuse relation 15819392. Delta 4
  is not in OSM; `Delta` (way 106179571, Towarowa 35, 11 levels) is the older building.
- Buildings (first fetched 2026-10-27, OSM base 18:55Z): `building=*` ways and `type=multipolygon` relations, ways
  `out tags geom`, relations `out body geom`. Committed raw like the others: the full tag sets were 1.7 MB of the
  13.4 MB of the smaller box (20.8 MB now), not worth a non-Overpass compaction step. `building:levels` is on 20,190
  elements (82 %), `height` on 223, `roof:levels` on 556. `building=construction` (71) is kept: a site under
  construction (AND2) is a built lot.
- Admin: relation 165941 (level 8), 42 level-9 and 81 level-10 relations, plus `place=suburb|quarter|neighbourhood`
  nodes, ways and relations.
- `poz_places.json` is hand-written, not fetched: area labels OSM has no place element for (Śródmieście, Chwaliszewo,
  Cytadela, Malta), each with a kind and lat/lon read off OSM features in the other snapshots (the `where` field says
  which). `poz-extra.mjs` appends them after the OSM places and skips any name OSM already has. Centrum is left out on
  purpose: it is the same city centre as Śródmieście and would sit on top of it.

## Pipeline (tools/build-poznan.mjs)
The build reads only the committed `poz_*.json` snapshots. The current output contract is documented above and next to the `GEO` literal in `tools/build-poznan.mjs`.
- Modules, in import order. Each one does its work at import time:
  - `poz-base.mjs`: the frame (origin at the Ratusz, 52.40856 N 16.93401 E; bearing 0, so x is east and z is south),
    `toWorld`, `llAffine`, `DETAIL_BOX` and the snapshot loader.
  - `poz-roads.mjs`: drivable ways split at shared nodes into `pieces`, plus plazas (with `holes`), pedestrian ways,
    rail lines, rail corridors, `roads`, tram stops and signal nodes.
  - `poz-water.mjs`: water polygons; `land` (the detail box minus water on a 2 m raster) with `landHoles`; `outskirts`
    with `outskirtsHoles`; `isLandAt`.
  - `poz-extra.mjs`: parks and the park-coverage pass, landmarks (with `ang`), districts and labels.
  - `poz-blocks.mjs`: curb islands on a 1 m raster over the detail box (9,743 × 5,677 cells after the 2026-11-08 west
    expansion; 8,168 × 5,677 before it and 6,126 × 3,674 before the 2026-10-28 enlargement). The nearest-edge loop of
    `blockFrames` uses a bbox prefilter. Block ids keep their old order east of x = −3675.4 and the new west blocks are
    appended, so the core ids move by 2–3 instead of hundreds.
  - `poz-buildings.mjs`: the building footprints rasterised on the block raster (outer minus inner rings), giving
    `blockStats`: per block the built share of the curb island, the area-weighted median `building:levels` of the
    buildings whose centroid lies in it (else the block holding most of their cells), their count, and `program`
    (0 none, 1 hospital/clinic campus, 2 university campus, 3 retail/mall, 4 industrial, 5 rail/depot, 6 sport/stadium/arena,
    7 utility, 8 leisure/water park, 9 office campus, from `building`, `amenity`, `healthcare`, `office`, `shop`, `power`,
    `railway`, `leisure`/`sport`, `industrial`, `landuse`, `man_made` and names such as Szpital, Klinika, Collegium,
    Posnania, Dworzec, ZNTK or Elektrociepłownia). `building=office` maps to programme 9 (Business Garden and other office
    campuses); `fillAnchor` keeps King Cross Marcelin at four storeys (way 341510638 is under-tagged at two). Campus keeps its old two-building / one-solo-hospital rule; a non-campus programme needs
    at least 40 % of the block's mapped footprint area (weighted by raster cells, or the ring area for slivers with no cell centre),
    so one 7.7 ha mall outweighs 30 kamienice. A campus keeps the block when its own footprint is larger; blocks under 0.4 ha
    and uses under 150 m² are left to the district profile.
    `building=roof` (1,038 canopies on the 2026-10-28 snapshot) and `building=no` are skipped, and a way that is also a building relation's outer is
    counted once.
    The pass also reads `poz_industry.json`: cooling towers, chimneys, silos and storage tanks with a built outline join
    the mask (only structures, not `power=plant|substation` or `man_made=works` site polygons, which would count a whole
    landuse ring as built mass); every industrial element inside the detail box becomes a `GEO.industry` entry. The
    ZNTK `building=ruins` outlines therefore classify as industrial (block 846, programme 4) and EC Garbary as utility
    (block 266, programme 7); Termy's unnamed `building=yes` at `addr:street=Termalna` classifies as leisure (611,
    programme 8; the west expansion moved most old ids by 2). A way that is also an industry relation's outer is counted once.
    It also emits `blockFootprints`: for blocks with any park share, the `{ block id: [[x0, x1, z0, z1, area], ...] }`
    envelopes of mapped sport/show/public facilities of at least 150 m² (`leisure=stadium|sports_hall|ice_rink|…`,
    `building=stadium|public|civic|…`, cultural amenities, a name match such as Stadion/Arena/Lodowisko/Termy, or
    `addr:street=Termalna`), with the OSM area so the runtime can shrink the rect to the real outline. The remaining
    footprints are not emitted.
    And `blockParkBuildings`: `{ block id: [[x0, x1, z0, z1, area], ...] }`, the ordinary mapped buildings of at least
    60 m² in blocks with more than 40 % park land (1,151 buildings in 66 blocks, 30 KB on the 2026-10-28 snapshot).
    `js/city-config.js` adds them to `parkFootprints` as non-facility lots, so `parkFreeCells` keeps an estate standing
    in parkland instead of clearing it to lawn; `buildings.js` keeps the district's house/kamienica layout on them.
    And `blockAnchors`: `{ block id: [[x0, x1, z0, z1, area, use, levels], ...] }`, the 1–3 largest mapped
    non-residential footprints of a block, with the raster envelope of their own cells in that block (not the full OSM
    bbox, so a footprint clipped by the detail-box edge stays clipped), their in-block area, use (1 retail/mall,
    2 industrial/warehouse, 3 rail/depot, 4 sport/leisure, 5 utility) and storeys. A block is anchored only when its
    non-residential footprints dominate its built mass (≥ 30% of its OSM building cells) and cover ≥ 10% of the island,
    or when one is a mapped park facility; hospital/university campuses stay with their own program. 75 anchors in 43
    blocks after the west expansion (2026-11-08; 61 in 35 blocks on 2026-10-28). Historical measurement on 2026-10-28 over
    the then 8.2 × 5.7 km box: 23,527 footprints (1,038 roof/no skipped), `building:levels` on 85 %; 20,142 in a block, 800
    of 1,422 blocks held one at that measurement; 6.60 km² built of 39.88 km² of block land (17 %). The west-expansion
    output has 30,316 snapshot elements, 25,283 footprints in a block, 957 of 1,647 blocks holding one, 7.80 km² built of
    47.91 km² of block land (16 %), 386 industry structures/sites inside the detail box and 54 blocks with a non-campus
    programme. (6.1 × 3.7 km box: 14,287 footprints, 10,401 in a block, 480 of 796 blocks; 3.67 of 18.75 km², 20 %.)
  - `poz-canopies.mjs`: the open canopies from the `building=roof` outlines that `poz-buildings.mjs` leaves out of the
    built mass. One canopy per outer ring of at least 60 m² inside the detail box, fitted to an oriented minimum-area
    rectangle; outlines whose rectangle overbuilds by more than 2.4× are dropped unless they are a platform, tram,
    fuel or market canopy. `kind` comes from the OSM tags and proximity to a mainline/tram track or tram stop. Each
    canopy carries its height (roof top 4.8–6.5 m, underside 4.5–5.6 m, above a train/tram body and a pedestrian) and
    its 0.4 m column posts: 2–3 rows at 6–8 m bays, every candidate within 2.6 m of a rail centreline skipped, and a
    canopy that loses every post dropped. On the 2026-10-28 snapshot: 157 canopies, 5.47 ha, 1,935 posts, of which 12
    platform (Poznań Główny, Dworzec Letni, Garbary), 3 tram, 10 fuel and 132 ordinary open roofs; 828 rings were under
    60 m², 11 too irregular, 1 had no clear post and 41 lay outside the box. The snapshot has no `building=roof` market
    hall (market halls are walled buildings in the other snapshots), so `market` has no records here.
  - `poz-roadgraph.mjs`: `buildRoadGraph(pieces, signalNodes, { service })`, called by the build script.
- Speed limits (`speedLimit` in `poz-roads.mjs`, the last element of each `roadGraph.links` tuple, km/h): OSM `maxspeed`,
  else the lower of `maxspeed:forward`/`:backward`, else a zone tag (`zone:maxspeed`, `maxspeed:type` or
  `source:maxspeed` of `PL:zone30`/`PL:zone20`/`PL:living_street`/`PL:urban`), else the class: 20 for `living_street`
  (and `service`), 50 for the rest (the built-up limit). Every `maxspeed` in the snapshot is a plain number. Measured on
  the west-expansion output (9.7 × 5.7 km box, 2026-11-08): tagged on 80.0% of the graph's 547.2 km; 10 km/h 0.3 km,
  20 km/h 93.1 km, 30 km/h 130.2 km, 40 km/h 18.9 km, 50 km/h 270.5 km, 60 km/h 1.5 km, 70 km/h 31.1 km (Warszawska,
  Krzywoustego, Bałtycka, Hlonda, Szwajcarska, Niestachowska, Witosa, Hetmańska, ...), 80 km/h 1.6 km (Św. Wawrzyńca).
  The build logs this line as `road graph: speed limits tagged on …`.
- Bus lanes: each `roadGraph.links` tuple ends with `[forward, backward]` vectors (null or left-to-right 0/1 for
  `designated` in `bus:lanes` / `psv:lanes`) and the OSM way ID for a designated vector. Unsuffixed vectors apply
  only to one-way roads. Opposite directions of one-way roads are discarded; count-only and turn tags never infer a
  position. Runtime maps each vector onto the directional runtime lanes instead of suppressing a count mismatch: an
  equal-length vector keeps its own index, otherwise the designated position is placed by its fractional distance
  across the lanes (a narrow two-lane direction becomes the single lane it models; a roundabout's outer lanes stay on
  their side). A designated lane removed by an obstacle paints nothing, while other removed lanes leave it alone. Rail,
  crossing and lane-width clearance are checked when placing each P-22 inscription.
  In the full committed source snapshot, 80 ways have positional bus/PSV tags, all `designated`; 15 more have only
  counts and 22 have only bus/PSV turn tags (these categories exclude positional and count tags). Seven one-way ways
  allow opposite-direction buses/PSVs via `oneway:bus` or `oneway:psv`; none provides a designated
  opposite-direction positional vector, so none produces a contraflow marking. Categories can overlap.
  In the furnished headless measurement, of the 80 designated ways, 46 receive paint, 33 are mapped from a runtime
  lane-count mismatch, 12 have eligible segments too short for a mark, and 22 have no corresponding retained paint
  edge (outside the graph, collapsed, or removed). Track/crossing clearance removes no additional whole way in this
  sample. These are OSM ways, not street names; the same street can have many ways. The marked length and inscription
  count are part of the furnished regression output. The regression prints and checks the following report against this
  document (`node --test tests/zebra-visibility.test.cjs`):

  `P-22 ways: 80 designated, 46 painted, 33 mapped from lane-count mismatch, 12 too short, 0 rail clearance, 0 crossing clearance, 0 blocked lanes, 22 no retained edge; 15 count-only, 22 turn-only, 7 one-way ways allow opposite buses/PSVs`

  The latter seven are a separate, overlapping source-tag count, not seven additional designated ways. See [world.md](world.md#road-network-shared-by-traffic-pedestrians-and-paint) for measurement scope.
- No bike lanes: the OSM `cycleway` tags are ignored since the bike lanes were removed (2026-10-28).
- Tram strips (`roadGraph.links` flags bit 1 tram, bits 3/4): a tram link's width includes `TRAM_W` 6.5 m for the
  tracks. Where the median signed offset of the nearest parallel track (every 4 m, within 12 m) lies beyond the
  carriageway's half width, the tracks run beside it (a divided road's median) and `tramSide` puts the strip on that
  side: flags bit 3 right of a→b, bit 4 left. `poz-blocks.mjs` stamps such a piece about the middle of carriageway and
  strip (3.25 m to the tracks' side), and road-network.js lays its roadway out there with the lanes on the carriageway
  (`docs/world.md`). Centred on every link, the strip put 3.25 m of roadway past the real outer curb. Measured on the
  2026-11-08 west-expansion output: 45 links right, 847 left; the pre-expansion 8.2 × 5.7 km box had 44 right, 799 left
  (52.5 km) and 200 with the tracks on the carriageway (the 6.1 × 3.7 km box: 35, 475 (32 km), 156); the build logs
  `tram strip right … / left … links`. Blocks went from 821 to 796 (outer curbs moved in, slivers merged) when it came in.
- Current committed output (read directly from `js/geodata.js`, 2026-11-08 after the west expansion): 3,071,585 bytes
  including its header, 1,647 blocks and block-stat entries, 75 anchors in 43 blocks, 7,608 road pieces, 8,342 graph
  links, 485 parks, 35 osiedla, 1,172 rail chains (645 tram, 527 mainline) and 181 canopies with 2,283 columns
  (12 platform, 3 tram, 10 fuel, 156 other). There are 233 tram stop nodes and 38 directional route records.
  Physical tram chains total 129.6 km; mainline chains 127.2 km. Directed runtime tram edges have a different
  denominator (two-way chains contribute twice); see [actors.md](actors.md#trams-jstramsjs). The historical
  smaller-box output was 1.42 MB.
- Holes are separate keys: `landHoles` and `outskirtsHoles` are `[{ outer, ring }]` with positive winding, where `outer`
  indexes `land` or `outskirts`. `water[i].holes` (islands) and `plazas[i].holes` (buildings on a square) are nested and
  optional. Keep the comments next to the `GEO` literal in `build-poznan.mjs` in sync with the layouts.
- Block raster decisions (`poz-blocks.mjs` header):
  - Unnamed `highway=service` pieces are not stamped. Stamping them added 350 courtyard slivers. Named service roads
    are stamped.
  - `STRIP` is a 10 m riverside strip, measured from `isLandAt`. The detail-box edge is not treated as a shore.
  - Plazas are cleared, then a multipolygon's inner rings of 100 m² and up are given back, grown by `SIDEWALK`. This is
    how Stary Rynek keeps its central block. Plac Wolności's pedestrian relation is excluded in `poz-roads.mjs`: its
    inner rings are planting beds and a fountain, rather than buildings.
  - Pedestrian ways are stamped only outside plazas.
  - `landuse=railway` areas and off-street track corridors are cleared, except the footprint of a mapped railway
    building (station, depot, signal box), given back grown by `SIDEWALK`. A candidate needs
    `building=train_station|transportation|station|railway_station|bus_station|engine_shed`, any `railway=*` tag, or a
    station/depot name; the restored cells must be cells the rail stamp removed, so a building never reopens a road or
    water cell. The `SIDEWALK` margin stops one metre outside the 5 m mainline / 4 m tram track corridor and one cell
    short of an existing block, so a station becomes its own island and does not bridge two blocks across a rail
    strip; the footprint itself comes back whole (a depot hall covers its yard tracks). 9 islands / 19,098 m² on the
    2026-11-08 snapshot; Głogowska depot went from 1,176 m² and no lots to 8,196 m² and 13 lots (block #1248 in the
    current west-expansion output), and LCS Poznań Główny (#1001) and Dworzec Letni (#802) gained their own blocks.
    See [railway building islands](observations/railway-building-islands-2026-11-08.md).
  - Bridges are stamped like any road.
- Water labels (Warta, Cybina, Jezioro Maltańskie, Stare koryto Warty, Jezioro Rusałka; `kind: 'water'`) are appended
  to the place `labels`. Each sits at the point of its water body farthest from the shore inside the detail box
  (Rusałka, two fifths inside the box's west edge, on that part).

## Tests
- The same fresh build must match the committed `js/geodata.js` byte for byte. Landmark coverage requires the exact
  36 site names, finite placement and dimensions, positive sizes and area, positions inside the detail box and
  non-degenerate polygon footprints.
- `tests/geodata.test.mjs` copies `tools/*.mjs` into a temporary directory whose path contains spaces and non-ASCII characters (`'Poznań Zażółć 東京 '`), symlinks `tools/data` into it, runs the build with GEO_DATA unset, the default output path and `--max-old-space-size=8192`, then imports the output and checks the version, ≥ 3 land rings, the Warta, a bridge link, link flags within bits 0-4 with the tram-strip bits only on tram links (> 300 of them), > 100 signals, plausible link speed limits (values, the 50 and ≤ 30 km/h shares, a 70 km/h artery), the Ratusz, > 500 blocks, `blockStats` (one per block, shares in 0..1, programmes 0-9, the blocks within 150 m of the Ratusz over 40 % built, an area-weighted share of 12-35 %), `blockFootprints` (the Hala Arena, Enea Stadion and Chwiałka envelopes in blocks 925/937), `blockAnchors` (≥ 30 anchored blocks; Posnania 953, Castorama 21, ZNTK 846, Hala Arena 925 and the Głogowska depot 1248; every entry seven finite values with a positive envelope and use 1–5), `industry` (the snapshot's structures in the detail box, with chimney, tank and plant entries), `canopies` (≥ 140 records, finite oriented rectangles, 4.5–6.5 m roofs above their undersides, ≥ 8 platform and ≥ 5 fuel canopies, the long Poznań Główny platform canopy), that `frame.ll` puts the Ratusz at the origin, that the tram track closed for rebuilding is kept (every Most Chrobrego, Most Mieszka I and Most Teatralny link carries the tram bit with a track on the deck; the Katedra, Rondo Śródka, Fredry, Most Teatralny and Małe Garbary stop nodes lie on a track), and the tram routes (≥ 30, valid `routes` indices on every tram chain, over 90% of the tram track length on a route (by length: the Głogowska depot yard is many short chains on no route), lines 7, 8 and 17 over Most Chrobrego). It guards path handling: resolve paths with `fileURLToPath(new URL(..., import.meta.url))`, never `URL.pathname`. New tool modules must be `.mjs` files directly in `tools/`, or the test will not copy them. It takes about 36 s (timeout 180 s).
- `tests/overpass.test.mjs` replaces `curl` and `sleep` with stubs on PATH and checks the keep-old-data-on-failure guarantees above, including that all 3 endpoints are tried and no temp files are left behind. If you change the retry or endpoint logic, update the expected call counts.
- `tests/canopies.test.cjs` checks `GEO.canopies` against `GEO.rail`: every column lies inside its roof and at least 2.5 m from every track centreline (the closest measured column is printed on failure), and the runtime `buildCanopies` emits one roof instance per record with one thin full-height post collider per column plus a deck collider whose underside is above 4.5 m.
- Run both with `node --test tests/geodata.test.mjs tests/overpass.test.mjs`. Neither needs network access.
