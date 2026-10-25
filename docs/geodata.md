# Geodata pipeline (tools/ → js/geodata.js)

## Map
- `tools/build-geodata.mjs`: entry point. It assembles and writes the `GEO` object, and builds Broadway, the merged `roads` polylines, the Central Park features and the landmark footprints itself.
- `tools/geo-base.mjs`: the frame (`toWorld`) and the shorelines. Importing it runs the frame calibration and loads CSCL, so every other `geo-*.mjs` module except `geo-util.mjs` depends on it.
- `tools/geo-util.mjs`: the pure geometry and raster helpers (`ringArea`, `bbox`, `rdp`/`rdpRing`, `pointInRing`, `centroid`, the `Raster` class, `elemRing`/`elemRings` for Overpass elements, `chainCoastline`). It has no inputs, no frame and no import-time work: helpers that project lon/lat take a `project(lon, lat)` function (`toWorld`). Keep NYC constants and file reads out of it, so a second city's pipeline can import it.
- `geo-streets.mjs` (CSCL → `pieces`, `STREETS`, `AVENUES`), `geo-blocks.mjs` (curb islands rasterised at 1 m, lot rects, frontage frames, `CUT_Z`/`STRIP`/`SIDEWALK`), `geo-extra.mjs` (parks onto blocks, piers, East River bridges, NJ, islands, the Manhattan split), `geo-roadgraph.mjs` (`GEO.roadGraph`).
- The modules do their work at import time, as top-level side effects. Import order is the dependency order, and `node tools/geo-streets.mjs` on its own prints a street and avenue table for debugging.

## Regenerate
```
node --max-old-space-size=8192 tools/build-geodata.mjs            # writes js/geodata.js
node --max-old-space-size=8192 tools/build-geodata.mjs /tmp/x.js  # writes elsewhere (diff before replacing)
GEO_DATA=/some/dir node ... tools/build-geodata.mjs                # read inputs from another directory (default tools/data/)
```
- The run takes about 11 s. The 8 GB heap flag is what the header usage line and `tests/geodata.test.mjs` pass. A default 4 GB heap also worked on Node 26, but keep the flag, because the 1 m rasters and the EDTs are large.
- The output is deterministic. A rebuild from the committed `tools/data` reproduces the committed `js/geodata.js` byte for byte (verified). After any change to tools/, build to a temporary path and `cmp` it against the committed file: an unexpected diff means a behaviour change.
- `js/geodata.js` is GENERATED: its header says "do not edit by hand", and its single JSON line is about 1.1 MB. To change any geodata value, change the tools or the inputs and rebuild. Commit the regenerated file together with the tool change.
- Read the build's `[geodata]` log lines (counts, the derived bearing and origin, the per-key KB at the end). They are the quickest sanity check after a change.
- Inspect the output with `head -c 1500 js/geodata.js`, or `import('./js/geodata.js')` in node. Never read the whole file.

## World frame (the whole sim uses it)
- 1 unit = 1 m. y is up. **x = Manhattan-grid east, z = grid south (north = −z)**. Heading 0 faces +z (south).
- The origin is the CSCL centreline node shared by `5 AVE` and `E/W  42 ST`. The axes are turned by the grid bearing, about 29.02° east of true north. Both values are **re-derived from CSCL on every build**: the bearing is the length-weighted median of the long avenue segments, and the origin is that node. `GEO.frame.bearingDeg` records the bearing.
- The projection is an ellipsoidal local tangent plane at LAT0/LON0 = 40.75318, −73.98185 (`geo-base.mjs`). The 5th & 42nd node sits at (−54.35, 69.42) in that plane.
- `GEO.frame.ll` is `toWorld` as affine coefficients `[a, b, c, d, e, f]`: **x = a·lon + b·lat + c, z = d·lon + e·lat + f** (`geo-base.mjs` `llAffine`, emitted unrounded because c and f are about 5·10⁶). `js/boroughs.js` `LL(lon, lat)` reads it, so hand-placed lon/lat follows the frame on every rebuild. It reproduces the former hand constants to within 0.6 mm over lon −74.30…−73.65, lat 40.48…41.00 (verified). Many world coordinates are hard-coded and depend on this frame:
  - `geo-extra.mjs`: the island seed points, the Ellis Island point (−1460, 7780), the Hudson River Park z range and the NJ cut.
  - `geo-blocks.mjs`: the Times and Herald Square z values.
  - `js/city-config.js`: `HOUSTON_Z` and the other district constants, and the teleports.
  - The street details, landmarks and other placements.

  If a CSCL refresh moves the logged bearing or origin, `LL()` follows by itself, but recheck those constants. Otherwise boroughs, labels and placements drift away from the Manhattan geometry.
