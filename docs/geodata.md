# Geodata pipeline (tools/ → js/nyc-geodata.js)

## Map
- `tools/build-geodata.mjs`: entry point. It assembles and writes the `GEO` object, and builds Broadway, the merged `roads` polylines, the Central Park features and the landmark footprints itself.
- `tools/geo-base.mjs`: the frame (`toWorld`), the geometry/raster helpers and the shorelines. Importing it runs the frame calibration and loads CSCL, so every other `geo-*.mjs` module depends on it.
- `geo-streets.mjs` (CSCL → `pieces`, `STREETS`, `AVENUES`), `geo-blocks.mjs` (curb islands rasterised at 1 m, lot rects, frontage frames, `CUT_Z`/`STRIP`/`SIDEWALK`), `geo-extra.mjs` (parks onto blocks, piers, East River bridges, NJ, islands, the Manhattan split), `geo-roadgraph.mjs` (`GEO.roadGraph`).
- The modules do their work at import time, as top-level side effects. Import order is the dependency order, and `node tools/geo-streets.mjs` on its own prints a street and avenue table for debugging.

## Regenerate
```
node --max-old-space-size=8192 tools/build-geodata.mjs            # writes js/nyc-geodata.js
node --max-old-space-size=8192 tools/build-geodata.mjs /tmp/x.js  # writes elsewhere (diff before replacing)
GEO_DATA=/some/dir node ... tools/build-geodata.mjs                # read inputs from another directory (default tools/data/)
```
- The run takes about 11 s. The 8 GB heap flag is what the header usage line and `tests/geodata.test.mjs` pass. A default 4 GB heap also worked on Node 26, but keep the flag, because the 1 m rasters and the EDTs are large.
- The output is deterministic. A rebuild from the committed `tools/data` reproduces the committed `js/nyc-geodata.js` byte for byte (verified). After any change to tools/, build to a temporary path and `cmp` it against the committed file: an unexpected diff means a behaviour change.
- `js/nyc-geodata.js` is GENERATED: its header says "do not edit by hand", and its single JSON line is about 1.1 MB. To change any geodata value, change the tools or the inputs and rebuild. Commit the regenerated file together with the tool change.
- Read the build's `[geodata]` log lines (counts, the derived bearing and origin, the per-key KB at the end). They are the quickest sanity check after a change.
- Inspect the output with `head -c 1500 js/nyc-geodata.js`, or `import('./js/nyc-geodata.js')` in node. Never read the whole file.

## World frame (the whole sim uses it)
- 1 unit = 1 m. y is up. **x = Manhattan-grid east, z = grid south (north = −z)**. Heading 0 faces +z (south).
- The origin is the CSCL centreline node shared by `5 AVE` and `E/W  42 ST`. The axes are turned by the grid bearing, about 29.02° east of true north. Both values are **re-derived from CSCL on every build**: the bearing is the length-weighted median of the long avenue segments, and the origin is that node. `GEO.frame.bearingDeg` records the bearing.
- The projection is an ellipsoidal local tangent plane at LAT0/LON0 = 40.75318, −73.98185 (`geo-base.mjs`). The 5th & 42nd node sits at (−54.35, 69.42) in that plane.
- **The frame is duplicated by hand** in `js/boroughs.js` `LL(lon, lat)`, an affine copy whose constants match `toWorld` to within 1 mm (verified). Many world coordinates are also hard-coded and depend on this frame:
  - `geo-extra.mjs`: the island seed points, the Ellis Island point (−1460, 7780), the Hudson River Park z range and the NJ cut.
  - `geo-blocks.mjs`: the Times and Herald Square z values.
  - `js/city-config.js`: `HOUSTON_Z` and the other district constants, and the teleports.
  - The street details, landmarks and other placements.

  If a CSCL refresh moves the logged bearing or origin, update `LL()` and recheck those constants. Otherwise boroughs, labels and placements drift away from the Manhattan geometry.
- Rings and polylines are flat `[x0, z0, x1, z1, ...]` arrays, rounded to 0.1 m. Rings are reversed to a negative shoelace area in (x, z), to match the winding the runtime has always used for `MANHATTAN_COASTLINE`.
- `CUT_Z = −7090` (about 129th St) splits the detailed island (`GEO.manhattan`, south of the cut) from low-detail Upper Manhattan (`GEO.upperManhattan`, built by boroughs.js). Streets, blocks, roads and the road graph exist only south of about `CUT_Z − 250`.

