# Geodata pipeline (tools/ → js/geodata.js)

## Map
- `tools/build-poznan.mjs`: entry point. It assembles and writes the `GEO` object (the contract in `docs/poznan-plan.md` §2), and places the water labels itself.
- `tools/poz-base.mjs`: the frame (`toWorld`, `llAffine`, `DETAIL_BOX`) and the snapshot loader. Side-effect free apart from reading `GEO_DATA`.
- `tools/geo-util.mjs`: the pure geometry and raster helpers (`ringArea`, `bbox`, `rdp`/`rdpRing`, `pointInRing`, `centroid`, the `Raster` class, `scanRings` (even-odd scanline over several rings), `elemRings` (outer rings, or inner ones with `role = 'inner'`) for Overpass elements, and `labelComponents`/`traceComponents` for the land components). It has no inputs, no frame and no import-time work: helpers that project lon/lat take a `project(lon, lat)` function (`toWorld`). Keep city constants and file reads out of it.
- `poz-roads.mjs`, `poz-water.mjs`, `poz-extra.mjs`, `poz-blocks.mjs`, `poz-buildings.mjs` do their work at import time, as top-level side effects, in that dependency order; `poz-roadgraph.mjs` exports `buildRoadGraph`, which the entry point calls. What each decides is under [Pipeline](#pipeline-toolsbuild-poznanmjs).
- The Manhattan pipeline (`build-geodata.mjs`, `geo-*.mjs` other than `geo-util.mjs`, the CSCL/DCP/NYC Parks inputs) was deleted at the Phase 5 cutover; it lives in git history (commit `fc38ef6` and earlier).

## Regenerate
```
node --max-old-space-size=8192 tools/build-poznan.mjs            # writes js/geodata.js
node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/x.js  # writes elsewhere (diff before replacing)
GEO_DATA=/some/dir node ... tools/build-poznan.mjs                # read inputs from another directory (default tools/data/)
```
- The run takes about 29 s (24 s of it the block outlines, lots and frames; the building pass, snapshot load included, logs ≈ 0.36 s), with a peak RSS of ≈ 1.27 GB (`/usr/bin/time -l`, 2026-10-28; the 6.1 × 3.7 km box took 14 s and 0.81 GB). Keep the 8 GB heap flag that the header usage line and `tests/geodata.test.mjs` pass, because the 1 m rasters and the EDTs are large.
- The output is deterministic. A rebuild from the committed `tools/data` reproduces the committed `js/geodata.js` byte for byte (verified). After any change to tools/, build to a temporary path and `cmp` it against the committed file: an unexpected diff means a behaviour change.
- `js/geodata.js` is GENERATED: its header says "do not edit by hand", and its single JSON line is about 2.48 MB. To change any geodata value, change the tools or the inputs and rebuild. Commit the regenerated file together with the tool change.
- Read the build's `[geodata]` log lines (counts, the frame, the per-key KB at the end). They are the quickest sanity check after a change.
- Inspect the output with `head -c 1500 js/geodata.js`, or `import('./js/geodata.js')` in node. Never read the whole file.

## World frame (the whole sim uses it)
- 1 unit = 1 m. y is up. **x = east, z = south (north = −z)**. Heading 0 faces +z (south). The axes are not turned (`GEO.frame.bearingDeg` = 0, D2): Poznań has no single street grid, so almost every block carries frontage frames.
- The origin is fixed at the Ratusz on Stary Rynek, **52.40856 N, 16.93401 E** (D1), not derived from a data node.
- The projection is a local tangent plane at that point (`poz-base.mjs`): KX ≈ 67.9 km/°, KY ≈ 111.25 km/° at 52.4°.
- `GEO.frame.ll` is `toWorld` as affine coefficients `[a, b, c, d, e, f]`: **x = a·lon + b·lat + c, z = d·lon + e·lat + f** (emitted unrounded). `city-config.js` `LL(lon, lat)` reads it, so hand-placed lon/lat (outskirts zones, camera targets) follows the frame on every rebuild.
- `GEO.frame.detailBox` = `[x0, x1, z0, z1]` is the detailed core (D3 grown by about 1 km a side in Phase 13.2: 52.383–52.434 N, 16.880–17.000 E, x −3675…4491, z −2831…2844, ≈ 8.2 × 5.7 km = 46 km²; it was 52.392–52.425 N, 16.895–16.985 E, 6.1 × 3.7 km). Blocks, roads, the road graph and `land` exist only inside it; `outskirts` covers the rest of the city out to the admin boundary. The runtime's `CITY_BOUNDS` is this box.
- Rings and polylines are flat `[x0, z0, x1, z1, ...]` arrays, rounded to 0.1 m. Outer rings have a negative shoelace area in (x, z); hole rings are positive.

## Output shape and consumers
- `GEO` has these keys: `version` (2), `frame{bearingDeg, origin, lat0, lon0, units, strip, sidewalk, detailBox, ll}`, `land`, `landHoles`, `water`, `outskirts`, `outskirtsHoles`, `districts`, `labels`, `roads`, `roadGraph`, `rail`, `tramRoutes`, `tramStops`, `plazas`, `blocks`, `blockStats`, `parks`, `landmarks`. The positional tuple layouts of `roads`, `roadGraph.links`, `blocks` and `blockStats` are documented in comments next to the `GEO` literal in `build-poznan.mjs`. Keep those comments in sync when you change a layout.
- `js/city-config.js` is the main consumer. It turns `GEO` into `{x, z}` rings and named exports: `LAND_RINGS`/`LAND_HOLES`, `WATER`, `OUTSKIRTS`/`OUTSKIRTS_HOLES`, `RAIL`, `PLAZAS`, `DISTRICTS` (`districtAt`), `BRIDGES` (the bridge-flagged graph links chained per name), `SIGNAL_SITES` (from `roadGraph.signals`, with each junction's arms), `roadClearance` (distance outside the road graph's runs, for street furniture), `ROADS`, `BLOCKS` (each with `built`, `levels` and `buildings` from `GEO.blockStats`), `LANDMARK_SITES`, and the land raster behind `isLand`/`isWater`/`distToWater`/`clampToLand` (2 m cells; bridge decks count as land). Prefer those exports in runtime code. A few modules read `GEO` directly:
  - `road-network.js`: `roadGraph`
  - `city-grid.js`, `buildings.js`, `city-map.js`: `parks`, `plazas`, `frame`
  - `city-map.js`: `labels` (area names, placed by `kind`)
  - `tram-infra.js`: `rail` (for `oneway`, which `RAIL` drops) and `tramStops`
  - `trams.js`: `rail` (with each tram chain's `routes`), `tramStops` and `tramRoutes`
- When you add, rename or re-layout a `GEO` key, update every consumer of it, plus the `GEO` stubs in `tests/city-map.test.cjs` if `city-map.js` reads it.
- `GEO.landmarks` is keyed by a curated name (`Ratusz`, `Katedra`, `Bałtyk`, …; `poz-extra.mjs`), each `{x, z, w, d, h, area, ring, ang}`. `ang` (radians, the turn of a frontage frame's θ and three.js `rotation.y`) is the outline's principal axis: `w` and `d` are the extents along the turned axes, and `fitToSite` turns the model and its colliders by it (see [`world.md`](world.md)). `h` is curated, else `building:levels` × 3.4; OSM `height` is not trusted. Runtime code looks entries up by name (`LANDMARK_SITES['Ratusz']`), so a dropped match silently drops the landmark: `fitToSite` returns early on a missing site.

## Data sources and licensing (tools/data/)
- Every input is OpenStreetMap via Overpass, © OpenStreetMap contributors, **ODbL**: `poz_*.json`, each from the matching `q_poz_*.overpassql`. Extents, dates and schemas are in the next section.
- The output header and README.md carry the attribution. Keep it whenever you add a source, and add the new source's licence there too (GUGiK and ZTM terms if their data is used; `docs/poznan-plan.md` §4.4, §9.3).

## Refreshing an OSM source
```
tools/overpass.sh tools/data/poz_landmarks.json tools/data/q_poz_landmarks.overpassql [tries=12]
```
- The script tries three Overpass endpoints per round and sleeps `i*4` s between attempts. It writes to an adjacent temp file and renames it over the output **only** when the response is HTTP 200, curl succeeded, the JSON parses, `elements` is an array and there is no `remark`. Overpass reports timeouts as a 200 response with a `remark`. Any failure leaves the old data untouched and exits 1.
- After a refresh, rebuild and review the diff of `js/geodata.js` and the build log counts (landmarks, blocks, graph links, signals).
- To add a landmark footprint, add its exact OSM name to `q_poz_landmarks.overpassql` (ways and relations) and its curated entry to `poz-extra.mjs`, then refetch and rebuild. For the runtime side, see [`world.md`](world.md).
- The build logs `WARNING landmark query name "…" matches nothing` for every name in the query's `["name"~…]` / `["name"=…]` filters that no snapshot element carries: an OSM rename otherwise drops the landmark silently. Unnamed footprints (Domki Budnicze, Bałtyk) are fetched by id or by another tag.

## Poznań snapshots (tools/data/poz_*.json)
Inputs for the Poznań pipeline (`docs/poznan-plan.md` §4.1), OSM via Overpass, **ODbL**. All refetched for the larger
detail box on 2026-10-28 18:40–18:51 CET (OSM base 2026-10-28T17:40–17:49Z), one query at a time, with
`bash tools/overpass.sh tools/data/poz_<name>.json tools/data/q_poz_<name>.overpassql`; the three overpass-api.de
endpoints answered (502s on some tries), no other instance was needed. Inside the old padded box OSM had not changed
since the 2026-10-25/27 fetches (no tag change on any road, rail, tram route, building or signal there).
- **Detail box D3**: 52.383–52.434 N, 16.880–17.000 E. **Padded box**: 52.380–52.437 N, 16.875–17.005 E (≈ 330 m on
  each side), selecting whole ways that intersect it, so features crossing the D3 edge are complete. (Before Phase
  13.2: D3 52.392–52.425 N, 16.895–16.985 E, padded 52.389–52.428 N, 16.890–16.990 E.)
- **City**: the Poznań admin_level=8 boundary, relation **165941** (Overpass `area(id:3600165941)`). Area filters return
  elements that are at least partly inside, with full geometry.

| file | query | extent | elements | size |
|---|---|---|---|---|
| `poz_roads.json` | `q_poz_roads.overpassql` | padded box | 9,717 (9,688 ways, 29 relations) | 8.8 MB |
| `poz_signals.json` | `q_poz_signals.overpassql` | padded box | 6,175 nodes (906 `traffic_signals`, 5,017 `crossing`, 259 `tram_stop`) | 1.3 MB |
| `poz_rail.json` | `q_poz_rail.overpassql` | padded box | 1,551 (592 tram and 555 rail ways; 60 closed tram ways of route relations; 334 ways and 10 relations of `landuse=railway`) | 2.5 MB |
| `poz_tram_routes.json` | `q_poz_tram_routes.overpassql` | padded box | 46 `route=tram` relations (members only; the same 46 as in the smaller box) | 0.4 MB |
| `poz_water.json` | `q_poz_water.overpassql` | city | 1,571 (1,543 ways, 28 relations) | 2.5 MB |
| `poz_parks.json` | `q_poz_parks.overpassql` | city + padded box | 7,227 (7,073 ways, 154 relations) | 13.9 MB |
| `poz_landmarks.json` | `q_poz_landmarks.overpassql` | D3 | 36 (28 ways, 7 relations, 1 node) | 0.1 MB |
| `poz_admin.json` | `q_poz_admin.overpassql` | city | 344 (148 relations, 26 ways, 170 nodes) | 2.2 MB |
| `poz_buildings.json` | `q_poz_buildings.overpassql` | padded box | 24,569 (24,399 ways, 170 relations) | 20.8 MB |

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
  direction, sorted by number and terminus; routes with no track in the box (line 1) are dropped. Each tram `rail` entry
  carries `routes`, the indices of the routes whose member ways make up at least half its length (`ROUTE_SHARE`: a
  chain is not cut where a dropped tunnel track leaves it). Measured over the 8.2 × 5.7 km box: 38 routes of 20 lines
  (line 1 now reaches the box); 120.5 of 127.2 km of tram track is on a route, most of the rest the Głogowska depot
  yard (about 145 short chains, so only 74% of the chains); Most Chrobrego carries 7, 8 and 17. (6.1 × 3.7 km box: 36
  routes of 19 lines, 76.5 of 76.9 km.)
- Track chains (`GEO.rail`) end at every node where more than two track pieces end, whatever their chaining key
  (`street`, `oneway`, `tracks`). Before 2026-10-28 a switch whose branch had another key (a street track leaving an
  off-street one, a two-way stub off a one-way line) was chained through, so the branch met the other chain mid-way
  and the runtime graph had no junction there: 249 tram chains then, 367 after (644 over the 8.2 × 5.7 km box).
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
The build (`docs/poznan-plan.md` §2, §4) reads only the `poz_*.json` snapshots.
- Modules, in import order. Each one does its work at import time:
  - `poz-base.mjs`: the frame (origin at the Ratusz, 52.40856 N 16.93401 E; bearing 0, so x is east and z is south),
    `toWorld`, `llAffine`, `DETAIL_BOX` and the snapshot loader.
  - `poz-roads.mjs`: drivable ways split at shared nodes into `pieces`, plus plazas (with `holes`), pedestrian ways,
    rail lines, rail corridors, `roads`, tram stops and signal nodes.
  - `poz-water.mjs`: water polygons; `land` (the detail box minus water on a 2 m raster) with `landHoles`; `outskirts`
    with `outskirtsHoles`; `isLandAt`.
  - `poz-extra.mjs`: parks and the park-coverage pass, landmarks (with `ang`), districts and labels.
  - `poz-blocks.mjs`: curb islands on a 1 m raster over the detail box (8,168 × 5,677 cells; 6,126 × 3,674 before
    Phase 13.2). It ports
    the former Manhattan `geo-blocks.mjs` and adds a bbox prefilter to the nearest-edge loop of `blockFrames`.
  - `poz-buildings.mjs`: the building footprints rasterised on the block raster (outer minus inner rings), giving
    `blockStats`: per block the built share of the curb island, the area-weighted median `building:levels` of the
    buildings whose centroid lies in it (else the block holding most of their cells), and their count. `building=roof`
    (555 canopies) and `building=no` are skipped, and a way that is also a building relation's outer is counted once.
    The footprints are not emitted. Measured over the 8.2 × 5.7 km box: 23,527 footprints (1,038 roof/no skipped),
    `building:levels` on 85 %; 20,142 in a block, 800 of 1,422 blocks hold one; 6.60 km² built of 39.88 km² of block
    land (17 %). (6.1 × 3.7 km box: 14,287 footprints, 10,401 in a block, 480 of 796 blocks; 3.67 of 18.75 km², 20 %.)
  - `poz-roadgraph.mjs`: `buildRoadGraph(pieces, signalNodes, { service })`, called by the build script.
- Speed limits (`speedLimit` in `poz-roads.mjs`, the last element of each `roadGraph.links` tuple, km/h): OSM `maxspeed`,
  else the lower of `maxspeed:forward`/`:backward`, else a zone tag (`zone:maxspeed`, `maxspeed:type` or
  `source:maxspeed` of `PL:zone30`/`PL:zone20`/`PL:living_street`/`PL:urban`), else the class: 20 for `living_street`
  (and `service`), 50 for the rest (the built-up limit). Every `maxspeed` in the snapshot is a plain number. Measured on
  the 2026-10-28 snapshot (8.2 × 5.7 km box): tagged on 81.4% of the graph's 452.4 km; 20 km/h 78.2 km, 30 km/h
  108.9 km, 40 km/h 14.5 km, 50 km/h 219.3 km, 70 km/h 28.1 km (Warszawska, Krzywoustego, Bałtycka, Hlonda,
  Szwajcarska, Niestachowska, Witosa, Hetmańska, ...), 80 km/h 1.6 km (Św. Wawrzyńca), and under 2 km each of 10
  and 60. (The 6.1 × 3.7 km box: 83.3% of 229.8 km.) The build logs this line as `road graph: speed limits tagged on …`.
- No bike lanes: the OSM `cycleway` tags are ignored since the bike lanes were removed (2026-10-28).
- Tram strips (`roadGraph.links` flags bit 1 tram, bits 3/4): a tram link's width includes `TRAM_W` 6.5 m for the
  tracks. Where the median signed offset of the nearest parallel track (every 4 m, within 12 m) lies beyond the
  carriageway's half width, the tracks run beside it (a divided road's median) and `tramSide` puts the strip on that
  side: flags bit 3 right of a→b, bit 4 left. `poz-blocks.mjs` stamps such a piece about the middle of carriageway and
  strip (3.25 m to the tracks' side), and road-network.js lays its roadway out there with the lanes on the carriageway
  (`docs/world.md`). Centred on every link, the strip put 3.25 m of roadway past the real outer curb. Measured on the
  2026-10-28 snapshot (8.2 × 5.7 km box): 44 links right, 799 left (52.5 km), 200 with the tracks on the carriageway
  (the 6.1 × 3.7 km box: 35, 475 (32 km), 156); the build logs `tram strip right … / left … links`. Blocks went from
  821 to 796 (outer curbs moved in, slivers merged) when it came in.
- Output (2.48 MB over the 8.2 × 5.7 km box; 1.42 MB over the 6.1 × 3.7 km one): `blocks` 878 KB (1,422; 796 before),
  `roads` 457 KB (6,665), `roadGraph` 394 KB (7,116 links; 3,903 before), `parks` 288 KB, `rail` 170 KB (1,170 lines),
  `plazas` 67 KB, `water` 44 KB, `districts` 27 KB (34 osiedla), `outskirts` 16 KB plus 9 KB of holes, `blockStats`
  14 KB, `landHoles` 13 KB, `tramStops` 10 KB. The rest is under 10 KB each.
- Holes are separate keys: `landHoles` and `outskirtsHoles` are `[{ outer, ring }]` with positive winding, where `outer`
  indexes `land` or `outskirts`. `water[i].holes` (islands) and `plazas[i].holes` (buildings on a square) are nested and
  optional. Keep the comments next to the `GEO` literal in `build-poznan.mjs` in sync with the layouts.
- Block raster decisions (`poz-blocks.mjs` header):
  - Unnamed `highway=service` pieces are not stamped. Stamping them added 350 courtyard slivers. Named service roads
    are stamped.
  - `STRIP` is a 10 m riverside strip, measured from `isLandAt`. The detail-box edge is not treated as a shore.
  - Plazas are cleared, then a multipolygon's inner rings of 100 m² and up are given back, grown by `SIDEWALK`. This is
    how Stary Rynek keeps its central block.
  - Pedestrian ways are stamped only outside plazas.
  - `landuse=railway` areas and off-street track corridors are cleared.
  - Bridges are stamped like any road.
- Water labels (Warta, Cybina, Jezioro Maltańskie, Stare koryto Warty, Jezioro Rusałka; `kind: 'water'`) are appended
  to the place `labels`. Each sits at the point of its water body farthest from the shore inside the detail box
  (Rusałka, two fifths inside the box's west edge, on that part).

## Tests
- `tests/geodata.test.mjs` copies `tools/*.mjs` into a temporary directory whose path contains spaces and non-ASCII characters (`'Poznań Zażółć 東京 '`), symlinks `tools/data` into it, runs the build with GEO_DATA unset, the default output path and `--max-old-space-size=8192`, then imports the output and checks the version, ≥ 3 land rings, the Warta, a bridge link, link flags within bits 0-4 with the tram-strip bits only on tram links (> 300 of them), > 100 signals, plausible link speed limits (values, the 50 and ≤ 30 km/h shares, a 70 km/h artery), the Ratusz, > 500 blocks, `blockStats` (one per block, shares in 0..1, the blocks within 150 m of the Ratusz over 40 % built, an area-weighted share of 12-35 %), that `frame.ll` puts the Ratusz at the origin, that the tram track closed for rebuilding is kept (every Most Chrobrego, Most Mieszka I and Most Teatralny link carries the tram bit with a track on the deck; the Katedra, Rondo Śródka, Fredry, Most Teatralny and Małe Garbary stop nodes lie on a track), and the tram routes (≥ 30, valid `routes` indices on every tram chain, over 90% of the tram track length on a route (by length: the Głogowska depot yard is many short chains on no route), lines 7, 8 and 17 over Most Chrobrego). It guards path handling: resolve paths with `fileURLToPath(new URL(..., import.meta.url))`, never `URL.pathname`. New tool modules must be `.mjs` files directly in `tools/`, or the test will not copy them. It takes about 30 s (timeout 180 s).
- `tests/overpass.test.mjs` replaces `curl` and `sleep` with stubs on PATH and checks the keep-old-data-on-failure guarantees above, including that all 3 endpoints are tried and no temp files are left behind. If you change the retry or endpoint logic, update the expected call counts.
- Run both with `node --test tests/geodata.test.mjs tests/overpass.test.mjs`. Neither needs network access.
