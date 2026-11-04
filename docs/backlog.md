# Poznań backlog

Updated 2026-11-04. The port and documentation cleanup are implemented; the remaining work is below.
Implementation details live in the [topic docs](../AGENTS.md#docs). Original phase numbers refer to the
[archived port plan](archive/poznan-plan.md), which retains historical measurements and decisions.

## Most Chrobrego tram deck fixed

The user reported that Most Bolesława Chrobrego is too narrow and its tram track overlaps the span/deck. The bridge links
carry 13 m of width, which includes the `TRAM_W` 6.5 m tram strip from `tools/poz-roads.mjs` (not a PIM dimension; the
rebuilt tram formation is at least 7 m), but `bridges.js` put the structure's centre on the roadway axis. The merged
road/tram width is 13.34 m; with the two footways the deck is **17.14 m**, half 8.57 m, the parapet centre 8.45 m and
the arch ribs/hangers 9.27 m. The tracks sit 1.36–4.43 m to the tram side, so their 1.2 m envelopes reached about
**9.0 m**: past the deck edge, through the parapet and into the rib line. `bridgeStructures` now shifts a tram link's
lateral extent to the strip's side (the land-raster capsule follows the same offset). Headless on the water run, the
envelopes reach 5.63 m: **2.94 m** clear of the deck edge, **2.60 m** clear of the parapet's inner face and **3.14 m**
clear of the arch ribs and hangers.

The same rule changes the other split bridges. A median tram strip had been counted on both sides of the centreline, so
each structure used to overhang 3.25 m past both outer curbs and now loses **6.5 m** (road/tram width, before the 1.9 m
footways): Most Świętego Rocha 20.43 → 13.93 m, Most Królowej Jadwigi 23.02 → 16.52 m, Most Mieszka I 25.74 → 19.24 m,
ul. Wyszyńskiego 25.62 → 19.12 m, Most Dworcowy main 34.33 → 27.83 m, Wiadukt Dolna Wilda 32.93 → 26.43 m and Wiadukt
Hetmański 34.04 → 27.54 m. It also shifts Most Chrobrego, both Most Uniwersytecki pieces and the 13 m Most Dworcowy
approach by 3.25 m; that approach is an overpass, so it draws no deck or parapets. Most Teatralny, Most Lecha, Mosty
Berdychowskie, Most Jordana and Kładka Bramy Poznania are unchanged. Lane placement and traffic are unchanged, and the
geodata and tram graph are untouched; the lanes still fit the narrowed decks, the new regression checking Rocha,
Królowej Jadwigi and Mieszka I. ul. Wyszyńskiego is tightest, its 1.2 m lane envelope reaching 0.04 m past the curb.

The current OSM snapshot (2026-10-28) is from the reconstruction under way, so it keeps one two-way link and the closed
(razed/disused) track ways. The rebuilt bridge's official section is not that single link: PIM's 2020 design guidelines
give a 6.50 m carriageway (2 × 3.25 m lanes), a tram formation of at least 7.00 m, 2.00 m footways and 2.00 m cycle
paths, with a 4 m footway on the south side; PIM and MPK (2025–2026) describe the rebuilt crossing as two road bridges
plus a separate tram bridge, retaining two lanes in each direction with cycle paths and footways on both sides. The
2025–2028 works are not a 2023 reopening. Sources: PIM tender guidelines as reported by
[Czas na Poznań](https://czasnapoznan.pl/most-chrobrego-przebudowa-projekt-przetarg/), PIM/MPK statements
([PIM](https://pim.poznan.pl/aktualnosci/informacje-biezace/przetarg-na-przebudowe-mostu-chrobrego),
[MPK](https://www.mpk.poznan.pl/zbliza-sie-przebudowa-mostu-chrobrego-najwazniejsze-informacje-na-temat-inwestycji/),
[PIM Q&A](https://www.pim.poznan.pl/most-chrobrego-pytania-i-odpowiedzi)) and the PIM 2025 presentation
([PDF](https://pim.poznan.pl/system/files/aktualnosci/prezentacja-most-chrobrego-8-pazdziernika.pdf)). Browser checks remain:
Most Chrobrego from the bank and from a tram; how the narrowed Most Świętego Rocha, Most Królowej Jadwigi and Most
Mieszka I decks look; and the 13 m Most Dworcowy approach. Regression:
`tests/track-parapets-crossings.test.cjs`.

## Tree-building clearance implemented

The user reported buildings overlapping trees. 41 park blocks with buildings were built over completely on top of
their park trees and paving, and street trees never checked building colliders. Park blocks with buildings now build
only on cells clear of their parks (`parkFreeCells`), and every tree keeps its trunk at least its crown radius from
any building, landmark or bridge wall, with BS 5837:2012 Table A.1 floors of 1.2 m (large) and 0.5 m (narrow-street
trees); street trees that fail slide along the curb before being dropped. Headless: 55,381 → 50,019 trees, trunks
inside walls 1,721 → 0, crowns overlapping walls 4,062 → 0, no orphan trunk colliders. The 41 blocks build 3.46% of
their area against 4.39% real (6.64% before). Park paving is still drawn under their buildings; three planter boxes
lost their trees and stand empty. Browser checks remain. Details:
[observation record](observations/tree-building-clearance-2026-11-03.md).

## Street-tree player colliders implemented

The user reported that the player walks through the street trees on ulica Rybaki's sidewalk next to the curb. Street
trees were the only tree type without player colliders: city-grid.js gave park and plaza trunks colliders, but
street-details.js placed its curb-side street trees without them. Each street tree now gets a trunk collider like the
park ones (`0.56 × scale` m wide, `3.0 m` above its base), kept out of the traffic footprints so lanes, sidewalk
links and pedestrian routes are unchanged. Headless citywide measurement: **18,112 street trees had 0 colliders
before and all 18,112 now have one**; Rybaki's 9 trees are all covered (8 at the curb, about 0.9 m behind it; 1 at
6.8 m from the centreline). The 18,152 in the test build includes 40 trees near landmarks or bridges that the full
audit build drops. Park/plaza trees keep their city-grid colliders. Browser check remains: walk and drive into a
Rybaki tree. Details: [world.md](world.md#street-furniture-street-detailsjs) "Player colliders".

## Tram-stop shelter colliders fixed

The user reported the player blocked behind a tram shelter, well before reaching the glass back wall. The stop furniture
colliders were world AABBs, not oriented boxes: the boxes stand turned with the track. On the 139 diagonal shelters the
AABB's local depth became `hx + hz`, up to **2.28 m past the glass** (and 0.60–0.63 m past the roof ends). Shelters,
signs and machines now use `obb` colliders. The shelter's back face keeps **0.080 m** behind the glass at local
z = −0.62 and its ends match the end panel / advert at len/2 across the 209 shelters (island 3.2/4.4 and curb 4.4 in
the current data; a synthetic case covers curb 3.2); the longer roof is above player height. The ticket machine collider
now matches its 0.62 × 0.48 m top cap; the sign keeps its 0.08 m pole box because the 0.82 m plate is above the player.
The front stops at +0.7 m just past the front posts and inside the 0.8 m roof edge (the bench fills the back half, so
the open side stays blocked), as explained in the build comment. `tests/tram-infra.test.cjs` probes the built colliders
with controllers.js's collision logic: 0.3 m behind a diagonal shelter's glass is free, the glass plane and inside block,
and the end panel frees 0.1 m beyond its face; it also checks the real and synthetic furniture dimensions. Browser check
remains: walk and drive round a diagonal stop (Dworzec Zachodni or Żniwna) and confirm the back no longer pushes roughly
2 m early. Details: [world.md](world.md#tram-infrastructure) "Furniture".

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
  keep the paint visible. The headless furnished-network regression finds **0 m²** of overlap between emitted zebra
  quads and ballast beds. Disabling the rail cuts provides a positive control.
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
| Other missing signal heads | Runtime geometric audit of 167 historical unmatched edges: with up to 300 sampled sites, A/B/C/D before/after placement is **17/74/66/10 → 91/0/66/10**; vehicle heads **903 → 979**, pedestrian heads **1,572 → 1,572**, with six existing and 70 new poles (the previous placement with 60-site sampling: 17/27/113/10 → 47/0/110/10, 933 vehicle heads). Short-circuiting candidate checks reduced runtime placement from 3.52 to 2.89 s; a throwaway exploration of extra positions (0..+6 m forward, medians, arm-aligned reuse) unlocked no Category C edges. C means the sampled sites failed; investigate other positions and visually verify visibility. The fixture omits building, landmark and bridge colliders, which the browser supplies, so actual counts can differ. Run `node tools/audit-signal-heads.mjs`; see [Signals](world.md#street-furniture-street-detailsjs). | 15.5 |
| Park bounding boxes | Resolved citywide. Exact park polygons (`exact = true`) are enabled for all street furniture and trees in `js/street-details.js`, restoring 4,004 street trees and 4,639 non-signal street furniture footprints while preserving 100% of drivable road network edges (8,512/8,512) and 0 rail clearance violations. | Follow-up |
| Sparse OSM blocks | Resolved 2026-11-04. Re-audited every block ≥ 2 ha with under 5% OSM building coverage over the current detail box (36 blocks, 7.96 km²) against BDOT10k `OT_BUBD_A` for powiat 3064 and GUGiK orthophotos. No omission was confirmed: BDOT coverage exceeds OSM by at most 0.08 pp, and all sparse blocks are parks, cemeteries, forest, meadows, allotments, brownfield, a railway buffer or a car park. No supplement added; `js/geodata.js` unchanged. Source terms and the per-block table are in [observations/sparse-blocks-2026-11-04.md](observations/sparse-blocks-2026-11-04.md). | 14.3 |
| Building accuracy | Sourced landmark heights calibrated (audit record: [observations/landmark-heights-2026-11-03.md](observations/landmark-heights-2026-11-03.md); tests: `tests/landmark-heights.test.cjs`). Corrected: Iglica (70 m), Delta (43.5 m), Brama Poznania (16.3 m), Zamek Królewski terrace (30 m), Fara nave ridge (40 → 37 m, overall top 40 m) and Teatr Wielki fly tower (27 → 31.7 m), both from GUGiK NMPT − NMT; Novotel (68 m, CTBUH/Urbanity) is now sourced too. All three former "no source" entries are closed. Remaining sub-heights (e.g. Fara front statues, Teatr pediment/Pegasus) stay estimates. | 4.4, 7 |
| Merge starvation | The short-exit reservation now considers a waiting red approach only when the green entrant is predicted to encounter a non-green downstream signal; a long-held follower at adjacent signals can also close up behind its own lane lead. At current HEAD, Centrum seed 1 longest hold / held over 60 s / over 120 s is **166 / 1 / 1 → 63 / 2 / 0**; seed 4242 is **88 / 5 / 0 → 85 / 4 / 0**, still above the original 66 s target. The historical 181 s merge-braking hold is reduced. For seed 7, the merge junction at `−1117, 132` drops from 185 to 72 s; the district's new 91 s peak is at `−1136, 127`. See the comparison below. | Follow-up |
| Short-link left-turn phase | Partially improved: a tram that can stop at its clearance gate no longer reserves beyond it on a short signal approach; its body remains reserved. The guarded change reduces Centrum seed 99 longest hold / cars held over 60 s / over 120 s **176 / 8 / 5 → 110 / 5 / 0**, but long holds remain. See the comparison and trace below. | Follow-up |
| Car–tram body overlaps | Partially fixed: a tram stopped before a road conflict waits for a car committed to it before restarting, Półwiejska's southbound inner lane keeps clear of the opposing track, a bus longer than the next link yields to a tram close to that link's next curve, and an oncoming car is no longer exempt from a held curve just because it projects ahead of the tram's nose (the Stare Miasto hotspot). Against HEAD `313bb33`, over seeds 1 / 4242 / 7 / 99 / 2 / 3 / 5 / 11 and all seven districts, `tools/audit-tram-overlaps.mjs` finds **65 → 52** pairs, deadlocks **0 → 0**, and cars held over 60 s / over 120 s **183 / 9 → 183 / 9**; the mean longest hold moves 441.3 → 443.4 s (Centrum +3.2 s, Kaponiera unchanged). Stare Miasto goes 26 → 14 pairs; Kaponiera stays at 10. Remaining: the short-link blind spot for cars at Kaponiera and Centrum (the generic high-speed `enter` fallback; forecast and hard-stop variants all raised Kaponiera to 134–153 s and up to 4 deadlocks), cars stopped in the tram envelope (27, mostly Jeżyce buses), and the other 60 opposing close lanes from `tools/audit-tram-opposing-lanes.mjs`. Details, mechanisms and rejected variants: [observations/tram-overlaps-2026-11-04.md](observations/tram-overlaps-2026-11-04.md). | Follow-up |
| Tram route quality | Track continuity, tunnel preservation (PST, Franowo), the Św. Marcin – Ratajczaka curve, and universal 2.2875 m step elimination across junctions and islands are implemented. The 2026-11-03 headless run found 0 / 84,235 samples on other lines or unused track; the display timing fix reduced line 5 samples showing the return direction before the front reached its edge from 355 to 0 in the same benchmark. The historical 0.44% is not directly comparable; method and limits are in [Trams](actors.md#trams-jstramsjs) and [testing](testing.md#tram-route-membership-benchmark). | 15.10 |
| Park blocks with buildings | After the 2026-11-03 carve-out, park paving, granite beds and lawn are still drawn over the whole block under its buildings; the three planter boxes whose trees the wall rule dropped (Domki Budnicze, Stary Browar) stand empty; the 41 blocks build 3.46% against 4.39% real, partly because real buildings inside the park rings are carved out. | Follow-up |
| Street-tree placement clearances | Street trees were never checked by `clearOfCrosswalks`; now that they are solid, 652 trunks stand in crosswalk landing zones, 5 overlap a zebra's painted area, 31 are within 1.2 m of a car-lane centreline (as close as 0.16 m; e.g. (2044, 1701.6), (1388, 957.1); lanes over curb islands, mostly Rataje and Żegrze) and 8 have a corner off the curb island at the city edges (x ≈ ±3,100-3,600). Fixing it means re-placing trees, which changes the tree layout and test hashes. | Follow-up |

Merge benchmark, five minutes per district at 15 fps: each entry is longest hold in seconds / cars held over 60 s /
cars held over 120 s, before → after. Dashes mark districts not measured for that seed. Current HEAD is after traffic
commits `1e6a8b5`, `89f2fee`, `cf797ed`, `759e06e`, `29d72c8`, `64b802c` and `284d4bc`; the earlier `dedac97`
baselines of 181 s (seed 1) and 66 s (seed 4242) differ because the simulation changed, not because of Node.
At the Centrum junction, the seed 1 stopped-car root causes changed from 53% merge at `dedac97` to 75% signal at
current HEAD. Replaying the original historical car with the revised logic reduced its maximum stop from 181 s to
about 114 s and it entered the junction; historical seed 4242 changed from 66 s / 2 / 0 to 63 s / 3 / 0. This does
not establish that all merge starvation is eliminated. The rejected early-arrival rule remains removed: on `dedac97`
it raised seed 4242 to 125 s even with the narrower reservation. A lane-lead braking relaxation was also rejected:
it changed current seed 4242 Kaponiera from 140 to 237 s. Current Centrum seed 4242 remains above the original 66 s
target. The historical seed 99 district peak of 176 s was the separate left-turn signal hold described above, not merge starvation.

| District | Seed 1 | Seed 4242 | Seed 7 | Seed 99 |
|---|---|---|---|---|
| Jeżyce | 64 / 2 / 0 → 64 / 2 / 0 | 71 / 1 / 0 → 71 / 1 / 0 | 67 / 2 / 0 → 67 / 2 / 0 | 82 / 2 / 0 → 82 / 2 / 0 |
| Łazarz | 33 / 0 / 0 → 33 / 0 / 0 | 29 / 0 / 0 → 29 / 0 / 0 | — | — |
| Centrum | 166 / 1 / 1 → 63 / 2 / 0 | 88 / 5 / 0 → 85 / 4 / 0 | 185 / 11 / 2 → 91 / 5 / 0 | 187 / 9 / 6 → 176 / 8 / 5 |
| Rondo Kaponiera | 160 / 29 / 5 → 160 / 29 / 5 | 140 / 24 / 1 → 140 / 18 / 1 | 133 / 19 / 1 → 133 / 19 / 1 | 103 / 22 / 0 → 103 / 22 / 0 |
| Stare Miasto | 43 / 0 / 0 → 43 / 0 / 0 | 27 / 0 / 0 → 27 / 0 / 0 | — | — |
| Rataje | 46 / 0 / 0 → 46 / 0 / 0 | 186 / 2 / 2 → 186 / 2 / 2 | — | — |
| Wilda | 42 / 0 / 0 → 42 / 0 / 0 | 38 / 0 / 0 → 38 / 0 / 0 | — | — |

Short-link clearance-gate comparison, five minutes per district at 15 fps, Node 26.13.0. The unguarded and guarded runs produced identical district summaries. Entries are longest hold / cars held over 60 s / cars held over 120 s, before → after. Unlike the historical merge table, all four seeds were replayed for every district.

| District | Seed 1 | Seed 4242 | Seed 7 | Seed 99 |
|---|---|---|---|---|
| Jeżyce (Rynek Jeżycki) | 64 / 2 / 0 → 64 / 2 / 0 | 71 / 1 / 0 → 71 / 1 / 0 | 67 / 2 / 0 → 67 / 2 / 0 | 82 / 2 / 0 → 82 / 2 / 0 |
| Łazarz (Głogowska) | 33 / 0 / 0 → 33 / 0 / 0 | 29 / 0 / 0 → 29 / 0 / 0 | 46 / 0 / 0 → 46 / 0 / 0 | 39 / 0 / 0 → 39 / 0 / 0 |
| Centrum (Św. Marcin) | 63 / 2 / 0 → 56 / 0 / 0 | 85 / 4 / 0 → 85 / 4 / 0 | 91 / 5 / 0 → 91 / 4 / 0 | 176 / 8 / 5 → 110 / 5 / 0 |
| Rondo Kaponiera | 160 / 29 / 5 → 133 / 27 / 4 | 140 / 18 / 1 → 98 / 13 / 0 | 133 / 19 / 1 → 133 / 19 / 1 | 103 / 22 / 0 → 103 / 22 / 0 |
| Stare Miasto | 43 / 0 / 0 → 43 / 0 / 0 | 27 / 0 / 0 → 27 / 0 / 0 | 17 / 0 / 0 → 17 / 0 / 0 | 32 / 0 / 0 → 32 / 0 / 0 |
| Rataje (Rondo Rataje) | 46 / 0 / 0 → 46 / 0 / 0 | 186 / 2 / 2 → 186 / 2 / 2 | 49 / 0 / 0 → 49 / 0 / 0 | 52 / 0 / 0 → 52 / 0 / 0 |
| Wilda | 42 / 0 / 0 → 42 / 0 / 0 | 38 / 0 / 0 → 38 / 0 / 0 | 41 / 0 / 0 → 41 / 0 / 0 | 41 / 0 / 0 → 41 / 0 / 0 |

In both the original unguarded experiment and the guarded replay, Kaponiera seed 1 exposed a car–tram mutual wait: deadlocks
**0 → 1**. At 300 s, tram 2 (line 2) has waited 70 s for car 16, while that car waits for `tram` at the unsignalised
node `−1496, 82` on a 16.9 m approach. This divergence exposes an existing mutual-wait behavior. In that run, the
maximum wait at `−1136, 127` rose **60 → 108 s**. The table above also describes the guarded replay.

The three hold metrics do not worsen in these runs. Finished-wait p90 does rise in Kaponiera seed 1 (47 → 50 s),
Centrum seed 7 (27 → 28 s), and Centrum seed 99 (20 → 22 s); it falls in Kaponiera seed 4242 (52 → 48 s) and
Centrum seed 4242 (27 → 26 s). These simulations can diverge after the changed crossing.

The [per-second tram trace](observations/left-turn-tram-2026-11-04.md) records the two original green phases,
reservation and body-occupancy times, and the timetable context.

## Decisions awaiting the user

- **Overhead or far-side signal heads:** 66 historical approaches remain in audit class C because no curbside pole
  site near the stop line clears the lanes, curves, landings and rails (a throwaway search of 0..+6 m beyond the line,
  medians and arm-aligned pole reuse unlocked none). A head on a mast arm over the roadway (nad jezdnią) or on the far
  corner would need a new mounting type and model; awaiting the user's decision.

Both historical open decisions were confirmed by the user on 2026-11-01 and implemented:
- **Buildings inside park blocks:** implemented (blocks with mapped OSM buildings generate structures steered to real density; unmapped blocks stay 100% green).
- **Real Poznań hejnał:** implemented (authentic statutory melody transcribed and synthesized in tune).

## Optional features and fidelity

- Trams: Siemens Combino is implemented (models are Gamma, Tramino, and Combino; dedicated tram signal heads and tunnel portals omitted). Tram control uses the shared local signal plans.
- Vehicles: articulated 18 m bus (Solaris Urbino 18) and PSP fire truck (heavy rescue pumper) are implemented;
  registration plate font stack on systems without Arial Narrow is implemented. Taxi crests and exact livery/marking fidelity require
  source verification before use.
- Street details: real OSM tree positions.
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
- 2026-11-03 changes, all verified headless only: park lamps along ulica Za Cytadelą and the lamps stepped onto the
  lawn in narrow-walk parks (e.g. block 212 near `−953, −1928`); trees by Avenida and in park blocks with buildings
  (Park Nad Wartą, Antoninek block 874); the corrected Iglica, Delta, Brama Poznania and Zamek Królewski heights.

For each implemented fix, record the before/after measurement, run the relevant regression checks, and state
which browser checks were actually performed. Keep unresolved items here rather than reopening archived phase notes.

## P-22 BUS lane markings (2026-11-03)

Implemented from positional OSM bus/PSV lane tags. The furnished headless network has 27 inscriptions on 14 OSM
ways, over 0.764 km of eligible directional lane segments. Among 71 source ways with `designated` positions, 29
have mismatched runtime lane counts, five are too short for a mark and 23 have no retained paint edge. Count-only,
turn-only and contraflow tags do not create markings; see [geodata.md](geodata.md) for the source counts and
[world.md](world.md) for clearance and measurement scope. Browser appearance and WebGPU/WebGL2 checks remain open.

## Fourth tree species implemented

Black locust joins lime, Norway maple and horse chestnut using a deterministic 4% site reassignment; see
[Trees](world.md) for the inventory snapshot, model and mesh cost. In the full headless grid → buildings →
street-details build, counts are lime 21,647 → 20,759, maple 23,712 → 22,767, chestnut 10,022 → 9,606 and
locust 0 → 2,249 (55,381 total). Site and collider snapshots are unchanged. Browser checks of the new foliage,
bark, LOD and wind remain outstanding.

## Streetlight curb clearance fixed (2026-11-03)

The user reported lamps standing on the curb along ulica Za Cytadelą. These were city-grid.js park lampposts, placed
on the vertices of the park walk slab inset only 0.1 m from the curb, so their 0.2 m cast bases overhung it: 2,242 of
2,281 park lamps citywide, 23 of them along the Za Cytadelą park side. Park lamps now stand on a line 1.05 m inside the
curb; where narrow walks (bed insets 0.1–0.8 m) put that line in the lawn bed, the lamp steps up to 2.5 m inward onto
the lawn, 0.5 m past the coping and 2.5 m from park trees, so no park loses all its lamps. Five square lamps in narrow
plaza strips and six street-details poles on narrow wedges and tram cuts also moved. The 0.5 m minimum from the curb
face to the pole surface is a design choice, not a statutory figure.

Headless measurement against the drawn curb (`tools/audit-lamp-curb.mjs`, pole surface clearance): park lamps
2,281 → 2,332 (with the tree clearance change), under 0.5 m 2,250 → 0 (worst −0.16 → 0.53 m), about 130 on the
lawn; Za Cytadelą park side 22 lamps at 0.87–0.90 m; square lamps 642, under 0.5 m 5 → 0; street-details 15,645
(2,059 main, 12,512 side, 1,074 gas), under 0.5 m 5 → 0. Park and square lamps are player colliders only; the strongly
connected network is unchanged at 8,509 edges / 424.641 km. `tests/streetlight-curb-clearance.test.cjs` covers all
lamp types. Browser appearance remains unverified.
