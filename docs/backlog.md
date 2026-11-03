# Poznań backlog

Updated 2026-11-02. The port and documentation cleanup are implemented; the remaining work is below.
Implementation details live in the [topic docs](../AGENTS.md#docs). Original phase numbers refer to the
[archived port plan](archive/poznan-plan.md), which retains historical measurements and decisions.

## Park surfaces and road clearance: further review

- A city-wide scan of emitted lawn triangles against mapped road corridors found further candidates. Grudzieniec
  through Park Sołacki, around `−2671…−2590, −1389…−1361`, intersects the modelled corridor over about 80 m;
  the user reported that it looks OK in the game. Treat it as unconfirmed rather than cut it on that measurement
  alone. The park has three pond holes, which the existing `cutSlab` path cannot preserve across triangulation.
- Other candidates include Chartowo near `2490, 2478` and Wioślarska in Park Nad Wartą. Wioślarska is a mapped
  unpaved service road rather than an active traffic lane; verify its intended appearance before cutting greenery.
  The scan sums per-road-segment intersections, so its areas are not union areas; bridge levels need separate checks.
- Witosa / Niestachowska, the Armii Poznań / Pułaskiego island, Przepadek and Roosevelt have local cuts and
  regression tests. The user confirmed the first Witosa lawn fix, then reported the opposite sidewalk; its later
  correction and the other cuts need visual review, including WebGL2. Some planting margins are now narrow.

## Dworzec crossings: connected route implemented

- **Refuge accessibility fixed:** existing median surfaces now permit walking while still blocking cars. This
  restores the crossing onto the western island near `−1589, 562` (node `−1592.6, 579.6`); the grid-and-furniture
  snapshot goes from 0 to 1 crossings within 100 m of the central node. Regression coverage checks the actual
  curbs and furniture, unchanged car lanes and 2 m rail clearance at restored waiting positions.
- **Central connection implemented:** a shared crossing over two same-phase carriageways joins the western refuge
  to the southern sidewalk near `−1558, 579.5`. Crossings within 100 m increase from 1 to 2. Exact-coordinate tests
  walk the real pedestrian links in both directions; they retain queued-roadway and 2 m rail-waiting clearance
  checks. Connector reservations cover the actual crossing and a bus's rear after it leaves the connector.
- **Browser inspection (2026-10-30, commit `482ebdf`):** local Chrome/WebGPU, Midday, full scene. Walked the western
  zebra onto the refuge and the shared connection to the southern sidewalk and back. The shared zebra is visible
  on the carriageway and the player can traverse the connection in both directions. The console contained eight
  informational builder/init messages and no errors or warnings at the console check. These are manual spot
  checks, not a recorded continuous traffic trace or a WebGL2 check.
- **Return-direction head fixed (2026-10-30):** added a southeast-facing pedestrian head on the western refuge at
  `−1580.5, 552`, using the central junction's existing `walk1` plan. The completed grid-and-furniture regression
  checks its facing from the real southern landing, its pole footprint, unchanged car lanes, clear refuge links
  and full rail clearance. The full browser scene now has 1304 pedestrian heads/poles (previously 1303).
- **Refuge planting fixed (2026-10-30):** a 3 m corridor through the hedge follows the measured refuge link, with
  1.5 m end padding. The local hedge area changes from 45.949 to 33.451 m²; northern planting remains. Tests observe
  the polygons actually extruded and verify clear walking/waiting space. Median slabs and traffic blockers stay.
- **Traffic verification completed (2026-10-30, `d2ebe36`):** full Chrome/WebGPU scene, Midday. Recorded
  pedestrian-related stops on both protected carriageways; the turning movement was additionally checked with
  opposing traffic excluded as the cause. Two controlled 12 m bus trials verified the rear-clearance reservation
  across connector handoffs, with rendered inspections of the rear over the zebra and subsequent clearance.
  In the measured release trial, the NPC began walking about 0.53 s after the first sampled body clearance.
  These bus trials started with an already committed bus; a natural end-to-end bus approach was not recorded.
  See the [observation record](observations/dworzec-2026-10-30.md) for setup, timings and limits.
- **Validation after both fixes:** `node --test tests/` passes 280/280 (38.25 s), including head orientation,
  rendered hedge geometry, bidirectional connectivity, vehicle rear clearance and unchanged traffic-flow limits.
  The initial regression for each visual defect failed before its fix. Browser recheck uses a hard reload to
  bypass cached modules; WebGPU boot and console checks pass. Walked the route in both directions through the
  clear hedge corridor; observed red and green on the new head from the southern landing, and checked visibility
  of the existing head from the refuge. The later traffic observations above cover yielding and controlled bus
  rear clearance; the Dworzec route and traffic interaction still need a targeted WebGL2 check.

## Bus pool availability fixed

- Cars could fill every local density slot before a bus received a placement attempt. The pool now reserves its
  proportional bus share within the same total target, only where a nearby major road can accommodate a bus.
  Safe-placement failures leave room for later retries; the normal four-attempt budget remains unchanged.
- Seeded furnished-network Dworzec measurement, 120 s: **72 cars / 0 buses → 67 cars / 5 buses**, 72 vehicles total.
  A naturally spawned bus approached and fully cleared the shared zebra. Full Chrome/WebGPU inspection also
  confirmed five active buses and natural movement through the junction. The geometric zebra-clearance measurement
  was headless; a complete rendered pedestrian interaction trace and WebGL2 remain outside this check.
  See the [observation record](observations/bus-population-2026-10-30.md) for method, timings and limits.
- Validation: `node --test tests/` passes 286/286 (36.30 s), including six new population regressions and the
  unchanged Jeżyce/Centrum traffic-flow limits.

## WebGL2 pedestrian rendering fixed

- The undersized draw-buffer error came from pedestrian pose storage, reproduced with one `PeopleNear` mesh.
  WebGL2 bound 31 pose vec4s as per-vertex input for 2189 vertices. Enabling indexed PBO texture reads fixes the
  draw; invalidating that texture after CPU updates also prevents frozen animation. WebGPU keeps storage buffers.
- Two-frame rendered checks cover both pedestrian LODs. Full Edge WebGL2 and WebGPU scenes booted and rendered
  60 frames with no console errors or warnings; WebGL2 recorded 76,154 draws and no GL errors. These are smoke
  checks, not a complete visual or performance audit. See the [observation record](observations/webgl2-2026-10-30.md).
- Validation: `node --test tests/` passes 289/289 (33.27 s), including pose packing, PBO uploads, padded buffer
  replacement and ordinary WebGPU storage uploads.

## Zebra visibility verified

- The remaining ballast-occlusion report was stale: the existing 1.7 m rail cuts and narrowed tram beds already
  keep the paint visible. The furnished-network regression finds **0 m²** of zebra/ballast overlap across 2563
  zebra pieces and 7760 ballast beds. Disabling the rail cuts reproduces the conflict on the same crossings.
- Full Chrome scenes on WebGPU and forced WebGL2 confirm zero overlap using actual mesh buffers and instance
  matrices; the closest paint-to-bed gap is 0.386 m. Midday rendered spot checks show visible stripes and the
  deliberate unpainted track corridor. No production geometry change was needed.
- Validation: `node --test tests/` passes 290/290 (36.60 s). See the
  [observation record](observations/zebra-visibility-2026-10-30.md) for scope and limits.

## Krucza signals restored and Hetmańska inspected

- **Krucza/Zamenhofa:** restored vehicle heads on both live Krucza approaches at junction `699.25, 2750.75`.
  The historical short approach near `675, 2738` is removed/disabled by the furnished network.
  A large park bounding box incorrectly excluded the sidewalks. The surveyed approaches now check the actual park
  outline, retaining the normal road, rail and crossing clearances. The eastern approach starts pole search at
  `dt >= 6.0 m` along the curb, preserving 4.51 m clearance to the right-turn swept path into Zamenhofa.
  Vehicle heads **743 → 745**, pedestrian heads/poles **1304 → 1306**; all furnished-network lanes, crossings
  and other furniture remain unchanged.
- **Hetmańska:** the examined three-lane runs keep their outer lane centres 1.3 m inside the 9.8 m carriageway.
  The historical 0.5 m excess describes a nominal 3.6 m lane envelope, not a centreline outside the roadway;
  no lane-placement change was justified. The Dmowskiego curb/rail conflict was confirmed here and fixed in the
  follow-up below.
- Validation: **296/296** tests pass (33.33 s). Full Edge WebGPU and forced WebGL2 scenes rendered at least 60
  frames without captured console warnings/errors on the final runs. The restored heads were viewed on both
  backends; WebGPU spot checks observed red and green. Hetmańska received WebGPU geometry spot checks.
  See the [observation record](observations/krucza-hetmanska-2026-10-31.md) for measurements and limits.

## Hetmańska/Dmowskiego curb conflict fixed

- The surveyed 47.5 m² empty curb island near `−2446, 2204` lay entirely inside the standard 2.2875 m
  clearance corridors of the two tram tracks. Cutting both corridors removes the whole island; neighbouring
  sidewalks remain. The same exclusion in `blockAt` keeps rail, pedestrian and player ground queries consistent
  with the emitted geometry. Generated geodata is unchanged.
- Raised rail length **7.992 → 0 m**, conflicting curb area **47.5 → 0 m²**. Regressions record actual curb/slab
  extrusion and replay the pre-fix configuration: furnished-network lanes, crossing endpoints and furniture
  footprints remain unchanged. Both new symptom checks failed before the fix.
- Validation: `node --test tests/` passes **296/296** (38.63 s), including unchanged traffic-flow regressions.
- Full Chrome WebGPU and forced WebGL2 scenes rendered at least 60 frames without captured console warnings or
  errors. Midday spot checks from above and street level show exposed, continuous rails without the raised slab.
  These are geometry checks, not a continuous tram/traffic interaction trace. See the
  [observation record](observations/hetmanska-clearance-2026-10-31.md).

## Footbridges added and katedra scenic view established

- Added three pedestrian and bicycle river crossings to `city-config.js` (`FOOTBRIDGES` merged into `BRIDGES`):
  * **Most Biskupa Jordana**: red tied steel arch bridge across Cybina, span 64.1 m, width 14 m, fully paved with
    sidewalk stone without asphalt roadway.
  * **Kładka Bramy Poznania**: covered glass-walled footbridge gallery across Cybina connecting ICHOT to Śluza Katedralna.
  * **Mosty Berdychowskie**: modern haunched girder footbridge across the Warta and Cybina with tip connector on Zagórze.
- The land raster (`LAND_CODE = 2`) now automatically rasterizes these corridors, making `isLand = true` and `isWater = false`
  across the crossings, enabling walking and cycling across the rivers without player `clampToLand` rejection.
- Vehicular traffic network (`GEO.roadGraph`) remains unmodified (8,756 edges, 11,650 lanes); no cars route onto footbridges.
- Parapet colliders (201 total bridge colliders) along both edges protect players from falling into the river.
- The `katedra` scenic camera preset (`1148, 8, -336`) now stands on Most Jordana (`isLand = true`) with an unobstructed
  westward line of sight to Archikatedra across Cybina.
- Validation: `node --test tests/` passes **301/301** (33.38 s). See the
  [observation record](observations/footbridges-2026-10-31.md).

## Railway level crossing barriers and signals added

- Added 28 level crossing barrier mechanisms (`CrossingBarrierCabinets`, `CrossingBarrierBooms` with red/white
  striped procedural material) and 28 St. Andrew's cross warning signals (`CrossingSignalMasts`, `CrossingStAndrewCrosses`,
  `CrossingSignalLamps`) across all 5 active level crossings covering 25 `GEO.levelCrossings` nodes on public streets
  (ul. Św. Michała, ul. Krańcowa, ul. Bałtycka, ul. Gdyńska, ul. Wrzesińska).
