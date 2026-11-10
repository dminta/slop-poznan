# Poznań backlog

Updated 2026-11-10. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Pedestrian overlap residual:** at `5e6a68e` the eight-district audit (seeds 4242/77, 3 min) has no cluster
  (0 clusters, 5.43 overlapping pairs/s, 105.3 crosswalk entries/min); `564975e` cleared the Pasaż Różowy cluster the
  `42329c3` layout restore had created (10 clusters, longest 26 s). The traffic fixes since then do not touch
  pedestrians. Open: Most Dworcowy / Głogowska corner-link pairs of 16–19 s at `(-1558, 575)`, both seeds. The 19 s
  pair is a head-on entrance cycle, not a red-light wait: an isolated 4.78 m split sidewalk has its two painted lane
  lines (inset 1.7 / 2.8 m) joined by a 1.1 m U-turn at each end, so the two lines form a closed 4.8 × 1.1 m
  racetrack and the two directions of one U-turn link meet head-on. A world scan finds 332 such closed twin-lane
  tracks (249 split, 83 full; 67 under 6 m); Św. Marcin, Taczaka, Wilda and Rataje show the same 16–20 s stand-off
  that the 20 s recovery ends. Centrum's Pasaż Różowy
  pocket is a 1.87 m pedestrian way whose four lines form a clique of 1.1–5.6 m links with no through exit; it still
  freezes walkers routed into it (`--ped-rooms` 22,550 of ~93,700 ped-s, longest 20.1 s; 7-district total 40,271
  ped-s). The 2026-11-10 twin-lane pass root-caused both and tried route-build traps, dead-end sink guards, spawn
  filters, one-direction-at-a-time short links, a length-scaled lane ramp and a delayed entrance swap. It killed the
  named pair and improved the overlap rate (full audit 5.24 pairs/s, 110.0 entries/min) but left one 5 s Pasaż
  cluster and raised rooms to 43,399 ped-s (Centrum 22,949); every other variant moved a cluster or made the room
  total worse. All were reverted, so the baseline is unchanged. Do not revive the length-weighted goal pick
  (Centrum 22,111 → 24,189 ped-s), a one-person minimum capacity on short links (the hold moved, pairs/s 6.2 → 7.6),
  a world-grid body-clearance check at short-link entrances (new 19 s pairs at Głogowska / Zachodnia), ignoring an
  oncoming blocker on the same route key (no effect), matching the reversed link by its endpoints (pairs/s up in both
  seeds, ~19 %), the same after 5 s stuck (hold persists), dropping dead-end twin U-turns (pairs/s 7.1 → 9.1), or a
  one-direction-at-a-time rule on tracks under 3 m (rooms +1,914 ped-s at Centrum alone). [Corner-link record](observations/ped-corner-links-2026-11-10.md),
  [twin-lane and Pasaż pass](observations/ped-twin-lane-loops-2026-11-10.md),
  [Pasaż record](observations/ped-overlap-pasaz-2026-11-10.md),
  [mechanisms](observations/ped-overlap-remnants-2026-11-08.md).
