# Park lamps and park-block trees audit, 2026-11-14

Headless audit of `parkLampSites` (`js/city-grid.js`) and trees in park blocks with buildings, Avenida, Park Nad Wartą, and Antoninek (`tools/audit-park-lamps-trees.mjs`).

## 1. Method

`tools/audit-park-lamps-trees.mjs` reuses the headless full-world builder `runAudit({ worldOnly: true })` from `tools/audit-tree-clearance.mjs` (landmarks, city blocks, city grid, bridges, street details, road network) and captures each park block's walk slabs (`slabPieces`), granite beds (`beds`), lawns (`lawns`), pond path holes (`bedHoles`), ponds (`ponds`), and placed lamps (`addLamp`).

- **Lamp walk classification**:
  - **On walk**: inside `slabPieces` / `b.poly` and outside `beds` (or inside a `bedHole` 2 m pond path).
  - **On walk edge (`≤ 0.6 m` outside)**: inside `beds` within `0.6 m` of a `beds` / `bedHoles` boundary.
  - **On lawn (`> 0.6 m` outside)**: inside `beds` farther than `0.6 m` from the walk edge.
- **Lamp clearance checks**: tree trunks (`0.2 + 0.28 * scale`), tree crowns (`SPECIES_CROWN_R[species] * scale` from `js/city-config.js` / `js/trees.js`), benches and other `propColliders` / `details.colliders`, `buildingColliders` + `footprintsByBlock`, `isWater`/`distToWater`/`ponds`, road carriageways (`roadNet.edges`), and `railClearance`.
- **Lamp-vs-lamp spacing**: pairwise distance across all `parkLampSites` (plazas + parks + Teatr Polski) against `MIN_LAMP_SPACING = 6.0 m`.
- **Tree checks**: `SPECIES_CROWN_R` (`[4.53, 4.74, 6.07, 4.55]`) scaled by `t.scale` against `buildingColliders` and `footprintsByBlock`, plus walk/path containment against `beds` / `bedHoles` (full park blocks) and `partParkLawns` (partial-park blocks).

## 2. Park lamps (`parkLampSites`)

Total `parkLampSites`: **3,519 → 3,438** (**2,823** in Section 6 park blocks; **615** in plazas and Teatr Polski after dropping **81** duplicate lamps `< 6 m` apart).

| Metric (Section 6 park-block lamps) | Before (`2,846`) | After (`2,823`) |
|---|---:|---:|
| On walk | 2,721 | 2,701 |
| On walk edge (`≤ 0.6 m`) | 0 | 0 |
| On lawn (`> 0.6 m`) | 125 | 122 |
| Tree trunk overlap (`< 0.2 + 0.28 * scale`) | **3** | **0** |
| Within tree crown (`< R_crown * scale`) | 242 | 227 |
| Bench / prop overlap | 0 | 0 |
| Building overlap | 0 | 0 |
| Water / pond overlap | 0 | 0 |
| Road carriageway (`< 0.2 m`) | 0 | 0 |
| Rail clearance (`< 2.0 m`) | 0 | 0 |
| All `parkLampSites` pairs `< 6 m` (`< 3 m` / `< 1 m`) | **84** (`45` / `19`) | **0** (`0` / `0`) |

On-lawn distance distribution (122 lamps across 15 blocks): `(0.6, 1.0]`: **4**, `(1.0, 1.5]`: **117**, `(1.5, 2.0]`: **1**, `> 2.0`: **0**.

### Why duplicate/close lamps occurred