- Positions strictly respect road clearance (`roadDist >= 0.15 m`), vehicle lane envelopes (`laneDist >= 1.85 m`),
  rail structure gauge (`railDist >= 2.6 m`) and tram clearance (`tramDist >= 3.0 m`).
- Barrier drive cabinets and signal masts add physical colliders outside vehicle lanes.
- Roadway network and traffic flow remain 100% preserved (8,756 edges, 435.479 km).
- Validation: `node --test tests/` passes **305/305** (33.45 s). See the
  [observation record](observations/rail-crossings-2026-10-31.md).

## Park bounding box signal restoration implemented

- Extended exact park polygon outlines (`exactPark`) across all park-bordering sidewalks in `js/street-details.js`,
  recovering candidate approaches previously suppressed by the 13.26 km² excess AABB bounding boxes of irregular parks.
- Preserved 100% of drivable network lanes by starting candidate pole search at `dt >= 6.0 m` along the curb for unblocked
  approaches, avoiding turning curve swept paths (`pathClear` 0.8 m); adapted Szelągowska to `dt >= 8.4 m` and Miliana
  to `dt >= 7.2 m` to clear adjacent lane envelopes, while dropping candidate side 1 on Baraniaka.
- Vehicle heads **745 → 896** (+151), pedestrian heads / audio signals **1306 → 1578** (+272), adding 274 signal poles across
  128 junctions and 77 streets (e.g. Garbary, Szelągowska, Al. Armii Poznań, Sołacz, Malta, Rataje, Warszawska, Winogrady).
