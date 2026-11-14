# Street-tree clearance and OSM audit, 2026-11-14

Headless audit and pole-overlap fix for street-tree placement in `js/street-details.js`.

## 1. Clearance audit (`default` and `--full`)

| Measure | Default (`street-tree-clearance`) | `--full` (with landmarks & bridges) |
|---|---:|---:|
| `landing` / `zebra` / `lane` / `island` | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `streetTrees` / `totalTrees` | 34,468 / 119,366 | 34,400 / 119,245 |
| `placement.moved` / `placement.dropped` | 1,701 / 91 | 1,698 / 92 |
| `minLane` (full shifted runs) | 1.2009 m | 1.2009 m |
| `minTreeDistance` / `minMovedTreeDistance` | 0.3253 m / 3.5513 m | 0.3253 m / 3.5513 m |
| `extraCounts.rail` / `wall` / `water` / `plazaProc` | 0 / 0 / 0 / 0 | 0 / 0 / 0 / 0 |
| `extraCounts.poleProc` / `tramPlatform` / `tramShelter` | 0 / 0 / 0 | 0 / 0 / 0 |
| `extraCounts.poleOverlap` / `tramPoleOverlap` | **0 / 0** | **0 / 0** |

### Pole-overlap fix (`js/street-details.js`, `js/main.js`)

- **Root cause**:
  1. `tram-infra.js` `layoutTramInfrastructure` ran after `buildStreetDetails` in `js/main.js`, so `street-details.js` had no tram traction poles (`poleR = 0.16 m`, `js/tram-infra.js:773`) when placing trees: **50** street trees (`48` procedural, `2` OSM) stood within `0.28 * scale + 0.16 + 0.15 m` of a tram pole.
  2. Surveyed OSM trees in `js/street-details.js` skipped `isClearOfPoles`, leaving **46** OSM street trees (plus **1** OSM park tree) within `0.28 * scale + poleR + 0.15 m` of street-details poles (`signal: 0.08`, `signalMast: 0.10`, `lantern: 0.14`, `lamp: 0.18`, `hydrant: 0.14`, `postbox/parking: 0.20`, `bollard: 0.07`, `column/kiosk/flower: hypot(halfW, halfD)`).
- **Fix**:
  - `main.js` passes `layoutTramInfrastructure` into `buildStreetDetails`, which builds `tramLayout` once on `treeNetwork` and returns it so `main.js` reuses `streetDetails.tramLayout` without rebuilding.
  - `addPole` records each pole's collider radius `r`. `clearStreetTree` enforces `clearOfTramPoles(x, z, scale)` (`0.28 * scale + 0.16 + 0.15 m`), so overlapping procedural street trees relocate along the curb in 0.4 m steps up to ±6 m. OSM trees enforce `clearOfOsmPoleOverlap(x, z, scale)` against both `poleCells` and `tramPoleCells` (`0.28 * scale + poleR + 0.15 m`).
- **Before/after tree-site record diff** (`street-tree-clearance` fixture, RNG stream unchanged):
  - `before`: `119,408` total (`34,509` street), street-tree hash `db601141…`
  - `after`: `119,366` total (`34,468` street), street-tree hash `72e67ec8…`
  - **34,419 / 34,509** street trees are bit-for-bit identical; **42** overlapping OSM street trees (+ **1** OSM park tree) dropped, **48** procedural street trees moved `0.4–0.8 m` along their curb (`0` procedural drops), and **1** procedural gap filler planted where a dropped OSM tree had suppressed it.
- **Boot timing (3 interleaved runs, `city-config` + `geodata` + `city-grid` + `buildings` + `street-details` + `layoutTramInfrastructure`)**:
  - Main checkout: `12,591.8 ms`, `12,687.8 ms`, `11,982.4 ms` (**median `12,591.8 ms`**)
  - Worktree: `12,390.9 ms`, `12,154.4 ms`, `12,141.4 ms` (**median `12,154.4 ms`** — no slowdown)

## 2. OSM comparison (`--osm`, before final pole drops; rerun for exact updated counts)

Geodata source: `js/geodata.js` `GEO.trees` (exposed as `OSM_TREES` in `js/city-config.js`), built from `tools/data/poz_trees.json` via `tools/poz-trees.mjs`.

- **Stare Miasto (`x ∈ [-500, 500], z ∈ [-500, 500]`)**: `1,179` OSM points, `232` OSM street trees matched `<= 0.5 m`, `0` moved OSM trees.
- **Around Park Cytadela (`x ∈ [-800, 900], z ∈ [-2100, -800]`)**: `4,026` OSM points, `186` (`--full`: `185`) OSM street trees matched `<= 0.5 m`, `0` moved OSM trees.

## 3. Camera positions for visual verification

1. Moved procedural tree (`0.8 m` clear of tram pole at `-3053.13, -214.18 -> -3053.31, -213.40`): eye `(-3047.0, 2.2, -208.0)`, look `(-3053.3, 1.5, -213.4)`
2. Moved procedural tree (`0.4 m` clear of tram pole at `-1125.13, -960.19 -> -1124.85, -959.90`): eye `(-1119.0, 2.2, -954.0)`, look `(-1124.9, 1.5, -959.9)`
3. Dropped OSM tree that overlapped a tram pole (`(18.2, 404.9)`, `0.161 m` from pole): eye `(24.0, 2.2, 411.0)`, look `(18.2, 1.5, 404.9)`

## Rerun commands

```sh
node tools/audit-street-tree-clearance.mjs
node tools/audit-street-tree-clearance.mjs --full
node tools/audit-street-tree-clearance.mjs --osm
node tools/audit-street-tree-clearance.mjs --full --osm
```