Neither `addLamp(x, y, z)` nor the plaza/park lamp loops (`js/city-grid.js:1746-1793`, `1961-2004`) checked distance to already-placed lamps:
1. **Adjacent/overlapping plaza polygons and thin corners** (`city-grid.js:1746-1793`): each plaza ring in `GEO.plazas` places a 30 m loop along `offsetPolygonInward(pl.ring, 2.0)`, so abutting or overlapping plazas lay parallel lamp rows within `0–5 m` (e.g. runs around `x = 4150–4410` and `5200–5270`, and `(-433.2, 719.3)` at `0.66 m`), while narrow/acute corners or inward shifts place two edges `< 1 m` apart (closest `0.005 m` at `(-1165.36, 99.28)` / `(-1165.37, 99.28)`).
2. **Converging park edges stepping onto the same lawn spot** (`city-grid.js:1961-2004`): at block 212 (`(-959.18, -1893.81)` / `(-958.42, -1893.58)`, `0.794 m` apart), two converging edges of `lampLine` both stepped inward via `onLawn` onto the same spot.
3. **Minimum spacing (`MIN_LAMP_SPACING = 6.0 m`)**: `6.0 m` is 20% of the `30 m` plaza spacing, smaller than a normal 90° plaza corner (`Math.hypot(6, 5) = 7.81 m`), normal 90° park corner (`Math.hypot(17, 8) = 18.79 m`), and `TEATR_POLSKI_SITE.lamps` minimum spacing (`9.937 m`). Baseline pairs `< 6 m`: `[0, 1) m`: **19**, `[1, 2) m`: **13**, `[2, 3) m`: **13**, `[3, 4) m`: **7**, `[4, 5) m`: **19**, `[5, 6) m`: **13** (`71` `< 5 m`, `45` `< 3 m`, `19` `< 1 m`).

### Why lamps go onto lawns in narrow-walk parks

In `js/city-grid.js:1940-1982`:
1. `lampLine = offsetPolygonInward(b.poly, 1.05)` places candidate lamps `1.05 m` inward from the outer curb `b.poly`.
2. In narrow-walk parks, `parkBedInset(b, roadCuts)` (`js/city-grid.js:240-258`) sets the bed inset to `0.1–1.0 m` (e.g. `0.8 m` for `roadCuts` blocks such as **block 212** near `(-953, -1928)` and **block 529**, `0.8 m` for **Park Stanisława Moniuszki** block 421, `1.0 m` for **Skwer Sybiraków** block 303 on Za Cytadelą).
3. Because `1.05 m ≥ parkBedInset`, the candidate falls inside `beds` (`beds.some((p) => polygonIn(p, px, pz))`). There is no walk-edge spot wide enough for a `0.4 m` lamp base plus curb clearance.
4. `city-grid.js:1976-1981` steps the lamp inward up to `2.5 m` until `onLawn(qx, qz)` (`js/city-grid.js:1951-1954`) succeeds, which requires `ringDist(p, x, z, 0.7) >= 0.7` on `lawns` and `ringDist(p, x, z, 1) >= 1` on `beds` (`0.3 m` coping + `0.7 m` lawn margin). Hence 120 of the 125 lawn lamps sit `1.0–1.5 m` inside the walk edge.

Za Cytadelą park blocks (`205, 212, 243, 251, 270, 303`, **232** lamps):
- Block 212 (`(unnamed)`): 14 / 14 `onLawn` (`1.000–1.250 m`; duplicate `(-958.42, -1893.58)` dropped)
- Block 303 (`Skwer Sybiraków`): 22 / 22 `onLawn` (`1.050 m`)
- Blocks 205 (35), 243 (13), 251 (145), 270 (3): 196 / 196 `onWalk` (`0` `onLawn`)

Worst 15 park lamps by distance outside walk (intentional narrow-walk placement):
1. `block 529` `(unnamed)` at `(145.29, -300.99)`: `1.588 m`
2. `block 147` `(unnamed)` at `(-2284.45, -2277.35)`: `1.270 m`
3. `block 340` `(unnamed)` at `(-829.55, -1099.50)`: `1.258 m`
4. `block 421` (`Park Stanisława Moniuszki`) at `(-1094.88, -612.03)`: `1.250 m`
5. `block 421` (`Park Stanisława Moniuszki`) at `(-1077.66, -634.57)`: `1.250 m`
6. `block 421` (`Park Stanisława Moniuszki`) at `(-1019.36, -530.54)`: `1.250 m`
7. `block 421` (`Park Stanisława Moniuszki`) at `(-1021.48, -424.63)`: `1.250 m`
8. `block 212` `(unnamed)` at `(-817.47, -1447.86)`: `1.250 m`
9. `block 212` `(unnamed)` at `(-805.54, -1247.26)`: `1.250 m`
10. `block 212` `(unnamed)` at `(-773.31, -1419.14)`: `1.250 m`
11. `block 421` (`Park Stanisława Moniuszki`) at `(-1010.11, -497.82)`: `1.250 m`
12. `block 421` (`Park Stanisława Moniuszki`) at `(-1028.62, -563.26)`: `1.250 m`
13. `block 421` (`Park Stanisława Moniuszki`) at `(-1050.89, -441.69)`: `1.250 m`
14. `block 421` (`Park Stanisława Moniuszki`) at `(-1149.09, -495.79)`: `1.250 m`
15. `block 421` (`Park Stanisława Moniuszki`) at `(-1114.91, -584.56)`: `1.250 m`