## Output shape and consumers
- `GEO` has these keys: `version, frame{bearingDeg, origin, units, cutZ, strip, sidewalk}, manhattan, upperManhattan, innerShore, islands, boroughs, streets, avenues, broadway, plazas, roads, roadGraph, blocks, parks, centralPark, piers, bridges, landmarks, points`. The positional tuple layouts of `roads`, `roadGraph.links` and `blocks` are documented in comments next to the `GEO` literal in `build-geodata.mjs`. Keep those comments in sync when you change a layout.
- `js/city-config.js` is the main consumer. It turns `GEO` into `{x, z}` objects and named exports (`BLOCKS`, `ALL_STREETS`, `ALL_AVENUES`, `ROADS`, `LANDMARK_SITES`, the polygons and so on). Prefer those exports in runtime code. A few modules read `GEO` directly:
  - `road-network.js`: `roadGraph`
  - `city-grid.js`: `plazas`, `centralPark`, `points`, `parks`
  - `buildings.js`: `plazas`
  - `nyc-map.js`: `frame`, `parks`, `centralPark`
- When you add, rename or re-layout a `GEO` key, update every consumer of it, plus the `GEO` stubs in `tests/nyc-map.test.cjs` if `nyc-map.js` reads it.
- `GEO.landmarks` is keyed by the exact OSM `name` tag. If a name has several outlines, the largest one wins. Each entry holds a grid-aligned bbox centre and size, the OSM `height` or null, and the outline ring. Runtime code looks entries up by name (`LANDMARK_SITES['Empire State Building']`), so an OSM rename silently drops the landmark: `fitToSite` returns early on a missing site.

## Data sources and licensing (tools/data/)
| file | source | notes |
|---|---|---|
| `dcp_boroughs.json` | NYC DCP Borough Boundaries, water areas excluded (NYC Open Data `gthc-hcne`) | GeoJSON FeatureCollection. Reads `properties.boroname` (`Manhattan`, `Brooklyn`, `Queens`, `Bronx`, `Staten Island`). |
| `cscl_manhattan.json` | NYC Street Centerline, CSCL (`inkn-q76z`), Manhattan only | Socrata JSON row array. Fields read: `the_geom, full_street_name, rw_type, trafdir, streetwidth` (ft), `number_travel_lanes, from_level_code, to_level_code`. |
| `nycparks_manhattan.json` | NYC Parks Properties (`enfh-gkve`), Manhattan | Row array. Reads `multipolygon, signname, name311, typecategory, acres`. |
| `osm_*.json` | OpenStreetMap via Overpass, © OpenStreetMap contributors, **ODbL** | Each file comes from the matching `q_*.overpassql` (coast→coastline, cp→centralpark, landmarks, piers). |

- The output header and README.md carry the attribution. Keep it whenever you add a source, and add the new source's licence there too.
- The `geo-base.mjs` header points at `tools/fetch-geodata.sh`, but **that script does not exist**. No script in the repo records the Socrata queries for the three NYC Open Data files. To refresh one, download the same dataset filtered to Manhattan with at least the fields listed above. The code relies on CSCL's raw formatting: names with double spaces (`'E  42 ST'`, `'W  END AVE'`, `'FDR DR  VIADUCT'`), the `rw_type` codes kept in `geo-streets.mjs` (1 street, 2 highway, …), level code `'13'` for at grade, and `trafdir` values `FT`, `TF` and `TW`.

## Refreshing an OSM source
```
tools/overpass.sh tools/data/osm_landmarks.json tools/data/q_landmarks.overpassql [tries=12]
```
- The script tries three Overpass endpoints per round and sleeps `i*4` s between attempts. It writes to an adjacent temp file and renames it over the output **only** when the response is HTTP 200, curl succeeded, the JSON parses, `elements` is an array and there is no `remark`. Overpass reports timeouts as a 200 response with a `remark`. Any failure leaves the old data untouched and exits 1.
- After a refresh, rebuild and review the diff of `js/nyc-geodata.js` and the build log counts (landmark footprints, piers, CP water/lawns).
- To add a landmark footprint, add its exact OSM name to the `name~"^(...)$"` regex in `q_landmarks.overpassql`. Add it to the `relation` clause too if OSM maps it as a multipolygon. Then refetch and rebuild. For the runtime side, see [`world.md`](world.md).
- To add a Central Park water body, lawn or site, add its name to `WATER_NAMES`, `LAWN_NAMES` or `SITE_NAMES` in `build-geodata.mjs`. `q_cp.overpassql` may also need a matching clause.

## Tests
- `tests/geodata.test.mjs` copies `tools/*.mjs` into a temporary directory whose path contains spaces and CJK characters, symlinks `tools/data` into it, runs the build with GEO_DATA unset and `--max-old-space-size=8192`, then imports the output. It guards path handling: resolve paths with `fileURLToPath(new URL(..., import.meta.url))`, never `URL.pathname`. New tool modules must be `.mjs` files directly in `tools/`, or the test will not copy them. The test takes up to 180 s.
- `tests/overpass.test.mjs` replaces `curl` and `sleep` with stubs on PATH and checks the keep-old-data-on-failure guarantees above, including that all 3 endpoints are tried and no temp files are left behind. If you change the retry or endpoint logic, update the expected call counts.
- Run both with `node --test tests/geodata.test.mjs tests/overpass.test.mjs`. Neither needs network access.
