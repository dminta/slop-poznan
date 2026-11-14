# Building footprint rail clearance audit — 2026-11-14

Headless exact-geometry audit of every building footprint built by `js/buildings.js` (`allBlocks[i].footprints`) against `GEO.rail` (`< 0.5 m` keep-out).

## Method

`tools/audit-building-rails.mjs` loads `js/city-config.js`, `js/city-grid.js` and `js/buildings.js` via `loadModule` with inert Three.js/TSL/roof/balcony stubs, runs `buildCityGrid` and `buildCityBlocks`, and measures the exact polygon-to-segment distance from every emitted building footprint (`f.pts || rect`) to every `GEO.rail` segment indexed in a 32 m grid (`10 m` pad).

**Command to rerun:**

```sh
node tools/audit-building-rails.mjs
```

Supports `--json`, `--top N` (default `20`), `--near x,z,r` and `--block ID`.

## Findings before

- **Footprints audited:** **51,755**
- **Violations (`< 0.5 m`):** **16** across **3** blocks (all at `0 m`, track passing through the footprint):
  - **Block 1257 (Zajezdnia Głogowska, Łazarz):** **12** footprints (`999.3 m²` ground area on `8,184.5 m²` block, **12.21 %** built share). The block has only `blockAnchors` and `blockStats` (`blockObjects = 0`, `blockFootprints = 0`), so the generic lot layout built kamienice/oficyny (`11.1–22.2 m` tall) directly over the depot tracks.
  - **Block 849 (ZNTK / Wilda):** **3** footprints (`Wilda_-1576_775` `19.52 × 39.04 m`, `Wilda_-1576_844` `20.13 × 40.26 m`, `Wilda_-1709_756` `33.12 × 16.56 m`). Generated low `ancillaryBlock` pavilions (`3.7–7.6 m` tall) placed on lot rects crossed by ZNTK rail sidings (`rail 35, 158, 182, 185, 330, 331, 376`).
  - **Block 326 (Warszawskie-Pomet-Maltańskie):** **1** footprint (`Warszawskie-Pomet-Maltańskie_4205_-418` at `(4205.4, -417.6)`, `113.33 × 81.86 m`, `ry = 0.0563`, `h = 8.2 m`). Mapped `GEO.blockObjects[326][0]` (`9,277 m²`, `use = 10`, `levels = 2`), whose northern edge (`z ≈ -458.5`) overlapped the stub ends of three industrial rail sidings (`rail 25, 101, 105` terminating at `z = -455.7, -456.8, -455.0`).

## Fix

Added `partRailClear(x0, x1, z0, z1)` in `js/buildings.js` (transforming the lot-frame rectangle into world space via `toWorld` and `xf.th` and calling `railRectClear(..., 0.5)` from `js/city-grid.js`), and wired rail clearance into all building emission paths:
1. `commitBuilding`: skips any building whose part fails `partRailClear` (`blk.voidLots.push(b.lot); return;`, matching `hitsBridgeCorridor`). Covers generic lot rows, corner houses, oficyny, inner lots, courtyard cores, estates, villas, halls and anchors.
2. `fallbackPartClear`: checks `partRailClear` before `populateBlock` runs on `GEO.blockFallbackLots`.
3. `populateObject`: checks `railRectClear(cx, cz, hw, hd, th, 0.5)` inside `clear(hw, hd, margin)` so mapped `GEO.blockObjects` are symmetrically trimmed by `inset` (`0.5 m` steps) to clear tracks instead of being dropped whole.

## Results after

- **Footprints audited:** **51,746** (`-9` net)
- **Violations (`< 0.5 m`):** **0** (closest remaining footprint city-wide: `0.7206 m` in block `326`)
- **Courtyard slabs (`node tools/audit-courtyards.mjs`):** **19,580** slabs, **0** violations.
- **Changed blocks (3 of all blocks city-wide):**
  - **Block 1257:** `12 → 0` footprints (`-12` removed; built share `12.21 % → 0.00 %`).
  - **Block 849:** `121 → 123` footprints (`3` rail-overlapping pavilions removed; unspent `srcPieceBudget` built `5` clear footprints in later lots, net `+2`).
  - **Block 326:** `537 → 538` footprints (mapped object `GEO.blockObjects[326][0]` trimmed symmetrically from `113.33 × 81.86 m` to `105.33 × 73.86 m` to clear the three siding ends; unspent `srcBuiltArea` budget added `1` generic footprint in a clear lot, net `+1`).

## Headless boot cost

Three interleaved runs of `city-config` + `buildCityGrid` + `buildCityBlocks` (`main` checkout at `a4a44fc` vs this worktree):

- **Main median:** `config 3,718.3 ms`, `grid 3,787.9 ms`, `buildings 6,306.0 ms`, **total `13,813.0 ms`** (runs: `13,813.0`, `13,571.5`, `14,040.7 ms`).
- **Worktree median:** `config 3,682.7 ms`, `grid 3,775.7 ms`, `buildings 5,629.3 ms`, **total `13,061.1 ms`** (runs: `13,036.4`, `13,061.1`, `13,226.4 ms`).
- **Delta:** no slowdown (`-751.9 ms` median, `-5.4 %`).

## Verification

- `node --test tests/boot-indexes-3.test.cjs` adds `partRailClear` unit coverage (world-frame transform and stub fallback).
- `tests/tree-distribution.test.cjs` updates `siteHash` and `details.colliders` digest for the removed/trimmed walls in blocks `326`, `849` and `1257` (site counts, species counts and `grid.propColliders` unchanged).
- Full `node --test tests/` passes.