- Rings and polylines are flat `[x0, z0, x1, z1, ...]` arrays, rounded to 0.1 m. Rings are reversed to a negative shoelace area in (x, z), to match the winding the runtime has always used for `MANHATTAN_COASTLINE`.
- `CUT_Z = −7090` (about 129th St) splits the detailed island (`GEO.manhattan`, south of the cut) from low-detail Upper Manhattan (`GEO.upperManhattan`, built by boroughs.js). Streets, blocks, roads and the road graph exist only south of about `CUT_Z − 250`.

## Output shape and consumers
- `GEO` has these keys: `version, frame{bearingDeg, origin, units, cutZ, strip, sidewalk, ll}, manhattan, upperManhattan, innerShore, islands, boroughs, streets, avenues, broadway, plazas, roads, roadGraph, blocks, parks, centralPark, piers, bridges, landmarks, points`. The positional tuple layouts of `roads`, `roadGraph.links` and `blocks` are documented in comments next to the `GEO` literal in `build-geodata.mjs`. Keep those comments in sync when you change a layout.
- `js/city-config.js` is the main consumer. It turns `GEO` into `{x, z}` objects and named exports (`BLOCKS`, `ALL_STREETS`, `ALL_AVENUES`, `ROADS`, `LANDMARK_SITES`, the polygons and so on). Prefer those exports in runtime code. A few modules read `GEO` directly:
  - `road-network.js`: `roadGraph`
  - `city-grid.js`: `plazas`, `centralPark`, `points`, `parks`
  - `buildings.js`: `plazas`
  - `city-map.js`: `frame`, `parks`, `centralPark`
