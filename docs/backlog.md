# Poznań backlog

Updated 2026-11-11. Only remaining work, open decisions and outstanding browser checks are listed below.
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
- **Kaponiera long holds and the last deadlock:** at `8c41595` (8 seeds × 7 districts, 5 min) every hold > 120 s and
  every deadlock is in Kaponiera: 12.6 km/h, 51.3 % stopped, worst wait 145 s, held > 60 s 133, > 120 s **13**,
  **1** deadlock, 2 box-stuck seeds (from 12.3 km/h, 52.2 %, 155 s, 167 / 21 / 5 / 3 at `3279f75`). `6d70c71` broke
  the tram → car → (car →) own proxy → tram cycles (seeds 1, 7, 99 and one of seed 5's): the tram's road-car gate now
  skips a car stopped ≥ `QUEUED_RELEASE_WAIT` 20 s behind that tram's proxy, directly or via one stopped car, whose
  stopped body is outside the swept envelope. `proxyYieldsTo` (2026-11-10) breaks seed 5's remaining 70 s cycle: a
  tram stopped ≥ 20 s for the car yields its own crossing pad in the car's exit lane once the car has waited 20 s and
  the lane, after any real queue in it, holds the car's rear clear of the pad, so the car goes first while the tram's
  sweep keeps the tram stopped.
  Seed 5: held > 120 s 2 → 0, deadlocks 1 → 0, 11.7 → 11.8 km/h, held > 60 s 31 → 28; the other seven seeds are
  bit-identical (8-seed held > 120 s 13 → 11, held > 60 s 133 → 130, deadlocks 1 → 0). Seed 2's 10 holds over 120 s
  were then fixed in the signal plan (2026-11-11): the 37.8 m crossing over Roosevelta's tram corridor clears at the
  1.2 m/s design walking speed (`SIGNAL_WALK_SPEEDS`), so its group-0 stage needs 34 s instead of 40 s and the 10 m
  two-lane give-way link gets 16 s instead of 10 s (2.4 → 3.8 cars/min). Seed 2 goes 10 → 0 holds over 120 s and
  169 → 116 s longest; the eight Kaponiera seeds go 11 → 1 hold, 130 → 90 over 60 s, 12.6 → 13.1 km/h, 0 deadlocks.
  Costs: seed 1's new 175 s queue into Centrum, seed 5's one box stop, Centrum −0.2 km/h and Jeżyce +0.1 km/h (the
  other four districts are bit-identical); the eight-seed car–tram audit is 37 before and 37 after on this tree (36
  was measured at 8c41595), Kaponiera 9 → 8 and Jeżyce 21 → 23. Open: seed 7's one 139 s hold (a line-20 switch jam holds
  the crossing proxies, not a car rule); seed 1's new boundary queue and seed 5's box stop. Rejected in this pass:
  1.2 m/s for every plan (173 plans re-timed, two Kaponiera deadlocks over eight seeds), green1 12–15 s at this site
  (audit 38–39, a deadlock, or mean speed lower), keeping the 1 m/s split and moving the offset (seed 2 still had
  7 holds), and the +6 s phase-preserving offset (Centrum and Jeżyce bit-identical but 8 holds and audit 38). The
  crossing has no refuge to split (rail clearance falls to 0.1 m mid-span).
  [Signal-plan record](observations/kaponiera-signal-plan-2026-11-11.md).
  Do not revive the entry guard that counts tram proxies as exit
  occupancy (seed 7 held > 120 s 6 → 19 and a deadlock, Jeżyce seed 1 16.0 → 12.8 km/h), the release only for a
  direct proxy follower (the seed-1 cycle runs through a car) or without the 20 s wait (audit 73 → 79, trams passing
  a just-released car at 5–6.5 m/s), ignoring the waiting tram's proxy for its connector obstacle (the cycle became
  three vehicles, box still 84 s), counting the room behind an exit-lane tram proxy (no change), the rejected
  unrestricted sibling lane (cars entered a left-turn lane over the tram tracks and two trams waited 89 s at
  switches), the version applied to links that do not store for a signal (Jeżyce's `(-2023, -448)` car–tram cycle
  returned and the audit rose to 13 pairs), the rear-gap rule for every moving queue (it cut the merge's throughput
  and added a deadlock), the early-arrival and lane-lead braking relaxations without their regressions, or the
  tram-pad release without both 20 s wait terms (a momentary stop released a seed-99 car that had just reached the
  line and left an unrelated bus in a 124 s red-light hold).
  [Tram-pad release](observations/kaponiera-tram-pad-release-2026-11-10.md),
  [Deadlock traces and the queued-release fix](observations/kaponiera-deadlock-traces-2026-11-10.md),
  [2026-11-10 traces and re-measurement](observations/kaponiera-traffic-2026-11-10.md),
  [2026-11-08 trace and rejected variants](observations/kaponiera-traffic-2026-11-08.md),
  [Centrum trace](observations/merge-starvation-2026-11-07.md),
  [per-second left-turn/tram trace](observations/left-turn-tram-2026-11-04.md).
