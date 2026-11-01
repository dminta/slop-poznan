# Railway network continuity across bridges and underpasses — 2026-10-31

This work resolves railway track discontinuities, missing river bridges across the Warta and Cybina, and artificial
track cuts beneath elevated road overpasses across the Poznań railway network (PKP mainline and station lines).

---

## 1. Defect and correction

### River railway bridges (Linia 3 & Linia 356)
- **The problem:** Railway lines were not included in `BRIDGES` or in the `LAND_CODE` raster in `js/city-config.js`.
  When `tram-infra.js` sampled ground at river crossings, `isLand(x, z)` returned `false` (`isWater === true`),
  tagging all bridge segments as rejected with `why = 'water'`. This resulted in:
  * Most kolejowy Garbary across Warta (Linia 3 Warszawa – Kunowice): 64–72 m track gaps between `[435, -816]` and
    `[505, -795]`, terminated by retaining end walls on both river banks.
  * Most kolejowy across Cybina (Linia 3 and Linia 356, Ostrów Tumski – Poznań Wschód): 16–24 m track gaps between
    `[1170, -630]` and `[1194, -620]`, terminated by end walls.
- **The correction:**
  * Defined `RAIL_BRIDGES` in `js/city-config.js` for both crossings with half-widths of 10 m and 8 m (spans >= 14 m).
  * Included `RAIL_BRIDGES` in the `LAND_CODE = 2` rasterization loop alongside road and footbridges, ensuring
    `isLand(x, z) === true` and `isWater(x, z) === false` along the railway bridge corridors.
  * Modeled continuous ballast, rails, steel plate through-girders (`RailViaductGirders`), concrete deck slabs, and
    underwater pier foundations extending down to $y = -3.0$ m (`isRiverBridge` in `buildTramInfrastructure`).
  * Suppressed spurious end walls on river banks in the railway track alignment.

### Grade separation at Most Teatralny, Most Uniwersytecki and Most Dworcowy
- **The problem:** In the simulation, all roadways (`GEO.roadGraph`) and tram lines on Most Teatralny, Most Uniwersytecki,
  and Most Dworcowy are rendered at ground level ($y = 0$, tram rails at $y = 0.016$ m). When railway tracks crossing these
  corridors were modeled at grade ($y = 0$), railway ballast, steel rails, and trains intersected the roadway and tram tracks.
- **The correction:**
  * Modeled railway crossings at Most Teatralny, Most Uniwersytecki, and Most Dworcowy as elevated railway viaduct spans
    (`rail.viaducts`).
  * Enforced vertical clearance $y_{\text{clearance}} = 6.0$ m (required for tram overhead catenary lines on the bridges)
    and deck height $y_{\text{deck}} = 6.35$ m.
  * Spans generate instanced steel through-plate side girders (`RailViaductGirders`), continuous concrete deck slabs,
    elevated ballast, and steel rail heads.
  * Elevated decks carry overhead colliders with `minY >= 6.0 m` and `maxY = 8.5 m`, leaving cars ($y \le 2.0$ m),
    buses, trams, and pedestrians at ground level ($y = 0$) completely unobstructed with zero collisions.
  * Railway tracks smoothly transition between ground level and the viaduct decks via approach ramps over 160 m
    (`RAMP_LEN = 160 m`, gradient $< 6\%$, shared as continuous elevated embankments between nearby bridges), with continuous
    3D ballast and rising rails with zero vertical step.
  * Excluded bridge complex slip roads (`Franklina Roosevelta` and `Dworcowa`) and bridge envelopes from `isRoadOverpass`,
    ensuring that 100% of railway tracks across the three bridges are elevated as viaducts without leaving any stray
    ground pieces or blocking end walls.

### Ground-level tracks beneath other road overpasses
- **The correction:**
  * At other grade-separated crossings (e.g. ul. Karola Libelta / Pułaskiego, ul. Niestachowska, ul. Witosa), railway
    tracks run continuously at ground level (`ground = 0`) beneath elevated road decks without blocking end walls.
  * In `roadDist(x, z)` and `tramDist(x, z)`, tracks under elevated decks (`underDeck(x, z)`) return `Infinity` and `r`,
    preventing spurious cuts.
  * Guarded catenary mast, portal, and fence placement (`!underDeck(x, z)`), preventing overhead carriageways from being
    obstructed by vertical poles, and maintaining 100% of vehicular road network edges (8756/8756).

---

## 2. Deterministic regressions

The dedicated regression test `tests/rail-continuity.test.cjs` runs the full headless harness and verifies:
1. `RAIL_BRIDGES` exports river bridges across Warta and Cybina with width >= 14 m.
2. Bridge corridors rasterize as walkable land (`isLand === true`, `isWater === false`).
3. Mainline tracks across Warta (Garbary) and Cybina are continuous with 0 m gaps and 0 blocking end walls.
4. Railway tracks crossing Most Teatralny, Most Uniwersytecki and Most Dworcowy are elevated as viaduct spans
   with vertical clearance >= 6.0 m (clearing tram catenary) and deck height >= 6.35 m, with zero non-viaduct blocking end walls.
5. Tracks beneath other road overpasses (ul. Libelta, ul. Witosa / Niestachowska) remain continuous at ground level with 0 blocking end walls.
6. River bridge pieces generate through-plate steel side girders, concrete deck slabs, and concrete river piers.

Test results:
- Focused suite: `node --test tests/rail-continuity.test.cjs tests/underpass-sidewalks.test.cjs` passes **12/12** (7.2 s).
- Full regression suite: `node --test tests/` passes **317/317** (35.2 s).
- Traffic regression: `node --test tests/traffic-flow.test.mjs` passes **1/1** (24.3 s, 0 deadlocks, mean speed > 13 km/h).
- Formatting: `git diff --check` passes with zero warnings or errors.

---

## 3. Browser checks

Local Chrome, full scene, Midday, WebGPU and forced WebGL2:
- Viewed Most kolejowy Garbary across Warta from `470, 15, -780` looking west toward Garbary station: confirmed
  continuous steel plate girders, ballast, rails, and concrete piers descending into the water.
- Viewed elevated railway viaducts over Most Teatralny and Most Uniwersytecki from `-1380, 12, 100`: confirmed
  elevated viaduct spans passing overhead with 6.0 m clearance, allowing trams and cars to pass freely underneath at ground level.
- Viewed Most Dworcowy elevated railway viaducts from `-1520, 10, 560`: confirmed elevated spans flying over the bridge
  and tram corridor with 6.0 m clearance into Poznań Główny.
- Confirmed zero GL errors or shader compilation warnings on both backends.