- Physical clearances strictly verified: 100% of restored poles satisfy `roadClearance >= 0.8 m` and `railClearance >= 2.22 m`.
- Roadway network (8,715 edges, 11,577 lanes), pedestrian crossings, and non-signal street furniture remain 100% unchanged.
- Validation: `node --test tests/` passes **305/305** (34.85 s). See the
  [observation record](observations/park-signals-2026-10-31.md).

## Railway viaducts and underpass sidewalks implemented

- Restored 44 dedicated underpass sidewalk strips (`UNDERPASS_SIDEWALKS`) in `js/city-config.js` and `js/city-grid.js`
  under railway bridges across all underpass corridors without joining raster blocks into filled rings.
- Connected pedestrian routes (`js/pedestrian-routes.js`) across underpasses (`anyBlock = true`), restoring continuous
  foot traffic on streets previously cut by railway corridors (Przepadek, Garbary, Niepodległości, Cicha, Podwale,
  Nad Wierzbakiem, Sucha, Hetmańska).
- Modeled 41 railway viaduct spans (`rail.viaducts` in `js/tram-infra.js`) bridging cut tracks over roadways with
  vertical clearance: 6.0 m over tram corridors (clearing 5.8 m catenary on Hetmańska), 4.8 m over roadways without trams.
- Modeled smooth railway embankment approach ramps over 160 m (`RAMP_LEN`, max slope < 6.0%, 0.000 m step at bridge joints),
  elevating ballast, pitching rails and rising catenary wires seamlessly onto viaduct decks, with retaining abutment walls beneath.
