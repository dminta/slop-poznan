# Poznań backlog

Updated 2026-11-07. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap remnants:** the 2026-11-07 follow-up keys queues by physical line instead of route object,
  tests entrances and oncoming queues in world space, and lets a blocked crossing exit age. On the dworzec/wilda audit
  (seeds 4242/77, 3 min) clusters fall 17 → 12, longest 26 → 24 s, mean overlapping pairs/s 18.8 → 14.1, crosswalk
  entries hold at 108.0 → 109.2/min; the biggest short cluster grows 7 → 8. The retained `bench-traffic.mjs --ped-rooms`
  audit attributes Jeżyce's remaining walker holds (1,745 ped-s of 94,103 sampled, longest 17.7 s) to queue (96%) and
  merge (4%) room, not to trams; the `tramRoom` boundary trap is fixed. Remaining: a 24 s / 5-body knot on the 5.3 m
  Most Dworcowy corner link where trams stop both directions on one line, an 8 s / 8-body two-way queue at
  Droga Dębińska, and conversation pairs meeting within a body width of another pair. A direction-specific inset lane
  is the untried fix for the first two. The 20 s recovery is still postponed while a pedestrian is in `nearView`.
  [Mechanisms, fix and per-seed results](observations/ped-overlaps-2026-11-05.md#follow-up-2026-11-07-coincident-lines-and-blocked-exits),
  [room audit](observations/jezyce-gridlock-2026-11-07.md#follow-up-tramroom-boundary-fix-and-room-audit-2026-11-07).
- **Isolated crosswalk landings:** connect the remaining 212 empty ends (197 tracks with an empty end) without
  restoring U-turns or crossing roads, rails, buildings or water. Examples: Okrąglak (both side-1 lines),
  Miła / Dąbrowskiego, Święty Marcin / Wysoka, Promienista / Grochowska and Wierzbięcice / Górna Wilda.
  Most are unused second lines of two-line crossings. The route builder receives the real building colliders
  (`main.js`: landmark + city-block) and uses them in fallback-connector clearance. Direct and fallback links share
  an 8 m corridor from the block edge (5 → 8 m on 2026-11-07), every connector stays `RAIL_KEEP` 2 m from tracks, and
  the long loop still caps at 32 m. The connector clearance now measures exact segment-to-segment distance; the old
  line-line form read 5.39 m where the pair was 2.0 m and let 17 fallback legs into a lane by up to 1.09 m. In the
  2026-11-07 headless world (`tools/bench-world.mjs`, city-block colliders included; city-grid curbs, landmarks and
  bridges omitted) empty ends moved **269 → 246 → 212** and tracks with an empty end **247 → 225 → 197**, with
  crosswalks unchanged at 3,270 and `laneHits` 0. The older grid-and-furniture 230/218 snapshot predates these inputs
  and is not directly comparable. Still open: a corridor wider than 8 m (10/12/16 m leave 204/192/182 ends but reach
  into forecourts and courtyards), a longer 32 m limit (40/48 m connected only 4/5 more), and a production full-scene
  count. The fallback keeps a 2 m building-lot pad and rejects connectors through building walls; the benchmark still
  omits landmark and bridge colliders.
  [Routing observations](observations/ped-overlaps-2026-11-05.md).
- **Other missing signal heads (15.5):** investigate alternative mounting positions for the 66 historical
  Category C approaches and verify visibility. Sampled curbside sites, forward positions up to 6 m, medians and
  arm-aligned pole reuse found no suitable sites. Run `node tools/audit-signal-heads.mjs` with attention to the
  fixture's missing building, landmark and bridge colliders; browser counts can differ.
  [Signal placement](world.md#street-furniture-street-detailsjs). Overhead mounting is an option to consider below.
- **Building accuracy (4.4, 7):** source the remaining estimated sub-heights, including Fara's front statues and
  Teatr Wielki's pediment/Pegasus. [Height audit](observations/landmark-heights-2026-11-03.md).
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
- **Car–tram body overlaps:** address the short-link car forecast blind spot at Kaponiera and Centrum, cars
  stopped inside the tram envelope (27 in the recorded audit, mostly Jeżyce buses), and 58 remaining close lanes
  (62 runs, 626 m: short junction/shared-tram stubs, curved and constant-shift cases, off-street lanes and tracks
  unused by routes). Use `tools/audit-tram-opposing-lanes.mjs`; forecast and hard-stop variants previously raised
  Kaponiera holds to 134–153 s and introduced up to four deadlocks. Moving the Rynek Jeżycki stubs also increased
  overlaps and added a deadlock. [Mechanisms, pins and rejected variants](observations/tram-overlaps-2026-11-04.md).

## Park surfaces and road clearance: further review

- Verify the candidate lawn/road intersection on Grudzieniec through Park Sołacki, around
  `−2671…−2590, −1389…−1361`, over about 80 m. The user reported that it looks OK in the game; do not cut it on
  the scan alone. Any geometry change must preserve the park's three pond holes through triangulation.
- Review Chartowo near `2490, 2478` and Wioślarska in Park Nad Wartą. Wioślarska is a mapped unpaved service road,
  so verify its intended appearance before cutting greenery. Scan areas sum segment intersections rather than
  their union; bridge levels need separate checks.
- Visually review the later Witosa / Niestachowska opposite-sidewalk correction and the Armii Poznań / Pułaskiego
  island, Przepadek and Roosevelt cuts, including WebGL2. Some planting margins are narrow.

## Options to consider

- **Overhead signal heads:** consider heads on mast arms above the roadway for the 66 historical approaches
  without a suitable curbside pole site. This remains an option, not an approved implementation task.

## Optional features and fidelity

- Taxi crests and exact vehicle livery/marking fidelity; verify sources before use.
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
- Check the corrected heights of Iglica, Delta, Brama Poznania and Zamek Królewski.
- Check tram rails without a track bed for appearance and shader errors (flush heads on road, grass and curb islands);
  mainline railway sleepers should remain visible.
- Inspect P-22 BUS markings on WebGPU and WebGL2. [Placement scope](world.md).
- Inspect black locust foliage, bark, LOD and wind. [Tree models](world.md).

### Signals, traffic and audio

- Continue signal and traffic checks at Kaponiera, Most Teatralny and Głogowska/Hetmańska, including visible head
  orientation/colour correspondence and WebGL2. Extend NPC demand-request coverage beyond node `2422`, test the
  full rendered Św. Marcin green-wave corridor and crossing ticks against displayed heads.
  [Previous coverage and limits](observations/signals-2026-10-30.md).
- Check Dworzec's connected refuge route, signals and pedestrian/vehicle interactions on WebGL2; record a full
  rendered interaction with a naturally approaching bus, including rear clearance.
  [Dworzec checks](observations/dworzec-2026-10-30.md), [bus population check](observations/bus-population-2026-10-30.md).
- Watch a tram pass a car stopped at a crossing and a left-turner complete through the Kaponiera box; check for
  visible clipping or stopping within the approximately 1 s forecast gap.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and return
  destinations and the Starołęka boundary routes.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify local timing and audible range.

For each fix, record measurements and regression checks in the topic docs or observation records, and state which
browser checks were actually performed. Remove completed tasks from this backlog; retain only unresolved work.