- **Car–tram body overlaps:** at `6d70c71` the eight-seed audit has **36** pairs (Jeżyce 21, Kaponiera 9,
  Stare Miasto 5, Centrum 1). `3279f75` gave the nearest same-direction car behind a tram a private leader where the
  tram's lane proxy is dropped (`protectTramFollower`): 73 → 37 (moving 53 → 19, stopped 20 → 18; Jeżyce 47 → 21,
  Centrum 11 → 1), with no new hold or deadlock (Jeżyce seed 4242 13.3 → 14.1 km/h); `6d70c71` moved Kaponiera
  8 → 9 and Stare Miasto 7 → 5. Diagnosed in Jeżyce at `aecdb54`: seed 2 car 19 stopped inside tram 21's turning
  sweep at `(-2050, -456)`, seed 2 car 47 whose proxy leader arrived after contact on edge 8081, and seed 4242 bus 204
  at `(-2056, -458)`, where the audit's rigid 18 m rectangle starts the contact a second early but the 10.4 m front
  section then really overlaps tram sections 0–2. **Kaponiera and Stare Miasto are diagnosed at `8c41595`**
  ([record](observations/car-tram-kaponiera-stare-2026-11-10.md)): 6 of Kaponiera's 9 are the feeder race at the
  10 m link 7909 (`-1385, -216`; seeds 1, 4242, 7, 5, 11) and link 280 (`-1497, 237`, seed 2) — the car passes the
  entry guard while it can still stand on the link, accelerates along the 40–45 m feeder past that speed (7.5 → 12.8,
  4.4 → 13.6 m/s), and the `enter` too-fast fallback then crosses the link line into the tram's curve; the other 3
  are stopped/slow cars inside a tram's turning sweep at `-1125…-1138, 140…167` (seeds 7, 99, 5). Stare Miasto's 5
  are 3 side-by-side contacts on the shared street-running lane at `-318, -184` (the 10 m stubs 8503/8504 carry one
  `+1.80 m` lane the track runs along), and 2 cars whose corner reaches a tram nose that stopped 0.4–3.1 m before the
  conflict while waiting for that very car (seeds 1 and 4242). Rejected in this pass: **a feeder speed cap** (cap a
  car on the connector at the speed it can stand from inside the short link while its exit curve is tram-held within
  20 m or has a standing tram, shared tram lanes excluded, engaged above 1.6× the standable speed). It removed the
  `-1385` cluster in every tested seed but the eight-seed audit was 34 (Jeżyce 21 → 23, Centrum 1 → 4, Kaponiera
  9 → 3, Stare 5 → 4) and the default-seed benchmark lost 1.9 km/h at Kaponiera (13.7 → 11.8, stopped 47.1 →
  52.9 %, maximum wait 112 → 119 s; all districts 14.9 → 14.4 km/h); **a connector stop for a tram standing at the
  exit curve**, including one waiting for this car, added a 146 s hold and one car held over 120 s at Jeżyce seed
  4242. Both were reverted; the `tramStandsAt` "tram waits for me" exemption must stay. The turning-sweep and
  shared-lane families need geometry (stop lines inside the swept envelope, a 10 m stub lane inside the tram's width),
  not a queue rule.
  `tools/audit-tram-opposing-lanes.mjs` is unchanged at **40** street-running rows / 38 lanes / 293 m (`--all`
  55 / 51 / 498): 37 short stubs (35 lanes, 252 m) with no 4.6 m band between the tracks and the curb, and three
  curved runs (41 m) that sweep a track across the whole carriageway; they need per-station lane geometry. Moving the
  Rynek Jeżycki stubs still increases overlaps and adds a deadlock. Rejected: clipping the shared proxy behind the
  tram's obstacle (Jeżyce 13.5 → 12.9 km/h), the unheld-curve arrival forecast (same 54, pairs moved), a 1.5 m gate
  standoff (60 pairs, Centrum 4 → 10), projected entry speed (Kaponiera 3, Centrum 1, mean 11.3 km/h, switch waits
  40.9 s), the `enter` hard stop, the stand test in every short-link `tramBlocks` call or a long-connector stop, the
  feeder two-step, the unrestricted sibling lane, the rear-gap rule for every moving queue, and accepting a residual
  below the audit's 5 m floor (it hides the 1.5 m overlap left at 5523).
  [Kaponiera and Stare diagnosis](observations/car-tram-kaponiera-stare-2026-11-10.md),
  [Jeżyce traces and the follower fix](observations/car-tram-jezyce-2026-11-10.md),
  [2026-11-10 traces and re-measurement](observations/car-tram-overlaps-2026-11-10.md),
  [moving-gate measurements](observations/car-tram-overlaps-2026-11-09.md),
  [short-link pass and rejected variants](observations/car-tram-overlaps-2026-11-08.md),
  [eight-seed results](observations/tram-overlaps-2026-11-04.md),
  [opposing lanes](observations/tram-opposing-lanes-2026-11-08.md).

Decided: central density stays as built (user, 2026-11-10). Jeżyce and Łazarz at 1.19× / 1.20× their OSM district
share are not thinned; [central-density record](observations/central-density-2026-11-08.md).

## Optional features and fidelity

- **Performance on older devices** (users report slowness): measured 2026-11-11 in headless Chrome (WebGPU, Apple
  silicon, 1280 × 720): Rynek street view 1,553 draws / 7.9 M triangles / 11–13 ms renderer CPU, Centrum drone 2,851
  draws; the sun-shadow pass is ~half the draws and 68 % of submitted instances at Rynek are off screen; 903 MB JS
  heap, 412 MB GPU memory. Done: frozen static matrices (`c1f5e66`, renderer CPU −20 to −24 % at Rynek) and indexed
  load-time predicates (boot 18.4 → 11.9 s at 1× on a busy machine,
  [record](observations/perf-boot-predicates-2026-11-11.md)), a low graphics tier (`js/graphics-quality.js`:
  `?quality=` or auto-detected on touch-first phones / WebGL2 / ≤ 4 cores / ≤ 4 GB; Rynek renderer CPU 16.3 → 12.0 ms,
  GPU 34 → 6 ms) and
  halved mural / tram plate canvases ([record](observations/perf-memory-2026-11-11.md)). Not yet measured on a real
  phone or integrated GPU.
  Remaining: draw-call batching (roofs per chunk, street furniture), tree LOD / draw distance, then the other boot
  hotspots (`outlineRay` 14–17 %). [Ranked opportunities](observations/perf-older-devices-2026-11-11.md).
- Road levels and richer road-priority classification; revisit only with a runtime consumer.
- Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data: research candidates.

## Browser checks still outstanding

The 2026-11-11 headless Chrome pass is recorded in
[observations/browser-checks-2026-11-11.md](observations/browser-checks-2026-11-11.md). It covered part or all of the
checks below; each remaining bullet is the part that is still open.

### Defects found in the 2026-11-11 browser checks

- **Teatr Polski is buried behind a generated block:** at `(-701, -5)` its front faces south-west towards
  `(-717, 53)`, but generated buildings stand on that frontage at z 20–37 (colliders `maxY` 15.2–22.8 m). A camera at
  the modelled front is inside a brick wall, and a street view from the south-east shows a generic tenement with a
  `PIZZERIA` sign; from the air the white portico sits in a narrow slot between roofs. Cut the block back to the
  theatre's forecourt and re-check the front and entrance from ul. 27 Grudnia/Fredry on WebGPU and WebGL2.
  Note: the real Teatr Polski stands back in a courtyard behind the ul. 27 Grudnia frontage, reached through a gate,
  so a partly hidden front is correct; check the courtyard footprint against OSM before cutting the block.
- **The player taxi's left-side stripe mesh is culled:** the left side at the spawn `(-1060.6, 124.3)` shows the
  body's street-taxi fallback (chequer edges, crest, `1427` above the band) instead of the dedicated stripe: no white
  field, `TAXI`/`POZNAŃ` or number panel. The right side is correct on WebGPU and WebGL2. `buildCarSidePatch` reverses
  both the z order and the triangle indices for `side < 0`, so the left patch normal points +x into the car and the
  `FrontSide` material culls it; use one winding for both sides and add a both-patches-face-outward test.
- **Re-check the taxi livery at midnight after fixing D2:** the culled left stripe leaves the body fallback nearly black
  under the midnight streetlight pool. Capture both sides at a lit door after the winding fix; if the right side is also
  unreadable, add a small emissive lift to the stripe.
- **Phone touch layout overlaps:** at 390 × 844 the `.touch-look-hint` (top 136 px) is partly covered by the camera
  switcher (`#hud-bottom-right`, top 78 px), and the current-camera label ellipsizes to "Kamera za grac…" on both the
  phone and the 1280 × 720 desktop HUD. Move the hint below the camera cluster (or hide it while the cluster is open) and
  widen/shorten the camera label.
- **The WebGL2 fallback labels itself WebGPU:** with `?backend=webgl` the HUD subtitle still reads
  `three.js · WebGPU · TSL` and the loading status says `Inicjalizacja WebGPURenderer…`. Drive both strings from
  `renderer.backend.isWebGPUBackend` (or drop the backend name from the static HUD).
- **Fara niches:** the four lower-tier statues on the north front at `(6.5, 229.5)` (niches y ≈ 9.35–13.85) have their
  crozier/spear/cross in the same sandstone colour as the robes, not gilded, and the niches are unlit at midnight. The
  aedicules, hoods, silhouettes, the 2.1 m outer-pair rise and the absence of z-fighting are correct.

### Interface and performance

- Confirm the loading-screen credit link hover/focus and external navigation in a real (non-headless) browser; its
  colours, contrast, dark-mode independence and credit layout at 1280 × 720 and 390 × 844 were checked 2026-11-11.
- Verify shop-sign atlas mip bleed at grazing angles on WebGPU and WebGL2; per-instance cell selection, the two chain
  signs and the dusk/night spot colours were checked 2026-11-11 (all 28 cells in the live pool, `ŻABKA`/`BIEDRONKA`
  legible day, twilight and midnight).
- Measure draw calls, shadow-pass share and the transitions across roof/dormer coverage, pool limits, estate slabs and
  the outskirts on both backends; boot time and fps at seven viewpoints were measured 2026-11-11.
- Measure Ławica's draw-call/shadow cost; the runway from the air and Bukowska, the terminals and jet bridges, the
  markings and night lights, and the 3.5 cm tarmac/land join were checked 2026-11-11 with no z-fighting.

### Geometry, materials and collisions

- Inspect the new non-residential silhouettes from a free camera and street level: Posnania (#953, 11–16 m mall with
  rooflights), Castorama (#21, 7.6 m retail park), ZNTK (#846, 11.4 m halls), EC Garbary (#266, utility halls plus the
  fallback 65 m chimney and 55 m cooling tower) and the Główna halls (blocks 36/78/95), on WebGPU and WebGL2, including
  yard/apron joins, tower colliders and any z-fighting. Aerial views of Posnania, Castorama and the Główna 78/95 halls
  were checked 2026-11-11; the EC Garbary chimney/cooling tower, the ZNTK halls, street level and WebGL2 remain open.
  [Profiles record](observations/building-profiles-nonres-2026-11-08.md).
- Continue the landmark checks for the views that were obstructed on 2026-11-11: the Muzeum old front at night, the
  Ratusz from the east at night, Pałac Działyńskich's full silhouette, Hotel Bazar from Paderewskiego, the Zamek
  Królewski main block behind the museum, and Kościół Franciszkanów from the street. Fara, Biblioteka Raczyńskich,
  Bernardynów, Boże Ciało, Collegium Maius, NMP in Summo and św. Wojciech were framed on WebGPU; Fara, Biblioteka,
  Bernardynów and Boże Ciało were repeated on WebGL2.
  [Landmark measurements](observations/landmarks-2026-11-05.md).
- Check Dworzec Letni and the Garbary canopy from a train/car, and a train or car passing under the Główny platform
  decks; the Główny platform underside/beams, Kaponiera tram canopy, a fuel forecourt and a pergola were checked
  2026-11-11, with no post in a track and no clipping seen.
  [Canopy record](observations/platform-canopies-2026-11-08.md).
- Check every courtyard along Podgórna, Strzelecka, Plac Wiosny Ludów and around Kupiec Poznański (no lawn within
  4.6 m of the roadway or over a track); the Podgórna/Strzelecka aerial and the Wilda near-balcony pool
  (262 instances, five complete storeys, nearest 38 m) were checked 2026-11-11.
  [Alignment record](observations/street-alignment-2026-11-09.md).
- Inspect outward-facing x-ridge kit roofs (Ratusz, Katedra, Zamek Cesarski, Teatr Wielki, Dworzec and others)
  from above and street level, including shading, rotated-block ridges and normals.
- Continue landmark-placement and scenic-camera checks, panel-material shimmer, balcony LOD transitions and
  platform/slab flicker where surfaces are only 1 cm apart.
- Check Most Świętego Rocha and Most Królowej Jadwigi from the bank; Most Chrobrego, Most Mieszka I and the 13 m Most
  Dworcowy approach were checked 2026-11-11.
- Check relocated street trees near landings, zebras, lanes and island edges; walk the surveyed OSM rows in Stare Miasto
  and around Park Cytadela, compare a few pits with the OSM points, and measure frame rate and draw calls at street level
  and from the drone (the 88,479-site scene allocates about 21 MB of tree instance buffers). The Rybaki collision was
  checked 2026-11-11: the player deflected 0.57 m around a tree with a player collider at `(-285.9, 874.5)`.
  [Tree-placement audit and pins](observations/street-tree-clearance-2026-11-06.md),
  [OSM tree record](observations/osm-street-trees-2026-11-08.md).
- Walk and drive around the named diagonal tram shelters at Dworzec Zachodni and Żniwna, checking collision against
  their back glass and ends; a shelter at `(-1552.6, 229.7)` stopped the walking player at 3.84 m on 2026-11-11.
  [Furniture geometry](world.md#tram-infrastructure).
- Inspect park lamps on Za Cytadelą and lamps moved onto lawns in narrow-walk parks (e.g. block 212 near
  `−953, −1928`); check trees by Avenida and in park blocks with buildings (Park Nad Wartą, Antoninek block 874).
  [Tree/building clearance](observations/tree-building-clearance-2026-11-03.md).
- Check the corrected heights of Iglica, Delta, Brama Poznania and Zamek Królewski, and the refined Teatr Wielki
  portico/Pegasus from street level and above; the Fara front gable/cross reads from Świętosławska.
- Check mainline railway sleepers remain visible; the tram rails without a track bed were checked flush on the road at
  Kaponiera on WebGPU and WebGL2 2026-11-11.
- Inspect black locust foliage, bark, LOD and wind. [Tree models](world.md).

### Signals, traffic and audio

- Continue signal checks at Most Teatralny and Głogowska/Hetmańska, including visible head orientation/colour
  correspondence and WebGL2; the Kaponiera heads were checked day/twilight 2026-11-11. Extend NPC demand-request
  coverage beyond node `2422` and test the full rendered Św. Marcin green-wave corridor and crossing ticks against
  displayed heads. [Previous coverage and limits](observations/signals-2026-10-30.md).
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
  visible clipping or stopping within the approximately 1 s forecast gap. A six-frame twilight watch on 2026-11-11 saw
  no clipping, but not the named pair.
- Watch whole trams clear switches, crossings and occupied stops; observe Zawady/Ogrody loop boarding and return
  destinations and the Starołęka boundary routes.
- Listen to sirens, bells, tram motors/squeal and the noon show; verify local timing and audible range.

For each fix, record measurements and regression checks in the topic docs or observation records, and state which
browser checks were actually performed. Remove completed tasks from this backlog; retain only unresolved work.