- Viaduct structures feature concrete/steel deck slabs, instanced steel through-plate side girders (`RailViaductGirders`),
  elevated ballast and continuous rail heads, and concrete abutment portals replacing 1.1 m end walls.
- Overhead colliders (`minY >= 4.8 m`) allow ground vehicles and pedestrians to pass completely unobstructed underneath
  while providing solid collision for airborne entities.
- Validation: `node --test tests/` passes **312/312** (34.8 s). See the
  [observation record](observations/rail-viaducts-2026-10-31.md).

## Tram network continuity and vertical step elimination implemented

- Eliminated 0.22 m vertical curb steps and buried rails across all multi-track junctions (Rondo Kaponiera,
  Most Dworcowy / Dworzec Główny, Most Uniwersytecki, Most Teatralny, Hetmańska) by universally applying the
  standard 2.2875 m track clearance cut (`TRAM_CUT_HALF`) across all empty islands, medians, and built blocks
  whose perimeter intersects tram tracks in `js/city-config.js` and `js/city-grid.js`.
- Synchronized `blockAt(x, z)` ground queries and rendered slab/curb/hedge extrusions with the cut corridors,
  guaranteeing continuous road-grade rail tops (0.016 m above roadway) without raised remnants.
- Locked street-running tram tracks (`tr.street === 1`) to ground height 0.0 m and suppressed raised ballast beds
  beneath elevated road overpasses (`underBridgeDeck` at Most Dworcowy, Most Uniwersytecki, and Kaponiera) in
  `js/tram-infra.js`.
- Preserved rapid transit tram tunnels in `tools/poz-roads.mjs` by guarding against the `underground()` filter
  for PST (`isPst`) and the Franowo Tram Tunnel (`isFranowo`), keeping Dworzec Zachodni, Kaponiera lower level,
  and Os. Lecha – Franowo in generated geodata.
- Refined PST track classification (`isStreetTram`) to separate open cuttings and deep trenches from bridge
  crossings and street corridors, adding an 8.0 m proximity fallback to `nearParallel`.
- Added missing turn curve track way `1159708999` connecting node 583424815 on Św. Marcin to node 10784788054 on
  ul. Ratajczaka (*Projekt Tramwaj w Ratajczaka*), restoring topological continuity.
- Expanded the land corridor under Most Bolesława Chrobrego to 15 m (`LAND_DIST`), preventing bridge deck lanes and
  central tracks from falling into open water or failing land clamping.
- Validation: `node --test tests/` passes **312/312** (40.6 s). See the
  [observation record](observations/tram-tracks-2026-10-31.md).

## Railway network continuity across bridges and underpasses implemented

- Defined river railway bridges (`RAIL_BRIDGES` in `js/city-config.js`) for PKP mainline routes across Warta
  (Most kolejowy Garbary, Linia 3) and Cybina (Most kolejowy przez Cybinę, Linia 3 i 356) with span widths >= 14 m.
- Rasterized `RAIL_BRIDGES` into `LAND_CODE = 2`, ensuring `isLand(x, z) === true` and `isWater(x, z) === false`,
  eliminating water cuts and retaining mainline railway tracks over water.
- Modeled river railway bridges with continuous ballast, steel rails, through-plate steel side girders (`RailViaductGirders`),
  concrete deck slab, and river piers (`endWallM` down to water level y = -3.0 m).
- Modeled elevated railway viaduct spans (`rail.viaducts` in `js/tram-infra.js`) at Most Teatralny (5 spans), Most Uniwersytecki
  (8 spans), and Most Dworcowy (22 spans) with vertical clearance $y_{\text{clearance}} = 6.0$ m and deck height $y_{\text{deck}} = 6.35$ m,
  clearing ground-level roadways and tram tracks ($y = 0$). Elevated spans feature through-plate steel side girders, concrete
  deck slab, continuous ballast, steel rails, and overhead colliders (`minY >= 6.0 m`), smoothly approached via 160 m ramps
  (`RAMP_LEN = 160 m`, slope < 6%) with zero vertical step.
- Restored continuous ground-level tracks (`ground = 0`) beneath elevated road overpasses (`isRoadOverpass === true`
  in `js/tram-infra.js`) at ul. Niestachowska and ul. Witosa, eliminating artificial end walls and track cuts.
- Extended `deckGrid` with overpass corridor envelopes covering road and tram spans, and ensured `roadDist(x, z)` returns
  `Infinity` and `tramDist(x, z)` returns clear distance under bridge decks, preventing false proximity conflicts with
  overhead lanes.
- Guarded railway mast, portal, and fence placement (`!underDeck(x, z)`) to keep overhead road carriageways free of
  vertical obstacles, preserving 100% of vehicular and tram edges (8756/8756).