- When you add, rename or re-layout a `GEO` key, update every consumer of it, plus the `GEO` stubs in `tests/city-map.test.cjs` if `city-map.js` reads it.
- `GEO.landmarks` is keyed by the exact OSM `name` tag. If a name has several outlines, the largest one wins. Each entry holds a grid-aligned bbox centre and size (`x, z, w, d`), the OSM `height` or null, and the outline ring. An entry may also carry `ang` (radians, the turn of a frontage frame's θ and three.js `rotation.y`): `w` and `d` are then the extents along the turned axes, and `fitToSite` turns the model and its colliders by it (see [`world.md`](world.md)). The NYC pipeline never emits `ang`, because the Manhattan models are built for grid-aligned sites. Runtime code looks entries up by name (`LANDMARK_SITES['Empire State Building']`), so an OSM rename silently drops the landmark: `fitToSite` returns early on a missing site.

## Data sources and licensing (tools/data/)
| file | source | notes |
|---|---|---|
| `dcp_boroughs.json` | NYC DCP Borough Boundaries, water areas excluded (NYC Open Data `gthc-hcne`) | GeoJSON FeatureCollection. Reads `properties.boroname` (`Manhattan`, `Brooklyn`, `Queens`, `Bronx`, `Staten Island`). |
| `cscl_manhattan.json` | NYC Street Centerline, CSCL (`inkn-q76z`), Manhattan only | Socrata JSON row array. Fields read: `the_geom, full_street_name, rw_type, trafdir, streetwidth` (ft), `number_travel_lanes, from_level_code, to_level_code`. |
| `nycparks_manhattan.json` | NYC Parks Properties (`enfh-gkve`), Manhattan | Row array. Reads `multipolygon, signname, name311, typecategory, acres`. |
| `osm_*.json` | OpenStreetMap via Overpass, © OpenStreetMap contributors, **ODbL** | Each file comes from the matching `q_*.overpassql` (coast→coastline, cp→centralpark, landmarks, piers). |

- The output header and README.md carry the attribution. Keep it whenever you add a source, and add the new source's licence there too.
- No script in the repo records the Socrata queries for the three NYC Open Data files. To refresh one, download the same dataset filtered to Manhattan with at least the fields listed above. The code relies on CSCL's raw formatting: names with double spaces (`'E  42 ST'`, `'W  END AVE'`, `'FDR DR  VIADUCT'`), the `rw_type` codes kept in `geo-streets.mjs` (1 street, 2 highway, …), level code `'13'` for at grade, and `trafdir` values `FT`, `TF` and `TW`.

## Refreshing an OSM source
```
tools/overpass.sh tools/data/osm_landmarks.json tools/data/q_landmarks.overpassql [tries=12]
```
- The script tries three Overpass endpoints per round and sleeps `i*4` s between attempts. It writes to an adjacent temp file and renames it over the output **only** when the response is HTTP 200, curl succeeded, the JSON parses, `elements` is an array and there is no `remark`. Overpass reports timeouts as a 200 response with a `remark`. Any failure leaves the old data untouched and exits 1.
- After a refresh, rebuild and review the diff of `js/geodata.js` and the build log counts (landmark footprints, piers, CP water/lawns).
- To add a landmark footprint, add its exact OSM name to the `name~"^(...)$"` regex in `q_landmarks.overpassql`. Add it to the `relation` clause too if OSM maps it as a multipolygon. Then refetch and rebuild. For the runtime side, see [`world.md`](world.md).
- To add a Central Park water body, lawn or site, add its name to `WATER_NAMES`, `LAWN_NAMES` or `SITE_NAMES` in `build-geodata.mjs`. `q_cp.overpassql` may also need a matching clause.

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

## Poznań pipeline (tools/build-poznan.mjs)
The Poznań build (`docs/poznan-plan.md` §2, §4) runs next to the NYC one until the Phase 5 cutover. It reads only the
`poz_*.json` snapshots and never imports a `geo-*.mjs` module other than `geo-util.mjs`.
```
node --max-old-space-size=8192 tools/build-poznan.mjs            # writes $TMPDIR/geodata-poznan.js (path is logged)
node --max-old-space-size=8192 tools/build-poznan.mjs /tmp/p.js  # writes elsewhere
```
- The default output is `os.tmpdir()/geodata-poznan.js`, so the build cannot overwrite the NYC `js/geodata.js` before
  the cutover. A run takes ≈ 11 s, with a peak RSS of ≈ 0.76 GB. Two builds compare equal with `cmp` (verified).
- Modules, in import order. Each one does its work at import time:
  - `poz-base.mjs`: the frame (origin at the Ratusz, 52.40856 N 16.93401 E; bearing 0, so x is east and z is south),
    `toWorld`, `llAffine`, `DETAIL_BOX` and the snapshot loader.
  - `poz-roads.mjs`: drivable ways split at shared nodes into `pieces`, plus plazas (with `holes`), pedestrian ways,
    rail lines, rail corridors, `roads`, tram stops and signal nodes.
  - `poz-water.mjs`: water polygons; `land` (the detail box minus water on a 2 m raster) with `landHoles`; `outskirts`
    with `outskirtsHoles`; `isLandAt`.
  - `poz-extra.mjs`: parks and the park-coverage pass, landmarks (with `ang`), districts and labels.
  - `poz-blocks.mjs`: curb islands on a 1 m raster over the detail box (6,126 × 3,674 cells). It ports
    `geo-blocks.mjs` and adds a bbox prefilter to the nearest-edge loop of `blockFrames`.
  - `poz-roadgraph.mjs`: `buildRoadGraph(pieces, signalNodes, { service })`, called by the build script.
- Output (1.26 MB): `roads` 246 KB, `roadGraph` 201 KB (3,903 links), `blocks` 412 KB (822), `parks` 193 KB, `rail` 69 KB,
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
- `tests/geodata.test.mjs` runs the NYC build and the Poznań build (the latter into a `'Poznań Zażółć 東京 '` temp dir, with an explicit output path, checking land, Warta, bridge links, signals, Ratusz, block count, version and `frame.ll`). The NYC test copies `tools/*.mjs` into a temporary directory whose path contains spaces and CJK characters, symlinks `tools/data` into it, runs the build with GEO_DATA unset and `--max-old-space-size=8192`, then imports the output. It guards path handling: resolve paths with `fileURLToPath(new URL(..., import.meta.url))`, never `URL.pathname`. New tool modules must be `.mjs` files directly in `tools/`, or the test will not copy them. Each test may take up to 180 s; together they take about 22 s.
- `tests/overpass.test.mjs` replaces `curl` and `sleep` with stubs on PATH and checks the keep-old-data-on-failure guarantees above, including that all 3 endpoints are tried and no temp files are left behind. If you change the retry or endpoint logic, update the expected call counts.
- Run both with `node --test tests/geodata.test.mjs tests/overpass.test.mjs`. Neither needs network access.
