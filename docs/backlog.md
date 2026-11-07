# Poznań backlog

Updated 2026-11-07. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap remnants:** investigate short conversation and blocked-crossing queue overlaps, mostly around
  Dworzec and Droga Dębińska (up to 16 s and 6 pedestrians in the last audit). The 20 s recovery is postponed while
  a pedestrian is in `nearView`; recognising blocked give-way exits remains unexplored.
  [Method and district results](observations/ped-overlaps-2026-11-05.md).
- **Isolated crosswalk landings:** connect the remaining 230 empty ends (218 tracks never entered by routing)
  without restoring U-turns or crossing roads, rails, buildings or water. Examples: Okrąglak (both side-1 lines),
  Miła / Dąbrowskiego, Święty Marcin / Wysoka, Promienista / Grochowska and Wierzbięcice / Górna Wilda.
  Most are unused second lines of two-line crossings. Pass real building colliders to the route builder before
  relaxing the 5 m block-edge corridor and direct-link limits; exploratory data suggests about 124 ends could
  connect. The current fallback caps connector length at 32 m and keeps a 2 m building-lot pad.
  [Routing observations](observations/ped-overlaps-2026-11-05.md).
- **Jeżyce crosswalk gridlock:** break the tram → car → pedestrian → tram cycle around `−2105…−2040`.
  Pedestrians freeze mid-crosswalk in `tramRoom`/`tramNear` beside stopped trams; cars wait for those pedestrians
  and trams wait for the cars. It clears only when a tram respawns after 90 s. Queue spacing and the 20 s
  recovery do not break the cycle (`p.node` crosswalk waits do not accumulate that recovery timer).
  Measure the effect of the newer landing links on this scenario.
  [Traffic trace](observations/tram-overlaps-2026-11-04.md#kaponiera-regression-and-fix-2026-11-05).
- **Other missing signal heads (15.5):** investigate alternative mounting positions for the 66 historical
  Category C approaches and verify visibility. Sampled curbside sites, forward positions up to 6 m, medians and
  arm-aligned pole reuse found no suitable sites. Run `node tools/audit-signal-heads.mjs` with attention to the
  fixture's missing building, landmark and bridge colliders; browser counts can differ.
  [Signal placement](world.md#street-furniture-street-detailsjs). Overhead mounting is an option to consider below.
- **Building accuracy (4.4, 7):** source the remaining estimated sub-heights, including Fara's front statues and
  Teatr Wielki's pediment/Pegasus. [Height audit](observations/landmark-heights-2026-11-03.md).
- **Merge starvation:** investigate remaining long holds, especially Centrum seeds 99/4242/7 and Rataje seed 4242,
  and queues at Kaponiera and Wilda. After the short-link follower fix, the 8-seed × 7-district benchmark still
  has 213 cars held over 60 s and 10 over 120 s. Avoid reviving the rejected early-arrival and lane-lead braking
  relaxations without checking their regressions. [Comparison and rejected variants](observations/tram-overlaps-2026-11-04.md).
- **Short-link left-turn phase:** reduce remaining holds at Centrum (seed 99: 110 s; 4242: 85 s; 7: 87 s in the
  recorded comparison). Preserve tram-body reservations and verify full clearance through the junction.
  [Per-second trace and timetable context](observations/left-turn-tram-2026-11-04.md).
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
