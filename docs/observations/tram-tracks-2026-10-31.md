# Tram network continuity and vertical step elimination — 2026-10-31

This work resolves tram track discontinuities, vertical steps (0.22 m curb slab conflicts), missing track curves,
and dropped underground tram tunnels across the Poznań tram network (commits `7718727` and `77b9b25`).

---

## 1. Defect and correction

### Vertical steps and buried rails (0.22 m curb slabs)
- **The problem:** Empty curb islands, medians, and built city blocks whose perimeter crossed tram corridors were
  previously extruded as solid 0.22 m raised slabs (`SW_TOP = 0.22 m`). At major multi-track junctions—notably
  Rondo Kaponiera, Most Dworcowy / Dworzec Główny, Most Uniwersytecki, Most Teatralny, and Hetmańska—tracks
  running at grade were either lifted by 0.22 m onto curb slabs or buried beneath concrete and granite surfaces.
- **Universal track corridor cuts (`TRAM_CUT_HALF = 2.2875 m`):**
  - In `js/city-config.js`, the standard track clearance corridor ($0.7175 + 0.07 + 1.5 = 2.2875$ m, matching paved
    square cuts) is now applied universally to all empty curb islands and to any block whose polygon perimeter
    intersects tram track segments (`segsCross`).
  - Both `blockAt(x, z)` queries and rendered slab/curb extrusion in `js/city-grid.js` exclude these corridors.
  - In `js/city-grid.js`, median hedge geometries (`cutSlab`) also subtract intersecting tram corridors, preventing
    hedges from growing across the tracks.
  - In `js/tram-infra.js` (`layoutTrackBeds`), street-running tracks (`tr.street === 1`) are locked to ground height
    $y = 0.0$ m (`const ground = tr.street === 1 ? 0 : (blockAt(mx, mz) ? SW_TOP : 0)`). Raised ballast beds are
    suppressed beneath elevated road bridge decks (`underBridgeDeck`: Most Dworcowy at `−1545, 570`, Most Uniwersytecki
    at `−1420, 90`, and Kaponiera bridge deck at `−1365, −200`), eliminating spurious ballast mounds under bridges.

### Preserving PST and Franowo tram tunnels
- **The problem:** In `tools/poz-roads.mjs`, OSM track ways with `tunnel=yes` or `layer < 0` were previously dropped
  by the generic `underground()` filter. This erroneously discarded major rapid transit infrastructure:
  the underground segments of Poznański Szybki Tramwaj (PST / "Pestka", including Kaponiera lower level and Dworzec
  Zachodni) and the Franowo Tram Tunnel (Tunel Trasy na Franowo: Os. Lecha – Piaśnicka – Franowo).
- **The correction:**
  - Added filter exceptions `isPst(t)` and `isFranowo(t)` in `tools/poz-roads.mjs` ensuring all rapid transit tram ways
    are preserved in the generated geodata (`js/geodata.js`).
  - Implemented refined `isStreetTram` classification: distinguishes PST lower trench / underground levels
    (`level=-2` / `layer=-2` / $z \in [0, 1050]$) and open northern cuttings ($z < -460$) from street-level bridge
    crossings.
  - Enhanced segment grid matching (`nearParallel`) with an 8.0 m proximity fallback (`matchDist`), ensuring tracks
    accurately align with street corridors through complex multi-branch junctions.

### Missing Św. Marcin – ul. Ratajczaka track curve (way `1159708999`)
- **The problem:** The southern turn from Św. Marcin into ul. Ratajczaka (part of the *Projekt Tramwaj w Ratajczaka*)
  was disconnected in the OSM snapshot: node 583424815 at `[−612.43, 237.59]` on Św. Marcin did not connect to node
  10784788054 at `[−600.95, 230.41]` on Ratajczaka, causing a missing curve segment and broken route topology.
- **The correction:**
  - Added synthetic track way `1159708999` with smooth curve geometry spanning the five intermediate points,
    correct one-way orientation (`oneway: 1`), and automatic route membership extension (`allTramRoutes`).

