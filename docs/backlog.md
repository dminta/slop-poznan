# Poznań backlog

Updated 2026-11-10. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap residual:** at `5e6a68e` the eight-district audit (seeds 4242/77, 3 min) has no cluster
  (0 clusters, 5.43 overlapping pairs/s, 105.3 crosswalk entries/min); `564975e` cleared the Pasaż Różowy cluster the
  `42329c3` layout restore had created (10 clusters, longest 26 s). Open: Most Dworcowy / Głogowska corner-link pairs
  of 16–19 s (two or three bodies at `(-1558, 575)` on 1.1 m red-light corner links, both seeds), the same 16–20 s
  stand-off as other short corner links (Św. Marcin, Taczaka, Wilda, Rataje) that the 20 s recovery ends; and Centrum's
  Pasaż Różowy pocket still freezes walkers routed into it (`--ped-rooms` 22,550 of ~93,700 ped-s, longest 20.1 s;
  7-district total 40,271 ped-s). Do not revive the length-weighted goal pick (Centrum 22,111 → 24,189 ped-s).
  [Pasaż record](observations/ped-overlap-pasaz-2026-11-10.md),
  [mechanisms](observations/ped-overlap-remnants-2026-11-08.md).
- **Merge starvation and short-link left turns:** at `5e6a68e` (8 seeds × 7 districts, 5 min) mean 15.2 km/h,
  stopped 31.9 %, worst wait 155 s, held > 60 s 208, > 120 s **21**, **5** deadlocks, 8 box-stuck seed-districts —
  all > 120 s holds and deadlocks in Kaponiera (12.3 km/h, 52.2 % stopped, 167 held > 60 s; the 2026-11-08 figures of
  3 / 0 predate the `42329c3` network). Kaponiera seed 1 has no hold > 120 s (longest 118 s, 25 > 60 s) but one 89 s
  cycle: car 62 enters the `(-1503, 224)` box on green, stops behind a tram proxy on its exit lane while tram 6 waits
  for it (box blocked 92 s); car 43 waits 118 s for successive trams at the `(-1468, 118)` give-way. Seeds 2, 7 and 5
  carry the > 120 s holds (10 / 6 / 5, longest 169 s). Rejected at `42329c3`: ignoring the waiting tram's proxy for
  its connector obstacle (the cycle became three vehicles, box still 84 s) and counting the room behind an exit-lane
  tram proxy (no change). Do not revive the rejected unrestricted sibling lane (cars entered a left-turn lane over the
  tram tracks and two trams waited 89 s at switches), the version applied to links that do not store for a signal
  (Jeżyce's `(-2023, -448)` car–tram cycle returned and the audit rose to 13 pairs), the rear-gap rule for every moving
  queue (it cut the merge's throughput and added a deadlock), or the early-arrival and lane-lead braking relaxations
  without their regressions. [2026-11-10 traces and re-measurement](observations/kaponiera-traffic-2026-11-10.md),
  [2026-11-08 trace and rejected variants](observations/kaponiera-traffic-2026-11-08.md),
  [Centrum trace](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Centrum seed-1 long hold and the traffic-flow test margin:** `tests/traffic-flow.test.mjs` requires every car on
  seed 1 to be held under 120 s. At `42329c3` Centrum failed it (car 21 held 145 s for exit room near `(-1048, 131)`,
  2 held > 120 s); at `5e6a68e` the reshuffled draws pass it by 8 s: 14.3 km/h, 34.3 % stopped, wait p90/max 26 / 113 s,
  longest hold 112 s (car 58 stopped for `room` on the west approach `(-1174, 136) → (-1136, 127)`, car 10 109 s
  behind it). The cause, cars waiting for exit room across the `(-1117, 132)` / `(-1136, 127)` signal pair, is not
  fixed, so any change to spawns or routing can fail the test again; find the blocker chain and fix it, or pick a
  bound that is not one hold away from failing. [Centrum trace](observations/kaponiera-traffic-2026-11-10.md#current-centrum-regression).
- **Car–tram body overlaps:** at `5e6a68e` the default seed-4242 audit has 10 pairs (Jeżyce 5, Centrum 2,
  Stare Miasto 2, Kaponiera 1) and eight seeds **73** (moving 53, stopped 20; Jeżyce 47, Centrum 11, Kaponiera 8,
  Stare Miasto 7), against 54 quoted from before the `42329c3` network. Diagnoses at `42329c3`: in Jeżyce seed 2 four
  stopped articulated buses queue on the 26 m connector out of short edge 2595 under the turning tram's sections (the
  audit treats an articulated bus as one 18 m rectangle), and the seed-4242 pairs are rear approaches on straight
  shared edge 4692 where the follower has lost the tram proxy as its leader because the proxy is dropped for the whole
  mapped stretch. Clipping the proxy behind the tram's obstacle cleared the default Jeżyce pairs but cut Jeżyce to
  12.9 km/h / 38.1 % stopped (from 13.5 / 35.1) and was reverted. `tools/audit-tram-opposing-lanes.mjs` is unchanged
  at **40** street-running rows / 38 lanes / 293 m (`--all` 55 / 51 / 498): 37 short stubs (35 lanes, 252 m) with no
  4.6 m band between the tracks and the curb, and three curved runs (41 m) that sweep a track across the whole
  carriageway; they need per-station lane geometry. Moving the Rynek Jeżycki stubs still increases overlaps and adds
  a deadlock. Rejected: the same-direction proxy clip above, the unheld-curve arrival forecast (same 54, pairs moved),
  a 1.5 m gate standoff (60 pairs, Centrum 4 → 10), projected entry speed (Kaponiera 3, Centrum 1, mean 11.3 km/h,
  switch waits 40.9 s), the `enter` hard stop, the stand test in every short-link `tramBlocks` call or a
  long-connector stop, the feeder two-step, the unrestricted sibling lane, the rear-gap rule for every moving queue,
  and accepting a residual below the audit's 5 m floor (it hides the 1.5 m overlap left at 5523).
  [2026-11-10 traces and re-measurement](observations/car-tram-overlaps-2026-11-10.md),
  [moving-gate measurements](observations/car-tram-overlaps-2026-11-09.md),
  [short-link pass and rejected variants](observations/car-tram-overlaps-2026-11-08.md),
  [eight-seed results](observations/tram-overlaps-2026-11-04.md),
  [opposing lanes](observations/tram-opposing-lanes-2026-11-08.md).

Decided: central density stays as built (user, 2026-11-10). Jeżyce and Łazarz at 1.19× / 1.20× their OSM district
share are not thinned; [central-density record](observations/central-density-2026-11-08.md).

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
- Check the street-aligned fallback lots and courtyard guard (`fb091f6`) and the near balcony pool (`0fa3fdf`) on
  WebGPU and WebGL2. Along Podgórna, Strzelecka, Plac Wiosny Ludów and around Kupiec Poznański, fallback kamienice
  should follow the street angle and no courtyard lawn should come within 4.6 m of the roadway (over the pavement) or
  over a tram track. In Wilda around `−690, 1820`, near balconies should fill the closest facades first, with no
  missing stacks next to the camera now that the pool holds 384.
  [Alignment record](observations/street-alignment-2026-11-09.md).
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
- Inspect the 2026-11-08 span and cantilever heads on WebGPU and WebGL2: the 48 cantilever heads (16 new 6.2 m
  masts) and 27 span heads (25 new 10 m masts), stay height and sag above the tram wires and portals, and the Górna
  Wilda head hanging from the two 7.6 m traction poles (stays at 7.2 m). Check visibility through the queue and that
  no mast, stay or head clips a tram. [Measurements](observations/missing-signal-heads-2026-11-08.md).
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
