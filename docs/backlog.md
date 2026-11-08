# Poznań backlog

Updated 2026-11-08. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap remnants:** resolved 2026-11-08. The physical-line and inset-lane follow-ups are in; the last
  three remnants now have fixes. Connector legs (corner links, wide-corner and fallback connectors) are keyed by the
  physical line they land on (`physicalLine`), and projection sub-tracks inherit the parent sidewalk's key, so spans
  onto one line queue together instead of stacking on the 11.8 m Droga Dębińska link. Conversations need `MEET_CLEAR`
  0.65 m of clear space around both partners (checked against every placed body on a reused 2 m grid). The 20 s
  recovery is still postponed in `nearView`, but only to `PED_STUCK_VIEW_TIME` 30 s; the crossing-wait exemption and
  the leader merge yield now apply only at the curb (next leg a crosswalk within 2 × `QUEUE_GAP`), not to a body
  20 m back on an approach. On the eight-district audit (seeds 4242/77, 3 min) clusters fall **2 → 1**, longest
  **18 → 7 s**, biggest **5 → 5**, overlapping pairs/s **4.41 → 4.84**, crosswalk entries **116.7 → 118.3/min**;
  Wilda has no cluster in either seed and the Kaponiera 11 s / 4-body cluster is gone. The remaining cluster is 7 s /
  5 at the Most Dworcowy short-link/curb knot. `bench-traffic.mjs --ped-rooms` falls to **23,660 → 21,829 ped-s**
  (-7.7%) of about 642,800 sampled, longest hold 20.1 s. `tests/ped-overlaps.test.cjs` covers the view limit, the
  meeting clearance and the connector line key; `node --test tests/*.cjs` passes 446.
  [Mechanisms and results](observations/ped-overlap-remnants-2026-11-08.md),
  [earlier phases](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-07-direction-specific-inset-lanes).
- **Isolated crosswalk landings:** resolved 2026-11-08. Stage 3 split every road-edge sidewalk line into its
  clear same-block runs, indexed every sidewalk-track end by block (`curbPorts`), and gave a tram-cut island or median
  with no run at the landing a short kerb spur (≤ 6 m, `landing: true`). Stage 4 adds a third connector tier,
  `curbStepPaths`: a landing may step to a kerb end on its own block up to 32 m away when `baseLinks` and the fallback
  both found nothing. It keeps the same block and walkable ground along the connector, the `edge.half + 0.8 m` lane
  margin, `RAIL_KEEP` 2 m and every building collider; only the 2 m lot envelope is dropped, because it covers the
  sidewalk the step runs along. On the 2026-11-08 headless benchmark empty ends fall **47 → 24** and tracks with an
  empty end **41 → 24** (23 kerb-step ends, 144 legs, 0 lane/rail/building hits, longest 31.9 m); `siblingLinks` stays
  0, fallback legs stay 87/574, spurs fall 5/4 → 3/3 and the closest spur sample rises 2.48 → 3.22 m. The bare
  network falls 38/33 → 11/11. The production full-scene pass (`--full`: 118 landmark + 33,487 building + 194 bridge
  colliders and the real city-grid curbs) has 2,397 crosswalks and moves **32/27 → 18/18** with 14 kerb-step ends,
  68 legs and 0 hits; the lower absolute count is the curbs putting some arms out of `CROSSWALK_REACH`. The remaining
  24 benchmark / 18 full-scene ends are genuine roadway cases (a lane, a rail, a wall or non-walkable ground between
  the landing and every kerb end); a 40 m `FALLBACK_MAX` still adds only 2 ends, so 32 stays.
  [Routing observations](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-08-same-block-kerb-steps-and-the-production-full-scene-count).
