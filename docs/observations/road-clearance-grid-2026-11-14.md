# `GUIDE_GRID` / `roadClearance` cell-boundary range — 2026-11-14

Investigation and fix for the latent cell-boundary blind spot in `js/city-config.js` (`GUIDE_GRID`, 32 m cells): segments were registered within `half + 4 m` while `roadClearance(x, z)` scanned only the query's own cell, so callers comparing against `YARD_ROAD_KEEP = 4.6 m` could miss a roadway 4.0–4.6 m away across a cell boundary.

## Callers of `roadClearance` and `pedestrianClearance`

All callers in `js/` (checked across the whole codebase):

| Caller | Location | Threshold | Exceeds 4 m? |
| --- | --- | --- | --- |
| `trimOffStreets` | `js/buildings.js:837` | `>= 0` m | No |
| `objectReserveBoxes` (Kupiec) | `js/buildings.js:2914` | `< YARD_ROAD_KEEP` (`4.6` m) | **Yes** |
| `yardFitsBlock` | `js/buildings.js:2978` | `>= YARD_ROAD_KEEP` (`4.6` m) | **Yes** |
| `clipYard` | `js/buildings.js:3020` | `>= YARD_ROAD_KEEP` (`4.6` m) | **Yes** |
| `fallbackPartClear` | `js/buildings.js:3065` | `< 0` m | No |
| `populateObject` (`clear`) | `js/buildings.js:4181,4190,4193,4198,4200` | `< 2.5` m (`OBJECT_CURB_CLEAR`) / `< 0.5` m | No |
| `clearOfRoads` | `js/street-details.js:538,597,1112,1167,1316` | `>= r + 0.3` m (`0.55–0.8` m; max `w = 0.4` m) | No |
| OSM promenade trees | `js/street-details.js:1810` | `< 0.5 + 0.28 * scale` (max `0.85` m) | No |
| Signal pole `failures` | `js/street-details.js:2318` | `< 0.8` m | No |
| Traction span target | `js/street-details.js:2547` | `> -1` m | No |
| `roadDist` (`RAIL_ROAD_KEEP`) | `js/tram-infra.js:853,909` | `< 3.5` m (`RAIL_ROAD_KEEP`) | No |

All `pedestrianClearance` callers (`js/buildings.js:837,2978,3020,3065`) compare against `0` m or `0.5` m (`<= 4` m).

## Measured impact before the fix

Re-evaluating every `roadClearance` (3,325,045 calls) and `pedestrianClearance` (2,870,768 calls) query during a headless world build (`landmarks`, `buildings`, `city-grid`, `street-details`, `tram-infra`) against an exact-up-to-20 m (`half + 20 m`) index:

- **`roadClearance`:** 600,934 calls differed at all (mostly `Infinity` vs `> 5` m); **20** calls differed with `min(orig, exact) < 5.0 m`:
  - `fallbackPartClear` (`js/buildings.js:3065`, threshold `0` m): 8 calls (`exact` 4.5198–4.6363 m vs `Infinity`, e.g. `(3263.83, -484.19)`), **0** decision flips.
  - `trimOffStreets` (`js/buildings.js:837`, threshold `0` m): 7 calls (`exact` 4.7455–4.9543 m), **0** decision flips.
  - Signal pole `failures` (`js/street-details.js:2318`, threshold `0.8` m): 5 calls (`exact` 4.3154–4.7163 m, e.g. `(-2080.06, 2378.69)`), **0** decision flips.
  - `objectReserveBoxes`, `yardFitsBlock`, `clipYard` (threshold `4.6` m): **0** calls differed with `min < 5.0 m`, **0** decision flips.
- **`pedestrianClearance`:** 40,884 calls differed at all, **0** calls with `min(orig, exact) < 5.0 m`, **0** decision flips.

## Fix and boot-cost comparison

Measured `city-config` + `buildCityBlocks` in `.agent-task/bench-grid-options.mjs`:

- Baseline (`half + 4 m`, 1-cell lookup): `cfgMs = 5614 ms`, `bldMs = 8344 ms`, `total = 13958 ms`
- **Option A (`half + 6 m`, 1-cell lookup):** `cfgMs = 5549 ms`, `bldMs = 8676 ms`, `total = 14225 ms` (+1.9%)
- Option B (`half + 4 m`, 3×3-cell lookup): `cfgMs = 5516 ms`, `bldMs = 35670 ms`, `total = 41186 ms` (4.3× slower `buildCityBlocks`)

Chose **Option A** (`s[4] + 6` m in `GUIDE_GRID` in `js/city-config.js`), which covers `YARD_ROAD_KEEP = 4.6 m` with 1.4 m margin while keeping `roadClearance` a single-cell lookup. Updated comments on `GUIDE_GRID`, `roadClearance` (exact up to 6 m), and `pedestrianClearance` (exact up to 4 m).

## World diff and interleaved timings

Audits (`node tools/audit-courtyards.mjs`, `node tools/audit-building-rails.mjs`, `node tools/audit-prop-rails.mjs`) and direct record hashes (`main` checkout vs worktree) are **bit-for-bit identical** before and after:

- Courtyard slabs: `19580` (`hash 638db0a6b06a`), `0` violations
- Building footprints: `51746` (`48619` in `footprintsByBlock`), `51753` colliders (`hash 767d149cb6cb`), `0` rail violations
- Static objects (`audit-prop-rails.mjs`): `271349`
- Grid prop colliders: `63258` (`hash fa95a206111e`); `parkTreeSites`: `61549` (`hash 15e2212a39bd`)
- Street colliders: `95748` (`hash a24c1f062a5c`), street footprints: `35554` (`hash ae05276b1091`)
- Tram poles: `4491` (`hash 2c9a832564dd`), tram stops: `232` (`hash 66f2458da5e8`), rail masts: `1650` (`hash 00bb1ee19e73`)

Three interleaved full headless world builds (`main` vs `worktree`, separate Node processes):
- `main`: `40859.1`, `43520.7`, `42935.7` ms — median **`42935.7 ms`**
- `worktree`: `43489.3`, `43804.0`, `44146.4` ms — median **`43804.0 ms`** (+2.0%, within noise)

## Rerun

```sh
node --test tests/road-clearance-grid.test.cjs
node --test tests/
node tools/audit-courtyards.mjs
```
