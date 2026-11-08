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
- **Isolated crosswalk landings:** stage 2 connects the remaining empty ends without restoring U-turns or crossing
  roads, rails, buildings or water. The long fallback now accepts sidewalk track ends (the old `!next.node` gate
  skipped 16 ends) and the corridor grows 8 → 16 m, with a sight line to the block edge that keeps closed courtyards
  off limits. On the 2026-11-07 headless world (`tools/bench-world.mjs`, city-block colliders; city-grid curbs,
  landmarks and bridges omitted) empty ends fall **212 → 156** and tracks with an empty end **197 → 143**, with
  crosswalks unchanged at 3,270, `laneHits` 0, rail hits 0 and building hits 0. The bare network leaves 109/98.
  `node tools/audit-crosswalk-landings.mjs` reproduces the counts and re-checks every fallback leg.
  Still isolated are the key nodes the backlog named: **Okrąglak** (`-841.5, 30.6`; the 351 m² tram-cut
  island has no sidewalk track at all, and its only ports are 15.6-16.7 m across the roadway, crossing a lane and
  coming within 0.13 m of a rail), **Okrąglak / Święty Marcin** (`-1120.1, 112`; 12.5-21.3 m across the roadway),
  **Miła / Dąbrowskiego** (`-3269.1, -884.3`; 19.2 m through a building lot or 26 m across a lane and 0.10 m from a
  rail), **Promienista / Grochowska** (both lines at `-3541.4, 1448.4` and `-3540.3, 1449.4`; only sibling/self ports
  within 11 m, the nearest sidewalk 23-25 m across the road) and **Wierzbięcice / Górna Wilda** (both lines at
  `-851.4, 1662.7/1664.2`; nearest sidewalk 17.7-19.2 m across a lane and 0.10 m from a rail). Święty Marcin /
  Wysoka has no empty end in the audit. Connecting these would need a new sidewalk track on the island/curb, not a
  fallback connector: every existing candidate crosses a lane, a building lot or a rail, or lies beyond the 16 m
  corridor. The audit's `reasonCounts` (overlapping, one per remaining end) are lane 138, length 70, lot 51, walkable
  32, rail 14, corridor 14, building 8, block 4 and none 2. A 40/48 m `FALLBACK_MAX` adds only 6/7 ends, and a corridor
  beyond 16 m connects no other key node, so both stay. The dead-end guard now also covers sidewalk-track landings
  (`target.edge`): of the 346 path ends that used to land on a sidewalk track with no onward link, 11 gain a non-empty
  link after the fallback projection sub-tracks' `from`/`to` were made geometric and the remaining 335 are rejected by
  `next()` (sampled route choices into such dead ends fall 517 → 0). Still open: a production full-scene count (the
  benchmark omits landmark and bridge colliders and city-grid curbs).
  [Routing observations](observations/ped-overlaps-2026-11-05.md).
- **Other missing signal heads (15.5):** the overhead fallback now serves 26 of the 66 historical Category C
  approaches from 12 new 6.2 m masts and 14 reused signal poles (arm ≤ 11.717 m, mean 9.282 m); the audit is
  117/0/40/10 (was 91/0/66/10). The arm, head and foot keep 2.22 m from every track axis at 0.5 m samples, and the
  foot keeps a conservative 3.1 m from every track (above the 1.75 m tram-pole and 2.6 m railway-mast setbacks);
  the built tram and railway layouts put every arm, foot and head at least 7.26 m from a pole or mast. Three
  first-pass arms crossed a tram envelope and are rejected. 10 heads reach the stricter ≥ 10.5 m band and one more the
  ≥ 8 m band; 15 use the stop-line fallback (13 at 1.75 m past P-14, two reused poles at 0.03 and −0.82 m). A 0.5 × 0.4 m
  sweep of the −15…−8 m corridor found 12,510 candidate mast feet, none clear; the closest existing support was 12.96 m
  from an −8 m head, so no fallback head can reach either band without a gantry or span wire. The remaining 40 have no
  clear mast foot within 12 m or no support in the −15…+10 m approach band. Run `node tools/audit-signal-heads.mjs` with
  attention to the fixture's missing building, landmark and bridge colliders; browser counts can differ.
  [Signal placement](world.md#street-furniture-street-detailsjs).
- **Building accuracy (4.4, 7):** the Fara front gable/cross and the Teatr Wielki portico/Pegasus now use GUGiK
  NMPT − NMT sub-heights; only the four Fara niche statues (below the 1 m DSM resolution) remain visual estimates.
  [Height audit](observations/landmark-heights-2026-11-03.md#2026-11-07--refined-fara-and-teatr-sub-heights).
- **Building density and campus/pavilion complexes (Bukowska, hospital/academic grounds):** the campus profile and the
  graduated core for large blocks are in (2026-11-07): blocks 666, 577, 427 and 476 now sit within ±20% of their OSM
  built share (666 14.9 → 20.6% against 21%, 577 47.7 → 36.4% against 37%, 427 23.8 → 22.5% against 22%, 476 15.4 →
  14.5% against 15%), and real hospital blocks 807 and 1121 land at 19.7/21 and 16.7/18%. Remaining:
  1. Unnamed `highway=service` cuts: still dropped globally (stamping all cut 1,154 blocks against 802, mostly slivers);
     a named/major-service rule inside blocks over 5 ha is untried and needs a block-raster rebuild.
  2. `maskRects` still caps at 8 lot rects; the uncovered share of irregular campus interiors after the profile change
     was not measured, and a higher cap would alter lot rectangles and block-based clearance tests.
  3. The western `detailBox` edge at x = −3,675.4 still leaves King Cross, Business Garden and Ławica in the coarse
     outskirts; moving it needs new snapshots and an outskirts re-check.
  4. OSM vs BDOT10k is closed for the current snapshot: the 36 large sparse blocks show no omission (BDOT exceeds OSM
     by at most 0.08 pp), and the Bukowska campuses are not sparse blocks.
  [Density record and measurements](observations/building-density-2026-11-07.md),
  [sparse-block BDOT audit](observations/sparse-blocks-2026-11-04.md),
  [Density test harness](tests/buildings-density.test.cjs),
  [Phase 14 archive](archive/poznan-plan.md#phase-14-real-building-density-from-osm).
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
- Check the corrected heights of Iglica, Delta, Brama Poznania and Zamek Królewski, and the refined Fara front
  gable/cross and Teatr Wielki portico/Pegasus from street level and above.
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