- **Other missing signal heads (15.5):** the widened overhead search and the span-wire fallback now serve 75
  approaches: 48 cantilever heads (16 new 6.2 m masts, 32 reused poles) and 27 span heads (25 new 10 m masts,
  28 reused anchors; 18 span heads use at least one new mast and 9 sit entirely on existing supports). The furnished
  audit is **157/0/0/10** after placement (from 114/0/43/10), and vehicle heads rise **1,001 → 1,044**. Ordinary
  span stays meet 10 m above the head, above the 7.6 m tram poles, 9.6 m railway portal masts and 8.9 m portal
  beams; every foot, head and cantilever arm keeps **3.1 m** from the real tram poles and railway masts (checked in
  `tests/signal-placement.test.cjs`), the head and anchors keep **2.22 m** from every track axis, and a new span
  mast keeps 3.1 m from every track. The head may slide up to 1.5 m across its lane to clear a track. The last C at
  **Górna Wilda** (`-448.8, 947.4`, approach `0.480, -0.877`) now hangs from the two existing 7.6 m traction poles
  5.0 / 12.9 m from the head: the stays meet at 7.2 m, above the 6.6 m tram span wires, and the head keeps 2.69 m
  from the curved track on the clear side of the shared carriageway (a 3.0 m slide; no new mast, footprint or
  collider). Run `node tools/audit-signal-heads.mjs`; the fixture omits building, landmark and bridge colliders.
  [Measurements](observations/missing-signal-heads-2026-11-08.md),
  [placement](world.md#street-furniture-street-detailsjs).
- **Building accuracy (4.4, 7):** resolved 2026-11-08. The Fara front gable/cross and the Teatr Wielki
  portico/Pegasus use GUGiK NMPT − NMT sub-heights; the four lower-tier Fara niche statues now carry their parish
  identities, 2.18–2.36 m figures on 0.77 m pedestals in 3.33 m niche openings (4.09 m aediculae) at the 5.8 m and
  10.85 m bay centres, with the outer pair 2.1 m higher over the tall side windows. The central St Ignatius and the
  upper-tier Borgia/Xavier stay outside the four-statue set.
  [Height audit](observations/landmark-heights-2026-11-03.md#2026-11-08--fara-niche-statues).
- **Building density follow-up (Bukowska, hospital/academic grounds):** the campus profile and graduated core are in
  (2026-11-07) and the 2026-11-08 WebGPU/WebGL2 review is complete: blocks 664, 575, 425 and 474 sit within ±20 % of
  their OSM built share, and 805/1119 land near 20/18 %. The campus alley grid and `campusShed` supply the interior
  structure, so unnamed `highway=service` cuts stay dropped; the 8-lot `maskRects` cap is not on the path of the
  27 `program > 0` blocks of at least 5 ha, which all use frontage frames (raising the frame caps 12/10 to 18/16 changes
  8 of 27 sets and the coverage by -0.65 to +1.14 pp; above 18/16 there is no change), and OSM vs BDOT10k is closed for
  this snapshot. **Western edge, Etap 1: resolved 2026-11-08.** Etap 1 reached x = −5,250 (16.85686 E), so King
  Cross Marcelin (block 1475, mall anchor, 4 storeys) and Business Garden (block 1492, programme 9 office campus) are
  generated in detail; the merge kept the core frozen and the full suite passes 470/470. **Etap 2 (Ławica) resolved
  2026-11-08:** the box now reaches x = −9,120 (16.800 E); `poz_aeroway.json` feeds `GEO.aeroway`, `poz-blocks.mjs`
  clears the 2.81 km² aerodrome from the block raster, and `js/airport.js` draws the 10/28 runway, 83 taxiways,
  22 aprons, 7 terminals and 3 helipads with markings and lights. The full suite passes 471/471. Feasibility and the
  staged plan are in [the west-expansion study](observations/detailbox-west-expansion-2026-11-08.md); what shipped is
  in [the Etap 1 record](observations/detailbox-west-phase1-2026-11-08.md) and
  [the Etap 2 record](observations/detailbox-west-phase2-2026-11-08.md).
  [Density record and measurements](observations/building-density-2026-11-07.md#follow-up-2026-11-08-visual-review-lot-cap-and-service-alleys),
  [sparse-block BDOT audit](observations/sparse-blocks-2026-11-04.md),
  [Density test harness](tests/buildings-density.test.cjs),
  [Phase 14 archive](archive/poznan-plan.md#phase-14-real-building-density-from-osm).
- **Central density (2026-11-08):** the 190 central blocks (Stare Miasto, Jeżyce, Łazarz, Wilda) at least 35% built
  in OSM now generate 43.7% against 45.3% real (was 43.2% after the first pass and 40.3% before it), and blocks below
  75% of their real share fall 49 → 44. The named blocks moved: 708 35.4 → 39.7%, 688 37.3 → 39.9%, 836 42.1 → 44.8%
  and 1365 40.0 → 45.5%; 801 stayed 35.8%. Deep frontage lots now use up to 48 m, dense cores count from 8 m, rear
  rows stand on 7–9 m wells and dense courtyards get transverse oficyny. The 2026-11-08 office-courtyard follow-up
  now fills the office interiors too: 868 33.4 → 48.2%, 814 26.4 → 32.0%, 769 40.2 → 47.8%, 752 47.7 → 53.1% and
  695 35.5 → 41.2%; the 32 office-reach blocks move 26.8 → 30.9% against 37.4% real, Stare Miasto's 84-block subset
  39.5 → 40.8% against 48.4%, and the whole district 28.6 → 29.2% against 30.0%. `officeBlock` now builds mid-depth
  slabs down to a rear service yard, atrium lit floorplates and U/ring/H/L/parallel office cores on a
  `srcBuiltArea` budget, with 12 m+ courts, glazed links and low conference pavilions; blocks already over their OSM
  share (593, 786, 938/939 and 733) keep their plazas. 816 stays at 14.8% because its post-park buildable area is
  2.26 ha (20.7% of the island) and the Stary Browar is a landmark model, not generic stock. Remaining: 575
  (Collegium Maius) and 801 (46.5% lot-rect coverage) are landmark/fragmentation ceilings; Jeżyce and Łazarz still
  sit above their whole-district OSM share (1.19× / 1.20×), so a later pass should thin already-built blocks rather
  than add more. Browser checks were WebGPU (Apple `metal-3`) and WebGL2 on the automatic drone and the Bałtyk /
  Stary Rynek cameras; no curb or sidewalk overlap, missing facade or z-fighting were seen and no console error was
  logged. [Measurements, code changes and the office geometry audit](observations/office-courtyards-2026-11-08.md),
  [first central-density pass](observations/central-density-2026-11-08.md).
- **Non-residential building coverage and specialized profiles (2026-11-08 audit):** the comprehensive audit
  (`tools/audit-nonresidential.mjs`, [record](observations/non-residential-audit-2026-11-08.md)) revealed that
  almost all missing non-residential buildings stem from morphology replacement (shopping malls, industrial halls,
  railway depots and stadiums being turned into generic kamienice, villas or panel estates by district fallback)
  rather than empty blocks. Only two blocks ≥ 1,500 m² generate 0 m²: block 1248 (Głogowska tram depot hall cut by
  railway landuse) and block 573 (Collegium Maius landmark reserve; both ids after the west expansion). In-box: 31 large objects (9.3 ha) have 0%
  coverage and 211 (74.0 ha footprint) only partial/fragmented coverage. 34 large objects (29.8 ha) sit outside the
  detail box (Pestka, Makro, Plaza, Karolin, M1, IKEA, Selgros, Franowo, VW Antoninek). The audit's outstanding work:
  1. *Specialized building profiles* (done 2026-11-08): `MALL`, `RETAIL_PARK`, `INDUSTRIAL_HALL`, `DEPOT`,
     `STADIUM`, `ARENA` and `UTILITY` now have layouts, `KIND_SHARE` weights, a morphology classifier and site
     anchors in `js/buildings.js`; Posnania, Castorama and ZNTK are low halls (see
     [record](observations/building-profiles-nonres-2026-11-08.md)).
  2. *Dominant block program in `GEO.blockStats`* (done 2026-11-08): `buildingUse` in `tools/poz-buildings.mjs`
     classifies 1 hospital, 2 university, 3 retail/mall, 4 industrial, 5 rail/depot, 6 sport/stadium/arena,
     7 utility and 8 leisure/water park, and `blockStats` picks a non-campus programme by dominant footprint area (>= 40 %), with the campus
     kept when its own footprint is larger. `blockProfile` consumes it before `OFFICE_SITES` and the district switch;
     `HOSPITAL` gets a wider gate (area >= 0.4 ha, built <= 55 %) for #828/#991, while `UNIVERSITY` keeps the 5 ha /
     40 % gate. EC Garbary and the Madalińskiego depot stay `SPECIAL_SITES` fallbacks because OSM tags them too sparsely
     for the 40 % share. [Record](observations/block-programs-2026-11-08.md).
  3. *Building anchors (`GEO.blockAnchors`)* (done 2026-11-08): `tools/poz-buildings.mjs` emits the 1–3 largest
     mapped non-residential footprints of a block that dominate its built mass (35 blocks, 61 anchors in the current
     build), and `buildings.js` fills each anchor's OSM envelope clipped to the block's own lot rects. Posnania
     68 → 94 %, Castorama 22 → 84 %, ZNTK 21 → 74 % and Hala Arena 83 → 97 % outline coverage; the rest of an anchored
     block is parking/yard plus low service pavilions instead of kamienice.
     [Record](observations/block-anchors-2026-11-08.md).
  4. *Park clearance carve-out* (done 2026-11-08): `GEO.blockFootprints` emits the OSM envelopes of mapped sport/show/public
     facilities (≥ 150 m²) in park blocks; `parkFreeCells` in `js/city-config.js` keeps them as dedicated lots for
     `facilityBlock` in `js/buildings.js`. Hala Arena (block 925) coverage rises 0 → 74 %, Enea Stadion (937) 0 → 67 %
     and Lodowisko Chwiałka (937) 4 → 65 %, while lawn meshes and non-facility park land stay clear.
     [Record](observations/park-sports-facilities-2026-11-08.md).
  5. *Railway building preservation* (done 2026-11-08): in `tools/poz-blocks.mjs`, mapped station, depot and signal-box
     footprints are given back from `landuse=railway` and track buffers grown by `SIDEWALK` (keeping 1 m outside the track
     corridors and 1 cell short of adjacent blocks). Restores 9 railway islands (19,098 m²): Głogowska tram depot went
     from 1,176 m² and 0 lots to 8,196 m², 13 lots and 820 m² built (50 % outline coverage; block #1248 in the current
     west-expansion output); LCS Poznań Główny (#1001) and Dworzec Letni (#802) gain their own blocks.
     [Record](observations/railway-building-islands-2026-11-08.md).
  6. *Outskirts satellite sites (`SATELLITE_SITES`):* **done 2026-11-08** — `js/satellite-sites.js` places 13 OSM
     big-box and utility sites (Pestka, Makro, Plaza, M1, IKEA, Selgros, Franowo, VW Antoninek, Karolin) as 24 instanced
     rectangles plus 52 roof HVAC boxes in `js/outskirts.js`, and two instanced structures for Karolin's cooling towers
     and 204 m chimney. King Cross moved into the detail box with the west expansion. No geodata raster change; generic
     outskirts sheds keep out of the footprints via `satelliteClearance`.
     [Record](observations/outskirts-satellites-2026-11-08.md).
  7. *Industrial tagging supplement* (done 2026-11-08): snapshot `poz_industry.json` for cooling towers, power plants and
     chimneys (`GEO.industry`, `js/buildings.js` instanced meshes and EC Garbary fallback), plus regression tests in
     `tests/buildings-density.test.cjs`. [Record](observations/industrial-tagging-2026-11-08.md).
  8. *Platform and station canopies* (done 2026-11-08): open canopies from `building=roof` outlines in `js/canopies.js`.
     [Record](observations/platform-canopies-2026-11-08.md).
  9. *Browser pass:* inspect the new non-residential silhouettes from a free camera and street level: Posnania (#953,
     11–16 m mall), Castorama (#21, 7.6 m retail park), ZNTK (#846, 11.4 m halls), EC Garbary (#266, utility halls plus
     the fallback 65 m chimney and 55 m cooling tower) and the Główna halls (36/78/95), on WebGPU and WebGL2.
     [Profiles record](observations/building-profiles-nonres-2026-11-08.md),
     [industrial tagging record](observations/industrial-tagging-2026-11-08.md).
   10. *Building-density TOP-30 pass* (done 2026-11-08): `steerProfile` now steers kamienice and halls by the real built
     share of their effective lots (`lotTarget`) instead of the island share; non-res `skipP` uses the same target;
     Rataje/Chartowo/Stare Winogrady five-storey PROJECTS stay panel estates with an interpolated dense layout, and
     their small park-carved pieces get garage/pavilion rows; `retailParkBlock` accepts 12–18 m pieces with a short
     forecourt; `GEO.blockParkBuildings` keeps ordinary mapped buildings in park blocks as lots. Deficits fall from
     628,008 to ~385,000 m² (top-30 405,000 → ~211,000), with 875, 417, 266 and 58 near or above their OSM share and
     887/968/1166/1271 much closer; city-wide net overbuild grows from +580,000 to ~+836,000 m², the documented
     trade-off of densifying the underbuilt blocks without a parallel thinning pass.
     [Record](observations/building-density-investigation-2026-11-08.md).
- **Merge starvation and short-link left turns:** the 2026-11-07 Centrum seed 99 10-minute hold (`waitMax`/`longestHeld`
  184 s at `(-1117, 132)`) is fixed. A blocked lead no longer reserves the 9.4 m link between signals, and a left turn
  that cannot clear falls back to a straight move from the same lane, so it no longer waits on the link. That run is
  now 52/51 s with no box-stuck car or deadlock at the target and no car over 60 s; over the 8 seeds × 7 districts
  (5 min) held > 60 s moves 164 → 117 and > 120 s 12 → 3, deadlocks 1 → 0 and box-stuck seed-districts 13 → 11 (the
  older 213/10 figure came from a different tree; this baseline re-measured at `6a1a234`). Centrum has no box-stuck
  seed, including seeds 1 and 5 and the target `(-1117, 132)`. Kaponiera's remaining `(-1490, 170)` box and 10 m
  give-way exit at `(-1497, 198)` were fixed on 2026-11-08: over 8 seeds held > 120 s falls 25 → 7, deadlocks 2 → 0,
  the worst wait 195 → 139 s and no car stops in the `(-1490, 170)` box; seed 1 keeps the only hold regression
  (1 → 5 cars). A short link now uses a free sibling lane when its planned lane is queued for a signal (only when the
  sibling offers no extra movement), and a give-way feeder behind a short signal link leaves the upstream box clear
  when its rear car is stopped. Do not revive the rejected unrestricted sibling lane (cars entered a left-turn lane
  over the tram tracks and two trams waited 89 s at switches), the version applied to links that do not store for a
  signal (Jeżyce's `(-2023, -448)` car–tram cycle returned and the audit rose to 13 pairs), or the rear-gap rule for
  every moving queue (it cut the merge's throughput and added a deadlock). Do not revive the rejected early-arrival and
  lane-lead braking relaxations without their regressions.
  [Trace, measurements and rejected variants](observations/kaponiera-traffic-2026-11-08.md),
  [Centrum trace](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Car–tram body overlaps:** the short-link car forecast blind spot is fixed for the default seed-4242 run. A car
  that cannot stand on a link under 12 m now waits at the upstream line while a tram owns the link's exit curve
  (`shortLinkTramBlocked`, with a stand-at-the-nose test), and the tram restart gate reaches 8 m and counts a car
  physically committed on a short link (`ROAD_GATE_REACH`, `unable`). That moves the default audit **9 → 5 pairs**
  (Kaponiera 4 → 1, Stare Miasto 2 → 0, Centrum 0 → 1 stopped, Jeżyce unchanged at 3) with no deadlock or car held over
  120 s; Kaponiera's worst wait falls 120 → 112 s and held over 60 s 13 → 11. The remaining 27 stopped first contacts
  from the eight-seed audit are still shared-lane touches and close opposing lanes, and the Kaponiera pair 38:1 is the
  same race one link on, where the car was already on the link when the curve was claimed. Rejected in the same pass:
  the stand test in every short-link `tramBlocks` call or a long-connector stop (Kaponiera worst wait 191 s, 12 cars
  over 120 s), the feeder two-step (pairs moved around), and the old `enter` hard stop for cars. The earlier
  2026-11-07 proxy pass remains in the tree: the 8-seed audit fell **138 → 71 pairs** (110 → 41 moving; Jeżyce 83 → 31,
  Centrum 24 → 8, Kaponiera 16 → 17). `enter` hard stops for cars on short links and longer forecasts were measured
  again and rejected (they replaced one pair with another and raised turns); do not revive the rejected early-arrival
  and lane-lead braking relaxations without their regressions.
  `tools/audit-tram-opposing-lanes.mjs` now reports **42 runs / 40 lanes / 377 m** of used street-running tracks with
  close opposing traffic, with 14 runs / 12 lanes / 200 m off-street or unused under `--all` (56 / 52 / 577); the 37
  short stubs (35 lanes, 252 m), three curved runs (41 m) and two constant-shift cases (84 m: 4677 and 7930) still
  need per-station lane geometry. The 2026-11-08 station-profile pass adds a piecewise linear lane shift that is zero
  at real junctions and continuous across bend stations; it moves the Głogowska 4257 shared lane across its 42.7 m
  neighbour (`6353`, 0 → 2.33 m) and the 53.4 m edge (`4581`, 2.34 → 0), clearing the 20 m run without the 22.4°
  connector a constant +2.34 m made. The 2026-11-08 short-stub pass moves the 5 m edge at `−838, 1662`, the 6 m one
  at `379, −1965` and the 5/8 m pair at `−955, 1791` / `−877, 1700` clear; at `−2090, −1632` the 9 m run only becomes
  a 6 m one where the skewed track crosses the moved lane again. The later crossing-track pass walks the used track
  chains themselves (the audit samples the centreline, not the lane) and moves all lanes of a non-shared edge only
  when a 5 m-or-more
  crossing/oncoming run disappears and every used track then clears 2.3 m; it moves only the Pułaskiego stub at
  `−1216.6, −591.4` (−1.94 → −4.51 m), clearing its 5 m run. The station-profile solver clears Głogowska 4257 but
  finds no safe profile for the other 42 runs: the 4677 lane sits between the two tracks, Wierzbięcice 7930 has the
  same-direction track to its right and the road side-of-centreline rule to its left, and the curved runs sweep a
  track across the whole carriageway. Accepting a residual below the audit's 5 m floor was rejected (it hides the
  1.5 m overlap left at 5523).
  [Short-stub and crossing-track measurements](observations/tram-opposing-lanes-2026-11-08.md). Moving the Rynek
  Jeżycki stubs still increases overlaps and adds a deadlock, so the pass leaves that cluster alone.
  [Short-link pass and rejected variants](observations/car-tram-overlaps-2026-11-08.md),
  [eight-seed results and earlier variants](observations/tram-overlaps-2026-11-04.md).

## Optional features and fidelity

- Road levels and richer road-priority classification; revisit only with a runtime consumer.
- Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data: research candidates.

## Browser checks still outstanding

### Interface and performance

- Verify the loading screen's Poznań colours (white `#ffffff`, dark blue `#234792`, gradient to `#009cdc`),
  contrast, independence from OS dark mode before boot, and loader credits layout and link responsiveness on desktop
  and phone.
- Check Polish labels in the HUD, toolbar and touch layout, metric readings, map labels and pin clustering on
  WebGPU and WebGL2.
- Verify the merged shop-sign atlas at street level on WebGPU and WebGL2: per-instance cell selection, mip bleed at
  grazing angles, the two text-only chain signs and the dusk spot colours. The atlas replaced 26 sign meshes and
  textures with one mesh and one texture (25 fewer draw calls); [measurements](observations/shop-signs-atlas-2026-11-08.md).
- Measure load time and frame rate across the enlarged detail box, roof/dormer coverage and pool limits, estate
  slabs and transitions to the outskirts; check detailed WebGL2 appearance and performance.
- Inspect Ławica on WebGPU and WebGL2: the 10/28 runway from the air and from Bukowska, the terminal T1–T3 facades and
  jet bridges from street level, the runway/taxiway/apron markings and lights at night, z-fighting between the 3.5 cm
  tarmac layer and the land deck, and the airport's draw-call/shadow cost.
  [Etap 2 record](observations/detailbox-west-phase2-2026-11-08.md).

### Geometry, materials and collisions

- Inspect the new non-residential silhouettes from a free camera and street level: Posnania (#953, 11–16 m mall with
  rooflights), Castorama (#21, 7.6 m retail park), ZNTK (#846, 11.4 m halls), EC Garbary (#266, utility halls plus the
  fallback 65 m chimney and 55 m cooling tower) and the Główna halls (blocks 36/78/95), on WebGPU and WebGL2, including
  yard/apron joins, tower colliders and any z-fighting.
  [Profiles record](observations/building-profiles-nonres-2026-11-08.md).
- Inspect all 11 historic landmarks on WebGPU and WebGL2: Biblioteka Raczyńskich, Pałac Działyńskich, Hotel Bazar,
  Muzeum Narodowe, Teatr Polski, Collegium Maius, Kościół Bernardynów, Kościół Franciszkanów, Kościół NMP in Summo,
  Kościół św. Wojciecha and Kościół Bożego Ciała. Check silhouette, materials, window rhythm, panes 3.5 cm proud
  of rustication, gables, domes, helms, lanterns, the theatre inscription and pelican. Check masonry and lit panes
  beside neighbouring buildings by day and night, plus player collisions around facades and entrances.
  [Landmark measurements](observations/landmarks-2026-11-05.md).
- Inspect the new open canopies from a train, a tram, a car and on foot on WebGPU and WebGL2: Poznań Główny's long
  platform roofs, Dworzec Letni and Garbary, the tram-stop canopies, the fuel-station forecourts and a few ordinary
  pergolas. Check the deck underside and beams from below, column bases and collisions, that no post stands on a
  track, and that a tram/car/pedestrian passes under without clipping.
  [Canopy record](observations/platform-canopies-2026-11-08.md).
- Inspect outward-facing x-ridge kit roofs (Ratusz, Katedra, Zamek Cesarski, Teatr Wielki, Dworzec and others)
  from above and street level, including shading, rotated-block ridges and normals.
- Continue landmark-placement and scenic-camera checks, panel-material shimmer, balcony LOD transitions and
  platform/slab flicker where surfaces are only 1 cm apart.
- Inspect Most Chrobrego from the bank and a tram; check the narrowed Most Świętego Rocha, Most Królowej Jadwigi
  and Most Mieszka I decks, and the 13 m Most Dworcowy approach.
- Walk and drive into a street tree on Rybaki; check relocated street trees near landings, zebras, lanes and island
  edges. Walk the surveyed OSM rows in Stare Miasto and around Park Cytadela, compare a few pits with the OSM points,
  and measure frame rate and draw calls at street level and from the drone; the 88,479-site scene allocates about
  21 MB of tree instance buffers. [Tree-placement audit and pins](observations/street-tree-clearance-2026-11-06.md),
  [OSM tree record](observations/osm-street-trees-2026-11-08.md).
- Walk and drive around a diagonal tram shelter (Dworzec Zachodni or Żniwna), checking collision against its back
  glass and ends. [Furniture geometry](world.md#tram-infrastructure).
- Inspect park lamps on Za Cytadelą and lamps moved onto lawns in narrow-walk parks (e.g. block 212 near
  `−953, −1928`); check trees by Avenida and in park blocks with buildings (Park Nad Wartą, Antoninek block 874).
  [Tree/building clearance](observations/tree-building-clearance-2026-11-03.md).
- Check the corrected heights of Iglica, Delta, Brama Poznania and Zamek Królewski, and the refined Fara front
  gable/cross and Teatr Wielki portico/Pegasus from street level and above.
- Inspect the four Fara lower-tier niche statues from Świętosławska on WebGPU and WebGL2: aedicule depth and hood,
  no z-fighting against the plaster, the figure silhouettes and gilded attributes, and the outer pair standing 2.1 m
  higher over the tall side windows.
  [Niche record](observations/landmark-heights-2026-11-03.md#2026-11-08--fara-niche-statues).
- Check tram rails without a track bed for appearance and shader errors (flush heads on road, grass and curb islands);
  mainline railway sleepers should remain visible.
- Inspect P-22 BUS markings on WebGPU and WebGL2. [Placement scope](world.md).
- Inspect the Poznań city crest on the player's taxi stripe and street taxis from both sides, by day and under street
  lights, on WebGPU and WebGL2: legibility at door scale, the white number panel and the front-door centring.
  [Taxi markings](actors.md#vehicle-lights-and-turn-signal-conventions).
- Inspect black locust foliage, bark, LOD and wind. [Tree models](world.md).

### Signals, traffic and audio

- Continue signal and traffic checks at Kaponiera, Most Teatralny and Głogowska/Hetmańska, including visible head
  orientation/colour correspondence and WebGL2. Extend NPC demand-request coverage beyond node `2422`, test the
  full rendered Św. Marcin green-wave corridor and crossing ticks against displayed heads.
  [Previous coverage and limits](observations/signals-2026-10-30.md).
- Check Dworzec's connected refuge route, signals and pedestrian/vehicle interactions on WebGL2; record a full
  rendered interaction with a naturally approaching bus, including rear clearance.
  [Dworzec checks](observations/dworzec-2026-10-30.md), [bus population check](observations/bus-population-2026-10-30.md).
- Check overhead signal visibility: 10 of the 26 overhead heads stand at least 10.5 m before the stop line and one
  more at least 8 m, while 15 use the stop-line fallback (13 at 1.75 m past P-14, two reused poles at 0.03 and
  −0.82 m). Verify the fallback heads are visible through the whole queue and move them back or add a gantry if they
  are not.
- Watch a tram pass a car stopped at a crossing and a left-turner complete through the Kaponiera box; check for
  visible clipping or stopping within the approximately 1 s forecast gap.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and return
  destinations and the Starołęka boundary routes.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify local timing and audible range.

For each fix, record measurements and regression checks in the topic docs or observation records, and state which
browser checks were actually performed. Remove completed tasks from this backlog; retain only unresolved work.
