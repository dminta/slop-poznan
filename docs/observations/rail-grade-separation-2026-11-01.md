# Railway grade separation: Libelta overpass & level crossings liquidation — 2026-11-01

Elevation of railway tracks over ul. Karola Libelta and full grade separation across all 5 former level crossing
sites (ul. Świętego Michała, ul. Krańcowa, ul. Bałtycka, ul. Gdyńska, ul. Wrzesińska), replacing at-grade tracks,
barrier cabinets, booms, and warning signals with elevated railway viaduct spans.

---

## 1. Motivation and context

User request:
> "wygląda lepiej; zlikwidowałbym jeszcze przejazdy z rogatkami takie jak np. na świętego michała; na libelta dalej torowisko przechodzi przez ulicę i nie można po nim przejechać - wynieśmy torowiska ponad ulice; use subagents"

Previously:
1. **ul. Libelta (`x in [-1285, -1170], z in [-590, -500]`):** Railway tracks crossing over ul. Libelta were flagged as
   ground-level tracks beneath an overpass (`ground = 0`), which caused rail ballast and track pieces to intersect the
   roadway at $y = 0$, blocking road traffic.
2. **Level crossings with barriers (rogatki):** Mainline rail lines crossed public streets at grade across 5 locations:
   - ul. Świętego Michała
   - ul. Krańcowa (near Poznań Wschód)
   - ul. Bałtycka (dual carriageway)
   - ul. Gdyńska (dual carriageway)
   - ul. Wrzesińska
   These crossings featured flush tracks (`rail.level`), barrier cabinets, striped booms (`rail.barriers`), and
   warning signal masts with St. Andrew's crosses (`rail.signals`). While visually detailed, they presented obstacles
   and grade conflicts for street traffic.

---

## 2. Implementation details (`js/tram-infra.js`)

1. **Elevation of ul. Libelta crossing:**
   - Identified the Libelta corridor coordinates (`mx in [-1285, -1170], mz in [-590, -500]`).
   - Removed artificial `deckGrid.add` entries that previously forced `roadDist === Infinity` at ground level.
   - Added the corridor to `isBridgeCorridor`, converting the roadway crossings into elevated viaduct spans
     (`yClearance = 4.8 m` for standard road crossings; `6.0 m` over tram corridor intersections) with continuous steel
     through-plate side girders (`RailViaductGirders`), concrete deck slabs, and overhead colliders (`minY >= 4.8 m`).
   - Ul. Libelta at ground level ($y = 0$) is 100% unobstructed, continuous, and drivable.

2. **Liquidation of level crossings & conversion to elevated viaducts:**
   - Converted the road-cut handling logic in `layoutRailInfrastructure`: whenever railway tracks encounter road cuts,
     instead of laying flush ground tracks (`atLevel`), they are automatically bridged via elevated viaduct spans
     (`yClearance = 4.8 m`, deck height $y = 5.14$ m).
   - Eliminated all barrier cabinets, booms, and warning signal placements:
     `barriers = []`, `signals = []`, `level = []`.
   - Generated elevated spans across all 5 former level crossing locations:
     * **ul. Świętego Michała**: 8 elevated viaduct spans ($y_{\text{clearance}} = 4.8$ m).
     * **ul. Krańcowa**: 8 elevated viaduct spans ($y_{\text{clearance}} = 4.8$ m).
     * **ul. Bałtycka**: 2 elevated viaduct spans ($y_{\text{clearance}} = 4.8$ m).
     * **ul. Gdyńska**: 2 elevated viaduct spans ($y_{\text{clearance}} = 4.8$ m).
     * **ul. Wrzesińska**: 3 elevated viaduct spans ($y_{\text{clearance}} = 4.8$ m).
   - Citywide elevated viaduct spans increased from 67 to 96 spans.

3. **Approach ramp and vertical transition geometry:**
   - Tracks approach each viaduct span over 160 m ramps (`RAMP_LEN = 160 m`), achieving maximum slope of 5.95% (< 6.0% maximum).
   - Continuous 3D ballast and pitching rails join the viaduct deck slabs with zero vertical step across all 167 abutments.
   - Roadway corridor keep-out raster cells on all crossing lanes are cleared (0 blocked cells).

---

## 3. Measurements

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| Elevated railway viaduct spans (`rail.viaducts`) | 67 | 96 | +29 spans |
| Level crossing barriers (`rail.barriers`) | 28 | 0 | -28 (eliminated) |
| St. Andrew's warning signals (`rail.signals`) | 28 | 0 | -28 (eliminated) |
| Flush level track pieces (`rail.level`) | 80 | 0 | -80 (elevated) |
| Ground track pieces on ul. Libelta roadway | >0 | 0 | 0 |
| Road network edges | 8,756 | 8,756 | 0 (100% preserved) |
| Road network drivable length | 435.479 km | 435.479 km | 0 (100% preserved) |
| Vehicle flow speed across crossing edges | 12.0 km/h | 12.0 km/h | Uninterrupted |

---

## 4. Verification

- Focused tests:
  * `node --test tests/rail-crossings.test.cjs`: passes **6/6**.
  * `node --test tests/rail-continuity.test.cjs`: passes **5/5**.
  * `node --test tests/underpass-sidewalks.test.cjs`: passes **6/6**.
  * `node --test tests/track-parapets-crossings.test.cjs`: passes **2/2**.
  * `node --test tests/tram-infra.test.cjs`: passes **4/4**.
- Full test suite:
  * `node --test tests/*.cjs`: passes **312/312** (17.4 s).
- Code formatting and style:
  * `git diff --check`: 0 warnings, 0 trailing spaces.