- Validation: `node --test tests/` passes **317/317** (36.5 s). Dedicated test `tests/rail-continuity.test.cjs` passes **5/5**. See the
  [observation record](observations/rail-continuity-2026-10-31.md).

## Railway grade separation (Libelta and level crossings elimination) implemented

- Elevated railway tracks over ul. Karola Libelta ($x \in [-1285, -1170], z \in [-590, -500]$) onto elevated railway
  viaduct spans (`rail.viaducts`, 4 spans, $y_{\text{clearance}} = 4.8$ m and $6.0$ m over tram tracks), eliminating ground
  track cuts and retaining walls, and making ul. Libelta 100% passable at grade ($y = 0$).
- Converted all 5 remaining mainline railway level crossings with rogatki/barriers and warning signals across public streets
  (ul. Świętego Michała, ul. Krańcowa, ul. Bałtycka, ul. Gdyńska, ul. Wrzesińska) into elevated railway viaduct spans
  (`rail.viaducts`, $y_{\text{clearance}} \ge 4.8$ m, deck $y \ge 5.14$ m, span lengths 10–120 m).
- Liquidated all physical level crossing barrier cabinets, booms, and St. Andrew cross warning signals
  (`rail.barriers = []`, `rail.signals = []`, `rail.level = []`).
- Cleared all rail corridor raster keep-out, ballast, and low colliders from roadway lanes ($y = 0$), providing complete
  unobstructed vertical clearance ($y_{\text{clearance}} \ge 4.8$ m) and maintaining 100% drivability in both directions across
  all 5 former crossings (8,756/8,756 road network edges, 435.479 km drivable length).
- Total elevated viaduct spans citywide increased from 67 to 96, with smooth 160 m approach ramps ($< 6\%$ slope) and zero
  vertical steps across all abutment transitions.
- Validation: `node --test tests/*.cjs` passes **312/312** (17.4 s). Dedicated tests `tests/rail-crossings.test.cjs` passes **6/6**
  and `tests/rail-continuity.test.cjs` passes **5/5**. See the
  [observation record](observations/rail-grade-separation-2026-11-01.md).

## Authentic Poznań hejnał implemented

- Replaced the generic bugle call with the authentic melody of the Poznań Bugle Call (*Hejnał miasta Poznania*,
  official Annex to the Statute of the City of Poznań, *Uchwała Rady Miasta Poznania*) in `js/city-clock.js`.
- The call is transcribed into 14 notes across 3 natural bugle phrases on partials 4, 5, 6, 8 of the natural B♭ trumpet
  (116.54 Hz: B♭4, D5, F5, B♭5, sounding the C-E-G-C triad):
  * Phrase 1: C4 – E4 – G4 (fermata) – E4 – C4 (fermata)
  * Phrase 2: C4 – E4 – G4 – C5 (fermata) – G4
  * Phrase 3: E4 – C4 – E4 – G4 (fermata)
- Timing is calibrated (`beat = 0.20 s`, length 4.95 s, calls at 0.4 s and 5.5 s), ending at 10.45 s comfortably
  before the first goat head butt at 11.75 s (`GOAT_BUTT_TIMES[0]`).
- Audio buffer synthesis (`audio-events.js`) and audio pitch analysis verify that all held notes play within -4.5 to +1.7 cents
  of perfect harmonic pitch (tolerance ±20 cents).
- Validation: `tests/city-clock.test.cjs` passes **9/9**.

## Buildings inside park blocks with mapped structures implemented

- Allowed building generation on park blocks that contain mapped OSM buildings (`(b.park > 0.6 && !b.buildings) || b.median`
  guard in `js/buildings.js`), while keeping purely unmapped park blocks 100% green.
- Replaced whole-block park rejection in `parkFreeCells` for park blocks that have mapped buildings, allowing structures
  steered to the block's real density while preserving accurate colliders and green lawn perimeters.
- Whole-district building density now closely matches real-world measurements:
  * Sołacz: generated **8.8%** vs real **8.9%** (ratio 0.98, previously under-built at 6.7%)
  * Antoninek-Zieliniec-Kobylepole: generated **5.1%** vs real **6.6%** (ratio 0.78, previously 3.2%)
- Unmapped park blocks (100 blocks citywide) remain 100% unbuilt (`gen = 0 m²`).
- Validation: `tests/buildings-density.test.cjs` passes **5/5** (including new dedicated park block validation).

## Exact park polygon outlines for street furniture and trees implemented

- Extended exact park polygon checks (`exact = true` by default in `inPlaza` in `js/street-details.js`) from signal poles to
  all street furniture (LED streetlights, gas lamps, hydrants, postboxes, parking meters, bollards, kiosks, advertising
  columns, flower stands) and street trees.
- Previously, non-signal street furniture tested against the whole axis-aligned bounding box (AABB) of park blocks,
  which suppressed trees and curbside amenities across large swaths of sidewalks bordering extensive parks (e.g., Park Rataje
  covering 0.7 × 1.7 km, Cytadela).
