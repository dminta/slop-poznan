# Railway viaducts and underpass sidewalks — 2026-10-31

This work resolves the "Railway viaducts and underpasses" item from `docs/backlog.md` (historical reference §15.8):
1. Restoring sidewalks and pedestrian routing under railway bridges without merging raster blocks into filled rings or covering trackbeds in raised slabs.
2. Modeling railway viaduct decks, steel through-plate girders, abutment portals, and overhead colliders across road underpasses with vertical clearance for vehicular and tram traffic.

---

## 1. Geometric Problem & Underpass Sidewalks

### The Ring Problem
Historically (2026-10-28), connecting sidewalk blocks across railway land in `tools/poz-blocks.mjs` by setting `D = 1` caused the 4-connected component labeller to merge blocks on opposite sides of the railway into single outer polygons enclosing railway land. Because Three.js extrusion (`GEO.blocks`) only supports simple outer polygons without inner holes, extruding these merged rings covered the enclosed railway corridors in a 0.22 m raised sidewalk slab, burying ~25% of all Poznań tracks.

### The Runtime Solution
- **Zero tooling or raster changes:** The offline geodata and block raster are preserved intact.
- **Dedicated underpass sidewalks (`UNDERPASS_SIDEWALKS`):** In `js/city-config.js`, 44 continuous sidewalk strips (2.5 m wide) are computed along road underpass corridors (`UNDERPASS_CORRIDORS`) spanning between the blocks on either side.
- **Spatial grid indexing:** `UNDERPASS_GRID` indexes these strips; `blockAt(x, z)` queries them as virtual curb islands with `b.underpass = true`.
- **Mesh generation:** `js/city-grid.js` extrudes granite curbs (0–0.18 m) and concrete slabs (0.03–0.22 m) along all 44 strips and includes their bounds in `roadSidewalks`.
- **Pedestrian navigation:** In `js/pedestrian-routes.js`, `along(e)` supports continuous cross-block sidewalk paths across underpass strips (`anyBlock = true`), creating uninterrupted pedestrian routes through all underpasses.
- **Street furniture safety:** Signal poles and obstructions are excluded from underpass strips (`b.underpass`), preventing pole placement under railway bridges.

---

## 2. Railway Viaduct Spans & Clearances

### Viaduct Structures
Where railway lines cross over roadways at grade-separated underpasses (e.g. Hetmańska, Garbary, Libelta / Pułaskiego, Nowowiejskiego, Cicha, Przepadek, Niepodległości, Podwale, Niestachowska, Sucha, Nad Wierzbakiem, Niska):
- In `js/tram-infra.js` (`layoutRailInfrastructure`), non-level road cuts not under road overpasses are identified as railway viaducts (`viaducts`, 41 spans across the city).
- **Clearance:** Viaducts crossing tram corridors (such as the Hetmańska Górczyn line underpass) provide `yClearance = 6.0 m` to clear tram overhead catenary (`WIRE_Y = 5.8 m`). Viaducts crossing roadways without trams provide `yClearance = 4.8 m`.
- **Bridge Decks & Girders:** In `buildTramInfrastructure`:
  - Concrete/steel deck slabs (0.35 m thick, 4.4 m wide) span across each cut at `yClearance + 0.175 m`.
  - Steel side plate girders (`RailViaductGirders`, 1.2 m tall, 0.22 m thick) flank both sides of each track at `±2.2 m` offset using `steelMat`.
  - Elevated ballast slabs and continuous steel rails (`railM`, `topRail = deckY + 0.20 m`) span the deck, visually bridging the cut track.
  - Abutment portals (`RailEndWalls`) rise from ground to deck level (`deckY`), replacing plain 1.1 m end walls.
- **Overhead Colliders:** Each viaduct deck span generates an oriented 3D collider with `minY = yClearance` and `maxY = yClearance + 2.5 m`. Ground-level vehicles (cars, buses, trucks, trams) and pedestrians at `y in [0, 2.0 m]` pass unobstructed underneath (`groundTop <= minY`), while airborne entities collide with the deck.

---

## 3. Measurements

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Underpass sidewalk strips (`UNDERPASS_SIDEWALKS`) | 0 | 44 | +44 |
| Connected pedestrian underpass routes | Broken / missing | Fully routed | Continuous |
| Railway track collisions with sidewalks | 0 | 0 | 0 (100% clean) |
| Railway viaduct spans (`rail.viaducts`) | 0 | 41 | +41 |
| Viaduct clearance over tram lines (Hetmańska) | Open cut | 6.0 m | Full catenary clearance |
| Viaduct clearance over ordinary roads | Open cut | 4.8 m | Full truck/bus clearance |
| Overhead viaduct deck colliders (`minY >= 4.8 m`) | 0 | 195 | +195 |
| Ground roadway lane obstructions (< 3.5 m) | 0 | 0 | 0 |
| Total test suite (`node --test tests/`) | 305 pass | 310 pass | +5 tests |

---

## 4. Verification

- `tests/underpass-sidewalks.test.cjs`:
  1. `UNDERPASS_SIDEWALKS` exports 44 continuous strips under railway bridges.
  2. 0 collisions between kept railway pieces and underpass sidewalks.
  3. Pedestrian routes navigate continuously through underpasses (Przepadek, Garbary, Niepodległości, Cicha, Podwale, Nad Wierzbakiem, Sucha).
  4. Railway viaducts bridge cut tracks over roadways with `>= 4.8 m` clearance (`6.0 m` over Hetmańska tram line).
  5. Railway viaduct decks generate overhead colliders with `minY >= 4.8 m` leaving ground roadways unobstructed.
- Full regression suite `node --test tests/`: **310/310 passed** (34.3 s).
