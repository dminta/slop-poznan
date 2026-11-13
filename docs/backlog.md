# Poznań backlog

Updated 2026-11-12. Only remaining work, open decisions and outstanding browser checks are listed below.
Implementation details and completed measurements live in the [topic docs](../AGENTS.md#docs) and
[observation records](observations/). Original phase references refer to the [archived port plan](archive/poznan-plan.md).

## Known gaps and follow-up investigations

- **Piotrowo heights:** confirm the new rectorate against a post-completion survey; its 16.5 m model height now
  follows the documented 16.31 m above-ground portion. A28/A29 use 2024 elevation data; A30 uses PP’s 11.80 m dimension.
  Vault profiles, tagged pitch surfaces/markings and the circular lecture forecourt are implemented. See [world](world.md#piotrowo-campus-landmarks-2026-11-12-round-2) and
  [height evidence](geodata.md#piotrowo-campus-snapshot-2026-11-12).

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
  was measured at 8c41595), Kaponiera 9 → 8 and Jeżyce 21 → 23. Rechecked on 2026-11-13: seed 7's old 139 s hold
  was already removed by that signal change (longest 95 s, maximum switch wait 7.9 s). The remaining one hold over
  120 s belongs to seed 1's 175 s boundary queue; seed 5's box stop also stays open. The historical switch replay
  distinguishes line 20's occupied-switch and boarding-crossing waits from line 2's 81.4 s maximum; no new runtime
  change was justified. [Switch investigation](observations/kaponiera-switch-jam-2026-11-13.md). Rejected in this pass:
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
- **Car–tram body overlaps:** re-measured at `5199713`: **37 pairs** over eight seeds (Jeżyce 23,
  Kaponiera 8, Stare Miasto 5, Centrum 1; 19 moving / 18 stopped), one car held over 120 s and no deadlock.
  [Section-sweep audit and city-wide list](observations/car-tram-sweep-2026-11-12.md): 176 intruding lane ends,
  only 37 able to retreat clear while retaining six metres. The named Jeżyce 10 m stubs need 24.75 / 10.25 m
  retreat; Kaponiera 6522 needs 2.25 / 6.25 / 9.50 m across its three lanes on a 9.41 m edge. A whole-edge
  setback cannot clear these while storing a car. All current Kaponiera contacts start moving; the feeder race
  remains outside this pass. Stare Miasto 8503/8504 have lateral room, but the measured +3.70 / +4.60 m offset
  candidate leaves the eight-seed total at 37 and is rejected: seed 2 mean 18.4 → 17.3 km/h, stopped 6.5 → 10.2%;
  seed 7 off-stop tram holds >60 s 1 → 3, against zero measured repeat noise. No runtime geometry change is retained.
  Connector queues and the Jeżyce shared-lane body contacts remain; the new tool is a sampled section envelope, not a continuous collision proof.
  The opposing-lane audit stays **40 runs / 38 lanes / 293 m** (`--all` 55 / 51 / 498); the Rynek Jeżycki lane
  moves still increase overlaps and add a deadlock. Do not retry the rejected feeder cap, connector stop, proxy
  clipping, gate standoff, projected entry speed, unheld-curve forecast, `enter` hard stop, broad stand test,
  feeder two-step, unrestricted sibling lane, moving-queue rear-gap rule or below-5 m residual hiding without a
  new geometric reason. Keep `tramStandsAt`'s "tram waits for me" exemption.
  [Kaponiera and Stare diagnosis](observations/car-tram-kaponiera-stare-2026-11-10.md),
  [Jeżyce traces and follower fix](observations/car-tram-jezyce-2026-11-10.md),
  [2026-11-10 baseline](observations/car-tram-overlaps-2026-11-10.md),
  [moving gate](observations/car-tram-overlaps-2026-11-09.md),
  [short-link pass](observations/car-tram-overlaps-2026-11-08.md),
  [older eight-seed results](observations/tram-overlaps-2026-11-04.md),
  [opposing lanes](observations/tram-opposing-lanes-2026-11-08.md).

Decided: central density stays as built (user, 2026-11-10). Jeżyce and Łazarz at 1.19× / 1.20× their OSM district
share are not thinned; [central-density record](observations/central-density-2026-11-08.md).

## Optional features and fidelity

- **Performance on older devices** (users report slowness): measured 2026-11-11 in headless Chrome (WebGPU, Apple
  silicon, 1280 × 720): Rynek street view 1,553 draws / 7.9 M triangles / 11–13 ms renderer CPU, Centrum drone 2,851
  draws; the sun-shadow pass is ~half the draws and 68 % of submitted instances at Rynek are off screen; 903 MB JS
  heap, 412 MB GPU memory. Done: frozen static matrices (`c1f5e66`, renderer CPU −20 to −24 % at Rynek) and indexed
  load-time predicates (boot 18.4 → 11.9 s at 1× on a busy machine,
  [record](observations/perf-boot-predicates-2026-11-11.md)), the block frontage / curb / tram-rail indexes of boot
  part 2 (`outlineRay` and the tram/rail nearest queries; headless build 15.4 → 9.5 s;
  [record](observations/perf-boot-2-2026-11-11.md)), boot part 3 (land raster near-water block skip, road-network
  crossing-run rejects / CSR components / split footprint hash, city-grid ring and road-segment buckets, rail
  keep-out row spans; browser boot 1× −4 % and 6× −21 %, headless build 14.7 → 9.4 s;
  [record](observations/perf-boot-3-2026-11-11.md)), a low graphics tier (`js/graphics-quality.js`:
  `?quality=` or auto-detected from the GPU identity / WebGL2 / ≤ 4 cores / ≤ 4 GB / touch-first unknown GPU; Rynek
  renderer CPU 16.3 → 12.0 ms, GPU 34 → 6 ms), halved mural / tram plate canvases
  ([record](observations/perf-memory-2026-11-11.md)), the low-tier tree profile
  ([record](observations/perf-trees-2026-11-11.md): the Centrum drone drops 488 of 1,879 draws and 72 % of tree
  triangles; Rynek −85 draws at street level; high is pixel-identical), and draw-call batching (roofs merged per
  piece, lamp mast + housing merged, cheap-prop culling cells, merged prop shadow stand-ins on high only; see
  [record](observations/perf-draw-calls-2026-11-11.md) for the rebased ablation). Not yet measured on a real phone or
  integrated GPU; `?stats=1` shows a copyable report for that.
  Retained JS heap after GC is now ~843 MB high / ~780 MB low: after the first captured-scope release
  (−104 MB, [record](observations/perf-heap-2026-11-11.md)), the second pass releases local building/tree/road staging
  and packs immutable footprint queries (a further ~43 MiB per tier, with equivalent graph hashes and unchanged frame
  p50; [record](observations/perf-heap-2-2026-11-12.md)).
  Street furniture geometry trimmed (lamp masts, hydrants, gas lanterns, bollards, columns: −43 % furniture
  triangles, frame −12 to −14 %; [record](observations/perf-heavy-props-2026-11-11.md)).
  Sun shadow cadence: one depth map per cascade, the far cascade every second frame (shadow draws −31 to −42 %,
  renderer CPU −15 to −19 %, GPU memory −72 MB on high; [record](observations/perf-shadows-2026-11-11.md)). It relies
  on `SunShadowNode` internals: recheck shadows on both backends after any three.js SHA bump.
  Opaque shadow shader consolidation cuts programs 287 → 224 high / 267 → 206 low and median compile + warm-up
  8–18% across tiers/profile-cache states, with equivalent screenshots on both backends
  ([record](observations/perf-shaders-2026-11-12.md)).
  Boot part 4 removes curb-ring interior visits, short-circuits corner-link band checks and adds an outline-distance
  hierarchy: precompile init 7.16 → 6.70 s at 1× / 45.42 → 42.74 s at 6×, with identical build hashes and unchanged
  retained heap ([record](observations/perf-boot-4-2026-11-12.md)).
  Boot part 5 reuses park lots and trims signal-placement work: precompile init 6.63 → 6.29 s at 1× /
  43.04 → 40.78 s at 6×, with matching build hashes and unchanged retained heap
  ([record](observations/perf-boot-5-2026-11-12.md)).
  Cached per-pass chunk boxes reduce submitted triangles by up to 10% with fewer draws and unchanged programs;
  GPU-time savings remain unproven ([record](observations/perf-culling-2026-11-12.md)).
  Next steps, in order:
  1. **Measure real devices** with `?stats=1` (a phone in the default low tier, an integrated-GPU laptop, an iPad in
     Safari where the GPU model is masked) and let those reports pick the next target; extend the GPU table in
     `graphics-quality.js` from them.
  2. **Scene shader compile** still takes ~1 s on this Mac; use real-device reports to justify further material
     consolidation, and keep the full warm-up until deferred first-use hitches can be ruled out.
  3. **JS heap** (~843 MB high / ~780 MB low retained): runtime land rasters, scene/geometry buffers, remaining
     route/collider/guide indexes and shader NodeData (~38 MB) dominate. Use real-device measurements to justify
     further exact packing or geometry deduplication; shader-cache release needs a renderer-supported lifecycle.
     Post-upload attribute release remains unsafe in the pinned three.js; keep GEO/BLOCKS late-reader inputs.
  4. **Remaining boot work** after five passes: polygon/road/rail helpers still cost ~5.32 s self at 6×;
     investigate block-query callers and threshold-only `distToLots` (~0.77 s) before adding caches. Traffic (~9.54 s),
     streetDetails (~9.21 s), cityGrid (~8.09 s) and culling (~2.87 s) remain larger budgets; road-clearance box
     rejects, a centre-rail cache and fused chunk-bound passes did not beat noise. Workers or deferral would need
     pure layout/buffer boundaries (cityGrid + traffic: 17.64 s upper-bound budget), justified by real-device reports.
     The [worker boundary study](observations/perf-workers-2026-11-12.md) stopped at Stage 1: production remains
     synchronous and there is no `?workers=0` or worker path. The large phases are mostly pure logic, but a worker
     on the current chain can overlap only the next independent branch. Runtime signal heads (5.56 s) model
     2.4–3.2 s net at 6×, not clearly above 3 s; blocks/cityGrid/streetDetails return 50–73/52/15+ MiB measured
     records that the next stage waits for, and a worker's config + geodata alone retain 85 MiB. The scratch
     tram/rail worker regressed even with an unthrottled worker; page CPU throttling does not throttle a dedicated
     worker. Revisit
     workers only with a compact worker-consumable geodata/config projection or baked layouts, pure layout
     modules returning flat typed-array records, and a multi-stage pipeline measured under worker throttling and a
     process-peak budget. The raw cyclic network is not a cloneable boundary.
  5. **Remaining off-screen instances:** masts, local gas lanterns and members of intersecting chunks still dominate;
     use real-device reports to justify a conservative hierarchy/range approach, measuring per-pass CPU and buffer
     uploads. Smaller heavy-mesh cells added 52–232 draws for only 0.7–2.6% extra triangle savings and were rejected.
  6. Tree LOD / draw distance for the high tier (low already has its own profile), only if real devices need it.
  [Ranked opportunities](observations/perf-older-devices-2026-11-11.md).
- Road levels and richer road-priority classification; revisit only with a runtime consumer.
- Additional height sources (nDSM/LoD1/LoD2) and GEOPOZ machine-readable data: research candidates.

## Browser checks still outstanding

The 2026-11-11 headless Chrome pass is recorded in
[observations/browser-checks-2026-11-11.md](observations/browser-checks-2026-11-11.md). It covered part or all of the
checks below; each remaining bullet is the part that is still open.

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
- Calibrate Collegium Maius hall weather-cover elevations and outer panel specification if a measured section or
  dated refurbishment record becomes available. Its narrow gabled exterior above curved interior glazing is now
  resolved from GUGiK/GEOPOZ imagery (13 × 17 m approximation); 14 m eaves / 3.5 m rise remain model assumptions.
  [Hall-roof evidence, 2026-11-13](observations/kit-roofs-2026-11-13.md#hall-weather-roof-review-2026-11-13).
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
