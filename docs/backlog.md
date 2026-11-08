# Poznań backlog

Updated 2026-11-08. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap remnants:** the 2026-11-07 physical-line follow-up keys queues by physical line instead of
  route object, tests entrances and oncoming queues in world space, and lets a blocked crossing exit age. The
  direction-specific inset-lane follow-up then gives every walking track a `LANE_INSET` 0.34 m lane on its clear
  right-hand sides; each direction keeps its own side and the offset fades at both track ends. On the dworzec/wilda
  audit (seeds 4242/77, 3 min) clusters fall 8 → 1, longest 20 → 9 s, biggest 6 → 4, mean overlapping pairs/s
  13.25 → 5.68, crosswalk entries hold at 125.7 → 126.6/min. The 24 s Most Dworcowy two-way knot and the 8 s /
  8-body Droga Dębińska queue are gone. Wilda's `bench-traffic.mjs --ped-rooms` freeze falls 5,025 → 4,306 ped-s of
  about 50,000 sampled, longest 20.1 s (entrance → merge); the `tramRoom` boundary trap stays fixed. Remaining: a
  9 s / 4-body same-direction queue on an 11.8 m Droga Dębińska corner link feeding a crosswalk (no longer a
  two-way knot), conversation pairs meeting within a body width of another pair, and the 20 s recovery still
  postponed while a pedestrian is in `nearView`.
  [Mechanisms, fix and per-seed results](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-07-coincident-lines-and-blocked-exits),
  [inset lanes](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-07-direction-specific-inset-lanes),
  [room audit](observations/jezyce-gridlock-2026-11-07.md#follow-up-tramroom-boundary-fix-and-room-audit-2026-11-07).
- **Isolated crosswalk landings:** stage 3 (2026-11-07) splits every road-edge sidewalk line into its clear same-block
  runs instead of dropping the whole line when it leaves a block, indexes every sidewalk-track end by block
  (`curbPorts`) and offers a crosswalk end the same-block ends within 8 m. A tram-cut island or median with no run at
  the landing gets a short kerb spur (≤ 6 m, `landing: true`) along its outline; the spur keeps 2.22 m from every rail
  centreline, is rejected by the lane/lot/wall checks, and its far end is a terminus (the dead-end guard keeps it out of
  through routes). On the 2026-11-07 headless world (`tools/bench-world.mjs`, city-block colliders; city-grid curbs,
  landmarks and bridges omitted) empty ends fall **156 → 47** and tracks with an empty end **143 → 41**, with
  crosswalks unchanged at 3,270, `laneHits` 0, rail hits 0 and building hits 0; the 16,046 split runs keep
  `splitLaneHits` 0 (closest sample 0.8 m beyond half a lane + 0.8 m). The bare network falls 109/98 → 38/33.
  The five named nodes are linked: **Okrąglak** (`-841.5, 30.6`), **Okrąglak / Święty Marcin** (`-1120.1, 112`),
  **Miła / Dąbrowskiego** (`-3269.1, -884.3`; its far end at `-3263, -901.3` lies on an ordinary block and stays
  isolated), **Promienista / Grochowska** (both lines) and **Wierzbięcice / Górna Wilda** (both lines). The audit
  reproduces the counts, re-checks every fallback leg and now re-checks the generated spurs (`spur*` fields: 5 links
  on 4 tracks, closest rail 2.48 m, 0 rail/building/block hits) and the split runs' lane distance (`splitLaneHits` 0,
  `splitMinLane` 0.8 m). The remaining 47 ends are ordinary blocks and roadway cases; `reasonCounts` (overlapping
  categories) are lane 36, length 29, lot 22, walkable 10, rail 5, building 4, corridor 3 and block 1. Stage 2's 16 m
  fallback corridor and 32 m `FALLBACK_MAX` stay; a 40/48 m limit adds only 6/7 ends. The dead-end guard still covers sidewalk-track landings. Still open: a production full-scene count (the
  benchmark omits landmark/bridge colliders and city-grid curbs).
  [Routing observations](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-07-kerb-tracks-on-tram-cut-islands).