## 3. Trees in park blocks with buildings & Avenida

- **Avenida** (`LANDMARK_SITES.Avenida`): 29 trees within 30 m of colliders; **0** trunks inside, **0** crowns in walls.
- **Antoninek block 876** (was block 874 before the west expansion): 406 procedural park trees (0 OSM); **0** trunks inside, **0** crowns in walls, **0** on walks.
- **Park Nad Wartą (block 970)**: 1,728 trees after fix (1,098 procedural, 630 OSM); **0** trunks inside, **28** OSM crowns overhanging walls (0 procedural), **20** OSM trees on walks (procedural on walks: **1 → 0**).
- **All 44 full park blocks with buildings** (`isParkBlock(b) && b.buildings > 0`): 37,716 trees after fix (28,451 procedural, 9,265 OSM); **0** trunks inside, **116** OSM crowns overhanging walls (0 procedural; `street-details.js:1680` intentionally allows surveyed OSM trees with a 1.2 m wall floor so crowns may overhang facades), **709** OSM trees on walks (procedural on walks: **8 → 0**; across all full park blocks: **29 → 0**).

## 4. Fixes applied and record-hash diff

1. **Park-lamp / OSM-tree trunk overlaps (`js/city-grid.js`, `js/street-details.js`)**:
   - `city-grid.js` now populates `parkLampSites` directly from `addLamp(x, y, z)` instead of reading `m.elements[12..14]` (which was `(0, 0)` under inert headless stubs).
   - `street-details.js` indexes `parkLampSites` in `parkLampCells` and checks them in `clearOfOsmPoleOverlap(x, z, scale)` (`0.28 * scale + 0.20 + 0.15 m`), dropping the **3** overlapping OSM trees (`(-401.8, -2828.4)` in block 20, `(-265.7, -1682.4)` in block 243, `(-3118.2, 1699.2)` in block 1024) plus **3** within the 0.15 m margin (`(-367.7, -2828.1)`, `(-1150.5, 286.4)`, `(45.8, -1810.1)`).
2. **Procedural park trees on walks / pond paths (`js/city-grid.js`)**:
   - `city-grid.js:1925` now tests `lawns.some((p) => polygonIn(p, tx, tz))` (or `beds` if `lawns` is empty) unconditionally and excludes `bedHoles.some((h) => polygonIn(h, tx, tz))`, removing **32** procedural park trees that stood on 2 m pond paths or walk gaps (29 in full park blocks).