### Most Bolesława Chrobrego land corridor expansion
- **The problem:** Bridge deck rasterization in `js/city-config.js` (`LAND_DIST`) used standard half-width
  $w / 2 + 2$ m. For Most Bolesława Chrobrego, which carries two wide carriageways and central tram tracks over the
  Warta / Cybina flood channels, the narrow mask caused peripheral lanes and track beds to fall into open water,
  triggering land clamping rejections.
- **The correction:**
  - Expanded the bridge deck land capsule corridor on Most Bolesława Chrobrego to $\max(hw, 15\text{ m})$.
  - Ensures the full bridge deck, carriageways, and tram tracks remain walkable/drivable land (`isLand = true`,
    `isWater = false`) across the river.

---

## 2. Deterministic regressions

Deterministic test coverage across the full test suite confirms the integrity of the network, geometry, and actor
simulation:

- **Full test suite:** `node --test tests/` passes **312/312** (40.6 s); quick loop `node --test tests/*.cjs` passes
  **303/303** (19.4 s).
- **Traffic simulation (`tests/traffic-flow.test.mjs`):**
  - Traffic flows smoothly through Jeżyce and Centrum districts with 0 deadlocks, 0 trams held at switches $> 60$ s,
    and no vehicles held $> 120$ s. Mean speed remains healthy ($> 13$ km/h).
- **Hetmańska clearance regression (`tests/hetmanska-clearance.test.cjs`):**
  - Confirms track index 577 retains 0 m of raised rail across the former curb conflict. Centreline and both rail heads
    remain 100% uncovered by raised sidewalk slabs.
- **Tram infrastructure (`tests/tram-infra.test.cjs`):**
  - Verifies tram stops, platforms, catenary masts, and track beds maintain safe clearance from vehicular lanes.
  - The elevated Most Dworcowy bridge over the PST trench is properly accounted for without spurious road/ballast conflict.
- **Signal placement (`tests/signal-placement.test.cjs`):**
  - Restores 154 vehicle heads and 276 pedestrian heads across 128 junctions (276 restored poles) with
    `roadClearance >= 0.8 m` and `railClearance >= 2.22 m`. All non-signal footprints remain identical to baseline.
- **Footbridges (`tests/footbridges.test.cjs`):**
  - Road network preserves 8,756 edges and 11,651 vehicular lanes.
- **Source formatting:** `git diff --check` passes cleanly with zero whitespace or line-ending defects.

---

## 3. Browser checks

Browser verification was performed in Chrome on macOS using both WebGPU and forced WebGL2 renderers, Midday lighting preset,
full Poznań scene:

- Both backends booted cleanly and rendered at least 60 frames without captured console warnings, errors, or unhandled
  promise rejections.
- **Targeted geometry inspection:**
  - **Rondo Kaponiera (`−1365, 12, −200`):** Multi-track junction curves cross smoothly at road grade; no 0.22 m vertical
    steps or broken rail surfaces across central medians or pedestrian islands.
  - **Most Dworcowy / Dworzec Główny (`−1545, 15, 570`):** Elevated road bridge deck cleanly clears the lower-level PST
    tracks; no spurious raised ballast beds or sidewalk slabs penetrate the lower trench.
  - **Most Uniwersytecki (`−1420, 10, 90`):** Rails remain continuous and flush with the roadway surface across bridge
    approaches.
  - **Św. Marcin / ul. Ratajczaka (`−612, 5, 237`):** The new track curve connects seamlessly from Św. Marcin into
    ul. Ratajczaka, providing full track continuity.
  - **PST / Trasa na Franowo:** Retained rapid transit corridors render continuously through cuttings and tunnel portals.
  - **Most Bolesława Chrobrego (`950, 10, 100`):** Continuous road and tram track decks across the river without water
    clipping or land-clamping drops.

### Limitations
These inspections verify static geometry, clearance corridors, and application boot. They do not constitute an
exhaustive multi-hour traffic trace across all 8,756 road edges or full NPC route traversal across every tram line.
Long-term vehicle yielding and network-wide passenger boarding checks remain tracked in the backlog.
