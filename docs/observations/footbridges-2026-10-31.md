# Footbridges and Katedra camera — 2026-10-31

Implementation of pedestrian and bicycle river crossings across the Warta and Cybina rivers:
Most Biskupa Jordana, Kładka Bramy Poznania, and Mosty Berdychowskie, along with verifying
the `katedra` scenic camera view looking towards Ostrów Tumski.

## Motivation and cause

The initial simulation snapshot imported drivable ways (`highway in DRIVABLE`) from OpenStreetMap into the road graph.
Pedestrian river crossings were excluded from `roadGraph`, causing:
1. Missing bridges in 3D geometry over the Cybina and Warta rivers.
2. The `katedra` scenic camera preset (`eye: 1148, 8, -336`), named *"Ostrów Tumski from Most Jordana"*, hovered
   directly over open water (`isLand = false`, `isWater = true`, Cybina water level -3 m) with no structure beneath.
3. Pedestrian and bicycle navigation across the Cybina between Śródka and Ostrów Tumski, and across the Warta
   between Chwaliszewo, Zagórze and Berdychowo, was blocked by the player controller's land/water clamp (`clampToLand`).

## Implementation

1. **City Configuration (`js/city-config.js`):**
   - Added `FOOTBRIDGES` defining the three surveyed pedestrian river crossings:
     * **Most Biskupa Jordana**: span from `(1116.1, -340.9)` to `(1179.4, -330.6)`, width 14.0 m. Center at `(1147.8, -335.8)`.
     * **Kładka Bramy Poznania**: gallery from `(1117.0, -429.2)` to `(1179.5, -424.5)`, width 4.3 m.
     * **Mosty Berdychowskie**: 3 chained spans `(756.9, 330.0)` -> `(922.2, 323.6)` -> `(959.3, 322.5)` -> `(1048.7, 398.2)`, width 6.0 m.
   - Merged `FOOTBRIDGES` into `BRIDGES` with `footbridge: true`.
   - The land raster (`LAND_CODE = 2`) now automatically rasterizes these corridors, setting `isLand(x, z) = true`,
     `isWater(x, z) = false` and pinning `LAND_DIST = 255`.
   - Crucially, `GEO.roadGraph` is NOT modified: vehicular traffic cannot enter pedestrian bridges, preserving
     all traffic flow benchmarks and lane regressions.

2. **Bridge 3D Models and Colliders (`js/bridges.js`):**
   - **Most Biskupa Jordana**: tied steel arch bridge with deep red arches (`mats.redArch` `[0.62, 0.16, 0.16]`).
     Full 14 m wide pedestrian paving (`mats.sidewalk`) without asphalt roadway or center curbs. Edge balustrades and colliders.
   - **Kładka Bramy Poznania**: covered footbridge (`buildCoveredFootbridge`) connecting ICHOT to Śluza Katedralna.
     Steel box girders, concrete roof slab, continuous glass side walls (`mats.glass`), internal lamps and protective colliders.
   - **Mosty Berdychowskie**: haunched box girders (`girder`) on river wall piers with continuous pedestrian deck.
   - Parapet colliders (`addBridgeCollider`) along both edges of each footbridge ensure players cannot fall into the river.

3. **Scenic Camera View:**
   - The `katedra` preset at `eye: (1148, 8, -336)` now stands on Most Jordana (`isLand = true`).
   - The camera looks westward at Archikatedra `(1000.6, 34, -336.7)` over the Cybina, with an unobstructed line of sight.

## Measurements

| Measurement | Before | After |
|---|---:|---:|
| `isLand(1148, -336)` (under `katedra` camera) | `false` | `true` |
| `isWater(1148, -336)` | `true` | `false` |
| Total bridge structures | 30 | 34 |
| Bridge colliders | 163 | 201 |
| Road network edges | 8,756 | 8,756 |
| Road network lanes | 11,650 | 11,650 |

## Validation

- `node --test tests/footbridges.test.cjs`: passes 5/5.
- `node --test tests/*.cjs`: passes 292/292.
- `node --test tests/`: passes full regression suite.