- **Kaponiera long holds and the last deadlock:** at `6d70c71` (8 seeds × 7 districts, 5 min) every hold > 120 s and
  every deadlock is in Kaponiera: 12.6 km/h, 51.3 % stopped, worst wait 145 s, held > 60 s 133, > 120 s **13**,
  **1** deadlock, 2 box-stuck seeds (from 12.3 km/h, 52.2 %, 155 s, 167 / 21 / 5 / 3 at `3279f75`). `6d70c71` broke
  the tram → car → (car →) own proxy → tram cycles (seeds 1, 7, 99 and one of seed 5's): the tram's road-car gate now
  skips a car stopped ≥ `QUEUED_RELEASE_WAIT` 20 s behind that tram's proxy, directly or via one stopped car, whose
  stopped body is outside the swept envelope. Open: seed 2's 10 holds > 120 s (a queue backed up from a red at
  `(-1497, 198)`, no wait-for cycle); seed 5's 70 s deadlock, car 66 refused room on the 10 m approach to
  `(-1468, 118)` by a proxy plus a real stopped car on the exit while tram 13 waits for it; seed 7's one
  hold > 120 s. Do not revive the entry guard that counts tram proxies as exit occupancy (seed 7 held > 120 s 6 → 19 and a
  deadlock, Jeżyce seed 1 16.0 → 12.8 km/h), the release only for a direct proxy follower (the seed-1 cycle runs
  through a car) or without the 20 s wait (audit 73 → 79, trams passing a just-released car at 5–6.5 m/s), ignoring
  the waiting tram's proxy for its connector obstacle (the cycle became three vehicles, box still 84 s), counting the
  room behind an exit-lane tram proxy (no change), the rejected unrestricted sibling lane (cars entered a left-turn
  lane over the tram tracks and two trams waited 89 s at switches), the version applied to links that do not store
  for a signal (Jeżyce's `(-2023, -448)` car–tram cycle returned and the audit rose to 13 pairs), the rear-gap rule
  for every moving queue (it cut the merge's throughput and added a deadlock), or the early-arrival and lane-lead
  braking relaxations without their regressions.
  [Deadlock traces and the queued-release fix](observations/kaponiera-deadlock-traces-2026-11-10.md),
  [2026-11-10 traces and re-measurement](observations/kaponiera-traffic-2026-11-10.md),
  [2026-11-08 trace and rejected variants](observations/kaponiera-traffic-2026-11-08.md),
  [Centrum trace](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Centrum exit-room tails:** `f20646d` lets a straight car on a < 12 m link between signals wait in the box before
  an exit over 17.5 m (`SHORT_SIGNAL_LINK` / `BOX_WAIT_EXIT`), which gives `tests/traffic-flow.test.mjs` 34 s of
  margin (seed 1 longest hold 112 → 86 s; Centrum 14.5 km/h, 33.4 % stopped, held > 60 s 13 → 10). Seeds 5 and 11
  trade throughput for longer tails (58 → 76 s, 65 → 86 s) with more cars through `(-1117, 132)` stopping for the
  merge; watch them if spawns or routing change. Do not revive projected exit room (Kaponiera seed 4242 hold
  111 → 156 s, a seed-99 deadlock), the unscoped box wait (Kaponiera seed 7 deadlocks 1 → 2, a 39 s cycle at
  `(-1503, 224)`) or scoping it by tram conflicts (no effect: every Centrum straight curve there crosses a track).
  [Exit-room record](observations/centrum-exit-room-2026-11-10.md).
- **Car–tram body overlaps:** at `6d70c71` the eight-seed audit has **36** pairs (Jeżyce 21, Kaponiera 9,
  Stare Miasto 5, Centrum 1). `3279f75` gave the nearest same-direction car behind a tram a private leader where the
  tram's lane proxy is dropped (`protectTramFollower`): 73 → 37 (moving 53 → 19, stopped 20 → 18; Jeżyce 47 → 21,
  Centrum 11 → 1), with no new hold or deadlock (Jeżyce seed 4242 13.3 → 14.1 km/h); `6d70c71` moved Kaponiera
  8 → 9 and Stare Miasto 7 → 5. Diagnosed in Jeżyce at `aecdb54`: seed 2 car 19 stopped inside tram 21's turning
  sweep at `(-2050, -456)`, seed 2 car 47 whose proxy leader arrived after contact on edge 8081, and seed 4242 bus 204
  at `(-2056, -458)`, where the audit's rigid 18 m rectangle starts the contact a second early but the 10.4 m front
  section then really overlaps tram sections 0–2. The Kaponiera and Stare Miasto pairs are undiagnosed.
  `tools/audit-tram-opposing-lanes.mjs` is unchanged at **40** street-running rows / 38 lanes / 293 m (`--all`
  55 / 51 / 498): 37 short stubs (35 lanes, 252 m) with no 4.6 m band between the tracks and the curb, and three
  curved runs (41 m) that sweep a track across the whole carriageway; they need per-station lane geometry. Moving the
  Rynek Jeżycki stubs still increases overlaps and adds a deadlock. Rejected: clipping the shared proxy behind the
  tram's obstacle (Jeżyce 13.5 → 12.9 km/h), the unheld-curve arrival forecast (same 54, pairs moved), a 1.5 m gate
  standoff (60 pairs, Centrum 4 → 10), projected entry speed (Kaponiera 3, Centrum 1, mean 11.3 km/h, switch waits
  40.9 s), the `enter` hard stop, the stand test in every short-link `tramBlocks` call or a long-connector stop, the
  feeder two-step, the unrestricted sibling lane, the rear-gap rule for every moving queue, and accepting a residual
  below the audit's 5 m floor (it hides the 1.5 m overlap left at 5523).
  [Jeżyce traces and the follower fix](observations/car-tram-jezyce-2026-11-10.md),
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