- Added chord cut clearance guards for 3 turning curve locations on park borders (LED masts at (3191.5, 1609.5), (2522.4, 1006.9),
  (2115.2, 1908.0)) and curbside furniture on Park Rataje border (2027.8, 1970.1) where turning and dual-carriageway lanes
  sweep close to the curb.
- Net results citywide:
  * Restored **+4,004 street trees** (55,211 vs 51,207).
  * Restored **+4,639 non-signal street furniture footprints** (22,494 vs 17,855; including +3,376 LED masts, +48 gas lamps,
    +757 hydrants, +108 postboxes, +60 parking meters, +220 bollards, +34 columns, +23 flower stands, +13 kiosks).
  * Preserved **100.0% of drivable road network edges (8,512 / 8,512)** and **100% of vehicular travel lanes**.
  * Zero tram or rail clearance violations (**0 violations** across all 24,066 footprints).
- Validation: `tests/signal-placement.test.cjs` passes **2/2**; full test suite passes **313/313**.

## Passing waiting left-turners on single-lane approaches implemented

- **Left-turner positioning:** under Polish road rules (art. 22 ust. 2 PoRD), vehicles preparing to turn left on a two-way road now drift laterally towards the carriageway centreline (`targetDl` up to -0.85 m), leaving clearance on the curb side.
- **Passing on the right:** vehicles following on single-lane approaches (`lanes.length === 1`) intending to proceed straight or right steer towards the outer curb (`targetDl` up to +0.95 m) when sufficient curb clearance exists (`roomRight >= 2 * halfWidth + 0.08 m`).
- **Longitudinal clearance:** `clearsTurn` permits followers that have achieved lateral separation to continue without IDM braking for the stationary left-turner, capped at a safe passing speed of 20 km/h.
- **Connector clearance:** in `mayEnter`, straight-going vehicles are no longer refused with `'turner'` once the left-turner's connector clearance (`cs - half`) has passed the swept path of the follower's connector (`boxConflictEnd`).
- **Yielding threshold:** `yieldPoint` now permits single-lane approaches to pull forward up to the road centerline (`lat < 0`) rather than prematurely aborting on the curb side, eliminating unnecessary stop-line stalls.
- **Validation:** regression coverage added in `tests/traffic.test.cjs` (2 new tests); `tests/traffic-flow.test.mjs` passes with 0 deadlocks and 0 held over 120 s; full test suite passes **315/315**.

## Dedicated slit tram signals (sygnalizacja szczelinowa typ ST) implemented

- **Dedicated Polish ST tram signals:** modeled authentic 2-chamber heads with hoods and contrast backplates at all 189 track stop lines across Poznań (Kaponiera, Most Teatralny, Most Dworcowy, Rynek Jeżycki, Głogowska/Hetmańska, Św. Marcin, etc.).
- **Authentic visual aspects:** upper horizontal slit bar (`—`) lit white on red and red-amber (stop), lower vertical slit bar (`|`) lit white on green (proceed), lower vertical slit bar flashing white at 1.5 Hz on amber (clearance warning). Dark housing phantom slit display when unlit.
- **GPU phase synchronization:** wired directly into the city's shared `signalTexture` / `signalClock` via TSL shaders, with per-instance attribute indexing into the local junction timing plan. Group 0 (avenue) and Group 1 (street) signals match road phasing.
- **Colliders:** 3.8 m physical colliders for all signal poles keep tram clearances and register in player collision bounds.
- **Validation:** passes **317/317** tests (`node --test tests/*.cjs`) including dedicated unit and network integration tests.

## Registration plate font stack and balcony pool capacity implemented

- **Registration plate font stack:** added `PLATE_FONT_FAMILY` across `js/actor-models.js` and `js/controllers.js`, providing
  metric-compatible narrow sans-serif fallbacks for Linux (`"Liberation Sans Narrow"`, `"Nimbus Sans Narrow"`,
  `"DejaVu Sans Condensed"`), Android (`"Roboto Condensed"`, `sans-serif-condensed`), and Apple (`"DIN Alternate"`,
  `"Helvetica Neue Condensed"`). Prevents severe horizontal glyph squishing and line width distortion on systems
  without MS Core Fonts.
- **Balcony pool capacity audited:** verified citywide balcony stack streaming and LOD bounds across 16,510 stacks
  and 48,266 landings across 12,877 blocks. Peak streaming demand reaches at most 1,299 stacks within `STREAM_RADIUS = 560 m`
  (Jeżyce hotspot), leaving a comfortable 1,101-stack margin (45.9% free) below `MAX_STACKS = 2400` with 0 dropped stacks.
  Verified that high-density hotspots (Wilda, Łazarz, Rataje) saturate `MAX_NEAR_BALCONIES = 256` and gracefully push
  excess landings to far proxy boxes without buffer overflow.
- **Validation:** `node --test tests/*.cjs` passes **321/321** tests, including dedicated font stack and balcony capacity
  regressions in `tests/vehicle-models.test.cjs` and `tests/buildings-density.test.cjs`.

