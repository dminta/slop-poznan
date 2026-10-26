# Geodata pipeline (tools/ → js/geodata.js)

## Map
- `tools/build-poznan.mjs`: entry point. It assembles and writes the `GEO` object (the contract in `docs/poznan-plan.md` §2), and places the water labels itself.
- `tools/poz-base.mjs`: the frame (`toWorld`, `llAffine`, `DETAIL_BOX`) and the snapshot loader. Side-effect free apart from reading `GEO_DATA`.
- `tools/geo-util.mjs`: the pure geometry and raster helpers (`ringArea`, `bbox`, `rdp`/`rdpRing`, `pointInRing`, `centroid`, the `Raster` class, `elemRing`/`elemRings` for Overpass elements, `chainCoastline`). It has no inputs, no frame and no import-time work: helpers that project lon/lat take a `project(lon, lat)` function (`toWorld`). Keep city constants and file reads out of it.
- `poz-roads.mjs`, `poz-water.mjs`, `poz-extra.mjs`, `poz-blocks.mjs` do their work at import time, as top-level side effects, in that dependency order; `poz-roadgraph.mjs` exports `buildRoadGraph`, which the entry point calls. What each decides is under [Pipeline](#pipeline-toolsbuild-poznanmjs).
- The Manhattan pipeline (`build-geodata.mjs`, `geo-*.mjs` other than `geo-util.mjs`, the CSCL/DCP/NYC Parks inputs) was deleted at the Phase 5 cutover; it lives in git history (commit `fc38ef6` and earlier).

## Regenerate
```
node --max-old-space-size=8192 tools/build-poznan.mjs            # writes js/geodata.js
node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/x.js  # writes elsewhere (diff before replacing)
GEO_DATA=/some/dir node ... tools/build-poznan.mjs                # read inputs from another directory (default tools/data/)
```
- The run takes about 11 s, with a peak RSS of ≈ 0.76 GB. Keep the 8 GB heap flag that the header usage line and `tests/geodata.test.mjs` pass, because the 1 m rasters and the EDTs are large.
- The output is deterministic. A rebuild from the committed `tools/data` reproduces the committed `js/geodata.js` byte for byte (verified). After any change to tools/, build to a temporary path and `cmp` it against the committed file: an unexpected diff means a behaviour change.
- `js/geodata.js` is GENERATED: its header says "do not edit by hand", and its single JSON line is about 1.29 MB. To change any geodata value, change the tools or the inputs and rebuild. Commit the regenerated file together with the tool change.
- Read the build's `[geodata]` log lines (counts, the frame, the per-key KB at the end). They are the quickest sanity check after a change.
- Inspect the output with `head -c 1500 js/geodata.js`, or `import('./js/geodata.js')` in node. Never read the whole file.

## World frame (the whole sim uses it)
- 1 unit = 1 m. y is up. **x = east, z = south (north = −z)**. Heading 0 faces +z (south). The axes are not turned (`GEO.frame.bearingDeg` = 0, D2): Poznań has no single street grid, so almost every block carries frontage frames.
- The origin is fixed at the Ratusz on Stary Rynek, **52.40856 N, 16.93401 E** (D1), not derived from a data node.
- The projection is a local tangent plane at that point (`poz-base.mjs`): KX ≈ 67.9 km/°, KY ≈ 111.25 km/° at 52.4°.
- `GEO.frame.ll` is `toWorld` as affine coefficients `[a, b, c, d, e, f]`: **x = a·lon + b·lat + c, z = d·lon + e·lat + f** (emitted unrounded). `city-config.js` `LL(lon, lat)` reads it, so hand-placed lon/lat (outskirts zones, camera targets) follows the frame on every rebuild.
- `GEO.frame.detailBox` = `[x0, x1, z0, z1]` is the detailed core (D3: 52.392–52.425 N, 16.895–16.985 E). Blocks, roads, the road graph and `land` exist only inside it; `outskirts` covers the rest of the city out to the admin boundary. The runtime's `CITY_BOUNDS` is this box.
- Rings and polylines are flat `[x0, z0, x1, z1, ...]` arrays, rounded to 0.1 m. Outer rings have a negative shoelace area in (x, z); hole rings are positive.

## Output shape and consumers
- `GEO` has these keys: `version` (2), `frame{bearingDeg, origin, lat0, lon0, units, strip, sidewalk, detailBox, ll}`, `land`, `landHoles`, `water`, `outskirts`, `outskirtsHoles`, `districts`, `labels`, `streets` and `avenues` (both empty, deleted in Phase 12), `roads`, `roadGraph`, `rail`, `tramStops`, `plazas`, `blocks`, `parks`, `landmarks`. The positional tuple layouts of `roads`, `roadGraph.links` and `blocks` are documented in comments next to the `GEO` literal in `build-poznan.mjs`. Keep those comments in sync when you change a layout.
- `js/city-config.js` is the main consumer. It turns `GEO` into `{x, z}` rings and named exports: `LAND_RINGS`/`LAND_HOLES`, `WATER`, `OUTSKIRTS`/`OUTSKIRTS_HOLES`, `RAIL`, `PLAZAS`, `DISTRICTS` (`districtAt`), `BRIDGES` (the bridge-flagged graph links chained per name), `SIGNAL_SITES` (from `roadGraph.signals`), `ROADS`, `BLOCKS`, `LANDMARK_SITES`, and the land raster behind `isLand`/`isWater`/`distToWater`/`clampToLand` (2 m cells; bridge decks count as land). Prefer those exports in runtime code. A few modules read `GEO` directly:
  - `road-network.js`: `roadGraph`
  - `city-grid.js`, `buildings.js`, `city-map.js`: `parks`, `plazas`, `frame`
  - `city-map.js`: `labels` (area names, placed by `kind`)
  - `tram-infra.js`: `rail` (for `oneway`, which `RAIL` drops) and `tramStops`
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
Inputs for the Poznań pipeline (`docs/poznan-plan.md` §4.1), OSM via Overpass, **ODbL**. All fetched 2026-10-25 ~20:25 CET
(OSM base 2026-10-25T19:2x–19:31Z) with `bash tools/overpass.sh tools/data/poz_<name>.json tools/data/q_poz_<name>.overpassql`.
- **Detail box D3**: 52.392–52.425 N, 16.895–16.985 E. **Padded box**: 52.389–52.428 N, 16.890–16.990 E (≈ 330 m on
  each side), selecting whole ways that intersect it, so features crossing the D3 edge are complete.
- **City**: the Poznań admin_level=8 boundary, relation **165941** (Overpass `area(id:3600165941)`). Area filters return
  elements that are at least partly inside, with full geometry.

| file | query | extent | elements | size |
|---|---|---|---|---|
| `poz_roads.json` | `q_poz_roads.overpassql` | padded box | 5,920 (5,894 ways, 26 relations) | 5.5 MB |
| `poz_signals.json` | `q_poz_signals.overpassql` | padded box | 4,003 nodes (527 `traffic_signals`, 3,303 `crossing`, 175 `tram_stop`) | 0.9 MB |
| `poz_rail.json` | `q_poz_rail.overpassql` | padded box | 999 (341 tram and 425 rail ways; 228 ways and 5 relations of `landuse=railway`) | 1.6 MB |
| `poz_water.json` | `q_poz_water.overpassql` | city | 1,571 (1,543 ways, 28 relations) | 2.5 MB |
| `poz_parks.json` | `q_poz_parks.overpassql` | city + padded box | 4,839 (4,719 ways, 120 relations) | 9.9 MB |
| `poz_landmarks.json` | `q_poz_landmarks.overpassql` | D3 | 35 (27 ways, 7 relations, 1 node) | 0.1 MB |
| `poz_admin.json` | `q_poz_admin.overpassql` | city | 344 (148 relations, 26 ways, 170 nodes) | 2.2 MB |

- Schema (`out body geom`): ways carry `bounds`, `nodes` (ids) **and** `geometry` (`[{lat, lon}]`, same length and
  order). Relations carry `bounds` and `members`: way members have `geometry`, node members have `lat`/`lon`, relation
  members (e.g. `subarea`) have neither. Multipolygon outers are split across member ways and must be chained.
  `poz_landmarks.json` ways use `out tags geom` (no `nodes`); its relations use `body` because `tags` drops `members`.
- Roads drop `footway|path|cycleway|steps|track|bridleway|proposed|construction|…` and `service=driveway|parking_aisle|
  drive-through`. Of `area:highway` only `=pedestrian` is kept: the other ~5,500 outlines (sidewalks, islands, lane
  surfaces) were two thirds of a 23.5 MB first fetch. Plazas come from `highway=pedestrian` areas/multipolygons,
  `area:highway=pedestrian` and `place=square` (Stary Rynek is way 8452544, Plac Wolności 634296533, Plac Kolegiacki
  relation 14445791).
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
- Admin: relation 165941 (level 8), 42 level-9 and 81 level-10 relations, plus `place=suburb|quarter|neighbourhood`
  nodes, ways and relations.

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
  - `poz-blocks.mjs`: curb islands on a 1 m raster over the detail box (6,126 × 3,674 cells). It ports
    the former Manhattan `geo-blocks.mjs` and adds a bbox prefilter to the nearest-edge loop of `blockFrames`.
  - `poz-roadgraph.mjs`: `buildRoadGraph(pieces, signalNodes, { service })`, called by the build script.
- Speed limits (`speedLimit` in `poz-roads.mjs`, the last element of each `roadGraph.links` tuple, km/h): OSM `maxspeed`,
  else the lower of `maxspeed:forward`/`:backward`, else a zone tag (`zone:maxspeed`, `maxspeed:type` or
  `source:maxspeed` of `PL:zone30`/`PL:zone20`/`PL:living_street`/`PL:urban`), else the class: 20 for `living_street`
  (and `service`), 50 for the rest (the built-up limit). Every `maxspeed` in the snapshot is a plain number. Measured on
  the 2026-10-25 snapshot: tagged on 83.3% of the graph's 229.8 km; 20 km/h 32.1 km, 30 km/h 73.8 km, 40 km/h 9.3 km,
  50 km/h 103.8 km, 70 km/h 9.1 km (Krzywoustego, Hlonda, Warszawska, Niestachowska), and under 2 km each of 10
  and 60. The build logs this line as `road graph: speed limits tagged on …`.
- Output (1.29 MB): `roads` 246 KB, `roadGraph` 213 KB (3,903 links), `blocks` 412 KB (822), `parks` 193 KB, `rail` 69 KB,
  `plazas` 42 KB, `water` 22 KB, `outskirts` 17 KB plus 10 KB of holes, `districts` 17 KB. The rest is under 10 KB each.
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
- Water labels (Warta, Cybina, Jezioro Maltańskie, Stare koryto Warty; `kind: 'water'`) are appended to the place
  `labels`. Each sits at the point of its water body farthest from the shore inside the detail box.

## Tests
- `tests/geodata.test.mjs` copies `tools/*.mjs` into a temporary directory whose path contains spaces and non-ASCII characters (`'Poznań Zażółć 東京 '`), symlinks `tools/data` into it, runs the build with GEO_DATA unset, the default output path and `--max-old-space-size=8192`, then imports the output and checks the version, ≥ 3 land rings, the Warta, a bridge link, > 100 signals, plausible link speed limits (values, the 50 and ≤ 30 km/h shares, a 70 km/h artery), the Ratusz, > 500 blocks and that `frame.ll` puts the Ratusz at the origin. It guards path handling: resolve paths with `fileURLToPath(new URL(..., import.meta.url))`, never `URL.pathname`. New tool modules must be `.mjs` files directly in `tools/`, or the test will not copy them. It takes about 11 s (timeout 180 s).
- `tests/overpass.test.mjs` replaces `curl` and `sleep` with stubs on PATH and checks the keep-old-data-on-failure guarantees above, including that all 3 endpoints are tried and no temp files are left behind. If you change the retry or endpoint logic, update the expected call counts.
- Run both with `node --test tests/geodata.test.mjs tests/overpass.test.mjs`. Neither needs network access.