3. **Duplicate / close park & plaza lamps (`js/city-grid.js`)**:
   - `addLamp(x, y, z)` enforces `MIN_LAMP_SPACING = 6.0 m` via a 6 m spatial hash (`clearOfLamps(x, z)`), dropping **81** duplicate lamps (58 plaza `y=0.24`, 23 park `y=0.26`/`0.41`, 0 Teatr Polski):
     - Plazas (`y=0.24`, 58): `(-1325.51, 1962.46)`, `(-549.17, 420.30)`, `(-577.83, 411.44)`, `(-605.78, 403.47)`, `(3493.19, -62.29)`, `(-45.75, 108.71)`, `(-50.83, 138.28)`, `(-56.23, 167.69)`, `(-61.88, 197.15)`, `(-67.59, 227.01)`, `(-73.06, 256.51)`, `(-1154.49, 2607.50)`, `(940.27, 325.41)`, `(-1178.26, 79.13)`, `(-1165.37, 99.28)`, `(-206.16, -150.83)`, `(-176.99, -165.15)`, `(-167.74, -193.69)`, `(-158.49, -222.23)`, `(-1179.75, 151.51)`, `(-1154.26, 205.71)`, `(-363.58, 750.35)`, `(-644.64, 526.76)`, `(-506.87, 794.25)`, `(-433.77, 719.51)`, `(-1785.71, 218.67)`, `(2758.75, 2429.26)`, `(4201.66, -1502.79)`, `(4153.89, -1347.28)`, `(4174.29, -1369.27)`, `(4192.48, -1315.04)`, `(4213.05, -1267.26)`, `(4222.16, -1253.02)`, `(4237.58, -1227.28)`, `(4255.07, -1207.85)`, `(4270.54, -1195.02)`, `(4283.75, -1184.89)`, `(4304.70, -1173.16)`, `(4321.89, -1165.76)`, `(4337.25, -1160.14)`, `(4354.72, -1154.57)`, `(4373.79, -1149.29)`, `(4396.26, -1144.12)`, `(4409.98, -912.63)`, `(4459.20, -838.34)`, `(4733.27, -358.54)`, `(5295.99, -439.32)`, `(5254.32, -508.16)`, `(5267.57, -681.45)`, `(5238.32, -674.78)`, `(5209.07, -668.12)`, `(5222.30, -771.76)`, `(5193.94, -761.97)`, `(4070.17, -1815.10)`, `(-7197.50, 2207.18)`, `(-7175.99, 2195.30)`, `(-7257.38, 2172.89)`, `(-8517.54, -3018.33)`.
     - Parks (`y=0.26`/`0.41`, 23): `(-958.42, -1893.58)`, `(4339.13, -1710.34)`, `(4418.38, -1615.59)`, `(4092.86, -1765.42)`, `(4211.04, -1515.92)`, `(4425.38, -1601.86)`, `(4373.29, -1664.07)`, `(4337.78, -1704.87)`, `(4317.62, -1726.40)`, `(4172.90, -1813.45)`, `(4354.55, -1159.43)`, `(4390.10, -1175.37)`, `(4239.49, -1361.06)`, `(4207.34, -1372.12)`, `(-1751.31, -1260.05)`, `(-1746.19, -1297.17)`, `(-828.67, 828.31)`, `(2690.40, 2647.95)`, `(-8745.83, -2642.54)`, `(-6334.24, -2471.79)`, `(-6366.79, -2481.59)`, `(-6399.35, -2491.39)`, `(-6772.45, 2799.39)`.
4. **Record-hash diff (RNG stream unchanged)**:
   - `lamps`: `3,519` (`103b2b680431`) → `3,438` (`7dd87fcc6b71`), **81** duplicate lamps removed, **0** added, **0** moved.
   - `trees`: `119,245` (`fd93b2fae974`) → `119,207` (`053bbb1ef9af`), **38** removed (6 OSM + 32 procedural), **0** added, **0** moved.
5. **Boot timings (3 interleaved runs, `city-config` + `geodata` + `city-grid` + `buildings` + `street-details` + `layoutTramInfrastructure`)**:
   - Main checkout (`8040d16`): `12,287.9 ms`, `11,978.6 ms`, `12,096.5 ms` (**median `12,096.5 ms`**)
   - Worktree: `12,651.8 ms`, `12,711.7 ms`, `11,803.5 ms` (**median `12,651.8 ms`**)

## 5. Camera positions for visual verification

1. **Block 212 narrow-walk duplicate lamp removed (`(-959.18, -1893.81)` kept, `(-958.42, -1893.58)` dropped)**: eye `(-952.0, 2.2, -1887.0)`, look `(-959.2, 1.5, -1893.8)`
2. **Closest plaza duplicate lamp removed (`(-1165.36, 99.28)` kept, `(-1165.37, 99.28)` dropped)**: eye `(-1158.0, 2.2, 105.0)`, look `(-1165.4, 1.5, 99.3)`

## Rerun commands

```sh
node tools/audit-park-lamps-trees.mjs
node tools/audit-park-lamps-trees.mjs --json
node --test tests/park-lamps-trees.test.cjs
```