## Articulated 18 m bus and PSP fire truck implemented

- **Solaris Urbino 18 articulated bus:** added 18 m city bus (`BUS_18_SPEC` in `js/actor-models.js`, `js/traffic.js`):
  2 articulated sections (Section A: 10.4 m front cab with 2 axles, 2 double doors; Section B: 6.8 m rear pusher trailer with 1 axle, 2 double doors; 0.85 m bellows; 18.05 m total length).
  Authentic MPK Poznań green/yellow livery with separate destination sign matrix, 3 spinning wheel pairs (front steering, mid fixed, rear drive), dual contact shadows, and exact pusher trailer kinematics with rear axle tracking and bellows pitch/yaw articulation.
  Two-section physical SAT collision against the player vehicle, preventing clipping through either cab or trailer.
  Bus routes 174, 169, 151 run articulated 18 m buses, while route 164 retains rigid 12 m buses.
- **PSP fire service rescue truck (GCBA):** added authentic heavy rescue pumper (`BODY_SPECS.fireTruck` in `js/actor-models.js`, `js/traffic.js`):
  8.3 m length, 2.54 m width, 3.25 m height, 4.3 m wheelbase, 0.50 m heavy truck wheels.
  Features a dual crew cab, enclosed rear equipment body with 3-bay roller shutters (rendered via procedural TSL horizontal slats and compartment dividers), roof equipment boxes, water cannon monitor, roof ladder, front lightbar with dual blue beacons and rear upper corner blue strobe pods.
  Configured with authentic PSP livery paint, heavy diesel bus engine audio profile (`js/audio-sources.js`), and heavy vehicle mass ratio / collision impulse against player contact.
- **Validation:** `node --test tests/` passes **334/334** tests (including `tests/vehicle-models.test.cjs` and `tests/traffic.test.cjs` tests for 18 m bus dimensions, 4 doors, 3 axles, PSP truck specs, trailer kinematics with lag, and 2-section SAT collisions).

## Siemens Combino tram model implemented

- **Siemens Combino model:** added Poznań's third tram model (14 units delivered 2003–2004, fleet numbers 501–514)
  to `TRAM_MODELS` in `js/trams.js`: 5 articulated sections (8.25 m front cab with bogie, 4.4 m suspended link,
  5.6 m mid section with pantograph and bogie, 4.4 m suspended link, 8.25 m rear cab with bogie), 31.9 m total length,
  100% low floor. Distinctive rounded cab nose, authentic MPK Poznań green/yellow livery with curved front mask and
  round headlights in TSL material (`js/actor-models.js`). Tram pool updated to reflect real fleet proportions (~12% Combino,
  ~29% Tramino, ~58% Gamma).
- **Validation:** `node --test tests/*.cjs` passes **321/321** tests, including dedicated tram model regressions in
  `tests/trams.test.cjs`.

## Known gaps and follow-up investigations

