# Real OSM street-tree positions (2026-11-08)

The optional backlog item “Real OSM street-tree positions” is in. The city now plants 38,588 individually surveyed
`natural=tree` nodes from OSM, and the procedural rows survive only where the avenue has no individual mapping.

## Data

- New snapshot `tools/data/poz_trees.json`, query `tools/data/q_poz_trees.overpassql`:
  `node["natural"="tree"]` in the padded detail box (52.380–52.437 N, 16.852–17.005 E), `out body`.
- The usual Overpass endpoints timed out from this checkout; the fetch came from
  `https://overpass.openstreetmap.fr/api/interpreter` (OSM base `2026-08-25T05:55:11Z`). The compact snapshot is 13.5 MB
  with 40,957 nodes; `tools/overpass.sh` is unchanged.
- `tools/poz-trees.mjs` keeps the 38,588 nodes inside `DETAIL_BOX`, projects them through the shared frame, drops 180
  nodes mapped twice within 0.5 m, and maps `Tilia`, `Acer`, `Aesculus` and `Robinia` to the four tree models. The other
  24,616 nodes have another or no taxon and take a deterministic model at runtime.
- `GEO.trees` is a flat `[x, z, species, height, ...]` array (0.1 m, species -1..3, height 0 when untagged).
  `city-config.js` exposes it as `OSM_TREES`.

| measure | count |
|---|---:|
| query nodes in the padded box | 40,957 |
| nodes inside the detail box | 38,588 |
| duplicate positions dropped (< 0.5 m) | 180 |
| with a model species (lime / maple / chestnut / robinia) | 13,972 (3,792 / 7,062 / 984 / 2,134) |
| other or untagged taxon | 24,616 |
| with an OSM height tag | 24,017 |

## Runtime integration

`js/street-details.js` plants the mapped nodes before the procedural rows:

- The surveyed `(x, z)` is never moved. The scale comes from the OSM `height` (`height / 13`, clamped to 0.55–1.3);
  untagged trees use the existing position hash. Species tags feed the four model indices; the existing 4% locust
  reassignment still applies.
- A mapped node replaces a procedural street or park site within 4 m. Unchanged procedural rows keep their 3.5 m
  spacing; a moved row also keeps 4 m from a mapped trunk.
- A mapped trunk within 6 m of its block edge gets the street treatment: a pit turned along the curb, a crown squeezed
  across the sidewalk and tier 1/2 draw distance. A courtyard or park node gets tier 0 and no pit.
- Every accepted mapped tree gets a trunk collider (0.28 × scale m half-width, top at base + 3.0 m). Park colliders that
  belonged to a replaced grid tree are removed with the site.
- Placement rejects a mapped node instead of moving it: no block, median, underpass, water, a building wall or doorway
  closer than 1.2 m, a car lane, a zebra landing, a track, or a crosswalk band. 32,526 of 38,588 pass in the
  block-collider fixture; 6,062 are dropped. The procedural rows keep their stricter crown-to-wall rule.
- Procedural clearance moved 1,272 rows and dropped 83 in the same fixture. The audit still reports
  **0 / 0 / 0 / 0** landing, zebra, lane and off-island violations; the closest existing pair is 0.331 m and moved rows
  keep at least 3.551 m.

## Counts and instance budget

- Default tree-test fixture (block colliders only): **88,583 trees**, 28,168 street trees, 32,526 mapped nodes.
- Full headless fixture (118 landmark + 39,711 building + 194 bridge colliders): **88,479 trees**, 28,114 street trees.
- Species at site creation in the test fixture: 31,917 lime, 39,089 maple, 15,588 chestnut, 1,989 robinia; after the
  locust hash, 30,583 / 37,466 / 14,946 / 5,588.
- At 88,479 sites the tree field allocates 3 LOD capacities per site (matrix 64 B + `aTreeData` 16 B), about **21 MB** of
  instance buffers. Meshes stay per 200 m cell / species / variant / level, so the draw-call ceiling is still 24 meshes
  per cell; only cells within `LOD_NEAR`/`LOD_MID`/draw distance are active. The allocated mesh count is 19,831 before
  and 23,324 after the species hash.
- No browser frame-time measurement was made in this pass. Street-level and drone frame rate, draw calls and a sample of
  pits against the OSM points are the outstanding browser check in `docs/backlog.md`.

## Tests

- `node --test tests/osm-trees.test.cjs` — snapshot layout, in-box coordinates, species/height ranges, duplicate filter.
- `node --test tests/tree-distribution.test.cjs` — full site/collider snapshots, species distribution, mapped-node
  acceptance and field transforms.
- `node --test tests/trees.test.cjs` — atlas tiles, paths and mipmaps.
- `node --test tests/street-tree-clearance.test.mjs` — audit oracle.
- `node --test tests/street-tree-colliders.test.cjs` — every street and mapped park tree has a trunk collider.
- `node --test tests/geodata.test.mjs tests/overpass.test.mjs` — a fresh offline build matches the committed
  `js/geodata.js` byte for byte, and the fetch script keeps its old data on every failure.
- `node --test tests/*.cjs` — full quick suite.

## Changed files

- `tools/data/q_poz_trees.overpassql`, `tools/data/poz_trees.json` (new).
- `tools/poz-trees.mjs` (new), `tools/build-poznan.mjs`, regenerated `js/geodata.js`.
- `js/city-config.js` (`OSM_TREES`), `js/street-details.js` (priority planting, dedupe, colliders).
- `tests/osm-trees.test.cjs` (new), `tests/tree-distribution.test.cjs`, `tests/street-tree-colliders.test.cjs` pins.
- `docs/world.md`, `docs/geodata.md`, `docs/backlog.md`.
