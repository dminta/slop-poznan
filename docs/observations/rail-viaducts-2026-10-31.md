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

## 3. Railway Embankment Approach Ramps

### Eliminating the 90° Vertical Cliff
- **The problem:** Viaduct decks bridge road underpasses at $y_{\text{deck}} = 5.15$ m (or $6.35$ m over Hetmańska tram tracks), but ground tracks previously lay flat at $y = 0.30$ m and terminated at a 5-meter vertical abutment wall (`RailEndWalls`), creating an impassable 90° cliff.
- **Continuous Embankment Ramps (`RAMP_LEN = 160 m`):**
  - In `js/tram-infra.js` (`layoutRailInfrastructure`), track piece endpoints $(x, z)$ within $160$ m of any viaduct abutment are elevated via a $C^1$ cubic smoothstep curve:
    $$u = 1 - \frac{d}{160},\quad s = 3u^2 - 2u^3,\quad y(x, z) = y_{\text{ground}} + (y_{\text{deck}} - y_{\text{ground}}) \times s \times w_{\text{corridor}}$$
  - **Shared Embankments (Estakady):** Where viaducts sit close together ($< 2 \times 160$ m, e.g. the northern mainline through Libelta – Nowowiejskiego – Cicha – Przepadek – Niepodległości – Garbary), taking $\max$ across viaducts maintains a continuous elevated railway embankment.
  - **Gradient Compliance:** Across 1,369 elevated track pieces, the maximum gradient is $5.94\% < 6.0\%$, meeting railway standards without steep vertical kinks.
  - **Seamless Bridge Joint:** At the viaduct abutment, the approach track height matches the viaduct deck with $0.000$ m vertical error ($\Delta y = 0$).
  - **3D Ballast Prism & Rails:**
    - `railBedM` extends from ground level ($y_{\text{ground}} - 0.06$) to `bedTop = yMid + RAIL_BED_TOP`, rotated with pitch $\theta = \text{atan2}(\Delta y, \text{len})$, forming a solid embankment under the climbing track.
    - `railM` beams follow the 3D track pitch seamlessly onto the viaduct deck.
  - **Retaining Abutment Walls:**
    - `RailEndWalls` stands from $y = 0$ to $y = y_{\text{clearance}}$ *beneath* the viaduct deck, serving as an earth-retaining wall for the underpass rather than a barrier across the rails.
  - **Elevated Catenary:**
    - Contact and messenger wires rise continuously with the ramps ($y_{\text{rail}} + 5.6$ m / $7.0$ m) and span across all viaducts.
    - Catenary masts and cantilevers in ramp zones adjust their heights to stand on the embankment.

---

## 4. Measurements

| Metric | Before | After | Change |
|---|---:|---:|---:|
| Underpass sidewalk strips (`UNDERPASS_SIDEWALKS`) | 0 | 44 | +44 |
| Connected pedestrian underpass routes | Broken / missing | Fully routed | Continuous |
| Railway track collisions with sidewalks | 0 | 0 | 0 (100% clean) |
| Railway viaduct spans (`rail.viaducts`) | 0 | 41 | +41 |
| Viaduct clearance over tram lines (Hetmańska) | Open cut | 6.0 m | Full catenary clearance |
| Viaduct clearance over ordinary roads | Open cut | 4.8 m | Full truck/bus clearance |
| Overhead viaduct deck colliders (`minY >= 4.8 m`) | 0 | 195 | +195 |
| Railway embankment approach ramps | 0 (90° cliff) | 1,369 elevated pieces | Smooth ramps |
| Maximum railway approach gradient | 90° vertical step | 5.94% | Compliant (< 6%) |
| Vertical gap at bridge abutment joint | 5.15 m | 0.000 m | Seamless |
| Ground roadway lane obstructions (< 3.5 m) | 0 | 0 | 0 |
| Total test suite (`node --test tests/`) | 305 pass | 312 pass | +7 tests |

---

## 5. Verification

- `tests/underpass-sidewalks.test.cjs`:
  1. `UNDERPASS_SIDEWALKS` exports 44 continuous strips under railway bridges.
  2. 0 collisions between kept railway pieces and underpass sidewalks.
  3. Pedestrian routes navigate continuously through underpasses (Przepadek, Garbary, Niepodległości, Cicha, Podwale, Nad Wierzbakiem, Sucha).
  4. Railway viaducts bridge cut tracks over roadways with `>= 4.8 m` clearance (`6.0 m` over Hetmańska tram line).
  5. Railway viaduct decks generate overhead colliders with `minY >= 4.8 m` leaving ground roadways unobstructed.
  6. Approach ramps transition seamlessly into viaduct decks without vertical step ($\Delta y < 0.001$ m across all 82 abutment transitions).
  7. Railway approach ramp slopes stay within the 6.0% grade limit (max 5.94%).
- Full regression suite `node --test tests/`: **312/312 passed** (34.8 s).