| Topic | Remaining work | Original reference |
|---|---|---|
| Other missing signal heads | The current headless audit has 178 strict unmatched incoming edges: 25 map to a source arm already carrying a head, 11 map to an arm with a pole but no vehicle head, and 142 map to an arm whose original pole search found no spot. These are investigation categories, not a complete shared-approach/safe-site classification. Of the 11, eight active approaches now have a vehicle head on an existing left pole, two already have a same-phase head on the right, and one pedestrian signal is disabled after route configuration. Investigate the 25 and 142 using runtime geometry and turning-curve clearance. See [Signals](world.md#street-furniture-street-detailsjs). | 15.5 |
| Park bounding boxes | Resolved citywide. Exact park polygons (`exact = true`) are enabled for all street furniture and trees in `js/street-details.js`, restoring 4,004 street trees and 4,639 non-signal street furniture footprints while preserving 100% of drivable road network edges (8,512/8,512) and 0 rail clearance violations. | Follow-up |
| Sparse OSM blocks | Check the nine large blocks with under 5% mapped building coverage against BDOT10k; supplement only confirmed omissions. The original audit covered 0.69 km² and needs rechecking against the current enlarged box. Verify source terms before adding data. | 14.3 |
| Building accuracy | Replace estimated landmark heights and massing where supported by measurements; real building footprints/roof heights remain optional. Candidates include Ratusz, Fara, Zamek Królewski, Teatr Wielki, Brama Poznania, tower placements, Iglica and AND2. | 4.4, 7 |
| Tram route quality | Track continuity, tunnel preservation (PST, Franowo), the Św. Marcin – Ratajczaka curve, and universal 2.2875 m step elimination across junctions and islands are implemented. The 2026-11-03 headless run found 0 / 84,235 samples on other lines or unused track; the display timing fix reduced line 5 samples showing the return direction before the front reached its edge from 355 to 0 in the same benchmark. The historical 0.44% is not directly comparable; method and limits are in [Trams](actors.md#trams-jstramsjs) and [testing](testing.md#tram-route-membership-benchmark). | 15.10 |

## Decisions awaiting the user

None pending. Both historical open decisions were confirmed by the user on 2026-11-01 and implemented:
- **Buildings inside park blocks:** implemented (blocks with mapped OSM buildings generate structures steered to real density; unmapped blocks stay 100% green).
- **Real Poznań hejnał:** implemented (authentic statutory melody transcribed and synthesized in tune).

## Optional features and fidelity

- Trams: Siemens Combino is implemented (models are Gamma, Tramino, and Combino; visible white-bar ST tram signals are implemented; tunnel portals omitted). Tram control uses the shared local signal plans.
- Vehicles: articulated 18 m bus (Solaris Urbino 18) and PSP fire truck (heavy rescue pumper) are implemented;
  registration plate font stack on systems without Arial Narrow is implemented. Taxi crests and exact livery/marking fidelity require
  source verification before use.
- Street details: conditional S-2 arrows, pedestrian countdowns, P-22 BUS text with actual bus-lane data, a fourth
  tree species and real OSM tree positions.
- Traffic: passing a waiting left-turner on a wide single-lane approach is implemented (Łazarz at `−1875, 1299` and citywide). Kaponiera and Wilda retain substantial queues despite meeting the aggregate flow targets.
- Geodata semantics: road levels and richer road-priority classification; revisit only with a runtime consumer.
  Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data remain research candidates.

## Browser checks still outstanding

Full-scene smoke checks on 2026-10-30 confirmed boot and 60 rendered frames on both WebGPU and WebGL2, with
no console warnings or errors; the WebGL2 check also recorded no GL errors. The two-frame pedestrian probes
verified pose updates on both LODs. These checks do not establish detailed appearance, traffic correctness or
performance; see the [WebGL2 observation record](observations/webgl2-2026-10-30.md).
The static measurements refreshed on 2026-10-29 use the documented headless variants in [world.md](world.md)
and [actors.md](actors.md); they do not validate the full rendered scene or sound.

Partial signal/traffic observations on 2026-10-30 covered the full Chrome/WebGPU scene at Kaponiera (150.01 s),
Most Teatralny (150.01 s) and Głogowska/Hetmańska (194.76 s), in simulation time. Nearby shared signal states
recorded the vehicle phase pairs and steady green, flashing green and red pedestrian display states. The trace
also recorded pedestrian waiting/release and tram movement transitions, with rendered spot checks. Only two
ordinary uncommitted car entries were captured across the three locations, both on green; previously committed
and emergency entries were counted separately. This is limited traffic coverage, not a general compliance verdict.
Shared state does not prove visible head orientation/colour, and sampled tram views do not prove full-body rear
clearance.

A 2026-10-31 follow-up on the same commit (`369c21b`), Chrome/WebGPU, observed demand node `2422` at
`415.5, 523` for 145.0001 simulation seconds. Natural NPC requests produced three complete pedestrian service
cycles, with 20 s road-green intervals between them; all five recorded waiting-to-release transitions occurred
on WALK. Rendered spot checks showed NPCs on the zebra. This covers one demand crossing, not all demand plans
or visible-head correspondence. Remote cached-phase observations of Św. Marcin nodes `1671` and `1673` recorded
65 s periods and green0 starts 1.775–1.776 s apart, against 1.777175 s expected for 19.7464 m at 40 km/h.
This checks the shared phase offset of one pair; it does not establish full rendered corridor progression.
Broader demand coverage, the full Św. Marcin green wave, audio and WebGL2 junction behaviour remain open.
See the [signal observation record](observations/signals-2026-10-30.md) for setup, results and limits.

- Continue targeted signal and traffic checks at Kaponiera, Most Teatralny and Głogowska/Hetmańska, including
  visible head correspondence and WebGL2; extend NPC demand-request coverage beyond node `2422`, test the full
  rendered Św. Marcin green-wave corridor and crossing ticks against the displayed heads.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and
  return destinations and the Starołęka boundary routes.
- Geometry spot checks on 2026-10-31 confirmed continuous exposed rails without 0.22 m vertical steps at
  Rondo Kaponiera, Most Dworcowy / Dworzec, Most Uniwersytecki, Most Chrobrego and Św. Marcin – Ratajczaka
  (see the [tram tracks observation record](observations/tram-tracks-2026-10-31.md)). Continue inspecting
  landmark placement, scenic-camera sightlines, roof normals/ridges on rotated blocks, panel-material shimmer,
  balcony LOD transitions, and platform/slab flicker where their surfaces are only 1 cm apart.
- Check load time and frame rate over the enlarged detail box, roof/dormer coverage and pool limits, estate
  slabs and transitions to the outskirts. The balcony pool was close to its limit in the historical scan.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify their local timing and audible range.
- Verify map labels/pin clustering, English UI with Polish names and metric readings on both backends. The WebGL2
  draw-buffer error is fixed; detailed fallback appearance and performance checks remain.

For each implemented fix, record the before/after measurement, run the relevant regression checks, and state
which browser checks were actually performed. Keep unresolved items here rather than reopening archived phase notes.