- **Other missing signal heads (15.5):** the overhead fallback now serves 32 of the 75 historical Category C
  approaches from 10 new 6.2 m masts and 22 reused signal poles (arm ≤ 11.717 m, mean 8.819 m); the audit is
  114/0/43/10 after placement (65/75 B/C before; the kerb tracks moved 9 approaches from B to C against the stage-2
  74/66 split). The arm, head and foot
  keep 2.22 m from every track axis at 0.5 m samples, and the
  foot keeps a conservative 3.1 m from every track (above the 1.75 m tram-pole and 2.6 m railway-mast setbacks);
  the built tram and railway layouts put every arm, foot and head at least 7.26 m from a pole or mast. Three
  first-pass arms crossed a tram envelope and are rejected. 17 heads reach the stricter ≥ 10.5 m band and one more the
  ≥ 8 m band; 14 use the stop-line fallback (12 at 1.75 m past P-14, one reused pole at 0.03 m and one at −0.82 m).
  A 0.5 × 0.4 m sweep of the −15…−8 m corridor found 12,510 candidate mast feet, none clear; the closest existing support was 12.96 m
  from an −8 m head, so no fallback head can reach either band without a gantry or span wire. The remaining 43 have no
  clear mast foot within 12 m or no support in the −15…+10 m approach band. Run `node tools/audit-signal-heads.mjs` with
  attention to the fixture's missing building, landmark and bridge colliders; browser counts can differ.
  [Signal placement](world.md#street-furniture-street-detailsjs).
- **Building accuracy (4.4, 7):** the Fara front gable/cross and the Teatr Wielki portico/Pegasus now use GUGiK
  NMPT − NMT sub-heights; only the four Fara niche statues (below the 1 m DSM resolution) remain visual estimates.
  [Height audit](observations/landmark-heights-2026-11-03.md#2026-11-07--refined-fara-and-teatr-sub-heights).
- **Building density follow-up (Bukowska, hospital/academic grounds):** the campus profile and graduated core are in
  (2026-11-07) and the 2026-11-08 WebGPU/WebGL2 review is complete: blocks 666, 577, 427 and 476 sit within ±20 % of
  their OSM built share (666 20.6/21 %, 577 36.4/37 %, 427 22.5/22 %, 476 14.5/15 %), and 807/1121 land at 19.7/21 and
  16.7/18 %. The campus alley grid and `campusShed` supply the interior structure, so unnamed `highway=service` cuts
  stay dropped; the 8-lot `maskRects` cap is not on the path of the 27 `program > 0` blocks of at least 5 ha, which
  all use frontage frames (raising the frame caps 12/10 to 18/16 changes 8 of 27 sets and the coverage by -0.65 to
  +1.14 pp; above 18/16 there is no change), and OSM vs BDOT10k is closed for this snapshot. Remaining: the
  western `detailBox` edge at x = −3,675.4 leaves King Cross, Business Garden and Ławica in the coarse outskirts; moving
  it needs new snapshots, a rebuild of every layer and an outskirts re-check.
  [Density record and measurements](observations/building-density-2026-11-07.md#follow-up-2026-11-08-visual-review-lot-cap-and-service-alleys),
  [sparse-block BDOT audit](observations/sparse-blocks-2026-11-04.md),
  [Density test harness](tests/buildings-density.test.cjs),
  [Phase 14 archive](archive/poznan-plan.md#phase-14-real-building-density-from-osm).
- **Central density (2026-11-08):** the 190 central blocks (Stare Miasto, Jeżyce, Łazarz, Wilda) at least 35% built
  in OSM now generate 43.2% against 45.3% real (was 40.3%), and blocks below 75% of their real share fall 49 → 46.
  The named blocks moved: 708 35.4 → 39.7%, 688 37.3 → 39.9%, 836 42.1 → 44.8% and 1365 40.0 → 45.5%; 801 stayed
  35.8% and 868 slipped 34.7 → 33.4%. Deep frontage lots now use up to 48 m, dense cores count from 8 m, rear rows
  stand on 7–9 m wells and dense courtyards get transverse oficyny. Remaining: Stare Miasto is still at 0.82× its OSM
  share because blocks 575 (Collegium Maius reserve), 816 (Stary Browar/offices) and 868 (office profile) are mostly
  landmark or office layouts; `officeBlock` still builds only street slabs and no interior core. Jeżyce and Łazarz
  now sit above their whole-district OSM share (1.19× / 1.20×), so a later pass should thin already-built blocks
  before adding more. Browser checks were WebGPU (Apple `metal-3`) and WebGL2 at the drone, a 35–140 m helicopter POV
  over Ratajczaka and a street-level Św. Marcin/Piekary run; no curb or sidewalk overlap and no z-fighting were seen.
  [Measurements and code changes](observations/central-density-2026-11-08.md).
- **Non-residential building coverage and specialized profiles (2026-11-08 audit):** the comprehensive audit
  (`tools/audit-nonresidential.mjs`, [record](observations/non-residential-audit-2026-11-08.md)) revealed that
  almost all missing non-residential buildings stem from morphology replacement (shopping malls, industrial halls,
  railway depots and stadiums being turned into generic kamienice, villas or panel estates by district fallback)
  rather than empty blocks. Only two blocks ≥ 1,500 m² generate 0 m²: block 1254 (Głogowska tram depot hall cut by
  railway landuse) and block 575 (Collegium Maius landmark reserve). In-box: 31 large objects (9.3 ha) have 0%
  coverage and 211 (74.0 ha footprint) only partial/fragmented coverage. 34 large objects (29.8 ha) sit outside the
  detail box (Pestka, Makro, Plaza, Karolin, M1, IKEA, Selgros, Franowo, VW Antoninek). Outstanding backlog tasks:
  1. *Specialized building profiles:* introduce `MALL`, `RETAIL_PARK`, `INDUSTRIAL_HALL`, `DEPOT`, `STADIUM`, `ARENA`
     and `UTILITY` layouts with matched `KIND_SHARE` in `js/buildings.js` instead of district residential fallbacks.
  2. *Dominant block program in `GEO.blockStats`:* expand `buildingUse` in `tools/poz-buildings.mjs` beyond 1 (hospital)
     and 2 (university) to classify retail (3), industrial (4), rail/depot (5), sports/arena (6), utility (7), and
     pick program by dominant footprint area (≥ 40%) before district switch.
  3. *Building anchors (`GEO.blockAnchors`):* emit 1–3 largest non-residential footprints per block so `buildings.js`
     can place solitary big-box structures at their true OSM location and fill remainder with parking/service lots.
  4. *Park clearance carve-out:* update `parkFreeCells` to preserve mapped building footprints (Enea Stadion, Hala Arena,
     Chwiałka ice rink) so sports facilities in park grounds are not cleared to zero.
  5. *Railway building preservation:* in `tools/poz-blocks.mjs`, carve out building footprints (Dworzec Garbary,
     Dworzec Letni, LCS, Głogowska depot hall) from `landuse=railway` and track buffers so they receive block lots.
  6. *Outskirts satellite sites (`SATELLITE_SITES`):* **done 2026-11-08** — `js/satellite-sites.js` places 14 OSM
     big-box and utility sites (Pestka, Makro, Plaza, King Cross, M1, IKEA, Selgros, Franowo, VW Antoninek, Karolin)
     as 27 instanced rectangles plus 52 roof HVAC boxes in `js/outskirts.js`, and two instanced structures for Karolin's
     cooling towers and 204 m chimney. No geodata raster change; generic outskirts sheds keep out of the footprints via
     `satelliteClearance`. [Record](observations/outskirts-satellites-2026-11-08.md).
  7. *Industrial tagging supplement:* snapshot `poz_industry.json` for cooling towers, power plants and chimneys,
     plus regression tests in `tests/buildings-density.test.cjs`.
- **Merge starvation and short-link left turns:** the 2026-11-07 Centrum seed 99 10-minute hold (`waitMax`/`longestHeld`
  184 s at `(-1117, 132)`) is fixed. A blocked lead no longer reserves the 9.4 m link between signals, and a left turn
  that cannot clear falls back to a straight move from the same lane, so it no longer waits on the link. That run is
  now 52/51 s with no box-stuck car or deadlock at the target and no car over 60 s; over the 8 seeds × 7 districts
  (5 min) held > 60 s moves 164 → 117 and > 120 s 12 → 3, deadlocks 1 → 0 and box-stuck seed-districts 13 → 11 (the
  older 213/10 figure came from a different tree; this baseline re-measured at `6a1a234`). Centrum has no box-stuck
  seed, including seeds 1 and 5 and the target `(-1117, 132)`. Kaponiera still dominates what remains
  (`(-1490, 170)` boxes, 3 cars over 120 s) but improves from 12. Avoid reviving the rejected early-arrival and
  lane-lead braking relaxations without their regressions.
  [Trace, measurements and rejected variants](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Car–tram body overlaps:** the short-link car forecast blind spot remains at Kaponiera and Centrum, and cars can
  still stop inside the tram envelope, but the 2026-11-07 proxy pass removes the largest Jeżyce rear-end cluster. A tram
  braking for an obstacle outside its body no longer loses the whole lane proxy, so the 8-seed audit falls **138 → 71
  pairs** (110 → 41 with the car moving over 1 m/s; Jeżyce 83 → 31, Centrum 24 → 8, Kaponiera 16 → 17). The remaining
  27 stopped first contacts are mostly shared-lane touches and close opposing lanes; the moving Kaponiera/Stare Miasto
  pairs are the commitment race where a car enters a 10 m link before the tram's curve is held. `enter` hard-stops for
  cars on short links and longer forecasts were measured again and rejected (they replaced one pair with another and
  raised turns). `tools/audit-tram-opposing-lanes.mjs` drops the `< 12 m` exception (edge 305 clears) and reports only
  used street-running tracks: **47 runs / 45 lanes / 417 m** remain, with 14 runs / 12 lanes / 200 m off-street or unused
  tracks listed under `--all`. Moving the Rynek Jeżycki stubs still increases overlaps and adds a deadlock.
  [Eight-seed results and rejected variants](observations/tram-overlaps-2026-11-04.md).

## Optional features and fidelity

- Exact emergency-vehicle livery/marking fidelity (Policja/PRM/PSP) beyond the current colour bands; verify sources before use.
- Real OSM street-tree positions.
- Road levels and richer road-priority classification; revisit only with a runtime consumer.
- Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data: research candidates.

## Browser checks still outstanding

### Interface and performance

- Verify the loading screen's Poznań colours (white `#ffffff`, dark blue `#234792`, gradient to `#009cdc`),
  contrast, independence from OS dark mode before boot, and loader credits layout and link responsiveness on desktop
  and phone.
- Check Polish labels in the HUD, toolbar and touch layout, metric readings, map labels and pin clustering on
  WebGPU and WebGL2.
- Check new shop signs and their frame-rate/draw-call cost (26 instanced meshes, +21 calls versus the former five).
  Consider an atlas with per-instance UVs if measurements justify it.
- Measure load time and frame rate across the enlarged detail box, roof/dormer coverage and pool limits, estate
  slabs and transitions to the outskirts; check detailed WebGL2 appearance and performance.

### Geometry, materials and collisions

- Inspect all 11 historic landmarks on WebGPU and WebGL2: Biblioteka Raczyńskich, Pałac Działyńskich, Hotel Bazar,
  Muzeum Narodowe, Teatr Polski, Collegium Maius, Kościół Bernardynów, Kościół Franciszkanów, Kościół NMP in Summo,
  Kościół św. Wojciecha and Kościół Bożego Ciała. Check silhouette, materials, window rhythm, panes 3.5 cm proud
  of rustication, gables, domes, helms, lanterns, the theatre inscription and pelican. Check masonry and lit panes
  beside neighbouring buildings by day and night, plus player collisions around facades and entrances.
  [Landmark measurements](observations/landmarks-2026-11-05.md).
- Inspect outward-facing x-ridge kit roofs (Ratusz, Katedra, Zamek Cesarski, Teatr Wielki, Dworzec and others)
  from above and street level, including shading, rotated-block ridges and normals.
- Continue landmark-placement and scenic-camera checks, panel-material shimmer, balcony LOD transitions and
  platform/slab flicker where surfaces are only 1 cm apart.
- Inspect Most Chrobrego from the bank and a tram; check the narrowed Most Świętego Rocha, Most Królowej Jadwigi
  and Most Mieszka I decks, and the 13 m Most Dworcowy approach.
- Walk and drive into a street tree on Rybaki; check relocated street trees near landings, zebras, lanes and
  island edges. [Tree-placement audit and pins](observations/street-tree-clearance-2026-11-06.md).
- Walk and drive around a diagonal tram shelter (Dworzec Zachodni or Żniwna), checking collision against its back
  glass and ends. [Furniture geometry](world.md#tram-infrastructure).
- Inspect park lamps on Za Cytadelą and lamps moved onto lawns in narrow-walk parks (e.g. block 212 near
  `−953, −1928`); check trees by Avenida and in park blocks with buildings (Park Nad Wartą, Antoninek block 874).
  [Tree/building clearance](observations/tree-building-clearance-2026-11-03.md).
- Check the corrected heights of Iglica, Delta, Brama Poznania and Zamek Królewski, and the refined Fara front
  gable/cross and Teatr Wielki portico/Pegasus from street level and above.
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
